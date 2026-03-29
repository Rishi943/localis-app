# CLAUDE.md

## Workflow Rules

### Superpowers Skills (mandatory)
- **`superpowers:systematic-debugging`** — before proposing ANY bug fix
- **`superpowers:requesting-code-review`** — after completing a feature or fix
- **`superpowers:writing-plans`** — before touching code on multi-step tasks
- **`superpowers:brainstorming`** — before building new features or UI changes
- **`superpowers:verification-before-completion`** — before claiming work is done

### Context Limit Awareness (learned 2026-03-26)
Before planning or executing a multi-task session, check the current context window usage. Plan task batches to fit within the remaining context — don't start a 14-task execution near the context limit. Use subagents to preserve orchestrator context for coordination work.

### Parallel Agent Rule (learned 2026-03-20)
**Never dispatch parallel worktree agents on the same file.** Use `superpowers:subagent-driven-development` (sequential) for JS/HTML/CSS tasks. Only use parallel worktree agents when tasks touch **completely different files** with no shared state.

### UI Design System
Any UI change **must** read `UIUX/DESIGN.md` first and update it after if new patterns are introduced. The design system defines the "Midnight Glass" identity, typography (Inter + JetBrains Mono), CSS variables, and component behavior. Never contradict it without asking.

### Wakeword: Hey Chotu
Wakeword is **"Hey Chotu"** (renamed from "Hey Jarvis", 2026-03-28). All user-facing text updated. Internal model file remains `hey_jarvis_v0.1.onnx` (openWakeWord built-in — cannot rename). Do not use "Jarvis" anywhere in UI or video going forward.

### Home Assistant Multi-Device (Future)
Currently hardcoded to one entity (`light.rishi_room_light`). When expanding to multiple devices: fetch available HA entities at startup via `/api/states`, inject the entity list dynamically into the `home.set_light` tool description so the model can pick the right entity by name. Design the tool schema to be extensible (scenes, switches, thermostats) — don't assume lights-only.

### Localis Logo
The canonical Localis logo is at `Localis-demo/public/logo.svg` (dark rounded square `#161616`, sand-colored `#c8b89a` "L" with bracket marks). Use this SVG everywhere — splash screens, demo intros, favicons, README headers. Never substitute a different icon or the old lightning bolt.

### Test Data Cleanup
After any test run that writes to the database (notes, reminders, sessions, etc.), **always delete the test data before ending the session**. For notes specifically: `sqlite3 ~/.local/share/localis/chat_history.db "DELETE FROM notes WHERE content LIKE '%test%' OR content LIKE '%Test%';"` — or wipe all if none are real: `DELETE FROM notes;`. Never leave test rows in the live DB.

### CLAUDE.md Auto-Update
After every major change: add a dated Changelog entry, update Current Status. One paragraph max per entry.

---

## Current Status (2026-03-28)

All features through Phase 02.1 are on `main`. Single-model tool-calling architecture live. No open feature branches.

**Completed:** Tutorial system, memory system, RAG pipeline, voice/wakeword, Home Assistant integration, notes/reminders, finance advisor, chat UI redesign (Midnight Glass), single-model agentic tool-calling.

**Known issues:**
- 15/71 tests fail to collect (torch metaclass conflict during app startup in test context — fix: mock `get_embedder()` in conftest or add `TESTING=1` skip)
- 1 test fails: `test_finance_context_with_transactions` (assertion error)
- `chat_endpoint()` is 743 lines (main.py:975-1718) — primary refactoring target
- 70+ hidden DOM compatibility shims in index.html masking dead JS refs — needs cleanup

---

