# Localis Strategic Codebase Review

**Date:** 2026-03-22 | **Scope:** Full codebase (18,749 lines across 15 Python + 3 frontend files) | **Test suite:** 55 pass, 1 fail, 15 collection errors

---

## 1. Architecture

### What's Working Well

- **Module registration pattern** — All 8 feature modules (`rag`, `assist`, `voice`, `wakeword`, `finance`, `notes`, `setup_wizard`, `updater`) follow a clean `register_*(app, config)` -> `APIRouter` pattern. Adding new features is straightforward.
- **Three independent locks** — `MODEL_LOCK` (inference), `ASSIST_MODEL_LOCK` (FunctionGemma), `VOICE_STT_LOCK`/`VOICE_TTS_LOCK` — no contention across subsystems.
- **Two-tier memory architecture** — Tier-A (identity, requires explicit confirmation) vs Tier-B (auto-learned) with proper authority model. Well-designed for a personal assistant.
- **SSE streaming** — Correct patterns throughout: deferred markdown parsing, `requestAnimationFrame` throttling, proper `data:` line handling.
- **Wakeword state machine** — Clean IDLE -> RECORDING -> TRANSCRIBING -> COOLDOWN lifecycle with proper cooldown/retry.

### What Should Change

| Finding | Priority | Effort | Blocks? |
|---------|----------|--------|---------|
| **`chat_endpoint()` is 743 lines** (main.py:975-1718) — contains tool dispatch, RAG query extraction, memory retrieval, streaming, DB persistence, and 6 nested helper functions all in one function. This is the single biggest maintainability risk. | **P1** | 1-2 days | No, but makes every feature change fragile |
| **`_FakeRequest` hack** (main.py:984-987) — Assist mode creates a fake request object to call `assist_chat()`. Should use direct function call instead of HTTP-layer abstraction. | **P2** | 1 hour | No |
| **`main.py` at 2,181 lines** — Routes, models, config, tutorial, all in one file. The tutorial system alone (lines 1718-2071) is 353 lines that could be its own module. | **P2** | 1 day | No |
| **`app.js` at 8,234 lines** — Single-file monolith with 20+ IIFE modules. Works but is the source of all integration seam bugs during parallel agent work. | **P2** | 2-3 days | No, but blocks safe parallel dev |

### What Can Be Simplified or Removed

| Finding | Priority | Effort | Blocks? |
|---------|----------|--------|---------|
| **Hidden compatibility section in index.html** (lines ~600-681) — 70+ hidden DOM elements exist solely to prevent `getElementById()` null errors from stale JS references. These should be cleaned up and the actual dead JS references removed instead. | **P2** | 4 hours | No |
| **Stale worktrees** — Two orphaned worktrees consuming 23MB: `agent-adc94c9c` and `palette-and-settings`. Safe to remove. | **P3** | 5 min | No |
| **Dead `els` references in app.js** — `btnSearchToggle`, `modelSelect`, `modelMetaDisplay`, `btnLoad`, `btnUnload`, `btnOpenModelsDir`, `systemPromptEditor`, `memMatrixContainer`, `memTierA`, `memTierB`, `tuiPrefix`, `connStatus`, `modelDisplay` — cached but reference hidden compatibility elements, never used functionally. | **P2** | 2 hours | No |
| **Two unused JS functions** — `waitForElementById()` (line 779) and `handleNarratorHook()` (line 796) have no call sites. | **P3** | 10 min | No |

---

## 2. Code Quality

### Dead Code & Deprecated References

| Finding | Priority | Effort |
|---------|----------|--------|
| **70+ hidden compatibility DOM elements** — Defensive shim hiding real dead code. Cleaning these up + removing the JS references that need them is the highest-value cleanup. | **P2** | 4 hours |
| **Dead `els` cache entries** (see above) — ~15 cached selectors pointing at hidden elements. | **P2** | 2 hours |
| **`waitForElementById()` / `handleNarratorHook()`** — defined, never called. | **P3** | 10 min |

