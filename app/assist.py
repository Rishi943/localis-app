# app/assist.py
# Assist Mode — Home Assistant control via REST API
# Phase 1: on/off toggle + state query
# Phase 2: brightness/color (gated behind ASSIST_PHASE env var)

import os
import re
import json
import sqlite3
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field, field_validator
from . import database

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Phase gate — env-driven, clamp to {1, 2}
# ---------------------------------------------------------------------------
_raw_phase = int(os.getenv("LOCALIS_ASSIST_PHASE", "2"))
ASSIST_PHASE = max(1, min(2, _raw_phase))

# Module-level state (populated by register_assist)
_models_dir: str = ""
_ha_url: str = ""
_ha_token: str = ""
_light_entity: str = ""
_debug: bool = False

router = APIRouter(prefix="/assist", tags=["assist"])


# ── Direct light control request models ───────────────────────────────────────
class _BrightnessReq(BaseModel):
    value: int = Field(..., ge=0, le=100)

class _ColorReq(BaseModel):
    rgb: list[int] = Field(..., min_length=3, max_length=3)

    @field_validator("rgb")
    @classmethod
    def validate_channels(cls, v: list[int]) -> list[int]:
        if not all(0 <= c <= 255 for c in v):
            raise ValueError("Each RGB channel must be in 0-255")
        return v

class _KelvinReq(BaseModel):
    kelvin: int = Field(..., ge=1000, le=10000)

def _ha_configured() -> bool:
    return bool(_ha_url and _ha_token and _light_entity)

@router.post("/light/toggle")
async def light_toggle():
    if not _ha_configured():
        raise HTTPException(status_code=503, detail={"error": "HA not configured"})
    try:
        await ha_call_service("light", "toggle", {"entity_id": _light_entity})
        return {"status": "ok"}
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})

@router.post("/light/brightness")
async def light_brightness(req: _BrightnessReq):
    if not _ha_configured():
        raise HTTPException(status_code=503, detail={"error": "HA not configured"})
    try:
        brightness_255 = round(req.value / 100 * 255)
        await ha_call_service("light", "turn_on",
                              {"entity_id": _light_entity, "brightness": brightness_255})
        return {"status": "ok"}
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})

@router.post("/light/color")
async def light_color(req: _ColorReq):
    if not _ha_configured():
        raise HTTPException(status_code=503, detail={"error": "HA not configured"})
    try:
        await ha_call_service("light", "turn_on",
                              {"entity_id": _light_entity, "rgb_color": req.rgb})
        return {"status": "ok"}
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})

@router.post("/light/kelvin")
async def light_kelvin(req: _KelvinReq):
    if not _ha_configured():
        raise HTTPException(status_code=503, detail={"error": "HA not configured"})
    try:
        await ha_call_service("light", "turn_on",
                              {"entity_id": _light_entity, "color_temp_kelvin": req.kelvin})
        return {"status": "ok"}
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_assist(app, models_dir, debug: bool = False):
    """Called from main.py during app construction."""
    global _models_dir, _ha_url, _ha_token, _light_entity, _debug
    _models_dir = str(models_dir)
    _debug = debug
    _ha_url = os.getenv("LOCALIS_HA_URL", "").rstrip("/")
    _ha_token = os.getenv("LOCALIS_HA_TOKEN", "")
    _light_entity = os.getenv("LOCALIS_LIGHT_ENTITY", "light.rishi_room_light")
    if _ha_url and _ha_token:
        logger.info(f"[Assist] Home Assistant configured: {_ha_url}, entity: {_light_entity}")
    else:
        logger.warning("[Assist] HA not configured. Set LOCALIS_HA_URL and LOCALIS_HA_TOKEN.")
    app.include_router(router)


# ---------------------------------------------------------------------------
# Tool schema (phase-gated)
# ---------------------------------------------------------------------------