## Commands

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000   # Run app
pip install -r requirements.txt                              # Install deps
source .venv/bin/activate && pytest tests/ --tb=short -q     # Run tests (55 pass, 15 collection errors, 1 fail)
bash scripts/setup_voice_venv.sh                             # Voice venv (Python 3.11)
bash scripts/voice_verify.sh                                 # Voice tests
```

---

## Architecture

### Backend Modules

| Module | Lines | Purpose |
|--------|-------|---------|
| `main.py` | 2,181 | FastAPI app, routes, chat pipeline (single-model agentic tool-calling), tutorial system, model loading |
| `database.py` | 1,024 | SQLite schema (13 tables), all DB operations, memory KV store |
| `rag.py` | 1,154 | RAG upload, ingest orchestration, SSE progress, query API |
| `rag_processing.py` | 418 | PDF/DOCX/CSV text extraction, 512-char semantic chunking |
| `rag_vector.py` | 483 | ChromaDB vector indexing, embedding, session-scoped collections |
| `memory_core.py` | 792 | Two-tier memory, BGE-small embeddings (BAAI/bge-small-en-v1.5), proposal system |
| `assist.py` | 951 | Home Assistant tool executors (set_light, get_device_state), function call parsing |
| `finance.py` | 904 | CSV parsing (chequing/credit), merchant categorization, finance chat |
| `wakeword.py` | 838 | openWakeWord daemon, browser WebSocket audio, state machine |
| `voice.py` | 463 | faster-whisper STT, Piper TTS, lazy-load with double-check locking |
| `notes.py` | 247 | Notes/reminders CRUD, due date filtering |
| `tools.py` | 192 | Web search (Brave/Tavily/custom), provider fallback chain |
| `setup_wizard.py` | 160 | First-run model download, tutorial |
| `updater.py` | 164 | Git-based self-update |

All feature modules follow `register_*(app, config)` -> `APIRouter(prefix=..., tags=[...])` pattern. Register in `main.py`.

### Frontend (single-file monolith)

| File | Lines | Key modules |
|------|-------|-------------|
| `app.js` | 8,234 | `els`, `state`, `api`, `FRT`, `RPG`, `voiceStatusBar`, `financeUI`, `notesUI`, `toolsUI`, `modePills`, `rsbLights`, `rsbModel`, `rsbStats`, `ragUI`, `voiceUI`, `wakewordUI` |
| `index.html` | 968 | 157 element IDs, 15 SVG symbol defs, hidden compat section (lines ~600-681) |
| `app.css` | 1,844 | 25 CSS variables in `:root`, Midnight Glass palette |

### Database (13 tables)

**Core:** `sessions`, `messages`, `app_settings`
**Memory:** `user_memory`, `user_memory_meta`, `vector_memory`, `memory_events`
**RAG:** `rag_files` (21 columns, SHA256 dedup), `rag_session_settings`
**Finance:** `fin_uploads`, `fin_transactions`, `fin_goals`
**Notes:** `notes`

Schema migration: `ALTER TABLE ... ADD COLUMN` wrapped in `try/except OperationalError`. Finance tables DROP+recreate on startup (V1->V2 migration).

### Concurrency — Three Independent Locks

| Lock | Module | Protects |
|------|--------|----------|
| `MODEL_LOCK` | main.py:184 | llama-cpp-python instance (single Qwen3.5 model). Held for Pass 1 tool-calling and Pass 2 response streaming. |
| `VOICE_STT_LOCK` | voice.py:40 | faster-whisper model |
| `VOICE_TTS_LOCK` | voice.py:41 | Piper TTS subprocess |

These are fully independent — no cross-lock contention.

### Chat Pipeline (main.py `chat_endpoint`, 743 lines)

1. Pass 1 (with MODEL_LOCK): Qwen3.5 decides which of 7 tools to call (web.search, home.set_light, home.get_device_state, notes.add, notes.retrieve, memory.retrieve, memory.write)
2. Tool execution (parallel `asyncio.gather`) -> memory, web search, RAG, notes, Home Assistant
3. Context building -> Tier-A identity + tool results + RAG chunks + datetime + system prompt with present_penalty=1.5
4. Direct answers (no tools): synthetic SSE stream (no Pass 2 call)
5. Tool results present: Pass 2 (with MODEL_LOCK) -> Qwen3.5 streams final response via SSE
6. Persistence -> `asyncio.to_thread(database.add_message, ...)` (non-blocking)

### Environment Configuration

Key env vars (loaded from `secret.env` in DATA_DIR or project root):

| Var | Purpose | Default |
|-----|---------|---------|
| `LOCALIS_DATA_DIR` | Data directory | `~/.local/share/localis` |
| `MODEL_PATH` | GGUF model directory | `DATA_DIR/models` |
| `LOCALIS_DEBUG` | Verbose logging (0/1) | `0` |
| `LOCALIS_HA_URL` | Home Assistant URL | (required for assist) |
| `LOCALIS_HA_TOKEN` | HA long-lived access token | (required for assist) |
| `LOCALIS_LIGHT_ENTITY` | HA light entity ID | `light.bedroom_light` |
| `LOCALIS_ASSIST_PHASE` | Assist feature level (1=on/off, 2=+brightness/color) | `2` |
| `LOCALIS_WAKEWORD_THRESHOLD` | Detection threshold | `0.20` |
| `LOCALIS_WHISPER_MODEL` | STT model size | `small` |
| `LOCALIS_VOICE_KEY` | LAN voice access key | (optional) |
| `BRAVE_API_KEY` | Brave search API | (optional) |
| `TAVILY_API_KEY` | Tavily search API | (optional) |

---

## Constraints

- **MODEL_LOCK is mandatory** for all llama-cpp-python calls — no exceptions
- **Tier-A writes require `user_explicit` authority** — router cannot auto-write identity keys
- **`database.DB_NAME`** is the canonical DB path (set by main.py to DATA_DIR location)
- **RAG session isolation** — always sanitize session_id with `_safe_session_id()`
- **Frontend session changes** — call `ragUI.refresh()` when `state.sessionId` changes
- **Streaming UI** — `requestAnimationFrame` throttling during stream, markdown parse only on completion. No debounced rendering.
- **Debug logging** — no high-volume logging unless `LOCALIS_DEBUG=1`

---

## Multi-Agent Standards

### File Ownership
- Declare owned files before making changes
- Never touch files outside your owned list without escalation
- For JS/HTML/CSS: use sequential subagent development, not parallel worktrees

### Pre-Merge Checklist
- [ ] No syntax errors in modified files
- [ ] No new global variables (use module pattern)
- [ ] No `console.log` in production paths
- [ ] Optional chaining for all DOM lookups: `els.foo?.classList.add(...)`
- [ ] SSE EventSources closed on terminal states
- [ ] `clearInterval()` before creating new timers

### Streaming UI Pattern
**During stream:** plain `textContent` + `requestAnimationFrame` throttle. **On completion:** one-time markdown parse + syntax highlight. **Think mode:** collapsible panel, collapsed by default.

### SSE Event Schema (canonical)
```json
// Ingest progress
{ "event_type": "ingest_status", "state": "running|done|error|cancelled", "phase": "upload|extract|chunk|index", "total_files": 3, "done_files": 1, "current_file_name": "bank.pdf", "message": "Chunking 2/3: bank.pdf", "updated_at": "2026-02-16T21:00:00Z", "error": null }

