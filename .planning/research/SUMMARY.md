# Project Research Summary

**Project:** Localis
**Domain:** Privacy-first local AI assistant desktop application (FastAPI + llama-cpp-python)
**Researched:** 2026-03-14
**Confidence:** HIGH — synthesized from codebase analysis and PROJECT.md requirements

---

## Executive Summary

Localis is a mature local-first AI assistant with a substantial existing codebase (~1900 lines backend, ~6300 lines frontend). The core inference pipeline, memory system, voice stack, RAG system, and UI are all shipped. The project is now in a feature expansion phase — adding LAB (model parameter playground), News RSS Feed, YouTube Music via HA, Financial Advisor, and Post+ (social writing assistant) — on top of a stable foundation with established patterns. This is not a greenfield build; every new feature slots into the existing Router-Generator pipeline and `register_*()` module pattern.

The recommended approach for all active features is additive: each one becomes a new FastAPI feature module with `register_<feature>(app, config)`, a new backend router, and a new IIFE module in `app.js`. The architecture already solves the hard problems — GPU-safe model access via `MODEL_LOCK`, streaming SSE, session/memory persistence — so new features inherit those solutions rather than reinvent them. The UI must conform to the Midnight Glass design system documented in `UIUX/DESIGN.md`; any new component should follow established patterns (glass panels, CSS variables, kebab-case IDs, IIFE modules).

The key risks are monolith growth and the embedded llama-cpp-python process. `app/main.py` at 1907 lines and `app/js/app.js` at 6346 lines are already large and will resist surgical edits as more features land. The planned runtime separation (embedded llama-cpp-python → standalone llama.cpp HTTP server) is architecturally significant and should be sequenced before or alongside new inference-touching features to prevent rework. Secondary risks are the lack of automated tests and several known fragile areas (wakeword WebSocket reconnect, memory proposal TTL, model loader race condition) that need stabilization before public sharing.

---

## Key Findings

### Recommended Stack

The existing stack is fixed by constraint — no framework migrations are in scope. All new features must use the same stack. The stack is well-suited for the domain: FastAPI handles async streaming and WebSocket cleanly, SQLite is sufficient for single-user persistence, and ChromaDB handles RAG vector search at the current scale.

**Core technologies:**
- **FastAPI + Uvicorn**: HTTP/WebSocket/SSE server — do not replace; all features build on it
- **llama-cpp-python (GGUF, GGML_CUDA)**: Local LLM inference — embedded in-process for now; planned migration to standalone llama.cpp server (OpenAI-compatible) is the most important pending architectural decision
- **SQLite (via `database.py`)**: Chat history, memory, settings, RAG metadata — `app_settings` table is the hook for any new persistent settings
- **ChromaDB**: RAG vector storage, one collection per session — scale limit ~50K chunks before performance degrades
- **sentence-transformers (BAAI/bge-small-en-v1.5)**: Embeddings for memory retrieval and RAG — CPU-based, lazy loaded with 10s TTL cache (max 50 entries, no LRU eviction currently)
- **faster-whisper**: STT — separate ASSIST_MODEL_LOCK from MODEL_LOCK; never contend the two
- **openwakeword 0.6.0** (pinned): Wakeword detection — requires separate Python 3.11 `.venv-voice`; ONNX path already preferred over TFLite
- **Piper TTS**: Via CLI subprocess; requires `piper` in PATH
- **Vanilla JS (IIFE modules)**: No framework, no build toolchain — keep it that way; new modules follow IIFE pattern

**Critical version requirements:**
- Python 3.12 (main venv), Python 3.11 (`.venv-voice` for openwakeword only)
- openwakeword pinned at 0.6.0 (last tflite-compatible release)

### Expected Features

**Must have (table stakes — already shipped):**
- Chat interface with local LLM inference (GGUF, GPU)
- Two-tier persistent memory (Tier-A core identity, Tier-B auto-learned)
- RAG document upload and retrieval (PDF, DOCX, TXT, MD, CSV)
- Voice input/output (STT + TTS) and wakeword detection
- Home Assistant smart home control (lights)
- Midnight Glass UI with settings persistence

**Active (in scope for next phases):**
- UI Polish — layout/spacing inconsistencies, sidebar navigation, chat interface presentation (prerequisite for sharability)
- LAB — model parameter playground (temp, top_p, context size, GPU layers, repeat penalty); A/B defaults for students vs power users
- News RSS Feed — r/LocalLLaMA + user-configured RSS sources; filterable, readable in-app
- YouTube Music via HA — voice-triggered HA media_player service call (user owns HA entity setup)
- Financial Advisor — bank statement upload (CSV/OFX), categorized expense dashboard with charts, RAG-powered chat over data
- Post+ (Reddit + LinkedIn) — writing style mimicry from user examples; soft-warn below minimum example count; per-platform profiles

