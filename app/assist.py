# app/assist.py
# Assist Mode — FunctionGemma-based smart home control via Home Assistant REST API
# Phase 1: on/off toggle + state query
# Phase 2: brightness/color (gated behind ASSIST_PHASE env var)

import os
import re
import json
import threading
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Phase gate — env-driven, clamp to {1, 2}
# ---------------------------------------------------------------------------
_raw_phase = int(os.getenv("LOCALIS_ASSIST_PHASE", "2"))
ASSIST_PHASE = max(1, min(2, _raw_phase))

DEFAULT_ASSIST_MODEL_FILE = "distil-home-assistant-functiongemma.gguf"
ASSIST_MODEL_LOCK = threading.Lock()

# Module-level state (populated by register_assist)
_assist_model = None          # Llama instance
_models_dir: str = ""
_ha_url: str = ""
_ha_token: str = ""
_light_entity: str = ""
_debug: bool = False
_assist_model_file: str = DEFAULT_ASSIST_MODEL_FILE

router = APIRouter(prefix="/assist", tags=["assist"])


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_assist(app, models_dir, debug: bool = False):
    """Called from main.py during app construction."""
    global _models_dir, _ha_url, _ha_token, _light_entity, _debug, _assist_model_file

    _models_dir = str(models_dir)
    _debug = debug

    _ha_url = os.getenv("LOCALIS_HA_URL", "").rstrip("/")
    _ha_token = os.getenv("LOCALIS_HA_TOKEN", "")
    _light_entity = os.getenv("LOCALIS_LIGHT_ENTITY", "light.bedroom_light")
    _assist_model_file = os.getenv("LOCALIS_ASSIST_MODEL", DEFAULT_ASSIST_MODEL_FILE)

    if _ha_url and _ha_token:
        logger.info(f"[Assist] Home Assistant configured: {_ha_url}, entity: {_light_entity}, phase: {ASSIST_PHASE}")
    else:
        logger.warning("[Assist] Home Assistant not configured. Set LOCALIS_HA_URL and LOCALIS_HA_TOKEN in secret.env")

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
        "You are an on-device smart home router. "
        "Always respond by calling exactly one tool from the provided tool schema. "
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
# Model management
# ---------------------------------------------------------------------------

def _get_model_path() -> Optional[str]:
    path = os.path.join(_models_dir, _assist_model_file)
    return path if os.path.isfile(path) else None


def _load_assist_model():
    """Load the FunctionGemma GGUF. Must be called with ASSIST_MODEL_LOCK held."""
    global _assist_model

    from llama_cpp import Llama

    model_path = _get_model_path()
    if not model_path:
        raise FileNotFoundError(
            f"Assist model not found: {_assist_model_file}. "
            "Download from HuggingFace: huggingface-cli download distil-labs/distil-home-assistant-functiongemma-gguf"
        )

    logger.info(f"[Assist] Loading FunctionGemma from {model_path} (CPU-only)")
    _assist_model = Llama(
        model_path=model_path,
        n_gpu_layers=0,   # CPU-only — no VRAM contention with main model
        n_ctx=2048,
        verbose=False,
    )
    logger.info("[Assist] FunctionGemma loaded successfully")


def _ensure_assist_model():
    """Lazy-load with double-check locking."""
    global _assist_model
    if _assist_model is not None:
        return
    with ASSIST_MODEL_LOCK:
        if _assist_model is not None:
            return
        _load_assist_model()


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------

