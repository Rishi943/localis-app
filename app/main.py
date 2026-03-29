# app/main.py
import os
import gc
import json
import re
import time
import shutil
import asyncio
import threading
import sqlite3
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import Union, List, Dict, Any, Optional

from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
import sys

import psutil
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# --- Resolve DATA_DIR and load secret.env FIRST, before any local imports ---
# Local modules (voice.py, wakeword.py, assist.py) evaluate env-var constants at
# import time, so dotenv must be loaded before those imports run.
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent

def _default_data_dir() -> Path:
    # Persistent, writeable location for DB/models/static
    if sys.platform.startswith("win"):
        base = os.getenv("LOCALAPPDATA") or os.getenv("APPDATA") or str(Path.home())
        return Path(base) / "Localis"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Localis"
    base = os.getenv("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "localis"

DATA_DIR = Path(os.getenv("LOCALIS_DATA_DIR") or _default_data_dir())
DATA_DIR.mkdir(parents=True, exist_ok=True)

if (DATA_DIR / "secret.env").exists():
    load_dotenv(dotenv_path=DATA_DIR / "secret.env")
else:
    load_dotenv(dotenv_path=PROJECT_ROOT / "secret.env")

try:
    import pynvml as _pynvml
    _pynvml.nvmlInit()
    _NVML_OK = True
except Exception:
    _NVML_OK = False

# --- Now safe to import local modules (env vars are set) ---
from .setup_wizard import register_setup_wizard
from .updater import register_updater
from .rag import register_rag
from .assist import register_assist
from .voice import register_voice
from .wakeword import register_wakeword
from .finance import register_finance
from .notes import register_notes


# ------------------------------
# Internal Modules
# ------------------------------
# memory_core is the only memory module.
from . import database, memory_core, tools, rag_vector

# ------------------------------
# llama.cpp Python binding
# ------------------------------
from llama_cpp import Llama

# ------------------------------
# Configuration
# ------------------------------

# (DATA_DIR and load_dotenv already resolved at top of file, before local imports)

# Debug configuration
def parse_bool_env(name: str, default: bool = False) -> bool:
    """Parse boolean environment variable (1/true/yes = True, 0/false/no = False)"""
    val = os.getenv(name, "").lower()
    if val in ("1", "true", "yes"):
        return True
    if val in ("0", "false", "no"):
        return False
    return default

DEBUG = parse_bool_env("LOCALIS_DEBUG", False)

# --- Logging setup ---
import logging.handlers as _logging_handlers

_LOG_DIR = DATA_DIR / "logs"
_LOG_DIR.mkdir(parents=True, exist_ok=True)
_LOG_FILE = _LOG_DIR / "localis.log"

_fmt = logging.Formatter("[%(levelname)s] %(message)s")
_file_fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s",
                               datefmt="%Y-%m-%d %H:%M:%S")

_stream_handler = logging.StreamHandler()
_stream_handler.setFormatter(_fmt)

_file_handler = _logging_handlers.RotatingFileHandler(
    _LOG_FILE, maxBytes=10 * 1024 * 1024, backupCount=3, encoding="utf-8"
)
_file_handler.setFormatter(_file_fmt)

_root = logging.getLogger()
_root.setLevel(logging.DEBUG if DEBUG else logging.INFO)
_root.addHandler(_stream_handler)
_root.addHandler(_file_handler)

# Silence chatty third-party loggers
for _lib in ("httpx", "httpcore", "multipart", "hpack", "urllib3",
             "sentence_transformers", "transformers", "huggingface_hub",
             "chromadb", "uvicorn.access",
             "wsproto", "websockets", "websockets.server",
             "websockets.client", "websockets.protocol"):
    logging.getLogger(_lib).setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

# Persist DB in user data dir (NOT next to the exe)
database.DB_NAME = str(DATA_DIR / "chat_history.db")

# Models live in user data dir by default
MODELS_DIR = Path(os.getenv("MODEL_PATH") or (DATA_DIR / "models"))

INDEX_TEMPLATE_PATH = BASE_DIR / "templates" / "index.html"

# Serve /static from a writeable, persistent location so wallpaper, etc. survive restarts
RESOURCE_STATIC_DIR = BASE_DIR / "static"      # bundled assets (read-only-ish)
STATIC_DIR = DATA_DIR / "static"              # persistent copy (writeable)

def _seed_static_assets():
    """
    Syncs shipped static assets from RESOURCE_STATIC_DIR into STATIC_DIR.
    Overwrites shipped assets to apply updates after git pull.
    Preserves user-owned files (wallpaper.bg, .temp_user_name).
    """
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    if not RESOURCE_STATIC_DIR.exists():
        return

    # User-owned files that should not be overwritten
    USER_OWNED_FILES = {"wallpaper.bg", ".temp_user_name"}

    for src in RESOURCE_STATIC_DIR.rglob("*"):
        if src.is_dir():
            continue
        rel = src.relative_to(RESOURCE_STATIC_DIR)
        dst = STATIC_DIR / rel

        # Skip user-owned files to preserve them
        if dst.name in USER_OWNED_FILES:
            # Only copy if it doesn't exist (first-time setup)
            if not dst.exists():
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
            continue

        # Overwrite all other shipped assets (sync updates)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

_seed_static_assets()


# ------------------------------
# Global State
# ------------------------------
current_model: Llama | None = None
current_model_name: str | None = None

# Global Inference Lock (Router + Gen)
# Protects the shared llama-cpp-python instance from concurrent access
MODEL_LOCK = threading.Lock()

# Tutorial System Prompts (In-Memory, Session-Scoped)
# Stores temporary system prompts for tutorial experimentation
tutorial_prompts: Dict[str, str] = {}

# Predefined Tutorial Prompts
PROMPT_DEFAULT = (
    "You are Localis, a private AI assistant running entirely on the user's own hardware. "
    "You are helpful, concise, and honest.\n\n"
    "Tool usage guidelines:\n"
    "- Use web.search for live/recent information only (news, scores, prices, current events). "
    "Do not search for things you already know.\n"
    "- Use home.set_light or home.get_device_state only when the user explicitly asks to "
    "control or check a device.\n"
    "- Use notes.add when the user asks to save a note, reminder, or task.\n"
    "- Use notes.retrieve when the user asks about their saved notes or upcoming reminders.\n"
    "- Use memory.retrieve when a query seems personal and prior context would help.\n"
    "- Use memory.write only when the user explicitly asks you to remember something.\n"
    "- If no tool is needed, answer directly.\n\n"
    "You do not have internet access unless a web.search tool result is provided. "
    "Never fabricate search results."
)
PROMPT_PIRATE = "You are a friendly pirate captain. Speak like a pirate, but still be helpful. Use pirate slang naturally."


def get_permitted_tools(web_search_on: bool) -> list:
    """
    Returns llama-cpp-python compatible tool definition list based on current config.
    web_search_on: True when web_search_mode == 'on'.
    HA tools included only when HA is configured.
    Notes and memory tools always included.
    """
    from .assist import is_ha_configured
    result = []

    if web_search_on:
        result.append({
            "type": "function",
            "function": {
                "name": "web.search",
                "description": (
                    "Search the web for real-time information: current events, live scores, "
                    "prices, news, weather. Do NOT use for things you can answer from knowledge."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Specific, time-anchored search query."}
                    },
                    "required": ["query"]
                }
            }
        })

    if is_ha_configured():
        result.append({
            "type": "function",
            "function": {
                "name": "home.set_light",
                "description": (
                    "Control the bedroom light (entity: light.rishi_room_light). "
                    "Use only when the user explicitly asks to control the light."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "state": {"type": "string", "enum": ["on", "off"]},
                        "brightness": {
                            "type": "integer",
                            "description": "Brightness 0-255. Omit to keep current.",
                            "minimum": 0, "maximum": 255
                        },
                        "color_name": {
                            "type": "string",
                            "description": "Color name e.g. 'red', 'blue', 'warm white'. Omit to keep current."
                        }
                    },
                    "required": ["state"]
                }
            }
        })
        result.append({
            "type": "function",
            "function": {
                "name": "home.get_device_state",
                "description": "Get the current state of a home device.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "entity_id": {
                            "type": "string",
                            "description": "HA entity ID e.g. 'light.rishi_room_light'"
                        }
                    },
                    "required": ["entity_id"]
                }
            }
        })

    result.append({
        "type": "function",
        "function": {
            "name": "notes.add",
            "description": "Save a note or reminder. Use when user says 'remind me', 'add note', 'note this', 'jot down'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {"type": "string"},
                    "note_type": {"type": "string", "enum": ["note", "reminder"], "default": "note"},
                    "due_at": {
                        "type": "string",
                        "description": "ISO8601 UTC datetime for reminders e.g. '2026-03-29T09:00:00Z'. Null for plain notes."
                    }
                },
                "required": ["content"]
            }
        }
    })
    result.append({
        "type": "function",
        "function": {
            "name": "notes.retrieve",
            "description": "Retrieve saved notes and reminders. Use when user asks about their notes, tasks, or upcoming reminders.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filter": {
                        "type": "string",
                        "enum": ["all", "notes", "reminders", "due_soon"],
                        "default": "all"
                    }
                }
            }
        }
    })
    result.append({
        "type": "function",
        "function": {
            "name": "memory.retrieve",
            "description": "Search the user's personal memory for relevant facts, preferences, and history.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"}
                },
                "required": ["query"]
            }
        }
    })
    result.append({
        "type": "function",
        "function": {
            "name": "memory.write",
            "description": "Save a fact about the user to memory. Use ONLY when user explicitly asks you to remember something.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "Category key e.g. 'preference', 'fact'"},
                    "value": {"type": "string"}
                },
                "required": ["key", "value"]
            }
        }
    })

    return result


