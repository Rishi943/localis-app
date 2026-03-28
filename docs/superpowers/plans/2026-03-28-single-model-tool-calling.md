# Single-Model Tool Calling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dual-model (FunctionGemma router + Qwen3.5 generator) pipeline with a single Qwen3.5 agentic tool-calling loop across all input paths.

**Architecture:** Single-round tool calling — Qwen3.5 receives permitted tools, decides what to call (Pass 1, non-streaming), tools execute in parallel, Qwen3.5 generates final response (Pass 2, streaming). If the model answers directly in Pass 1, its content is emitted as a synthetic stream with no second model call.

**Tech Stack:** llama-cpp-python `create_chat_completion` with `tools` param, FastAPI SSE, asyncio parallel execution, Python `datetime` for context injection.

**Spec:** `docs/superpowers/specs/2026-03-28-single-model-tool-calling.md`

---

## File Map

| File | Change Type | What Changes |
|---|---|---|
| `app/memory_core.py` | Minor | Fix `format_identity_for_prompt` label + value format |
| `app/main.py` | Major | New `PROMPT_DEFAULT`, datetime injection, `get_permitted_tools()`, `execute_tool_call()`, two-pass loop, remove old infrastructure |
| `app/assist.py` | Medium | Strip FunctionGemma model loading; keep HA HTTP helpers; add `execute_home_set_light()`, `execute_home_get_state()`, `is_ha_configured()` |
| `app/templates/index.html` | Minor | Remove assist mode button |
| `app/static/js/app.js` | Medium | Remove assist toggle, simplify web search toggle, add `tool_start` SSE handler, clean chat payload |
| `app/static/css/app.css` | Minor | Remove assist mode styles |

---

## Task 1: Fix memory identity framing (memory_core.py)

**Files:** Modify `app/memory_core.py:200-208`

- [ ] **Replace `format_identity_for_prompt`** — the current label `[USER IDENTITY (Tier-A)]` causes models to claim the user's identity as their own.

Find (lines 200-208):
```python
def format_identity_for_prompt(identity: Dict[str, str]) -> str:
    if not identity:
        return ""
    lines = ["[USER IDENTITY (Tier-A)]"]
    for key in sorted(identity.keys()):
        val = identity[key]
        label = key.replace("_", " ").capitalize()
        lines.append(f"* {label}: {val}")
    return "\n".join(lines)
```

Replace with:
```python
def format_identity_for_prompt(identity: Dict[str, str]) -> str:
    if not identity:
        return ""
    lines = ["[ABOUT THE USER YOU ARE TALKING TO — this is not about yourself]"]
    for key in sorted(identity.keys()):
        val = identity[key]
        label = key.replace("_", " ").lower()
        lines.append(f"* The user's {label} is: {val}")
    return "\n".join(lines)
```

- [ ] **Verify output** — start a Python shell from the project root:
```bash
source .venv/bin/activate
python -c "
from app.memory_core import format_identity_for_prompt
print(format_identity_for_prompt({'preferred_name': 'Rishi', 'location': 'Montreal'}))
"
```
Expected:
```
[ABOUT THE USER YOU ARE TALKING TO — this is not about yourself]
* The user's location is: Montreal
* The user's preferred name is: Rishi
```

- [ ] **Commit:**
```bash
git add app/memory_core.py
git commit -m "fix(memory): reframe identity block to prevent model self-identification bug"
```

---

## Task 2: New PROMPT_DEFAULT + datetime injection (main.py)

**Files:** Modify `app/main.py:191`, `app/main.py:~1530`

- [ ] **Replace `PROMPT_DEFAULT`** at line 191:

```python
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
```

- [ ] **Add datetime injection** in `chat_endpoint`. Find the block (~line 1525) that resolves `system_prompt_text`:

```python
    if session_id in tutorial_prompts:
        system_prompt_text = tutorial_prompts[session_id]
    elif req.system_prompt:
        system_prompt_text = req.system_prompt
    else:
        system_prompt_text = database.get_app_setting("default_system_prompt") or PROMPT_DEFAULT
```

Immediately after that block (after `system_prompt_text` is assigned), add:

```python
    # Prepend current datetime so model can anchor time-sensitive queries and tool calls
    from datetime import datetime as _dt
    _now_str = _dt.now().strftime("%A, %B %d, %Y %H:%M")
    system_prompt_text = f"Current date and time: {_now_str}\n\n{system_prompt_text}"
```