def _run_assist_inference(user_message: str) -> Optional[dict]:
    """Single inference attempt. Returns parsed tool call dict or None."""
    global _assist_model

    tools = _build_tool_schema()
    messages = [
        {"role": "system", "content": _build_system_prompt()},
        {"role": "user", "content": user_message},
    ]

    with ASSIST_MODEL_LOCK:
        try:
            result = _assist_model.create_chat_completion(
                messages=messages,
                tools=tools,
                tool_choice="required",
                temperature=0,
                max_tokens=256,
            )
        except TypeError:
            # Older llama-cpp-python may not support tool_choice="required"
            result = _assist_model.create_chat_completion(
                messages=messages,
                tools=tools,
                tool_choice="auto",
                temperature=0,
                max_tokens=256,
            )

    choice = result["choices"][0]
    msg = choice.get("message", {}) or {}

    # 1) Preferred: native tool_calls
    tool_calls = msg.get("tool_calls") or []
    if tool_calls:
        tc = tool_calls[0]
        fn = tc.get("function") or {}
        name = fn.get("name")
        args = fn.get("arguments", {})
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except Exception:
                args = {}
        if _debug:
            logger.debug(f"[Assist] Native tool_call: name={name!r} args={args!r}")
        if name:
            return {"name": name, "arguments": args}

    # 2) Fallback: parse FunctionGemma native <start_function_call> format
    content = msg.get("content") or ""
    if _debug:
        logger.debug(f"[Assist] No tool_calls in response. Raw content fallback: {content!r}")

    native = _parse_native_call(content)
    if native is not None:
        if _debug:
            logger.debug(f"[Assist] Parsed via native format: {native!r}")
        return native

    return None


def _run_assist_with_retry(user_message: str) -> dict:
    """
    Attempt inference; on parse failure retry once, then fall back to
    deterministic heuristic. Always returns a tool-call dict (never None).
    """
    result = _run_assist_inference(user_message)
    if result is not None:
        return result

    if _debug:
        logger.debug("[Assist] First inference parse failed — retrying with fix suffix")

    retry_msg = user_message + " (important: use tool call)"
    result = _run_assist_inference(retry_msg)
    if result is not None:
        return result

    if _debug:
        logger.debug("[Assist] Retry failed — using heuristic fallback")

    return _heuristic_fallback(user_message)


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
# Pydantic models
# ---------------------------------------------------------------------------

class AssistRequest(BaseModel):
    message: str
    session_id: str = "assist-default"


class AssistResponse(BaseModel):
    response: str
    tool_call: Optional[dict] = None
    model_loaded: bool = False


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/chat", response_model=AssistResponse)
async def assist_chat(req: AssistRequest, request: Request):
    """
    Main Assist Mode endpoint. Bypasses the big LLM entirely.
    Runs FunctionGemma (CPU) → executes HA tool call → returns template response.
    """
    if not _ha_url or not _ha_token:
        raise HTTPException(
            status_code=503,
            detail="Home Assistant not configured. Set LOCALIS_HA_URL and LOCALIS_HA_TOKEN in secret.env"
        )

    model_path = _get_model_path()
    if not model_path:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Assist model not found: {_assist_model_file}. "
                "Download from HuggingFace: "
                "huggingface-cli download distil-labs/distil-home-assistant-functiongemma-gguf"
            )
        )

    # Lazy-load model
    try:
        _ensure_assist_model()
    except Exception as e:
        logger.error(f"[Assist] Model load failed: {e}")
        raise HTTPException(status_code=503, detail=str(e))

    # Run inference (always returns a tool call — never None)
    tool_call = _run_assist_with_retry(req.message.strip())

    # Execute tool call against HA
    result = await _execute_tool_call(tool_call)

    return AssistResponse(
        response=result["response"],
        tool_call=result["raw"],
        model_loaded=True,
    )


@router.get("/status")
async def assist_status():
    """Readiness check for Assist Mode."""
    model_path = _get_model_path()
    ha_configured = bool(_ha_url and _ha_token)

    return {
        "available": bool(model_path and ha_configured),
        "model_loaded": _assist_model is not None,
        "model_file": _assist_model_file,
        "model_found": model_path is not None,
        "ha_configured": ha_configured,
        "ha_url": _ha_url if ha_configured else None,
        "light_entity": _light_entity,
        "assist_phase": ASSIST_PHASE,
    }