**Defer to v2+:**
- Dynamic wallpaper-aware text colour adaptation
- Windows installer packaging (separate workstream)
- Cloud AI fallbacks or hybrid inference (violates privacy-first principle)
- Mobile app
- Real-time collaboration

### Architecture Approach

The architecture follows a layered Router-Generator pattern: requests enter the FastAPI route layer, pass through an optional Router LLM phase (tool planning), execute tools concurrently (max 3), assemble context, then stream tokens via a Generator LLM phase — all protected by `MODEL_LOCK`. Feature modules use a consistent `register_<feature>(app, config)` registration pattern. The frontend is a single-page app with IIFE modules, an `els` element cache, a `state` global, and SSE-driven streaming. New features must fit this shape: a `register_*` backend module + an IIFE frontend module.

**Major components:**
1. **Inference Pipeline** (`app/main.py:893-1488`) — Router + Generator LLM calls under `MODEL_LOCK`; max 3 concurrent tools; SSE token streaming
2. **Memory System** (`app/memory_core.py`) — Tier-A (explicit confirmation required) + Tier-B (auto-inferred); hybrid vector + keyword retrieval; bullet-list merge for collection keys
3. **Database Layer** (`app/database.py`) — SQLite with 8 tables; auto-schema health checks; `app_settings` for persistent config
4. **Feature Module System** — `register_*()` pattern; each module owns its APIRouter and module-level state; registered in `main.py` startup
5. **Frontend IIFE Modules** (`app/static/js/app.js`) — `ragUI`, `voiceUI`, `wakewordUI`, `voiceStatusBar`, etc.; no build toolchain; streams rendered via `readSSE()`
6. **RAG Subsystem** (`app/rag.py`, `app/rag_processing.py`, `app/rag_vector.py`) — SSE-streamed ingest pipeline; session-isolated ChromaDB collections
7. **Assist/Voice Stack** (`app/assist.py`, `app/voice.py`, `app/wakeword.py`) — independent locks (`ASSIST_MODEL_LOCK`, `VOICE_STT_LOCK`, `VOICE_TTS_LOCK`); wakeword via WebSocket PCM stream

### Critical Pitfalls

1. **`MODEL_LOCK` contention deadlock** — Never call any llama-cpp-python operation without acquiring `MODEL_LOCK`. Never hold `MODEL_LOCK` while awaiting async I/O (use `asyncio.to_thread` or release before any await). Violating this serializes the entire app or deadlocks. Prevention: keep lock scope tight; router phase and generator phase each acquire/release independently.

2. **Monolith size creeping past maintainability** — `main.py` (1907 lines) and `app.js` (6346 lines) are already large. Each new feature risks adding hundreds more lines inline. Prevention: strictly use the `register_*()` module pattern for backend; strictly use a new IIFE module for frontend. Never add feature logic inline to the main chat endpoint or global `startApp()`.

3. **Embedded llama-cpp-python process coupling** — The current in-process model means a model crash takes down the server, model upgrades require app restart, and there is no multi-model parallel routing. This blocks the "three model tier" roadmap (Gemma 4B, Qwen 8B, 20B) from being cleanly concurrent. Prevention: prioritize the llama.cpp standalone server migration before adding more inference-touching features.

4. **Wakeword WebSocket double-stream race** — The reconnect timer in `wakewordUI` can fire during page unload and open a duplicate stream. Prevention: guard reconnect with a `_reconnecting` flag that is set/cleared atomically; add a `beforeunload` listener that cancels any pending timer.

5. **No automated tests for core flows** — Memory proposal flow, RAG end-to-end pipeline, and wakeword→STT→assist demo path have zero automated coverage. A regression in any of these breaks the primary user experience silently. Prevention: before each new phase, add at least one integration test for the critical path it touches. The test files already exist in `tests/` — extend them.

6. **Memory retrieval cache has no LRU eviction** — After 50 unique queries the cache fills and subsequent lookups do full vector search. For the Financial Advisor feature (repeated queries over statement data), this will cause noticeable latency spikes. Prevention: implement LRU eviction in `memory_core.py:_retrieval_cache` before the Financial Advisor phase.

---

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: UI Polish
**Rationale:** The UI is the demo surface and the primary path to sharability. Inconsistencies in layout, spacing, and navigation create friction that undermines all other features. This is the lowest-risk phase (no new backend) and highest-leverage for user trust. Must come first because every subsequent feature adds new UI surface — polish now prevents compounding debt.
**Delivers:** Cohesive, demo-ready Midnight Glass UI; resolved layout/spacing issues in sidebar, chat, and navigation
**Addresses:** Active requirement "UI Polish" from PROJECT.md
**Avoids:** Introducing new UI patterns before the design system is fully consistent (would create rework)
**Research flag:** Standard patterns — UIUX/DESIGN.md is authoritative; no external research needed