def _build_tool_schema() -> list:
    toggle_params = {
        "type": "object",
        "properties": {
            "state": {
                "type": "string",
                "enum": ["on", "off"],
                "description": "The desired light state."
            }
        },
        # Phase 2: state is optional (brightness/temp-only commands are valid)
        "required": [] if ASSIST_PHASE >= 2 else ["state"]
    }

    if ASSIST_PHASE >= 2:
        toggle_params["properties"]["brightness_pct"] = {
            "type": "integer",
            "minimum": 0,
            "maximum": 100,
            "description": "Brightness percentage (0-100)."
        }
        toggle_params["properties"]["color_temp_kelvin"] = {
            "type": "integer",
            "description": "Color temperature in Kelvin (e.g. 2700 for warm, 6500 for cool)."
        }
        toggle_params["properties"]["rgb_color"] = {
            "type": "array",
            "items": {"type": "integer"},
            "minItems": 3,
            "maxItems": 3,
            "description": "RGB color as [r, g, b] (0-255 each)."
        }
        toggle_params["properties"]["hs_color"] = {
            "type": "array",
            "items": {"type": "number"},
            "minItems": 2,
            "maxItems": 2,
            "description": "Hue-Saturation color as [hue (0-360), saturation (0-100)]."
        }

    return [
        {
            "type": "function",
            "function": {
                "name": "toggle_lights",
                "description": "Turn a smart light on or off, optionally adjusting brightness and color.",
                "parameters": toggle_params,
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_light_state",
                "description": "Query the current state of the light (on/off, brightness, color temperature).",
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "notes_add",
                "description": "Save a new note or reminder to the user's notepad. Use for: 'add note', 'jot down', 'remind me to X at Y time'. For reminders, set due_at to an ISO8601 UTC string.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "content": {
                            "type": "string",
                            "description": "The note or reminder text."
                        },
                        "note_type": {
                            "type": "string",
                            "enum": ["note", "reminder"],
                            "description": "'note' for plain notes, 'reminder' for timed reminders."
                        },
                        "due_at": {
                            "type": "string",
                            "description": "ISO8601 UTC datetime for reminders, e.g. '2026-03-20T09:00:00Z'. Null for plain notes."
                        }
                    },
                    "required": ["content", "note_type"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "notes_retrieve",
                "description": "Retrieve the user's saved notes and reminders. Use for: 'what did I note', 'show my notes', 'do I have a reminder about X'.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "filter_text": {
                            "type": "string",
                            "description": "Optional search string to filter notes by content."
                        }
                    },
                    "required": []
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "intent_unclear",
                "description": "Called when the user intent does not map to any available smart home function.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "reason": {
                            "type": "string",
                            "enum": ["no_matching_function", "ambiguous_command", "out_of_scope"],
                            "description": "Why the intent could not be resolved."
                        }
                    },
                    "required": ["reason"]
                }
            }
        }
    ]


def _build_system_prompt() -> str:
    return (
        "You are an on-device assistant router. "
        "Always respond by calling exactly one tool from the provided tool schema. "
        "Use notes_add for note/reminder creation, notes_retrieve for listing notes, "
        "toggle_lights/get_light_state for smart home light control. "
        "If the request is unsupported or unclear, call intent_unclear. "
        "Output no normal text — only a tool call."
    )


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def _parse_native_args(args_str: str) -> dict:
    """Parse key:value pairs from FunctionGemma native arg string.

    Handles three value formats:
      - <escape>text<escape>   (string values)
      - [a,b,c]               (JSON arrays)
      - bare_value            (integers, identifiers)
    """
    args: dict = {}
    pattern = re.compile(
        r'(\w+)\s*:\s*'
        r'(?:<escape>(.*?)<escape>'           # group 2: <escape> string
        r'|(\[[^\]]*\])'                      # group 3: array [...]
        r'|([^,\[\]{}<>\s][^,\[\]{}<>]*?)'  # group 4: bare value
        r')(?=\s*(?:,|\})|\s*$)',
        re.DOTALL,
    )
    for m in pattern.finditer(args_str):
        key = m.group(1)
        if m.group(2) is not None:
            args[key] = m.group(2).strip()
        elif m.group(3) is not None:
            try:
                args[key] = json.loads(m.group(3))
            except Exception:
                args[key] = m.group(3)
        elif m.group(4) is not None:
            args[key] = m.group(4).strip()
    return args