### Fragile Patterns

| Finding | Priority | Effort |
|---------|----------|--------|
| **39 separate `sqlite3.connect()` calls in database.py** — New connection per operation, no pooling. Functionally correct for single-user but makes DB operations 1-2ms slower than necessary and prevents connection-level caching. | **P3** | 4 hours |
| ~~**All Tier-B memories loaded on every retrieval**~~ (`memory_core.py:525`) — ~~O(n) scoring in Python.~~ **FIXED 2026-03-22:** Added `ORDER BY updated_at DESC LIMIT 200` to Tier-B query. | ~~**P2**~~ | Done |
| ~~**Vector memory loads 500 embeddings per query**~~ (`memory_core.py:669`) — ~~Hard-coded limit of 500.~~ **FIXED 2026-03-22:** Reduced to `limit=100`. | ~~**P2**~~ | Done |
| ~~**No SQL indexes on hot query paths**~~ — **FIXED 2026-03-22:** Added `idx_messages_session(session_id, timestamp)`, `idx_rag_files_session(session_id)`, `idx_fin_transactions_upload(upload_id)`. Note: audit incorrectly recommended `fin_transactions(session_id)` — that column doesn't exist; indexed `upload_id` instead. | ~~**P2**~~ | Done |

### Known Open Bugs

| Finding | Priority | Effort |
|---------|----------|--------|
| ~~**15 tests fail to collect**~~ — **FIXED 2026-03-22:** Two root causes found (audit diagnosis was incorrect): (1) `database.py` had `CREATE INDEX ON fin_transactions(session_id)` but that column doesn't exist — caused `OperationalError` breaking all 11 tests using the `client` fixture. (2) `test_assist_router.py`, `test_wakeword_ws.py`, `test_wakeword_preload.py` stubbed `httpx`/`fastapi` with `MagicMock`/`types.ModuleType` at module level, poisoning `starlette.testclient.WebSocketDenialResponse` for subsequent tests. **Result:** 0 collection errors, 131 collected, 114 pass, 17 fail (pre-existing: finance V1→V2 API mismatches + missing `scripts/test_wakeword_wav.py`). | ~~**P1**~~ | Done |
| **17 tests fail** — 11 finance tests (V1→V2 API mismatch: `period_label`→`account_label`, missing `has_goals` key), 6 wakeword tests (missing `scripts/test_wakeword_wav.py`). Pre-existing failures now visible after collection fix. | **P2** | 2-3 hours |
| ~~**`rsbStats` may double-poll**~~ — **FIXED 2026-03-22:** Added `clearInterval(_statsTimer)` at top of `rsbStats.start()` in `app.js`. | ~~**P3**~~ | Done |

---

## 3. Performance

High-impact, minimal-diff wins only:

| Finding | Priority | Effort | Impact |
|---------|----------|--------|--------|
| ~~**Add SQL indexes**~~ — **FIXED 2026-03-22.** | ~~**P2**~~ | Done | Done |
| ~~**Add `LIMIT` to KV memory retrieval**~~ — **FIXED 2026-03-22.** | ~~**P2**~~ | Done | Done |
| ~~**Reduce vector memory hard limit**~~ — **FIXED 2026-03-22** (500→100). | ~~**P3**~~ | Done | Done |
| **Static file caching headers** — Add `Cache-Control: max-age=86400` via middleware. app.js is ~200KB served on every load. | **P3** | 30 min | Faster page loads after first visit |
| ~~**Clear `_statsTimer` before re-init**~~ — **FIXED 2026-03-22.** | ~~**P3**~~ | Done | Done |

**Not recommended to change:** MODEL_LOCK held during streaming is correct — llama-cpp-python is not thread-safe. Connection-per-call in SQLite is fine for single-user workload.

---