- [ ] **Start server and confirm no errors:**
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 2>&1 | head -20
```
Expected: `Application startup complete.`

- [ ] **Commit:**
```bash
git add app/main.py
git commit -m "feat(chat): Localis identity in PROMPT_DEFAULT, inject current datetime into system prompt"
```

---

## Task 3: Refactor assist.py — strip FunctionGemma, add HA tool executors

**Files:** Modify `app/assist.py`

- [ ] **Remove these module-level globals** (lines ~29-39):
  - `DEFAULT_ASSIST_MODEL_FILE = "distil-home-assistant-functiongemma.gguf"`
  - `ASSIST_MODEL_LOCK = threading.Lock()`
  - `_assist_model = None`
  - `_assist_model_file: str = DEFAULT_ASSIST_MODEL_FILE`

- [ ] **Remove these functions entirely:**
  - `_get_model_path()` (~line 500)
  - `_load_assist_model()` (~line 505, ~40 lines)
  - The `_run_function_gemma()` function or the block inside it that calls `_load_assist_model()` and `_assist_model.create_chat_completion()` (~line 530)
  - `AssistRequest` and `AssistResponse` Pydantic models (~line 849)
  - `assist_chat()` async function and its `@router.post("/chat")` decorator (~line 864)

- [ ] **Simplify `register_assist()`** — remove `_assist_model_file` line (line ~123):

```python
def register_assist(app, models_dir, debug: bool = False):
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
```

- [ ] **Add `is_ha_configured()`** after the module globals section:

```python
def is_ha_configured() -> bool:
    """True if HA URL and token are both set."""
    return bool(_ha_url and _ha_token)
```

- [ ] **Add color map and `execute_home_set_light()`** — place after `is_ha_configured()`:

```python
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
```

- [ ] **Add `execute_home_get_state()`** after `execute_home_set_light`:

```python
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
```

- [ ] **Verify no dangling references** to removed symbols:
```bash
grep -rn "assist_chat\|AssistRequest\|AssistResponse\|ASSIST_MODEL_LOCK\|_load_assist_model\|DEFAULT_ASSIST_MODEL_FILE" app/ --include="*.py"
```
Expected: zero matches.

- [ ] **Verify server starts:**
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 2>&1 | head -20
```

- [ ] **Commit:**
```bash
git add app/assist.py
git commit -m "feat(assist): strip FunctionGemma; add execute_home_set_light, execute_home_get_state, is_ha_configured"
```

---

## Task 4: Add get_permitted_tools() to main.py

**Files:** Modify `app/main.py` — add after `PROMPT_DEFAULT` (~line 192)

- [ ] **Add `get_permitted_tools()`** function:

```python
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
```

- [ ] **Smoke test** — confirm tool list shape:
```bash
source .venv/bin/activate
python -c "
import os; os.environ['LOCALIS_HA_URL'] = ''; os.environ['LOCALIS_HA_TOKEN'] = ''
from app.main import get_permitted_tools
tools = get_permitted_tools(web_search_on=True)
print([t['function']['name'] for t in tools])
"
```
Expected: `['web.search', 'notes.add', 'notes.retrieve', 'memory.retrieve', 'memory.write']`
(No HA tools because HA not configured in env.)

- [ ] **Commit:**
```bash
git add app/main.py
git commit -m "feat(chat): add get_permitted_tools() — LLM tool permission factory"
```

---

## Task 5: Add execute_tool_call() dispatcher to main.py

**Files:** Modify `app/main.py` — add after `get_permitted_tools()` as a module-level async function

- [ ] **Add `execute_tool_call()`:**

```python
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
```

- [ ] **Commit:**
```bash
git add app/main.py
git commit -m "feat(chat): add execute_tool_call() dispatcher for all LLM tool calls"
```

---

## Task 6: Implement two-pass tool calling loop in chat_endpoint

**Files:** Modify `app/main.py` — replaces the manual tool execution block and stream response.

This is the core rewrite. Read the existing `chat_endpoint` carefully before editing.

- [ ] **Delete the manual tool execution block** — find the comment `# 2. Manual Tool Execution (Frontend-Driven)` (~line 1107) and delete everything from there down to (but not including) the system prompt assembly block starting with `# Check for tutorial-specific system prompt` (~line 1525). This removes:
  - `effective_tool_actions` construction
  - Regex note patterns (`_note_add_re`, `_note_retrieve_re`)
  - `ALLOWED_TOOLS` set and `validated_tools` loop
  - `execute_tool()` inner function
  - The `asyncio.gather` parallel execution
  - `tool_messages` injection into `messages[0]["content"]`
  - The old think mode injection block