def _parse_native_call(content: str) -> Optional[dict]:
    """
    Parse FunctionGemma's <start_function_call> native text output.

    Format B (most common, <escape> tags):
      <start_function_call>call:FUNCNAME{key:<escape>value<escape>,...}

    Format A (parentheses):
      <start_function_call>call:FUNCNAME(arg1_arg2_state)
    """
    # Format B: {key:<escape>value<escape>,...}
    m = re.search(
        r"<start_function_call>\s*call:(\w+)\{(.*?)\}",
        content, re.DOTALL,
    )
    if m:
        func_name = m.group(1)
        args = _parse_native_args(m.group(2))
        result = _build_call_from_name_args(func_name, args)
        if result is not None:
            return result

    # Format A: (token_token_state)
    m = re.search(
        r"<start_function_call>\s*call:(\w+)\(([^)]*)\)",
        content, re.DOTALL,
    )
    if m:
        func_name = m.group(1)
        args = _parse_paren_tokens(m.group(1), m.group(2))
        result = _build_call_from_name_args(func_name, args)
        if result is not None:
            return result

    # Format C: bare call:NAME{...} without the leading tag
    # Search for any call:NAME{...} and skip if it was already matched by Format B
    m = re.search(r"call:(\w+)\{(.*?)\}", content, re.DOTALL)
    if m and "<start_function_call>" not in content[max(0, m.start() - 50):m.start()]:
        func_name = m.group(1)
        args = _parse_native_args(m.group(2))
        result = _build_call_from_name_args(func_name, args)
        if result is not None:
            return result

    # Format D: <tool_call>{json}</tool_call>
    m = re.search(r"<tool_call>\s*(.*?)\s*</tool_call>", content, re.DOTALL)
    if m:
        try:
            obj = json.loads(m.group(1))
            if isinstance(obj, dict) and "name" in obj:
                return _normalise_json_call(obj)
        except Exception:
            pass

    # Format E: bare JSON — try whole content first, then scan for embedded object
    try:
        obj = json.loads(content.strip())
        if isinstance(obj, dict) and "name" in obj:
            return _normalise_json_call(obj)
    except Exception:
        pass

    # Scan for first {...} block that contains "name"
    for m in re.finditer(r'\{', content):
        start = m.start()
        depth = 0
        for i, ch in enumerate(content[start:]):
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    candidate = content[start:start + i + 1]
                    try:
                        obj = json.loads(candidate)
                        if isinstance(obj, dict) and "name" in obj:
                            return _normalise_json_call(obj)
                    except Exception:
                        pass
                    break

    return None


def _parse_paren_tokens(func_name: str, token_str: str) -> dict:
    """Extract state/brightness/kelvin from parenthesis token string."""
    args: dict = {}
    tokens = re.split(r"[\W_]+", token_str.lower())
    for token in tokens:
        if token in ("on", "off"):
            args["state"] = token
        m = re.fullmatch(r"(\d+)pct", token)
        if m:
            args["brightness_pct"] = int(m.group(1))
        m = re.fullmatch(r"(\d{4})k", token)
        if m:
            args["color_temp_kelvin"] = int(m.group(1))
    return args


def _build_call_from_name_args(func_name: str, args: dict) -> Optional[dict]:
    """Convert parsed name+args into canonical tool-call dict."""
    if func_name == "toggle_lights":
        call_args: dict = {}
        if "state" in args:
            state = args["state"].lower()
            call_args["state"] = state if state in ("on", "off") else "off"
        if ASSIST_PHASE >= 2:
            if "brightness_pct" in args:
                try:
                    call_args["brightness_pct"] = max(0, min(100, int(args["brightness_pct"])))
                except (ValueError, TypeError):
                    pass
            if "color_temp_kelvin" in args:
                try:
                    call_args["color_temp_kelvin"] = max(1500, min(9000, int(args["color_temp_kelvin"])))
                except (ValueError, TypeError):
                    pass
        return {"name": "toggle_lights", "arguments": call_args}

    if func_name == "get_light_state":
        return {"name": "get_light_state", "arguments": {}}

    if func_name == "intent_unclear":
        reason = args.get("reason", "no_matching_function")
        if reason not in ("no_matching_function", "ambiguous_command", "out_of_scope"):
            reason = "no_matching_function"
        return {"name": "intent_unclear", "arguments": {"reason": reason}}

    return None


def _normalise_json_call(obj: dict) -> Optional[dict]:
    """Normalise a bare JSON tool-call dict."""
    name = obj.get("name") or obj.get("function", {}).get("name", "")
    args = obj.get("arguments") or obj.get("parameters") or {}
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            args = {}
    return _build_call_from_name_args(name, args)


# ---------------------------------------------------------------------------
# Deterministic heuristic fallback
# ---------------------------------------------------------------------------