// Tool activity (emitted after Pass 1 resolves tool calls, before execution)
{ "event_type": "tool_start", "tool": "web.search" }

// Tool result (emitted after tool execution completes)
{ "event_type": "tool_result", "tool": "web.search", "results": [...] }

// Chat token stream
{ "content": "...", "stop": false }
{ "content": "", "stop": true }
```
All `data:` payloads must be valid JSON. Always emit terminal state. Frontend must close EventSource on `done`/`error`/`cancelled`.

---

## Voice / Wakeword

`.venv-voice` (Python 3.11) is separate from main `.venv` because `openwakeword` needs `tflite-runtime` which doesn't build on Python 3.13+. Setup: `bash scripts/setup_voice_venv.sh`. Pinned: `openwakeword==0.6.0`.

Wakeword config: model `hey_jarvis_v0.1.onnx`, threshold `0.20` (env override), detection window `_WINDOW=8` frames (640ms).

---

## File Tree

```
app/
  main.py            database.py       memory_core.py     tools.py
  rag.py             rag_processing.py  rag_vector.py
  assist.py          finance.py         notes.py
  voice.py           wakeword.py
  setup_wizard.py    updater.py         __init__.py
  templates/index.html
  static/css/app.css  static/js/app.js
  static/css/setup_wizard.css  static/css/updater_ui.css
  static/js/setup_wizard.js    static/js/updater_ui.js
  static/sounds/chime.mp3