async def execute_tool_call(
    tool_name: str,
    tool_args: dict,
    user_msg: str,
    session_id: str,
    web_search_provider: str | None,
    web_search_custom_endpoint: str | None,
    web_search_custom_api_key: str | None,
) -> str:
    """
    Dispatch a single LLM tool call. Returns a plain-text result string.
    Never raises — catches all exceptions and returns an error string.
    """
    try:
        # --- Web Search ---
        if tool_name == "web.search":
            query = tool_args.get("query", user_msg)
            provider = web_search_provider or database.get_app_setting("web_search_provider") or "auto"
            endpoint = web_search_custom_endpoint or database.get_app_setting("web_search_custom_endpoint")
            result = await tools.tool_web_search(
                query=query, provider=provider,
                custom_endpoint=endpoint, custom_api_key=web_search_custom_api_key
            )
            return result if not result.startswith("ERROR") else f"Web search failed: {result}"

        # --- Home Assistant ---
        elif tool_name == "home.set_light":
            from .assist import execute_home_set_light, is_ha_configured
            if not is_ha_configured():
                return "Home Assistant is not configured."
            return await execute_home_set_light(
                state=tool_args.get("state", "on"),
                brightness=tool_args.get("brightness"),
                color_name=tool_args.get("color_name"),
            )

        elif tool_name == "home.get_device_state":
            from .assist import execute_home_get_state, is_ha_configured
            if not is_ha_configured():
                return "Home Assistant is not configured."
            return await execute_home_get_state(
                entity_id=tool_args.get("entity_id", "light.rishi_room_light")
            )

        # --- Notes ---
        elif tool_name == "notes.add":
            import sqlite3 as _sqlite3, uuid as _uuid
            from datetime import datetime as _dt2, timezone as _tz2
            content = tool_args.get("content", "").strip()
            if not content:
                return "Could not save note — content was empty."
            note_type = tool_args.get("note_type", "note")
            due_at = tool_args.get("due_at") or None
            note_id = str(_uuid.uuid4())
            now = _dt2.now(_tz2.utc).isoformat()
            conn = _sqlite3.connect(database.DB_NAME)
            conn.execute(
                "INSERT INTO notes (id, content, note_type, due_at, color, pinned, dismissed, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, 'default', 0, NULL, ?, ?)",
                (note_id, content, note_type, due_at, now, now)
            )
            conn.commit()
            conn.close()
            if note_type == "reminder" and due_at:
                return f"Reminder set: \"{content}\" due {due_at}."
            return f"Note saved: \"{content}\"."

        elif tool_name == "notes.retrieve":
            import sqlite3 as _sqlite3
            note_filter = tool_args.get("filter", "all")
            conn = _sqlite3.connect(database.DB_NAME)
            if note_filter == "reminders":
                rows = conn.execute(
                    "SELECT content, note_type, due_at FROM notes WHERE dismissed IS NULL "
                    "AND note_type='reminder' ORDER BY created_at DESC LIMIT 10"
                ).fetchall()
            elif note_filter == "notes":
                rows = conn.execute(
                    "SELECT content, note_type, due_at FROM notes WHERE dismissed IS NULL "
                    "AND note_type='note' ORDER BY created_at DESC LIMIT 10"
                ).fetchall()
            elif note_filter == "due_soon":
                rows = conn.execute(
                    "SELECT content, note_type, due_at FROM notes WHERE dismissed IS NULL "
                    "AND due_at IS NOT NULL ORDER BY due_at ASC LIMIT 10"
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT content, note_type, due_at FROM notes WHERE dismissed IS NULL "
                    "ORDER BY created_at DESC LIMIT 10"
                ).fetchall()
            conn.close()
            if not rows:
                return "No notes found."
            parts = []
            for content, note_type, due_at in rows:
                if note_type == "reminder" and due_at:
                    parts.append(f"Reminder: {content} (due {due_at[:10]})")
                else:
                    parts.append(f"Note: {content}")
            return "\n".join(parts)

        # --- Memory ---
        elif tool_name == "memory.retrieve":
            query = tool_args.get("query", user_msg)
            return memory_core.tool_memory_retrieve(query=query, session_id=session_id)

        elif tool_name == "memory.write":
            key = tool_args.get("key", "fact").strip()
            value = tool_args.get("value", "").strip()
            if not value:
                return "Could not save memory — value was empty."
            res = memory_core.tool_memory_write(
                session_id=session_id, key=key, value=value,
                intent="preference", authority="user_explicit",
                source="user", confidence=0.9,
                reason="llm_tool_write", target="tier_b"
            )
            if res.get("ok"):
                return f"Remembered: {key} = {value}."
            return f"Memory write skipped: {res.get('skipped_reason', 'unknown')}."

        else:
            return f"Unknown tool: {tool_name}"

    except Exception as e:
        logger.error(f"[Tool] {tool_name} failed: {e}", exc_info=True)
        return f"Tool {tool_name} encountered an error: {str(e)}"


# Notes Tool Schemas (for router LLM tool calling)
# Referenced by execute_tool() and can be injected into any router system prompt.
# Uses the same function-calling schema format as assist.py _build_tool_schema().
NOTES_TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "notes.add",
            "description": (
                "Save a new note or reminder to the user's notepad. "
                "Use for: 'add note', 'remember this', 'remind me to X at Y time'. "
                "For reminders, resolve relative times (tomorrow, in 2 hours, end of day) "
                "to ISO8601 UTC using the current datetime provided in the system context. "
                "Defaults: 'tomorrow' with no time → 9:00 AM user local time converted to UTC; "
                "'end of day' → 17:00 local time converted to UTC."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": "The note or reminder content."
                    },
                    "note_type": {
                        "type": "string",
                        "enum": ["note", "reminder"],
                        "description": "'note' for plain notes, 'reminder' for timed reminders."
                    },
                    "due_at": {
                        "type": "string",
                        "description": (
                            "ISO8601 UTC datetime for reminders (e.g. '2026-03-20T09:00:00Z'). "
                            "Null for plain notes."
                        )
                    },
                    "color": {
                        "type": "string",
                        "enum": ["default", "deep-blue", "dark-teal", "amber-night", "rose-night", "mauve-glass"],
                        "description": "Card background color in the notes dashboard (optional, default 'default')."
                    }
                },
                "required": ["content", "note_type"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "notes.retrieve",
            "description": (
                "Retrieve the user's saved notes and reminders to answer questions about them. "
                "Use for: 'what did I note about X', 'show my notes', 'do I have a reminder about Y'. "
                "Results are injected into system prompt context only — not added to conversation history."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search term to filter notes by content. Leave empty to retrieve all notes."
                    }
                }
            }
        }
    }
]