def _heuristic_fallback(user_message: str) -> dict:
    """
    Last-resort deterministic intent parser. Never returns None.
    Handles: on/off toggle, brightness %, kelvin temperature, state query.
    """
    msg = user_message.lower()

    # State query
    if any(kw in msg for kw in ("status", "state", "is it on", "is it off", "what is", "current")):
        return {"name": "get_light_state", "arguments": {}}

    call_args: dict = {}

    # on/off
    has_on = bool(re.search(r"\bon\b", msg))
    has_off = bool(re.search(r"\boff\b", msg))
    if has_on and not has_off:
        call_args["state"] = "on"
    elif has_off and not has_on:
        call_args["state"] = "off"

    if ASSIST_PHASE >= 2:
        # brightness: "to 40%", "40 percent", "brightness 40"
        bm = re.search(r"(\d+)\s*(?:%|percent)", msg)
        if not bm:
            bm = re.search(r"brightness\s+(?:to\s+)?(\d+)", msg)
        if bm:
            call_args["brightness_pct"] = max(0, min(100, int(bm.group(1))))

        # kelvin: "4000K", "4000 kelvin", "4000k"
        km = re.search(r"(\d{3,5})\s*k(?:elvin)?\b", msg)
        if km:
            call_args["color_temp_kelvin"] = max(1500, min(9000, int(km.group(1))))

    if call_args:
        return {"name": "toggle_lights", "arguments": call_args}

    return {"name": "intent_unclear", "arguments": {"reason": "no_matching_function"}}


# ---------------------------------------------------------------------------
# Home Assistant client
# ---------------------------------------------------------------------------

async def ha_get_state(entity_id: str) -> dict:
    """GET /api/states/{entity_id}"""
    if not _ha_url or not _ha_token:
        raise RuntimeError("HA not configured")
    headers = {
        "Authorization": f"Bearer {_ha_token}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{_ha_url}/api/states/{entity_id}", headers=headers)
    if resp.status_code == 401:
        if _debug:
            logger.debug("[Assist] Unauthorized: check LOCALIS_HA_TOKEN")
        raise PermissionError("Unauthorized")
    if resp.status_code == 404:
        if _debug:
            logger.debug(f"[Assist] Light entity not found: {entity_id}")
        raise KeyError(f"Entity not found: {entity_id}")
    resp.raise_for_status()
    return resp.json()


async def ha_call_service(domain: str, service: str, data: dict) -> dict:
    """POST /api/services/{domain}/{service}"""
    if not _ha_url or not _ha_token:
        raise RuntimeError("HA not configured")
    headers = {
        "Authorization": f"Bearer {_ha_token}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{_ha_url}/api/services/{domain}/{service}",
            headers=headers,
            json=data,
        )
    if resp.status_code == 401:
        if _debug:
            logger.debug("[Assist] Unauthorized: check LOCALIS_HA_TOKEN")
        raise PermissionError("Unauthorized")
    resp.raise_for_status()
    return resp.json() if resp.content else {}


# ---------------------------------------------------------------------------
# Public API — called from main.py tool dispatcher
# ---------------------------------------------------------------------------

def is_ha_configured() -> bool:
    """True if HA URL and token are both set."""
    return bool(_ha_url and _ha_token)


_COLOR_MAP: dict = {
    "red": [255, 0, 0], "green": [0, 255, 0], "blue": [0, 0, 255],
    "yellow": [255, 255, 0], "orange": [255, 165, 0], "purple": [128, 0, 128],
    "pink": [255, 105, 180], "cyan": [0, 255, 255], "white": [255, 255, 255],
}


async def execute_home_set_light(
    state: str,
    brightness: int | None = None,
    color_name: str | None = None,
) -> str:
    """Control the bedroom light. Returns a human-readable result string."""
    if state == "off" and brightness is None and color_name is None:
        service = "turn_off"
        service_data: dict = {"entity_id": _light_entity}
    else:
        service = "turn_on"
        service_data = {"entity_id": _light_entity}
        if brightness is not None:
            service_data["brightness"] = max(0, min(255, int(brightness)))
        if color_name:
            cn = color_name.lower().strip()
            if cn == "warm white":
                service_data["color_temp_kelvin"] = 2700
            elif cn == "cool white":
                service_data["color_temp_kelvin"] = 6500
            elif cn in _COLOR_MAP:
                service_data["rgb_color"] = _COLOR_MAP[cn]

    try:
        await ha_call_service("light", service, service_data)
    except Exception as e:
        logger.error(f"[Assist] HA set_light failed: {e}")
        return f"Could not reach Home Assistant: {e}"

    parts = []
    if state == "on":
        parts.append("Bedroom light turned ON.")
    elif state == "off":
        parts.append("Bedroom light turned OFF.")
    else:
        parts.append("Bedroom light updated.")
    if brightness is not None:
        pct = round(brightness / 255 * 100)
        parts.append(f"Brightness set to {pct}%.")
    if color_name:
        parts.append(f"Color: {color_name}.")
    return " ".join(parts)