- [ ] **After** the `build_chat_context_v2` call (~line 1537), replace everything from `# RAG is now manual` to the end of the function with:

```python
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
                    web_search_provider=req.web_search_provider,
                    web_search_custom_endpoint=req.web_search_custom_endpoint,
                    web_search_custom_api_key=req.web_search_custom_api_key,
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
```

- [ ] **Check server starts:**
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 2>&1 | grep -E "error|Error|startup complete" | head -10
```
Expected: `Application startup complete.`

- [ ] **Quick smoke test** — send a simple message via curl:
```bash
curl -s -N -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "say hi", "session_id": "test-smoke-001", "web_search_mode": "off"}' | head -5
```
Expected: SSE events containing `"content"` fields streaming in.

- [ ] **Commit:**
```bash
git add app/main.py
git commit -m "feat(chat): implement two-pass LLM-driven tool calling loop with SSE streaming"
```

---

## Task 7: Remove old infrastructure from main.py and ChatRequest

**Files:** Modify `app/main.py`

- [ ] **In `ChatRequest`** (~line 461), remove these fields:
  - `use_search: bool = False`
  - `tool_actions: List[str | Dict[str, Any]] | None = None`
  - `assist_mode: bool = False`
  - `memory_mode: str = "auto"`

- [ ] **Update `web_search_mode` comment** in `ChatRequest`:
```python
web_search_mode: str = "off"  # "off" | "on"
```

- [ ] **Remove the assist mode early-return block** (~lines 978-999):
```python
# DELETE the entire block starting with:
if req.assist_mode:
    from .assist import assist_chat, AssistRequest as _AssistRequest
    # ... through ...
    return StreamingResponse(_assist_stream(), media_type="text/event-stream")