tests/               # 18 files (conftest.py + 16 test_*.py + 1 .sh)
UIUX/DESIGN.md       # Canonical design system
docs/                 # Audit reports, superpowers plans
scripts/              # setup_voice_venv.sh, voice_verify.sh
```

**DATA_DIR** (`~/.local/share/localis/`): `chat_history.db`, `models/`, `static/wallpaper.bg`, `rag/sessions/<id>/uploads/`, `logs/localis.log`

---

## Changelog

### 2026-03-28 — Single-Model Tool Calling (FunctionGemma removed)
Replaced dual-model pipeline (FunctionGemma router + Qwen3.5 generator) with single Qwen3.5 agentic tool-calling loop. Model receives 7 permitted tools (web.search, home.set_light, home.get_device_state, notes.add, notes.retrieve, memory.retrieve, memory.write), decides which to call in Pass 1 (non-streaming), tools execute in parallel, Pass 2 streams final response. Direct answers emit as synthetic stream with no second call. Removed: FunctionGemma GGUF, ASSIST_MODEL_LOCK, assist_mode UI button, tool_actions/use_search/memory_mode fields. Fixed: memory identity framing ("I am Rishi" bug), added present_penalty=1.5, datetime in system prompt.

### 2026-03-28 — Wakeword rename + logo update
Renamed "Hey Jarvis" → "Hey Chotu" in voice status bar labels (`app.js`), notes empty-state hint (`index.html`), and wakeword comments (`wakeword.py`). Internal model stays `hey_jarvis_v0.1.onnx`. Also: logo updated — Localis logo SVG now used in sidebar brand-icon and AI message avatar (replacing bolt icon and 'L' initial).

### 2026-03-22 — Strategic Audit
Full codebase review (audit report: `docs/Audit Report-22-03.md`). Identified: 13 tables (not 7), 18 test files (not 0), 3 undocumented modules (rag_processing, rag_vector, finance), 4 independent locks, 743-line chat_endpoint, 70+ DOM compat shims. Rewrote CLAUDE.md to reflect current state.

### 2026-03-19 — Chat UI Redesign (merged to main)
Eight-task Midnight Glass redesign: action cluster, input pill, LSB/RSB collapse, chat bubbles with avatars, tool use cards, thinking blocks, RSB polish. All on main (commits 862fc64 through 4d1a2cc).

### 2026-03-19 — Phase 02.1: Notes & Reminders
Voice-triggered notepad with timed reminder pings. 6 REST endpoints, notes table, router tool integration, frontend dashboard overlay. 9 tests passing.

### 2026-03-12 — Palette & Settings Modal
Midnight Black palette, settings modal (inference + appearance), DB-persisted accent/wallpaper.

### 2026-03-11 — UI Redesign + Demo Path Polish
Three-column Midnight Glass shell, voice status bar (gray/amber/green), trimmed to Inter + JetBrains Mono only.

### 2026-03-10 — Wakeword Bug Fixes
numpy float32 JSON crash fix, detection window 16->8, threshold 0.35->0.20.
