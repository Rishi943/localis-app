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
from pathlib import Path
from datetime import datetime, timezone
from typing import Union, List, Dict, Any, Optional

from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from .setup_wizard import register_setup_wizard
from .updater import register_updater
import sys  # add this near the top with imports


# ------------------------------
# Internal Modules
# ------------------------------
# memory_core is the only memory module.
from . import database, memory_core, tools

# ------------------------------
# llama.cpp Python binding
# ------------------------------
from llama_cpp import Llama

# ------------------------------
# Configuration
# ------------------------------

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent  # repo root in dev; temp bundle root when frozen

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

# Load env overrides if present (optional)
if (DATA_DIR / "secret.env").exists():
    load_dotenv(dotenv_path=DATA_DIR / "secret.env")
else:
    load_dotenv(dotenv_path=PROJECT_ROOT / "secret.env")

# Persist DB in user data dir (NOT next to the exe)
database.DB_NAME = str(DATA_DIR / "chat_history.db")

# Models live in user data dir by default
MODELS_DIR = Path(os.getenv("MODEL_PATH") or (DATA_DIR / "models"))

INDEX_TEMPLATE_PATH = BASE_DIR / "templates" / "index.html"

# Serve /static from a writeable, persistent location so wallpaper, etc. survive restarts
RESOURCE_STATIC_DIR = BASE_DIR / "static"      # bundled assets (read-only-ish)
STATIC_DIR = DATA_DIR / "static"              # persistent copy (writeable)

def _seed_static_assets():
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    if not RESOURCE_STATIC_DIR.exists():
        return
    # Copy only missing files (don’t overwrite user wallpaper, etc.)
    for src in RESOURCE_STATIC_DIR.rglob("*"):
        if src.is_dir():
            continue
        rel = src.relative_to(RESOURCE_STATIC_DIR)
        dst = STATIC_DIR / rel
        if dst.exists():
            continue
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
PROMPT_DEFAULT = "You are a helpful AI assistant."
PROMPT_PIRATE = "You are a friendly pirate captain. Speak like a pirate, but still be helpful. Use pirate slang naturally."


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
        print(" [System] Unloading previous model...")
        del current_model
        gc.collect()

    print(f" [System] Loading {model_name} with {n_gpu_layers} layers, ctx={n_ctx}...")
    current_model = Llama(
        model_path=str(path),
        n_gpu_layers=n_gpu_layers,
        n_ctx=n_ctx,
        verbose=True,
    )
    current_model_name = model_name
    return current_model_name


# ------------------------------
# App & Lifecycle
# ------------------------------
app = FastAPI(title="Localis")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


register_setup_wizard(app, MODELS_DIR)
register_updater(app, PROJECT_ROOT)


# --- Setup Wizard + Updater (new, minimal integration) ---
from .setup_wizard import register_setup_wizard
from .updater import register_updater

register_setup_wizard(app, MODELS_DIR)
register_updater(app, PROJECT_ROOT)



@app.on_event("startup")
async def _startup():
    print(" [System] Initializing database...")
    database.init_db()

    # Preload/warm embeddings at startup to avoid first-use latency.
    try:
        print(" [System] Preloading embedding model...")
        emb = memory_core.get_embedder()
        if emb:
            try:
                memory_core.embed_text("warmup")
            except Exception:
                pass
            print(" [System] Embedding model ready.")
        else:
            print(" [System] Embedding model unavailable (missing deps or load failure).")
    except Exception as e:
        print(f" [System] Embedding preload failed (continuing without embeddings): {e}")

    # Ensure models directory exists
    if not MODELS_DIR.exists():
        print(f" [System] Creating models directory at: {MODELS_DIR}")
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
        print(" [System] First run detected (tutorial incomplete). Skipping model auto-load.")
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
                            print(f" [System] Found preferred default model: {target_model}")
                            break
                    if not target_model:
                        print(f" [System] Default model '{default_model_name}' not found. Falling back.")

                # 2. Fallback to First Available
                if not target_model:
                    target_model = models[0].name
                    print(f" [System] Auto-loading fallback model: {target_model}")

                _load_model_internal(target_model, n_gpu_layers=35, n_ctx=n_ctx)
                print(" [System] Auto-load complete.")
            else:
                print(" [System] No .gguf models found in 'models/' directory. Please add one.")
        except Exception as e:
            print(f" [System] Auto-load failed: {e}")


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

    # Search Provider Plumbing
    web_search_provider: str | None = None  # "auto" | "brave" | "tavily" | "custom"
    web_search_custom_endpoint: str | None = None
    web_search_custom_api_key: str | None = None


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