### Phase 2: LAB (Model Parameter Playground)
**Rationale:** LAB is a settings-layer feature — it adds controls to the existing inference pipeline without requiring a new module. It depends on clean UI (Phase 1) to present the parameter controls well. It is also prerequisite context for students and power users before more complex features are introduced. Backend touches only `app_settings` table and `ModelLoadRequest` schema.
**Delivers:** Temp, top_p, context size, GPU layers, repeat penalty controls; A/B defaults presets; persisted to DB
**Uses:** Existing `POST /api/settings` endpoint; `app_settings` table; model load endpoint
**Implements:** Settings section in frontend settings modal (already exists); no new backend module required
**Research flag:** Standard patterns — well-documented FastAPI + llama-cpp-python parameter pass-through; skip research-phase

### Phase 3: News RSS Feed
**Rationale:** Self-contained feature with clear scope: HTTP fetch → parse → display. No LLM inference required for basic feed viewing. Adds meaningful daily-driver value with low implementation risk. Introduces the `register_rss()` module pattern which validates the architecture before heavier features.
**Delivers:** Aggregated feed from r/LocalLLaMA + user-configured RSS URLs; filterable by source; readable in-app with Midnight Glass panel
**Uses:** `httpx` (already a dependency) for feed fetching; `feedparser` or manual XML parsing; new `register_rss()` module; new right-sidebar panel in UI
**Avoids:** Any LLM inference (keep RSS feed stateless); avoid calling Brave/Tavily for RSS (use direct feed URLs)
**Research flag:** Needs research-phase for RSS parsing library selection (`feedparser` vs stdlib `xml.etree`) and r/LocalLLaMA RSS endpoint availability

### Phase 4: YouTube Music via HA
**Rationale:** Extends the existing Home Assistant integration (`app/assist.py`) with a media_player service call. The HA integration pattern is already proven. Voice command routing ("hey jarvis, play [song]") builds on the wakeword→STT→assist pipeline. Requires user to configure HA YouTube Music entity first (explicitly out of scope for Localis to set up).
**Delivers:** Voice-triggered music playback via HA media_player; "play [song]" intent routing; stop/pause commands
**Uses:** `app/assist.py` (extend FunctionGemma routing); HA `media_player.play_media` service; existing wakeword→STT→assist pipeline
**Avoids:** Any YouTube API calls from Localis directly (HA owns the integration); do not embed YouTube credentials in Localis
**Research flag:** Needs research-phase for HA media_player service call schema and FunctionGemma prompt update for `play_media` intent

### Phase 5: Financial Advisor
**Rationale:** Most complex active feature — requires new document parsing (CSV/OFX), a new visualization layer (pie charts), and RAG-powered chat over financial data. Scheduled after earlier phases to ensure the RAG subsystem, memory cache, and UI are all stable. The LRU cache fix (noted in pitfalls) must land before this phase to prevent performance degradation.
**Delivers:** Bank statement upload (CSV/OFX parser); categorized expense dashboard with Chart.js pie charts; RAG-powered financial Q&A chat
**Uses:** Existing RAG pipeline (`app/rag.py`, `app/rag_vector.py`); new `register_finance()` module; Chart.js (CDN, no build step needed); new IIFE `financeUI` module in `app.js`
**Implements:** CSV/OFX parser for statement ingestion; expense categorization logic (LLM-assisted or rule-based); dashboard view as a new UI panel
**Avoids:** Sending financial data to external services; never route financial data through web search tools
**Research flag:** Needs research-phase for OFX/QFX parsing (no standard Python library — may need `ofxparse`); Chart.js integration pattern with Midnight Glass theme

### Phase 6: Post+ (Reddit + LinkedIn)
**Rationale:** Self-contained writing assistant with no new infrastructure dependencies beyond the existing LLM pipeline. Comes last among active features because it requires a polished UI (Phase 1), stable inference (Phases 2-5 validate the stack), and a separate profile system for Reddit vs LinkedIn. The soft-warn below minimum examples feature requires thoughtful UX.
**Delivers:** Writing style mimicry from user-provided examples; per-platform profiles (Reddit posts, LinkedIn posts); soft-warn when example count is below quality threshold; generate draft posts on demand
**Uses:** Existing LLM inference (generator phase); new `post_plus` memory keys for style profiles in `user_memory`; new IIFE `postPlusUI` module
**Implements:** Example ingestion and style profile extraction; few-shot prompt construction from stored examples; platform-specific system prompt presets
**Avoids:** Posting to Reddit or LinkedIn directly (Localis is a writer, not a publisher); never auto-post
**Research flag:** Needs research-phase for few-shot style extraction prompt engineering; minimum example count threshold validation (community best practice)

### Phase Ordering Rationale