async def execute_home_get_state(entity_id: str) -> str:
    """Get current state of an HA entity. Returns human-readable string."""
    try:
        state_data = await ha_get_state(entity_id)
    except Exception as e:
        logger.error(f"[Assist] HA get_state failed: {e}")
        return f"Could not reach Home Assistant: {e}"

    light_state = state_data.get("state", "unknown").upper()
    attrs = state_data.get("attributes", {})
    parts = [f"{entity_id} is {light_state}."]
    if "brightness" in attrs and attrs["brightness"] is not None:
        pct = round(attrs["brightness"] / 255 * 100)
        parts.append(f"Brightness: {pct}%.")
    if "color_temp_kelvin" in attrs and attrs["color_temp_kelvin"] is not None:
        parts.append(f"Color temperature: {attrs['color_temp_kelvin']}K.")
    return " ".join(parts)


# ---------------------------------------------------------------------------
# Tool executor
# ---------------------------------------------------------------------------

def _entity_display_name() -> str:
    name = _light_entity.split(".")[-1].replace("_", " ").title()
    return name


async def _execute_tool_call(tool_call: dict) -> dict:
    """
    Map FunctionGemma tool call → HA service call.
    Returns {"response": str, "raw": dict}
    """
    name = tool_call.get("name", "")
    args = tool_call.get("arguments", {})
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            args = {}

    # Strip spurious 'room' arg (model sometimes hallucinates it)
    args.pop("room", None)

    display = _entity_display_name()

    if name == "intent_unclear":
        return {"response": "No function available for that request.", "raw": tool_call}

    if name == "notes_add":
        content = args.get("content", "").strip()
        note_type = args.get("note_type", "note")
        due_at = args.get("due_at") or None
        if not content:
            return {"response": "I couldn't understand what to note down.", "raw": tool_call}
        try:
            db_path = database.DB_NAME
            conn = sqlite3.connect(db_path)
            note_id = str(uuid.uuid4())
            now = datetime.now(timezone.utc).isoformat()
            conn.execute(
                "INSERT INTO notes (id, content, note_type, due_at, color, pinned, dismissed, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, 'default', ?, ?, ?, ?)",
                (note_id, content, note_type, due_at, now, None, now, now)
            )
            conn.commit()
            conn.close()
            if note_type == "reminder" and due_at:
                return {"response": f"Reminder set: {content}.", "raw": tool_call}
            return {"response": f"Note saved: {content}.", "raw": tool_call}
        except Exception as e:
            logger.error(f"[Assist] notes_add failed: {e}")
            return {"response": "Sorry, I couldn't save that note.", "raw": tool_call}

    if name == "notes_retrieve":
        filter_text = args.get("filter_text", "").strip()
        try:
            db_path = database.DB_NAME
            conn = sqlite3.connect(db_path)
            if filter_text:
                rows = conn.execute(
                    "SELECT content, note_type, due_at FROM notes WHERE dismissed IS NULL AND content LIKE ? ORDER BY created_at DESC LIMIT 10",
                    (f"%{filter_text}%",)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT content, note_type, due_at FROM notes WHERE dismissed IS NULL ORDER BY created_at DESC LIMIT 10"
                ).fetchall()
            conn.close()
            if not rows:
                return {"response": "You have no notes saved.", "raw": tool_call}
            parts = []
            for content, note_type, due_at in rows:
                if note_type == "reminder" and due_at:
                    parts.append(f"Reminder: {content} (due {due_at[:10]})")
                else:
                    parts.append(f"Note: {content}")
            return {"response": "Here are your notes: " + "; ".join(parts) + ".", "raw": tool_call}
        except Exception as e:
            logger.error(f"[Assist] notes_retrieve failed: {e}")
            return {"response": "Sorry, I couldn't retrieve your notes.", "raw": tool_call}

    if name == "get_light_state":
        try:
            state_data = await ha_get_state(_light_entity)
        except Exception as e:
            logger.error(f"[Assist] HA get state failed: {e}")
            return {"response": "Could not reach Home Assistant.", "raw": tool_call}

        light_state = state_data.get("state", "unknown").upper()
        attrs = state_data.get("attributes", {})
        parts = [f"{display} is {light_state}."]

        # Brightness: HA reports 0-255, convert to percent
        if "brightness" in attrs and attrs["brightness"] is not None:
            pct = round(attrs["brightness"] / 255 * 100)
            parts.append(f"Brightness: {pct}%.")

        # Color temperature: prefer color_temp_kelvin, else convert mired
        if "color_temp_kelvin" in attrs and attrs["color_temp_kelvin"] is not None:
            parts.append(f"Color temperature: {attrs['color_temp_kelvin']}K.")
        elif "color_temp" in attrs and attrs["color_temp"] is not None:
            try:
                kelvin = round(1_000_000 / attrs["color_temp"])
                parts.append(f"Color temperature: {kelvin}K.")
            except (ZeroDivisionError, TypeError):
                pass

        return {"response": " ".join(parts), "raw": tool_call}

    if name == "toggle_lights":
        state = args.get("state", "").lower()
        has_brightness = "brightness_pct" in args
        has_temp = "color_temp_kelvin" in args

        # Decide service: use turn_on if state==on or if only brightness/temp changes
        if state == "off" and not has_brightness and not has_temp:
            service = "turn_off"
        else:
            service = "turn_on"

        service_data: dict = {"entity_id": _light_entity}

        if state == "on":
            pass  # turn_on with no extra args
        elif state == "off" and not has_brightness and not has_temp:
            pass  # turn_off

        if ASSIST_PHASE >= 2:
            if has_brightness:
                pct = max(0, min(100, int(args["brightness_pct"])))
                service_data["brightness_pct"] = pct
            if has_temp:
                k = max(1500, min(9000, int(args["color_temp_kelvin"])))
                service_data["color_temp_kelvin"] = k
            if "rgb_color" in args:
                service_data["rgb_color"] = args["rgb_color"]
            if "hs_color" in args:
                service_data["hs_color"] = args["hs_color"]

        try:
            await ha_call_service("light", service, service_data)
        except Exception as e:
            logger.error(f"[Assist] HA service call failed: {e}")
            return {"response": "Could not reach Home Assistant.", "raw": tool_call}

        # Build response sentence
        parts = []
        if state == "on":
            parts.append(f"{display} turned ON.")
        elif state == "off":
            parts.append(f"{display} turned OFF.")
        else:
            parts.append(f"{display} updated.")

        if ASSIST_PHASE >= 2:
            if has_brightness:
                parts.append(f"Brightness set to {service_data['brightness_pct']}%.")
            if has_temp:
                parts.append(f"Color temperature set to {service_data['color_temp_kelvin']}K.")

        return {"response": " ".join(parts), "raw": tool_call}

    # Unknown function name
    return {"response": "No function available for that request.", "raw": tool_call}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/status")