## 4. CLAUDE.md Gaps

### Inaccurate Claims (must fix)

| Claim | Reality | Priority |
|-------|---------|----------|
| ~~"7 main tables"~~ | **FIXED in CLAUDE.md** — now documents 13 tables | ~~**P1**~~ |
| ~~"No formal test suite"~~ | **FIXED in CLAUDE.md** — now documents test suite | ~~**P1**~~ |
| ~~"feature/chat-ui-redesign branch ready to merge"~~ | **FIXED in CLAUDE.md** — removed stale branch reference | ~~**P1**~~ |
| ~~References `voice_stt.py`~~ | **FIXED in CLAUDE.md** — corrected to `app/voice.py` | ~~**P2**~~ |
| ~~Wakeword threshold "lowered to 0.15"~~ | **FIXED in CLAUDE.md** — corrected to `0.20` | ~~**P3**~~ |

### Missing Documentation (should add)

| What | Why It Matters | Priority |
|------|----------------|----------|
| **`app/rag_processing.py`** (418 lines) — PDF/DOCX/CSV extraction and chunking | Future agents won't know it exists when modifying RAG pipeline | **P1** |
| **`app/rag_vector.py`** (483 lines) — ChromaDB vector indexing and query | Same — invisible to agents working on RAG | **P1** |
| **`app/finance.py`** (904 lines) — CSV parsing, categorization, dashboard, finance chat | Large module with no CLAUDE.md entry beyond changelog | **P2** |
| **Multi-lock architecture** — `ASSIST_MODEL_LOCK`, `VOICE_STT_LOCK`, `VOICE_TTS_LOCK` are independent of `MODEL_LOCK` | Agents need to know which lock protects what | **P2** |
| **`LOCALIS_ASSIST_PHASE` env var** — gates Phase 1 (on/off) vs Phase 2 (brightness/color) in assist.py | Hidden config that changes behavior | **P2** |
| **Test run instructions** — `pytest tests/` with note about torch/embedding metaclass issue | Saves every future session from re-discovering this | **P2** |
| **Database migration pattern** — `ALTER TABLE` with `try/except OperationalError` for safe column additions | Not obvious from reading `init_db()` | **P3** |

### Context That Would Help Future Sessions

| What | Impact |
|------|--------|
| **File size guide** — `main.py` (2.2K), `app.js` (8.2K), `app.css` (1.8K), `index.html` (968) — knowing these are large helps agents estimate scope | Medium |
| **Route inventory** — 60+ endpoints across 8 modules. A URL -> handler -> module lookup table would save significant exploration time | High |
| **The `chat_endpoint` is 743 lines** — explicitly flagging this as the primary refactoring target | High |
| **Test suite status** — "55 pass, 15 collection errors due to torch import in test context" with the fix path | High |

---

## Summary by Priority

### P1 (fix soon)
- ~~Fix test collection errors~~ — **DONE 2026-03-22** (root cause: bad index + httpx/fastapi stubs, not torch metaclass)
- ~~Update CLAUDE.md: table count, test suite status, current phase, missing modules~~ — **DONE** (prior session)

### P2 (remaining)
- ~~Add SQL indexes on hot paths~~ — **DONE 2026-03-22**
- ~~Add LIMIT to memory/vector retrieval~~ — **DONE 2026-03-22**
- Fix 17 pre-existing test failures (finance V1→V2 API mismatches, missing wakeword script) — 2-3 hours
- Clean up hidden compatibility DOM elements + dead JS refs — 4 hours
- Document finance, rag_processing, rag_vector, multi-lock arch in CLAUDE.md — 2 hours

### P3 (backlog)
- Extract `chat_endpoint` into sub-functions (router, tools, generator) — 1-2 days
- Extract tutorial system from main.py into own module — 1 day
- Static file caching headers — 30 min
- Remove stale worktrees — 5 min
- Remove 2 dead JS functions — 10 min