# ------------------------------
# Helper Functions
# ------------------------------
def _load_model_internal(model_name: str, n_gpu_layers: int, n_ctx: int):
    """Internal logic to load a model."""
    global current_model, current_model_name

    path = MODELS_DIR / model_name
    if not path.exists():
        raise FileNotFoundError(f"Model {model_name} not found at {path}")

    # Unload existing to free VRAM
    if current_model:
        logger.info("[System] Unloading previous model...")
        # Call close() if available for cleaner shutdown
        if hasattr(current_model, 'close'):
            try:
                current_model.close()
            except Exception as e:
                logger.debug(f"[System] Model close() failed: {e}")
        del current_model
        gc.collect()

    # Check GPU backend availability
    gpu_available = False
    try:
        import torch
        gpu_available = torch.cuda.is_available()
    except ImportError:
        gpu_available = False

    # Environment overrides for performance tuning
    n_threads = int(os.getenv("LOCALIS_MODEL_THREADS", "6"))
    n_batch = int(os.getenv("LOCALIS_MODEL_BATCH", "1024"))
    n_ubatch = int(os.getenv("LOCALIS_MODEL_UBATCH", "512"))

    # GPU-specific optimizations: only enable if GPU layers requested AND GPU available
    use_flash_attn = (n_gpu_layers > 0 and gpu_available)
    use_offload_kqv = (n_gpu_layers > 0 and gpu_available)

    # Log performance parameters
    logger.info(f"[System] Loading {model_name}")
    logger.info(f"  GPU Layers: {n_gpu_layers}")
    logger.info(f"  Context: {n_ctx}")
    logger.info(f"  Batch Size: {n_batch}")
    logger.info(f"  Physical Batch: {n_ubatch}")
    logger.info(f"  Threads: {n_threads}")
    logger.info(f"  Flash Attention: {use_flash_attn}")
    logger.info(f"  Offload KQV: {use_offload_kqv}")

    current_model = Llama(
        model_path=str(path),
        n_gpu_layers=n_gpu_layers,
        n_ctx=n_ctx,
        n_batch=n_batch,
        n_ubatch=n_ubatch,
        n_threads=n_threads,
        flash_attn=use_flash_attn,
        offload_kqv=use_offload_kqv,
        verbose=DEBUG,  # Gate verbose output behind debug flag
    )
    current_model_name = model_name

    # Verify GPU usage after loading
    logger.info("[System] Model loaded successfully")

    if n_gpu_layers > 0:
        if gpu_available:
            logger.info(f"[System] GPU offload active ({n_gpu_layers} layers)")
            try:
                import torch
                logger.info(f"[System] CUDA: {torch.cuda.get_device_name(0)}")
                logger.info(f"[System] VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f}GB")
            except Exception:
                pass
        else:
            logger.warning("[System] WARNING: GPU offload requested but no CUDA backend available!")
            logger.warning("[System] Model will run on CPU only (slower performance)")

    return current_model_name


# ------------------------------
# App & Lifecycle
# ------------------------------
app = FastAPI(title="Localis")
app.state.debug = DEBUG  # Expose debug flag to frontend
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


register_setup_wizard(app, MODELS_DIR)
register_updater(app, PROJECT_ROOT)
register_rag(app, DATA_DIR)
register_assist(app, MODELS_DIR, DEBUG)
register_voice(app, DATA_DIR)
register_wakeword(app, DATA_DIR)
register_finance(app, str(database.DB_NAME))
register_notes(app, str(database.DB_NAME))



@app.on_event("startup")
async def _startup():
    # Re-silence protocol loggers in case uvicorn's dictConfig reset them
    for _proto_lib in ("wsproto", "websockets", "websockets.server",
                       "websockets.client", "websockets.protocol"):
        logging.getLogger(_proto_lib).setLevel(logging.WARNING)

    logger.info("[System] Initializing database...")
    database.init_db()

    # Preload/warm embeddings at startup to avoid first-use latency.
    try:
        logger.info("[System] Preloading embedding model...")
        emb = memory_core.get_embedder()
        if emb:
            try:
                memory_core.embed_text("warmup")
            except Exception:
                pass
            logger.info("[System] Embedding model ready.")
        else:
            logger.warning("[System] Embedding model unavailable (missing deps or load failure).")
    except Exception as e:
        logger.warning(f"[System] Embedding preload failed (continuing without embeddings): {e}")

    # Ensure models directory exists
    if not MODELS_DIR.exists():
        logger.info(f"[System] Creating models directory at: {MODELS_DIR}")
        MODELS_DIR.mkdir(parents=True, exist_ok=True)

    # Auto-load logic
    # We now strictly use app_settings for configuration.

    # 1. Check Tutorial Completion (Backward Compat Rule)
    # If key is missing (None), assume it's a legacy install -> Completed (True).
    # If key exists, parse "true" as True, anything else as False.
    tutorial_setting = database.get_app_setting("tutorial_completed")
    if tutorial_setting is None:
        tutorial_completed = True
    else:
        tutorial_completed = (tutorial_setting == "true")

    # 2. Get Defaults
    default_model_name = database.get_app_setting("default_model_name")

    # Context Size: Default to 4096 if missing or invalid
    default_ctx_str = database.get_app_setting("default_ctx_size")
    try:
        n_ctx = int(default_ctx_str) if default_ctx_str else 4096
    except ValueError:
        n_ctx = 4096

    if not tutorial_completed:
        logger.info("[System] First run detected (tutorial incomplete). Skipping model auto-load.")
    else:
        try:
            models = sorted(list(MODELS_DIR.glob("*.gguf")))
            if models:
                target_model = None

                # 1. Try Default Preference
                if default_model_name:
                    for m in models:
                        if m.name == default_model_name:
                            target_model = m.name
                            logger.info(f"[System] Found preferred default model: {target_model}")
                            break
                    if not target_model:
                        logger.warning(f"[System] Default model '{default_model_name}' not found. Falling back.")

                # 2. Fallback to First Available
                if not target_model:
                    target_model = models[0].name
                    logger.info(f"[System] Auto-loading fallback model: {target_model}")

                _load_model_internal(target_model, n_gpu_layers=35, n_ctx=n_ctx)
                logger.info("[System] Auto-load complete.")
            else:
                logger.warning("[System] No .gguf models found in 'models/' directory. Please add one.")
        except Exception as e:
            logger.error(f"[System] Auto-load failed: {e}")

    psutil.cpu_percent(interval=None)  # warm up; first call always returns 0.0


@app.on_event("shutdown")
async def _shutdown():
    if _NVML_OK:
        try:
            _pynvml.nvmlShutdown()
        except Exception:
            pass


# ------------------------------
# Pydantic Models
# ------------------------------
class ChatRequest(BaseModel):
    message: str
    session_id: str
    system_prompt: str | None = None
    temperature: float = 0.7
    max_tokens: int = 1024
    top_p: float = 0.95

    # Legacy flag (mapped to web_search_mode="enabled")
    use_search: bool = False

    # New Modes
    web_search_mode: str = "off"  # "off", "enabled", "auto"
    memory_mode: str = "auto"     # "off", "auto"
    think_mode: bool = False      # Enable step-by-step reasoning in <thinking> tags

    # Search Provider Plumbing
    web_search_provider: str | None = None  # "auto" | "brave" | "tavily" | "custom"
    web_search_custom_endpoint: str | None = None
    web_search_custom_api_key: str | None = None

    # Manual Tools (frontend-driven)
    # Can be simple strings ["web_search"] or structured objects [{"type": "web_search", "config": {...}}]
    tool_actions: List[str | Dict[str, Any]] | None = None

    # Assist Mode
    assist_mode: bool = False
    input_mode: str = "text"  # "text" | "voice"


class TutorialChatRequest(BaseModel):
    message: str
    history: List[Dict[str, str]] = Field(default_factory=list)  # Correct mutable default
    session_id: Optional[str] = None
    system_prompt: str | None = None
    allow_context: bool = False
    temperature: float = 0.7
    max_tokens: int = 1024
    top_p: float = 0.95
    web_search_mode: str = "off" # Default off for tutorial simplicity


class TutorialCommitRequest(BaseModel):
    tier_a: Dict[str, str]
    tier_b: List[Dict[str, str]]  # List of {key: str, value: str}
    defaults: Dict[str, Any]