# ------------------------------
# Routes: UI & Static
# ------------------------------
@app.get("/", response_class=HTMLResponse)
async def serve_ui():
    if not INDEX_TEMPLATE_PATH.exists():
        return HTMLResponse(content="Error: index.html not found in app/templates", status_code=404)
    return HTMLResponse(content=INDEX_TEMPLATE_PATH.read_text("utf-8"))


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
        "models_dir_exists": MODELS_DIR.exists()
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
        print(f" [Error] Load failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
    global current_model
    if not current_model:
        raise HTTPException(status_code=503, detail="No model loaded. Please load a model in settings.")

    session_id = req.session_id
    user_msg = req.message.strip()

    # 0. Log User Message
    database.add_message(session_id, "user", user_msg, len(user_msg) // 3)

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
    # 2. Tool Routing (Router)
    # ---------------------------------------------------------

    # Resolve Modes (Backward Compatibility)
    effective_web_mode = req.web_search_mode
    if req.use_search and req.web_search_mode == "off":
        effective_web_mode = "enabled"

    tool_messages: List[Dict[str, str]] = []

    # --- Authoritative system time context (from the host OS) ---
    # Use local machine settings (timezone + DST aware) to prevent the router from guessing dates.
    _local_now = datetime.now().astimezone()
    _tzinfo = _local_now.tzinfo
    _tz_name = getattr(_tzinfo, "key", None) or _local_now.tzname() or (str(_tzinfo) if _tzinfo else "local")
    _utc_now = _local_now.astimezone(timezone.utc)

    _time_context = (
        "\n\nSYSTEM TIME CONTEXT (authoritative):\n"
        f"- Current local datetime: {_local_now.isoformat(timespec='seconds')}\n"
        f"- Local timezone: {_tz_name}\n"
        f"- Current UTC datetime: {_utc_now.isoformat(timespec='seconds').replace('+00:00','Z')}\n"
        "Rules:\n"
        "- Treat this as the real current time.\n"
        "- Do NOT guess dates.\n"
        "- If generating a web.search query, prefer 'latest', 'today', or the current date context above.\n"
    )

    # Updated Router Prompt for Tier-A vs Tier-B logic
    router_sys_prompt = (
        "You are a function calling router. Decide if tools are needed based on the user's message.\n"
        "Available Tools:\n"
        "- memory.retrieve(query): Search long-term memory for facts, preferences, or project details.\n"
        "- memory.write(key, value, intent, confidence): Save a new permanent fact about the user.\n"
        "  * USE FREELY for: interests, media_preferences, habits_routines, projects, goals, values, traits, misc.\n"
        "  * DO NOT use for Core Identity (Tier-A).\n"
        "- memory.propose_tier_a(key, value, confidence, reason): Propose a change to Core Identity.\n"
        "  * USE ONLY for: preferred_name, location, timezone, language_preferences.\n"
        "- memory.forget(key): Delete a memory key.\n"
        "- web.search(query): Search the internet for real-time info.\n\n"
        "Output strictly a JSON object with this format:\n"
        "{\"tool_calls\": [{\"name\": \"tool_name\", \"arguments\": {\"arg\": \"value\"}}]}\n"
        "If no tools are needed, return {\"tool_calls\": []}."
        + _time_context
    )

    # Build Router History (Short Context)
    history = database.get_chat_history(session_id)
    router_context = [{"role": "system", "content": router_sys_prompt}]

    # Fix: Ensure strict role alternation (System -> User -> Assistant -> User)
    # Exclude the current user message (last one) to avoid duplicates or misaligned pairs
    hist = history[:-1]
    if len(hist) >= 2:
        if hist[-2]["role"] == "user" and hist[-1]["role"] == "assistant":
            router_context.append({"role": "user", "content": hist[-2]["content"]})
            router_context.append({"role": "assistant", "content": hist[-1]["content"]})

    router_context.append({"role": "user", "content": user_msg})

    # Execute Router
    tool_plan = {"tool_calls": []}

    print(" [Router] Planning...")
    with MODEL_LOCK:
        try:
            # Short generation for JSON plan
            router_res = current_model.create_chat_completion(
                messages=router_context,
                max_tokens=256,
                temperature=0.0,
                response_format={"type": "json_object"} # Force JSON if supported by model, else relies on prompt
            )
            raw_plan = router_res["choices"][0]["message"]["content"]
            try:
                tool_plan = json.loads(raw_plan)
            except json.JSONDecodeError:
                # Fallback: model might have chatted instead of JSON.
                pass
        except Exception as e:
            print(f" [Router Error] {e}")

    # ---------------------------------------------------------
    # 3. Tool Execution
    # ---------------------------------------------------------

    executed_tools = tool_plan.get("tool_calls", [])[:3] # Hard cap at 3 tools for speed
    tier_a_proposals = []

    for tool in executed_tools:
        name = tool.get("name")
        args = tool.get("arguments", {})

        print(f" [Router] Invoking {name} with {args}")

        # --- MEMORY TOOLS ---
        if name.startswith("memory."):
            if req.memory_mode == "off":
                print(" [Router] Skipped memory tool (memory_mode=off)")
                continue

            # 1. Tier-A Proposal Handling
            if name == "memory.propose_tier_a":
                key = args.get("key")
                if key in memory_core.TIER_A_KEYS:
                    old_value = database.get_user_memory_value(key)
                    tier_a_proposals.append({
                        "key": key,
                        "value": args.get("value"),
                        "old_value": old_value,
                        "confidence": args.get("confidence", 0.0),
                        "reason": args.get("reason", "router_proposal")
                    })
                continue

            elif name == "memory.write":
                key = args.get("key")

                # Harden against router mistakes: If key is Tier-A, force it to be a proposal
                if key in memory_core.TIER_A_KEYS:
                    print(f" [Router] Redirecting memory.write({key}) to Tier-A Proposal.")
                    old_value = database.get_user_memory_value(key)
                    tier_a_proposals.append({
                        "key": key,
                        "value": args.get("value"),
                        "old_value": old_value,
                        "confidence": args.get("confidence", 0.0),
                        "reason": "router_mistaken_write_redirect"
                    })
                    continue

                # Standard Tier-B Auto Write (Permissive)
                memory_core.tool_memory_write(
                    session_id=session_id,
                    key=key,
                    value=args.get("value"),
                    intent=args.get("intent", "fact"),
                    authority="assistant_inferred",
                    source="assistant",
                    confidence=args.get("confidence", 0.8),
                    reason="router_auto_write",
                    target="tier_b" # Router primarily writes to extended memory
                )

            elif name == "memory.retrieve":
                query = args.get("query", user_msg)
                result = memory_core.tool_memory_retrieve(session_id, query)
                tool_messages.append({
                    "role": "system",
                    "content": f"[TOOL RESULT: memory.retrieve]\n(Untrusted/May be outdated)\n{result}"
                })

            elif name == "memory.forget":
                memory_core.tool_memory_forget(session_id, args.get("key", ""))

        # --- WEB TOOLS ---
        elif name == "web.search":
            # Gate: "off" -> block. "enabled" -> strict user check. "auto" -> allow.
            allow_search = False
            if effective_web_mode == "auto":
                allow_search = True
            elif effective_web_mode == "enabled":
                # Manual override check: user must explicitly ask
                if re.search(r"(search|find|google|lookup|what is|who is)", user_msg, re.IGNORECASE):
                    allow_search = True

            if allow_search:
                # Resolve provider settings with fallbacks
                final_provider = req.web_search_provider
                if not final_provider:
                    final_provider = database.get_app_setting("web_search_provider") or "auto"

                final_endpoint = req.web_search_custom_endpoint
                if not final_endpoint:
                    final_endpoint = database.get_app_setting("web_search_custom_endpoint")

                query = args.get("query", user_msg)
                res = await tools.tool_web_search(
                    query,
                    provider=final_provider,
                    custom_endpoint=final_endpoint,
                    custom_api_key=req.web_search_custom_api_key
                )
                tool_messages.append({
                    "role": "system",
                    "content": f"[TOOL RESULT: web.search]\n{res}"
                })
            else:
                print(f" [Router] Skipped web.search (mode={effective_web_mode})")

    # ---------------------------------------------------------
    # 4. Build Final Context
    # ---------------------------------------------------------

    # Check for tutorial-specific system prompt first
    global tutorial_prompts
    if session_id in tutorial_prompts:
        system_prompt_text = tutorial_prompts[session_id]
        print(f" [Chat] Using tutorial system prompt for session {session_id}")
    else:
        system_prompt_text = req.system_prompt or "You are a helpful AI assistant."

    # Core Context Builder (Identity + History + User)
    messages = memory_core.build_chat_context_v2(
        session_id=session_id,
        system_prompt=system_prompt_text,
        chat_messages=history[:-1] if history else [],
        user_prompt=user_msg,
    )

    # Inject Tool Results without breaking role alternation.
    # llama-cpp chat formatter expects at most one "system" message at the start.
    if tool_messages and messages:
        if messages[0].get("role") == "system":
            tool_blob = "\n\n".join(
                tm.get("content", "").strip()
                for tm in tool_messages
                if tm.get("content")
            ).strip()
            if tool_blob:
                messages[0]["content"] = messages[0].get("content", "").rstrip() + "\n\n" + tool_blob
        else:
            # Fallback: if for some reason the first message isn't system, do not insert extra system messages.
            # (Better to drop tool text than to crash.)
            pass

    print(f" [Chat] Final Context: {len(messages)} msgs. Tools used: {len(tool_messages)}")

    # ---------------------------------------------------------
    # 5. Stream Response
    # ---------------------------------------------------------
    async def event_stream():
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()

        full_parts: List[str] = []
        error_sent = False

        # Emit Tier-A Proposals immediately (if any)
        for prop in tier_a_proposals:
            prop["target"] = "tier_a"
            yield f"data: {json.dumps({'content': '', 'stop': False, 'proposal': prop})}\n\n"

        def _gen_worker():
            try:
                # CRITICAL: Use Global Lock for Generation to prevent collision with Router or other requests
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
                        full_parts.append(content)
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
                # Send a final stop event with error text
                error_sent = True
                err_msg = f"\n[System Error: {payload}]"
                full_parts.append(err_msg)
                yield f"data: {json.dumps({'content': err_msg, 'stop': True})}\n\n"
                continue

            if kind == "done":
                break

        # Persist assistant message once generation completes
        full_text = "".join(full_parts)
        if full_text:
            database.add_message(session_id, "assistant", full_text, len(full_text) // 3)

        # If no error, send the usual final stop event
        if not error_sent:
            yield f"data: {json.dumps({'content': '', 'stop': True})}\n\n"

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

    print(f" [Tutorial] Context size: {len(messages)} messages.")

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

    print(f" [Tutorial] Swapped system prompt for session {session_id}: {prompt_text[:50]}...")

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
        if k in ALLOWED_DEFAULTS and v is not None:
            if isinstance(v, (dict, list, bool)):
                validated_defaults[k] = json.dumps(v)
            else:
                validated_defaults[k] = str(v).strip()

    # ------------------------------
    # 2. Atomic Execution (DB Transaction)
    # ------------------------------
    print(" [Tutorial] Committing results (Atomic)...")

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
        print(" [Tutorial] Commit success.")

        # Clear all tutorial prompts (session cleanup)
        global tutorial_prompts
        tutorial_prompts.clear()
        print(" [Tutorial] Cleared tutorial prompts.")

        return {"status": "ok"}

    except Exception as e:
        conn.rollback()
        print(f" [Tutorial] Commit Failed (Rollback): {e}")
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
    print(" [Tutorial] Resetting tutorial state...")

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
        print(f" [Tutorial] Reset Error: {e}")
        raise HTTPException(status_code=500, detail=f"Reset failed: {str(e)}")
    finally:
        if conn:
            conn.close()