async def assist_status():
    """Readiness check for Assist Mode."""
    ha_configured = bool(_ha_url and _ha_token)

    return {
        "available": ha_configured,
        "ha_configured": ha_configured,
        "ha_url": _ha_url if ha_configured else None,
        "light_entity": _light_entity,
        "assist_phase": ASSIST_PHASE,
    }


@router.get("/light_state")
async def light_state_endpoint(request: Request):
    """Return current state of the configured light entity for the sidebar."""
    if not _ha_url or not _ha_token or not _light_entity:
        raise HTTPException(status_code=503, detail={"error": "HA not configured"})
    try:
        data = await ha_get_state(_light_entity)
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})

    attrs = data.get("attributes", {})
    raw_brightness = attrs.get("brightness")          # 0–255 or None
    try:
        brightness_pct = round(float(raw_brightness) / 255 * 100) if raw_brightness is not None else 0
    except (TypeError, ValueError):
        brightness_pct = 0

    return {
        "entity_id": _light_entity,
        "state": data.get("state", "off"),            # "on" | "off"
        "brightness_pct": brightness_pct,
        "color_temp_k": attrs.get("color_temp_kelvin") or (
            round(1_000_000 / attrs["color_temp"]) if attrs.get("color_temp") else None
        ),
        "rgb": attrs.get("rgb_color"),
        "last_changed": data.get("last_changed"),
    }