class ModelLoadRequest(BaseModel):
    model_name: str
    n_gpu_layers: int = 35
    n_ctx: int = 4096


class MemoryUpsertRequest(BaseModel):
    target: str  # "tier_a" | "tier_b"
    key: str
    value: str


class TutorialSwapPromptRequest(BaseModel):
    session_id: str
    prompt_text: str


class SystemPromptRequest(BaseModel):
    prompt: str
    name: Optional[str] = None


class AppSettingsRequest(BaseModel):
    accent_color: Optional[str] = None
    wallpaper_opacity: Optional[float] = None
    gpu_layers: Optional[int] = None
    context_size: Optional[int] = None
    active_profile: Optional[str] = None
    custom_profile_prompt: Optional[str] = None


# ------------------------------
# Routes: UI & Static
# ------------------------------
@app.get("/", response_class=HTMLResponse)
async def serve_ui():
    if not INDEX_TEMPLATE_PATH.exists():
        return HTMLResponse(content="Error: index.html not found in app/templates", status_code=404)
    content = INDEX_TEMPLATE_PATH.read_text("utf-8")
    voice_key = os.getenv("LOCALIS_VOICE_KEY", "")
    if voice_key:
        injection = f'<script>window._LOCALIS_VOICE_KEY={json.dumps(voice_key)};</script>\n'
        content = content.replace("</head>", injection + "</head>", 1)
    return HTMLResponse(content=content)


# ------------------------------
# Routes: System / Settings
# ------------------------------
@app.get("/app/state")
async def get_app_state():
    """Returns the current application state for frontend initialization."""
    # Logic matches startup: None -> True (legacy), "true" -> True, else False
    tutorial_setting = database.get_app_setting("tutorial_completed")
    if tutorial_setting is None:
        tutorial_completed = True
    else:
        tutorial_completed = (tutorial_setting == "true")

    # Get all settings and filter allowed keys
    all_settings = database.get_all_app_settings()

    allowed_keys = {
        "default_model_name", "default_ctx_size", "default_max_tokens",
        "default_temperature", "default_temp_profile", "default_system_prompt",
        "web_search_mode", "web_search_provider", "web_search_custom_endpoint",
        "theme", "accent_color", "background_image", "background_opacity"
    }

    defaults = {k: v for k, v in all_settings.items() if k in allowed_keys}

    return {
        "tutorial_completed": tutorial_completed,
        "defaults": defaults,
        "current_model": current_model_name,
        "models_dir_exists": MODELS_DIR.exists(),
        "debug": DEBUG,  # Expose debug flag to frontend
        "n_ctx": (current_model.n_ctx if current_model and hasattr(current_model, 'n_ctx')
                  else int(database.get_app_setting('n_ctx') or 8192)),
    }


@app.get("/models")
async def list_models():
    if not MODELS_DIR.exists():
        return {"models": [], "current": current_model_name}

    model_files = sorted([f for f in MODELS_DIR.glob("*.gguf")])
    models_data = []

    for f in model_files:
        size_gb = round(f.stat().st_size / (1024 * 1024 * 1024), 2)
        models_data.append({"name": f.name, "size_gb": size_gb})

    return {"models": models_data, "current": current_model_name}


@app.post("/models/load")
async def load_model_route(req: ModelLoadRequest):
    global current_model, current_model_name

    if current_model_name == req.model_name and current_model:
        return {"status": "ok", "loaded": req.model_name}

    try:
        with MODEL_LOCK:
            loaded_name = _load_model_internal(req.model_name, req.n_gpu_layers, req.n_ctx)
        return {"status": "success", "loaded": loaded_name}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Model file not found")
    except Exception as e:
        logger.error(f"[System] Load failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/models/unload")
async def unload_model_route():
    """Unload the current model to free resources."""
    global current_model, current_model_name

    with MODEL_LOCK:
        if current_model:
            logger.info("[System] Unloading model...")
            # Call close() if available for cleaner shutdown
            if hasattr(current_model, 'close'):
                try:
                    current_model.close()
                except Exception as e:
                    logger.debug(f"[System] Model close() failed: {e}")
            del current_model
            current_model = None
            current_model_name = None
            gc.collect()
            logger.info("[System] Model unloaded.")
            return {"status": "ok", "message": "Model unloaded"}
        else:
            return {"status": "ok", "message": "No model was loaded"}