```

- [ ] **Add `tier_a_proposals = []`** — this was declared inside the deleted tool execution block. After the slash command handling block (~line 1105), add one line so `event_stream()` can still reference it:
```python
tier_a_proposals = []  # Populated by memory tool if Tier-A write proposal needed
```

- [ ] **Update the debug log line** (~line 976) — remove `mem={req.memory_mode}` reference:
```python
logger.debug(f"[Chat] Session: {req.session_id[:12]}... think={req.think_mode} web={req.web_search_mode}")
```

- [ ] **Run tests to check for regressions:**
```bash
source .venv/bin/activate && pytest tests/ --tb=short -q --ignore=tests/test_voice_stt.py 2>&1 | tail -20
```
Expected: same pass/fail counts as before this work (55 pass, some collection errors — nothing new failing).

- [ ] **Commit:**
```bash
git add app/main.py
git commit -m "refactor(chat): remove assist_mode, tool_actions, memory_mode, use_search from ChatRequest"
```

---

## Task 8: Frontend — remove assist mode, simplify web search toggle

**Files:** Modify `app/templates/index.html`, `app/static/js/app.js`, `app/static/css/app.css`

- [ ] **In `index.html`:** search for the assist toggle button (search for `assist`). Remove the button element. If it's wrapped in a container that only holds this button, remove the container too.

- [ ] **In `app.css`:** search for CSS rules targeting the assist button (search for `assist`). Remove those rules.

- [ ] **In `app.js`:**

  **a) Remove `assist_mode` and `tool_actions` from the chat payload** (search for `assist_mode:` and `tool_actions:` in the payload object ~line 6617):
  ```javascript
  // REMOVE these lines:
  tool_actions: selectedTools.length > 0 ? selectedTools : null,
  assist_mode: isAssistMode,
  memory_mode: ...,
  ```

  **b) Remove `isAssistMode` variable and its conditional branches** — search for `isAssistMode` and delete the variable assignment and all blocks gated on it.

  **c) Simplify web search toggle to Off / On** — find the toggle that cycles through `"off"` / `"enabled"` / `"auto"`. Change it to cycle between `"off"` and `"on"` only:
  ```javascript
  // Change the cycle logic to:
  state.webSearchMode = state.webSearchMode === 'on' ? 'off' : 'on';
  ```
  Update button label: replace "Auto" / "Enabled" text with "On".

  Update any comparisons to web search mode:
  - `=== "enabled"` → `=== "on"`
  - `=== "auto"` → `=== "on"`
  - Any ternary that includes three states → simplify to two states.

- [ ] **Verify page loads with no console errors:**
```bash
# Open browser to http://localhost:8000, open DevTools > Console
# Expected: no JS errors
```

- [ ] **Commit:**
```bash
git add app/templates/index.html app/static/css/app.css app/static/js/app.js
git commit -m "feat(ui): remove assist mode toggle; simplify web search to Off/On"
```

---

## Task 9: Frontend — add tool_start SSE handler

**Files:** Modify `app/static/js/app.js`

- [ ] **Find the SSE message handler** in the chat stream function (search for `event_type` or `tool_result` — the block that parses incoming SSE data objects).

- [ ] **Add `tool_start` handler** before the existing `tool_result` handler:

```javascript
if (data.event_type === 'tool_start') {
    const toolName = data.tool;
    const toolLabels = {
        'web.search': 'Searching web\u2026',
        'home.set_light': 'Controlling light\u2026',
        'home.get_device_state': 'Checking device\u2026',
        'notes.add': 'Saving note\u2026',
        'notes.retrieve': 'Loading notes\u2026',
        'memory.retrieve': 'Searching memory\u2026',
        'memory.write': 'Saving memory\u2026',
    };
    // Find existing pill or create a placeholder — reuse existing tool pill infrastructure
    const pill = document.querySelector(`[data-tool="${toolName}"]`);
    if (pill) {
        pill.classList.add('tool-pill--loading');
        const labelEl = pill.querySelector('.tool-pill__label');
        if (labelEl) labelEl.textContent = toolLabels[toolName] || `${toolName}\u2026`;
    }
    return;
}
```

- [ ] **Update `tool_result` handler** to clear the loading state:

```javascript
if (data.event_type === 'tool_result') {
    const pill = document.querySelector(`[data-tool="${data.tool}"]`);
    if (pill) pill.classList.remove('tool-pill--loading');
    // ... rest of existing tool_result rendering ...
}
```

- [ ] **Verify no console errors** after sending a message with web search ON.

- [ ] **Commit:**
```bash
git add app/static/js/app.js
git commit -m "feat(ui): add tool_start SSE handler to animate tool pills during execution"
```

---

## Task 10: Manual end-to-end verification

- [ ] **Start server:**
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- [ ] **Memory framing test** — send `"who am I?"` in a session with memory containing Rishi/Montreal.
  - Expected: `"You are Rishi"` — NOT `"I am Rishi"`

- [ ] **Date/time test** — send `"what's today's date?"` with web search OFF.
  - Expected: model states today's date correctly from system prompt context.

- [ ] **Direct answer (no tools)** — send `"what is 2 + 2?"`.
  - Expected: instant response, no tool pills animate, single-pass synthetic stream.

- [ ] **Web search test** — toggle web search ON, send `"who won the last F1 race?"`.
  - Expected: `web.search` pill animates → result returned → model gives answer with source.

- [ ] **Web search OFF** — toggle OFF, send same question.
  - Expected: no search fires, model answers from knowledge or states uncertainty.

- [ ] **HA light test** — send `"turn the bedroom light off"`.
  - Expected: `home.set_light` tool fires, light turns off, model confirms with "Bedroom light turned OFF."

- [ ] **HA light with voice** — trigger wakeword, say "light on kar do".
  - Expected: same pipeline as text, Qwen3.5 handles it, light responds.

- [ ] **Note save test** — send `"remind me to call dad tomorrow at 9am"`.
  - Expected: `notes.add` fires with `note_type: reminder`, confirmation in response.

- [ ] **Note retrieve test** — send `"what are my reminders?"`.
  - Expected: `notes.retrieve` fires, reminders listed in response.

- [ ] **Presence penalty sanity** — send a long-form question. Confirm model doesn't loop or repeat itself.

- [ ] **Clean test data:**
```bash
sqlite3 ~/.local/share/localis/chat_history.db "DELETE FROM notes WHERE content LIKE '%test%' OR content LIKE '%call dad%' OR content LIKE '%remind%';"
sqlite3 ~/.local/share/localis/chat_history.db "DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE title LIKE '%test%');"
```

- [ ] **Delete FunctionGemma model** (reclaim disk/VRAM):
```bash
ls ~/.local/share/localis/models/
rm ~/.local/share/localis/models/distil-home-assistant-functiongemma.gguf
```

- [ ] **Update CLAUDE.md changelog** with a dated entry describing this change.

- [ ] **Final commit:**
```bash
git add CLAUDE.md
git commit -m "docs(claude): update changelog — single-model tool calling, remove FunctionGemma"
```