- **UI first** because it has no dependencies and every subsequent phase adds UI surface — do it clean once
- **LAB second** because it is settings-layer with no new module and validates the settings persistence pattern for later phases
- **RSS third** because it introduces the new module pattern with low risk and no inference dependency
- **YouTube Music fourth** because it extends proven HA integration; sequenced before Financial Advisor to keep inference-free features grouped early
- **Financial Advisor fifth** because it is the most complex (new parsers + visualization + RAG) and requires all earlier infrastructure to be stable
- **Post+ last** because it depends on a polished inference pipeline and thoughtful UX; the complexity is in prompt engineering, not infrastructure

### Research Flags

Phases likely needing `/gsd:research-phase` during planning:
- **Phase 3 (RSS):** RSS parsing library selection; r/LocalLLaMA feed endpoint; Midnight Glass panel layout for feed items
- **Phase 4 (YouTube Music via HA):** HA media_player service call schema; FunctionGemma prompt changes for play_media intent
- **Phase 5 (Financial Advisor):** OFX/QFX parser library selection (`ofxparse` or alternatives); Chart.js Midnight Glass theme integration; expense categorization approach (LLM vs rules)
- **Phase 6 (Post+):** Few-shot style extraction prompt design; minimum example count threshold; per-platform profile storage schema

Phases with standard patterns (skip research-phase):
- **Phase 1 (UI Polish):** UIUX/DESIGN.md is the spec; changes are mechanical fixes not new architecture
- **Phase 2 (LAB):** llama-cpp-python parameters are well-documented; pattern is settings form → DB → model load params

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Derived directly from codebase analysis (`requirements.txt`, imports, env vars); no speculation |
| Features | HIGH | Derived from PROJECT.md validated requirements; active features are explicitly enumerated |
| Architecture | HIGH | Derived from codebase scan (1907-line main.py, 6346-line app.js, module boundaries confirmed) |
| Pitfalls | HIGH | Derived from CONCERNS.md codebase audit with specific file/line references |

**Overall confidence:** HIGH

### Gaps to Address

- **llama.cpp runtime separation timing:** The planned migration (embedded llama-cpp-python → standalone server) is not yet scoped into the phase order above. If it lands during Phase 5 or 6, the Financial Advisor or Post+ phases may need to account for OpenAI-compatible API call patterns instead of direct `Llama()` calls. Recommendation: track this migration as a parallel workstream and validate the interface contract before Phase 5 begins.
- **OFX parsing library:** No OFX parser is currently in `requirements.txt`. `ofxparse` is the de-facto Python choice but has sparse maintenance history. Needs evaluation during Phase 5 research.
- **Chart.js CDN vs bundle:** Financial Advisor will need a charting library. Chart.js via CDN is consistent with the no-build-toolchain constraint, but the Midnight Glass colour system will need custom Chart.js theme configuration. Needs validation during Phase 5 research.
- **LRU eviction for memory cache:** `memory_core.py:_retrieval_cache` has no LRU eviction (max 50 entries, then stale). Must be fixed before Phase 5 (Financial Advisor) to prevent latency spikes on repeated financial queries.
- **Memory proposal TTL:** Tier-A proposals have no server-side expiry. Stale proposals persist indefinitely. Should be addressed before Post+ (Phase 6) since that phase introduces new memory write patterns (style profiles).

---

## Sources

### Primary (HIGH confidence)
- `.planning/codebase/STACK.md` — full dependency and runtime inventory from codebase analysis
- `.planning/codebase/ARCHITECTURE.md` — layer-by-layer architecture with file/line references
- `.planning/codebase/CONCERNS.md` — tech debt, bugs, security, performance, and fragile areas audit
- `.planning/codebase/INTEGRATIONS.md` — external API contracts, auth patterns, env var inventory
- `.planning/codebase/CONVENTIONS.md` — naming patterns, module design, error handling conventions
- `.planning/codebase/STRUCTURE.md` — directory layout, file purposes, where to add new code
- `.planning/PROJECT.md` — product requirements (validated vs active vs out-of-scope)

### Secondary (MEDIUM confidence)
- `CLAUDE.md` changelog — implementation history and known fixes applied
- `UIUX/DESIGN.md` (referenced) — canonical design system; not re-read in this synthesis but cited as authoritative for UI phases
- Project memory (`MEMORY.md`) — wakeword configuration, demo path context, next phase notes

### Tertiary (LOW confidence — needs validation during research-phase)
- OFX parsing library selection: unverified during codebase analysis; `ofxparse` assumed but not confirmed
- r/LocalLLaMA RSS endpoint URL: not validated; needs check during Phase 3 research
- Chart.js CDN compatibility with current CSP headers (if any): not audited

---
*Research completed: 2026-03-14*
*Ready for roadmap: yes*