@app.post("/settings/wallpaper")
async def upload_wallpaper(file: UploadFile = File(...)):
    """Handles background image upload."""
    try:
        dest_path = STATIC_DIR / "wallpaper.bg"
        with dest_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        return {"url": f"/static/wallpaper.bg?v={int(time.time())}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@app.delete("/settings/wallpaper")
async def delete_wallpaper():
    """Removes the custom wallpaper."""
    dest_path = STATIC_DIR / "wallpaper.bg"
    if dest_path.exists():
        dest_path.unlink()
    return {"status": "deleted"}


@app.get("/settings/default-system-prompt")
async def get_default_system_prompt():
    """Get the persisted default system prompt."""
    prompt = database.get_app_setting("default_system_prompt")
    if prompt is None:
        prompt = PROMPT_DEFAULT
    return {"prompt": prompt}


@app.post("/settings/default-system-prompt")
async def save_default_system_prompt(req: SystemPromptRequest):
    """Save the default system prompt to app settings."""
    prompt = req.prompt.strip() if req.prompt else ""
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt cannot be empty")

    database.set_app_setting("default_system_prompt", prompt)
    return {"status": "ok", "prompt": prompt}


@app.post("/settings/system-prompt")
async def save_system_prompt(req: SystemPromptRequest):
    """
    Saves the personalized system prompt and user name.
    Stores name in memory for future reference.
    """
    try:
        prompt = req.prompt.strip()
        name = (req.name or "").strip()

        if not prompt:
            raise HTTPException(status_code=400, detail="prompt is required")

        # Store the system prompt in global state (for tutorial/current session)
        # This will be used in tutorial/commit to finalize settings
        global tutorial_prompts

        # Use a default session ID for questionnaire-derived prompt
        temp_session_id = "__questionnaire_prompt__"
        tutorial_prompts[temp_session_id] = prompt

        # If name provided, attempt to store it in memory
        # This requires a session context, so it's stored for later application
        if name:
            # Store in a temporary location that tutorial/commit can access
            with open(STATIC_DIR / ".temp_user_name", "w") as f:
                f.write(name)

        return {
            "status": "ok",
            "prompt_saved": True,
            "name_saved": bool(name)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save system prompt: {str(e)}")


# ------------------------------
# Routes: Data / Sessions
# ------------------------------
@app.get("/sessions")
async def get_sessions():
    return {"sessions": database.get_recent_sessions(20)}


@app.delete("/sessions/{session_id}")
async def delete_session_endpoint(session_id: str):
    # 1. Delete DB records (messages, rag_files, session row)
    db_deleted = database.delete_session(session_id)

    # 2. Delete RAG files on disk
    rag_cleaned = False
    try:
        safe_sess = re.sub(r"[^a-zA-Z0-9_-]", "_", session_id)
        session_rag_dir = DATA_DIR / "rag" / "sessions" / safe_sess
        if session_rag_dir.exists():
            shutil.rmtree(session_rag_dir)
            rag_cleaned = True
    except Exception as e:
        logger.warning(f"[Session Delete] RAG disk cleanup failed: {e}")

    # 3. Delete Chroma vectors
    try:
        rag_vector.delete_session_collection(session_id, DATA_DIR)
        rag_cleaned = True
    except Exception as e:
        logger.warning(f"[Session Delete] Chroma cleanup failed: {e}")

    if not db_deleted:
        raise HTTPException(status_code=404, detail="Session not found")

    return {"ok": True, "rag_cleaned": rag_cleaned}


@app.get("/history/{session_id}")
async def get_history(session_id: str):
    return database.get_chat_history(session_id)


@app.get("/memory/events/{session_id}")
async def get_memory_events(session_id: str):
    return database.get_memory_events(session_id)


# ------------------------------
# Routes: Memory Management
# ------------------------------
@app.get("/memory")
async def get_all_memory():
    """Returns all Tier A and Tier B memories."""
    # Assuming database module has these functions or helper logic
    # Since database.py was not provided with these exact function names in the snippet,
    # we will implement a direct query approach if needed or assume existence.
    # The prompt implies adding memory endpoints for the UI.

    # We'll use the existing generic fetchers if specific ones aren't available,
    # but based on the prompt "database.get_core_user_memories_with_meta()",
    # we will assume we need to implement this logic if it's missing or call it.
    # Let's verify if database.py has them. If not, we'll query directly here for safety.

    # Direct DB query implementation for robustness since we can't edit database.py here
    conn = sqlite3.connect(database.DB_NAME)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # Tier A (Identity)
    c.execute("""
        SELECT um.key, um.value, um.category, um.last_updated, meta.meta_json
        FROM user_memory um
        LEFT JOIN user_memory_meta meta ON um.key = meta.key
        WHERE um.category = 'identity'
    """)
    tier_a_rows = c.fetchall()

    # Tier B (Extended/Auto)
    c.execute("""
        SELECT um.key, um.value, um.category, um.last_updated, meta.meta_json
        FROM user_memory um
        LEFT JOIN user_memory_meta meta ON um.key = meta.key
        WHERE um.category != 'identity'
    """)
    tier_b_rows = c.fetchall()
    conn.close()

    def format_rows(rows):
        res = []
        for r in rows:
            d = dict(r)
            if d.get("meta_json"):
                try:
                    d["meta"] = json.loads(d["meta_json"])
                except:
                    d["meta"] = {}
            del d["meta_json"]
            res.append(d)
        return res

    return {
        "tier_a": format_rows(tier_a_rows),
        "tier_b": format_rows(tier_b_rows)
    }


@app.post("/memory/upsert")
async def upsert_memory(req: MemoryUpsertRequest):
    """
    Manually add or update a memory item (Tier A or Tier B).
    """
    target = req.target.lower()
    key = req.key.strip()
    value = req.value.strip()

    if not key or not value:
        raise HTTPException(status_code=400, detail="Key and value must not be empty.")

    if target == "tier_a":
        # Enforce key in Tier A allow-list
        safe_key = database._safe_key(key)
        if safe_key not in memory_core.TIER_A_KEYS:
             raise HTTPException(status_code=400, detail=f"Key '{key}' is not allowed in Tier A (Identity).")

        res = memory_core.tool_memory_write(
            session_id="ui_edit",
            key=safe_key,
            value=value,
            intent="identity",
            authority="user_explicit",
            source="user",
            confidence=1.0,
            reason="ui_edit",
            target="tier_a"
        )

    elif target == "tier_b":
        safe_key = database._safe_key(key)
        # Allow misc fallback
        if safe_key not in database.ALLOWED_AUTO_MEMORY_KEYS:
            safe_key = "misc"

        res = memory_core.tool_memory_write(
            session_id="ui_edit",
            key=safe_key,
            value=value,
            intent="preference",
            authority="user_explicit",
            source="user",
            confidence=1.0,
            reason="ui_edit",
            target="tier_b"
        )
    else:
        raise HTTPException(status_code=400, detail="Invalid target. Must be 'tier_a' or 'tier_b'.")

    return {"ok": res.get("ok", False), "key": res.get("key"), "value": res.get("value")}


@app.delete("/memory/{key}")
async def delete_memory_endpoint(key: str):
    """
    Delete a specific memory key.
    """
    success = memory_core.forget_memory(key, session_id="ui_delete")
    return {"ok": success}


# ------------------------------
# Routes: Debug
# ------------------------------
@app.get("/debug/context")
async def debug_context_endpoint(
    session_id: str,
    user_prompt: str = "What's the context window size?",
    limit: int = 12
):
    """
    Returns the real context payload that would be sent to llama.cpp for debugging.
    Does not perform actual generation. Requires session_id parameter.
    """
    # Validate limit bounds (1-50)
    if limit < 1 or limit > 50:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 50")

    # Resolve system prompt (same logic as /chat)
    # Check tutorial_prompts override first, then fallback to default
    global tutorial_prompts
    if session_id in tutorial_prompts:
        system_prompt_text = tutorial_prompts[session_id]
    else:
        system_prompt_text = "You are a helpful AI assistant."

    # Load history (same as /chat uses database.get_chat_history)
    full_history = database.get_chat_history(session_id)

    # Cap history to limit to avoid huge responses
    if len(full_history) > limit:
        capped_history = full_history[-limit:]
    else:
        capped_history = full_history

    # Build messages via memory_core.build_chat_context_v2 (same call signature as /chat)
    messages = memory_core.build_chat_context_v2(
        session_id=session_id,
        system_prompt=system_prompt_text,
        chat_messages=capped_history,
        user_prompt=user_prompt,
    )

    # Get generation parameters from app settings or use defaults
    default_max_tokens_str = database.get_app_setting("default_max_tokens")
    try:
        max_tokens = int(default_max_tokens_str) if default_max_tokens_str else 1024
    except ValueError:
        max_tokens = 1024

    default_temperature_str = database.get_app_setting("default_temperature")
    try:
        temperature = float(default_temperature_str) if default_temperature_str else 0.7
    except ValueError:
        temperature = 0.7

    # top_p uses default (not stored in settings)
    top_p = 0.95

    # Get ctx_size from settings (same as startup logic)
    default_ctx_str = database.get_app_setting("default_ctx_size")
    try:
        ctx_size = int(default_ctx_str) if default_ctx_str else 4096
    except ValueError:
        ctx_size = 4096

    return {
        "system_prompt": system_prompt_text,
        "messages": messages,
        "user_prompt": user_prompt,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "top_p": top_p,
        "ctx_size": ctx_size,
        "note": "This is what we send into llama.cpp each turn."
    }


# ------------------------------
# Routes: Chat
# ------------------------------
@app.post("/chat")
async def chat_endpoint(req: ChatRequest):
    logger.debug(f"[Chat] Session: {req.session_id[:12]}... think={req.think_mode} web={req.web_search_mode} mem={req.memory_mode}")

    global current_model
    if not current_model:
        raise HTTPException(status_code=503, detail="No model loaded. Please load a model in settings.")

    session_id = req.session_id
    user_msg = req.message.strip()

    # 0. Log User Message
    database.add_message(session_id, "user", user_msg, len(user_msg) // 3)

    # Auto-title: only if this is a new session with the default title
    current_title = database.get_session_title(session_id)
    default_pattern = f"Session {session_id[:8]}"
    if current_title and (current_title == default_pattern or current_title.startswith("Session ")):
        # Sanitize: strip newlines, collapse whitespace
        clean_msg = ' '.join(user_msg.split())
        if clean_msg:
            if len(clean_msg) > 60:
                title = clean_msg[:60].rsplit(' ', 1)[0] + "…"
            else:
                title = clean_msg
        else:
            title = "New chat"
        database.update_session_title(session_id, title)

    # 1. Handle Slash Commands - Fast Path
    # We now handle /confirm and /reject manually here since memory_core might not support them yet.
    cmd = memory_core.parse_memory_command(user_msg)

    # Custom parsing for new commands if memory_core didn't catch them
    if not cmd:
        if user_msg.lower().startswith("/confirm "):
            parts = user_msg[9:].split("=", 1)
            if len(parts) == 2:
                cmd = {"cmd": "confirm", "key": parts[0].strip(), "value": parts[1].strip()}
        elif user_msg.lower().startswith("/reject "):
            # Allow /reject key or /reject key=value
            raw = user_msg[8:].strip()
            key = raw.split("=")[0].strip()
            cmd = {"cmd": "reject", "key": key}

    if cmd:
        async def cmd_stream():
            msg = ""
            if cmd["cmd"] == "remember":
                proposal = memory_core.propose_memory_write(user_msg, session_id)
                if proposal:
                    success = memory_core.apply_memory_write(proposal, session_id)
                    key_display = proposal.key if proposal.key else "misc"
                    msg = f"✅ **Memory Saved**\n- Key: `{key_display}`\n- Value: {proposal.content}"
                    if not success:
                        msg = "❌ Failed to save memory (Database Error)."
                else:
                    msg = "❌ Could not interpret memory command."

            elif cmd["cmd"] == "forget":
                success = memory_core.forget_memory(cmd["key"], session_id)
                msg = (
                    f"🗑️ **Memory Deleted**\n- Key: `{cmd['key']}`"
                    if success
                    else f"⚠️ Key `{cmd['key']}` not found."
                )

            elif cmd["cmd"] == "confirm":
                key = cmd["key"]
                val = cmd["value"]
                # Strict check: Confirm only allows Tier-A keys?
                # Or we assume user knows what they are doing. Let's enforce Tier-A check as per spec.
                if key in memory_core.TIER_A_KEYS:
                    old_val = database.get_user_memory_value(key)

                    # Force write to Tier A
                    res = memory_core.tool_memory_write(
                        session_id=session_id,
                        key=key,
                        value=val,
                        intent="identity",
                        authority="user_explicit",
                        source="user",
                        confidence=1.0,
                        reason="ui_confirmed_tier_a",
                        target="tier_a"
                    )

                    if res.get("ok"):
                        diff_text = f"Old: {old_val} → New: {val}" if old_val != val else "No change"
                        msg = f"✅ **Identity Updated (Tier-A)**\n- Key: `{key}`\n- {diff_text}"
                    else:
                        msg = f"❌ Error saving Tier-A memory: {res.get('skipped_reason')}"
                else:
                    msg = f"⚠️ Key `{key}` is not a Core Identity key. Use standard conversation for preferences."

            elif cmd["cmd"] == "reject":
                # Log event
                database.add_memory_event("user_reject_proposal", {"key": cmd["key"]}, session_id)
                msg = "🚫 **Proposal Rejected.** No changes made."

            yield f"data: {json.dumps({'content': msg, 'stop': True})}\n\n"
            database.add_message(session_id, "assistant", msg, len(msg) // 3)

        return StreamingResponse(
            cmd_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # ---------------------------------------------------------
    # 2. Context Preparation
    # ---------------------------------------------------------

    tier_a_proposals = []
    # Limit history to 20 most recent messages for faster loading in long sessions
    MAX_HISTORY_MESSAGES = 20
    history = database.get_chat_history(session_id, limit=MAX_HISTORY_MESSAGES)

    # ---------------------------------------------------------
    # 4. Build Final Context
    # ---------------------------------------------------------

    # Check for tutorial-specific system prompt first
    global tutorial_prompts
    if session_id in tutorial_prompts:
        system_prompt_text = tutorial_prompts[session_id]
        logger.debug(f"[Chat] Using tutorial system prompt for session {session_id}")
    elif req.system_prompt:
        system_prompt_text = req.system_prompt
    else:
        # Use persisted default from app settings
        system_prompt_text = database.get_app_setting("default_system_prompt") or PROMPT_DEFAULT

    # Prepend current datetime so model can anchor time-sensitive queries and tool calls
    from datetime import datetime as _dt
    _now_str = _dt.now().strftime("%A, %B %d, %Y %H:%M")
    system_prompt_text = f"Current date and time: {_now_str}\n\n{system_prompt_text}"

    # Core Context Builder (Identity + History + User)
    messages = memory_core.build_chat_context_v2(
        session_id=session_id,
        system_prompt=system_prompt_text,
        chat_messages=history[:-1] if history else [],
        user_prompt=user_msg,
    )

    # -------------------------------------------------------
    # 3. Auto-inject RAG context (passive — unchanged)
    # -------------------------------------------------------
    session_rag_files = database.rag_list_files(session_id)
    has_indexed = any(
        f.get("status") in ("chunked", "indexed") and f.get("is_active") != 0
        for f in session_rag_files
    )
    if has_indexed:
        try:
            rag_hits = rag_vector.query(session_id, user_msg, top_k=4, data_dir=DATA_DIR, truncate_chars=None)
            if rag_hits:
                rag_block = rag_vector.build_rag_context_block(rag_hits)
                if messages and messages[0].get("role") == "system":
                    messages[0]["content"] += "\n\n" + rag_block
        except Exception as e:
            logger.warning(f"[RAG] Auto-inject failed: {e}")

    # -------------------------------------------------------
    # 4. Think mode — Qwen3.5 native /think /no_think tokens
    # -------------------------------------------------------
    think_suffix = " /think" if req.think_mode else " /no_think"
    for m in reversed(messages):
        if m["role"] == "user":
            m["content"] = m["content"] + think_suffix
            break

    # -------------------------------------------------------
    # 5. Permitted tools
    # -------------------------------------------------------
    web_on = req.web_search_mode == "on"
    permitted_tools = get_permitted_tools(web_search_on=web_on)

    logger.debug(
        f"[Chat] Final Context: {len(messages)} msgs. "
        f"Tools: {[t['function']['name'] for t in permitted_tools]}. "
        f"RAG: {has_indexed}"
    )

    # Approximate prompt tokens for stats
    prompt_token_count = sum(len(m.get("content", "")) // 4 for m in messages)

    # -------------------------------------------------------
    # 6. Two-Pass Tool Calling Loop (SSE stream)
    # -------------------------------------------------------
    async def event_stream():
        loop = asyncio.get_running_loop()
        full_parts: List[str] = []

        # Emit any Tier-A memory proposals first
        for prop in tier_a_proposals:
            prop["target"] = "tier_a"
            yield f"data: {json.dumps({'content': '', 'stop': False, 'proposal': prop})}\n\n"

        # --- Pass 1: Tool Decision (non-streaming) ---
        pass1_response = None
        try:
            with MODEL_LOCK:
                pass1_response = current_model.create_chat_completion(
                    messages=messages,
                    tools=permitted_tools if permitted_tools else None,
                    tool_choice="auto" if permitted_tools else None,
                    max_tokens=req.max_tokens,
                    temperature=req.temperature,
                    top_p=req.top_p,
                    presence_penalty=1.5,
                    stream=False,
                )
        except Exception as e:
            logger.error(f"[Chat] Pass 1 failed: {e}", exc_info=True)
            yield f"data: {json.dumps({'content': f'Model error: {e}', 'stop': True})}\n\n"
            return

        choice = pass1_response["choices"][0]
        finish_reason = choice.get("finish_reason")
        assistant_message = choice.get("message", {})

        if finish_reason == "tool_calls" and assistant_message.get("tool_calls"):
            tool_calls = assistant_message["tool_calls"]

            # Emit tool_start events so frontend can animate pills immediately
            for tc in tool_calls:
                yield f"data: {json.dumps({'event_type': 'tool_start', 'tool': tc['function']['name']})}\n\n"

            # Execute all tool calls in parallel (MODEL_LOCK is NOT held here)
            async def _run_one(tc):
                name = tc["function"]["name"]
                try:
                    raw_args = tc["function"].get("arguments", "{}")
                    args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                except json.JSONDecodeError:
                    args = {}
                result_str = await execute_tool_call(
                    tool_name=name,
                    tool_args=args,
                    user_msg=user_msg,
                    session_id=session_id,
                    web_search_provider=getattr(req, 'web_search_provider', None),
                    web_search_custom_endpoint=getattr(req, 'web_search_custom_endpoint', None),
                    web_search_custom_api_key=getattr(req, 'web_search_custom_api_key', None),
                )
                return tc["id"], name, result_str

            tool_results = await asyncio.gather(*[_run_one(tc) for tc in tool_calls])

            # Emit tool_result events for frontend pill rendering
            for _tc_id, name, result_str in tool_results:
                yield f"data: {json.dumps({'event_type': 'tool_result', 'tool': name, 'results': [{'snippet': result_str[:300]}]})}\n\n"

            # Build Pass 2 context: assistant tool-call turn + tool result messages
            messages.append(assistant_message)
            for tc_id, name, result_str in tool_results:
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc_id,
                    "content": result_str,
                })

            # --- Pass 2: Final streaming response ---
            queue: asyncio.Queue = asyncio.Queue()

            def _gen_pass2():
                try:
                    with MODEL_LOCK:
                        stream = current_model.create_chat_completion(
                            messages=messages,
                            max_tokens=req.max_tokens,
                            temperature=req.temperature,
                            top_p=req.top_p,
                            presence_penalty=1.5,
                            stream=True,
                        )
                        for chunk in stream:
                            delta = chunk["choices"][0]["delta"]
                            content = delta.get("content", "")
                            if content:
                                queue.put_nowait(content)
                        queue.put_nowait(None)  # sentinel: generation complete
                except Exception as e:
                    queue.put_nowait(Exception(str(e)))

            await loop.run_in_executor(None, _gen_pass2)

            while True:
                item = await queue.get()
                if item is None:
                    break
                if isinstance(item, Exception):
                    yield f"data: {json.dumps({'content': f'Generation error: {item}', 'stop': True})}\n\n"
                    return
                full_parts.append(item)
                yield f"data: {json.dumps({'content': item, 'stop': False})}\n\n"

        else:
            # Model answered directly in Pass 1 — emit as synthetic stream, no second call
            content = assistant_message.get("content") or ""
            chunk_size = 4
            for i in range(0, len(content), chunk_size):
                chunk = content[i:i + chunk_size]
                full_parts.append(chunk)
                yield f"data: {json.dumps({'content': chunk, 'stop': False})}\n\n"

        # Terminal stop event
        full_response = "".join(full_parts)
        yield f"data: {json.dumps({'content': '', 'stop': True, 'usage': {'prompt_tokens': prompt_token_count, 'completion_tokens': len(full_response) // 4}})}\n\n"

        # Persist assistant message (non-blocking)
        await asyncio.to_thread(
            database.add_message, session_id, "assistant", full_response, len(full_response) // 4
        )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ------------------------------
# Routes: Tutorial Chat
# ------------------------------
@app.post("/tutorial/chat")
async def tutorial_chat_endpoint(req: TutorialChatRequest):
    """
    Stateless chat endpoint for the tutorial.
    Does NOT write to DB, does NOT update memory, does NOT emit events.
    Uses purely frontend-provided history + current message.
    """
    global current_model
    if not current_model:
        raise HTTPException(status_code=503, detail="No model loaded. Please load a model in settings.")

    user_msg = req.message.strip()

    # Build Context manually (Stateless)
    messages = []

    # 1. System Prompt (Determine based on session_id lookup or fallback chain)
    global tutorial_prompts
    if req.session_id and req.session_id in tutorial_prompts:
        sys_prompt = tutorial_prompts[req.session_id]
    elif req.system_prompt:
        sys_prompt = req.system_prompt
    else:
        sys_prompt = "You are a helpful AI assistant explaining how to use this application."

    messages.append({"role": "system", "content": sys_prompt})

    # 2. History (Only include if allow_context is True)
    if req.allow_context:
        # Validate structure to prevent crash
        for msg in req.history:
            if "role" in msg and "content" in msg:
                messages.append({"role": msg["role"], "content": msg["content"]})

    # 3. Current User Message
    messages.append({"role": "user", "content": user_msg})

    logger.debug(f"[Tutorial] Context size: {len(messages)} messages.")

    # Stream Response (Standard SSE format)
    async def event_stream():
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()

        error_sent = False # Prevent double stop

        def _gen_worker():
            try:
                # Use Global Lock for Generation
                with MODEL_LOCK:
                    stream = current_model.create_chat_completion(
                        messages=messages,
                        max_tokens=req.max_tokens,
                        temperature=req.temperature,
                        top_p=req.top_p,
                        stream=True,
                    )

                    for chunk in stream:
                        delta = chunk["choices"][0]["delta"]
                        content = delta.get("content", "")
                        if not content:
                            continue
                        loop.call_soon_threadsafe(queue.put_nowait, ("data", content))

                loop.call_soon_threadsafe(queue.put_nowait, ("done", None))

            except Exception as e:
                loop.call_soon_threadsafe(queue.put_nowait, ("error", str(e)))
                loop.call_soon_threadsafe(queue.put_nowait, ("done", None))

        threading.Thread(target=_gen_worker, daemon=True).start()

        while True:
            kind, payload = await queue.get()

            if kind == "data":
                yield f"data: {json.dumps({'content': payload, 'stop': False})}\n\n"
                continue

            if kind == "error":
                error_sent = True
                yield f"data: {json.dumps({'content': f'[Error: {payload}]', 'stop': True})}\n\n"
                break # Stop loop immediately on error

            if kind == "done":
                break

        # Final stop event only if we didn't already send one via error
        if not error_sent:
            yield f"data: {json.dumps({'content': '', 'stop': True})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ------------------------------
# Routes: Tutorial Swap Prompt
# ------------------------------
@app.post("/tutorial/swap-prompt")
async def tutorial_swap_prompt_endpoint(req: TutorialSwapPromptRequest):
    """
    Stores a tutorial-specific system prompt for a session.
    This is tutorial-only and does NOT affect database or app settings.
    """
    global tutorial_prompts

    session_id = req.session_id.strip()
    prompt_text = req.prompt_text.strip()

    if not session_id or not prompt_text:
        raise HTTPException(status_code=400, detail="session_id and prompt_text are required")

    # Store in session-specific temporary storage
    tutorial_prompts[session_id] = prompt_text

    logger.debug(f"[Tutorial] Swapped system prompt for session {session_id}: {prompt_text[:50]}...")

    return {"status": "ok"}


# ------------------------------
# Routes: Tutorial Commit
# ------------------------------
@app.post("/tutorial/commit")
async def tutorial_commit_endpoint(req: TutorialCommitRequest):
    """
    Finalizes the tutorial by persisting all accumulated state using a rigid atomic transaction.
    """

    # ------------------------------
    # 1. Validation (Pure Python)
    # ------------------------------

    # A) Tier A Keys Validation
    validated_tier_a = {}
    for k, v in req.tier_a.items():
        if not k or not isinstance(k, str):
            raise HTTPException(status_code=400, detail=f"Invalid Tier A key: {k}")
        if not v or not isinstance(v, str) or not v.strip():
            # Skip empty entries rather than crashing, but strict validation might demand reject.
            # Spec says "Reject empty/whitespace", so we raise.
            raise HTTPException(status_code=400, detail=f"Empty value for Tier A key: {k}")

        safe_key = database._safe_key(k)
        if safe_key not in memory_core.TIER_A_KEYS:
            raise HTTPException(status_code=400, detail=f"Unauthorized Tier A key: {safe_key}")
        validated_tier_a[safe_key] = v.strip()

    # B) Tier B Validation
    validated_tier_b = []
    seen_keys = set()  # Track duplicate keys to prevent overwrites
    for item in req.tier_b:
        raw_key = item.get("key")
        raw_val = item.get("value")

        if not raw_key or not raw_val or not raw_val.strip():
            raise HTTPException(status_code=400, detail=f"Invalid Tier B entry: {item}")

        # Enforce Max Length
        if len(raw_val) > 4000:
            raw_val = raw_val[:4000]

        safe_key = database._safe_key(raw_key)
        # Fallback to misc if not an allowed key
        if safe_key not in database.ALLOWED_AUTO_MEMORY_KEYS:
            safe_key = "misc"

        # Check for duplicates in this commit payload
        if safe_key in seen_keys:
            raise HTTPException(status_code=400, detail=f"Duplicate Tier B key: {safe_key}")
        seen_keys.add(safe_key)

        validated_tier_b.append({"key": safe_key, "value": raw_val.strip()})

    # C) Defaults Validation (Allow-list)
    ALLOWED_DEFAULTS = {
        "default_model_name", "default_ctx_size", "default_max_tokens",
        "default_temperature", "default_temp_profile", "default_system_prompt",
        "web_search_mode", "web_search_provider", "web_search_custom_endpoint",
        "theme", "accent_color",
        "background_image", "background_opacity"
    }
    validated_defaults = {}
    for k, v in req.defaults.items():
        # Skip default_system_prompt - tutorial prompt swapping shouldn't affect actual default
        if k == "default_system_prompt":
            continue
        if k in ALLOWED_DEFAULTS and v is not None:
            if isinstance(v, (dict, list, bool)):
                validated_defaults[k] = json.dumps(v)
            else:
                validated_defaults[k] = str(v).strip()

    # ------------------------------
    # 2. Atomic Execution (DB Transaction)
    # ------------------------------
    logger.info("[Tutorial] Committing results (Atomic)...")

    conn = sqlite3.connect(database.DB_NAME)
    cursor = conn.cursor()

    try:
        # Start Transaction explicitly
        cursor.execute("BEGIN")
        now = datetime.utcnow().isoformat()

        # A) Write Tier A (Identity)
        for k, v in validated_tier_a.items():
            # user_memory
            cursor.execute("""
                INSERT INTO user_memory (key, value, category, last_updated)
                VALUES (?, ?, 'identity', ?)
                ON CONFLICT(key) DO UPDATE SET
                    value=excluded.value, category='identity', last_updated=excluded.last_updated
            """, (k, v, now))

            # user_memory_meta
            meta = {
                "authority": "user_explicit",
                "source": "user",
                "intent": "identity",
                "origin_session_id": "tutorial_init",
                "reason": "tutorial_commit"
            }
            meta_json = json.dumps(meta)

            cursor.execute("SELECT 1 FROM user_memory_meta WHERE key = ?", (k,))
            if cursor.fetchone():
                cursor.execute("UPDATE user_memory_meta SET meta_json = ?, last_updated = ? WHERE key = ?", (meta_json, now, k))
            else:
                cursor.execute("INSERT INTO user_memory_meta (key, meta_json, created_at, last_updated) VALUES (?, ?, ?, ?)", (k, meta_json, now, now))

        # B) Write Tier B (Preferences/Facts)
        for item in validated_tier_b:
            k = item["key"]
            v = item["value"]

            # user_memory
            cursor.execute("""
                INSERT INTO user_memory (key, value, category, last_updated)
                VALUES (?, ?, 'auto', ?)
                ON CONFLICT(key) DO UPDATE SET
                    value=excluded.value, category='auto', last_updated=excluded.last_updated
            """, (k, v, now))

            # user_memory_meta
            meta = {
                "authority": "user_explicit",
                "source": "user",
                "intent": "preference",
                "origin_session_id": "tutorial_init",
                "reason": "tutorial_commit",
                "confidence": 1.0
            }
            meta_json = json.dumps(meta)

            cursor.execute("SELECT 1 FROM user_memory_meta WHERE key = ?", (k,))
            if cursor.fetchone():
                cursor.execute("UPDATE user_memory_meta SET meta_json = ?, last_updated = ? WHERE key = ?", (meta_json, now, k))
            else:
                cursor.execute("INSERT INTO user_memory_meta (key, meta_json, created_at, last_updated) VALUES (?, ?, ?, ?)", (k, meta_json, now, now))

        # C) Write Defaults (App Settings)
        for k, v in validated_defaults.items():
            cursor.execute("""
                INSERT INTO app_settings (key, value, last_updated)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value=excluded.value, last_updated=excluded.last_updated
            """, (k, v, now))

        # D) Mark Tutorial Complete
        cursor.execute("""
            INSERT INTO app_settings (key, value, last_updated)
            VALUES ('tutorial_completed', 'true', ?)
            ON CONFLICT(key) DO UPDATE SET
                value='true', last_updated=?
        """, (now, now))

        conn.commit()
        logger.info("[Tutorial] Commit success.")

        # Clear all tutorial prompts (session cleanup)
        global tutorial_prompts
        tutorial_prompts.clear()
        logger.debug("[Tutorial] Cleared tutorial prompts.")

        return {"status": "ok"}

    except Exception as e:
        conn.rollback()
        logger.error(f"[Tutorial] Commit Failed (Rollback): {e}")
        raise HTTPException(status_code=500, detail=f"Commit failed: {str(e)}")
    finally:
        conn.close()


# ------------------------------
# Routes: Tutorial Reset
# ------------------------------
@app.post("/tutorial/reset")
async def tutorial_reset_endpoint():
    """
    Resets the tutorial state to allow re-onboarding.
    Clears default settings but preserves core memory/identity.
    """
    logger.info("[Tutorial] Resetting tutorial state...")

    # Allow-list of keys to clear (same as Commit allow-list)
    KEYS_TO_CLEAR = [
        "default_model_name", "default_ctx_size", "default_max_tokens",
        "default_temperature", "default_temp_profile", "default_system_prompt",
        "web_search_mode", "web_search_provider", "web_search_custom_endpoint",
        "theme", "accent_color",
        "background_image", "background_opacity"
    ]

    conn = None
    try:
        conn = sqlite3.connect(database.DB_NAME)
        cursor = conn.cursor()

        # 1. Reset Completion Flag
        now = datetime.utcnow().isoformat()
        cursor.execute("""
            INSERT INTO app_settings (key, value, last_updated)
            VALUES ('tutorial_completed', 'false', ?)
            ON CONFLICT(key) DO UPDATE SET
                value='false', last_updated=?
        """, (now, now))

        # 2. Clear Default Settings
        placeholders = ','.join('?' for _ in KEYS_TO_CLEAR)
        cursor.execute(f"DELETE FROM app_settings WHERE key IN ({placeholders})", KEYS_TO_CLEAR)

        conn.commit()
        return {"status": "ok", "message": "Tutorial reset complete."}

    except Exception as e:
        logger.error(f"[Tutorial] Reset Error: {e}")
        raise HTTPException(status_code=500, detail=f"Reset failed: {str(e)}")
    finally:
        if conn:
            conn.close()


# ------------------------------
# Routes: Server Control
# ------------------------------
@app.post("/server/stop")
async def stop_server():
    import signal

    logging.shutdown()

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M-%S")
    export_filename = f"localis_{timestamp}.log"
    error_log_dir = Path(__file__).resolve().parent.parent / "Error Log"
    error_log_dir.mkdir(exist_ok=True)
    export_path = error_log_dir / export_filename

    exported = False
    if _LOG_FILE.exists():
        shutil.copy2(_LOG_FILE, export_path)
        exported = True

    async def _shutdown():
        await asyncio.sleep(0.5)
        os.kill(os.getpid(), signal.SIGTERM)

    asyncio.create_task(_shutdown())

    return {
        "status": "stopping",
        "exported": exported,
        "log_path": str(export_path) if exported else None,
        "filename": export_filename if exported else None,
    }


# ------------------------------
# Routes: System Stats
# ------------------------------
@app.get("/api/system-stats")
async def system_stats():
    """Return current CPU, RAM, and VRAM usage for the sidebar stats panel."""
    cpu_pct = psutil.cpu_percent(interval=None)
    mem = psutil.virtual_memory()
    ram_used_gb = round(mem.used / 1e9, 1)
    ram_total_gb = round(mem.total / 1e9, 1)

    vram_used_gb = 0.0
    vram_total_gb = 0.0
    if _NVML_OK:
        try:
            vram_used = 0
            vram_total = 0
            for i in range(_pynvml.nvmlDeviceGetCount()):
                handle = _pynvml.nvmlDeviceGetHandleByIndex(i)
                info = _pynvml.nvmlDeviceGetMemoryInfo(handle)
                vram_used += info.used
                vram_total += info.total
            vram_used_gb = round(vram_used / (1024**3), 1)
            vram_total_gb = round(vram_total / (1024**3), 1)
        except Exception:
            pass

    return {
        "cpu_pct": cpu_pct,
        "ram_used_gb": ram_used_gb,
        "ram_total_gb": ram_total_gb,
        "vram_used_gb": vram_used_gb,
        "vram_total_gb": vram_total_gb,
    }


# ------------------------------
# Routes: App Settings (GET + POST /api/settings)
# ------------------------------

@app.get("/api/settings")
async def get_api_settings():
    """Return all persisted app settings used by the frontend settings modal."""
    keys = [
        "accent_color",
        "wallpaper_opacity",
        "gpu_layers",
        "context_size",
        "active_profile",
        "custom_profile_prompt",
        "fin_onboarding_done",
    ]
    result = {}
    for key in keys:
        val = database.get_app_setting(key)
        if val is not None:
            result[key] = val
    return result


@app.post("/api/settings")
async def post_api_settings(req: AppSettingsRequest):
    """Persist app settings from the frontend settings modal."""
    updates: dict = {}
    if req.accent_color is not None:
        updates["accent_color"] = req.accent_color.strip()
    if req.wallpaper_opacity is not None:
        updates["wallpaper_opacity"] = str(req.wallpaper_opacity)
    if req.gpu_layers is not None:
        updates["gpu_layers"] = str(req.gpu_layers)
    if req.context_size is not None:
        updates["context_size"] = str(req.context_size)
    if req.active_profile is not None:
        updates["active_profile"] = req.active_profile.strip()
    if req.custom_profile_prompt is not None:
        updates["custom_profile_prompt"] = req.custom_profile_prompt

    for key, value in updates.items():
        database.set_app_setting(key, value)

    return {"status": "ok", "updated": list(updates.keys())}
