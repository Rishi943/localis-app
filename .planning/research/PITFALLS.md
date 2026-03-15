# Pitfalls Research

**Domain:** Local-first AI assistant — new feature milestone (LAB, News RSS, YouTube Music via HA, Financial Advisor, Post+)
**Researched:** 2026-03-14
**Confidence:** HIGH (architecture-specific pitfalls verified against existing codebase); MEDIUM (external service pitfalls verified via official docs and community reports)

---

## Critical Pitfalls

### Pitfall 1: Financial Data Persisted Unencrypted to SQLite or RAG Store

**What goes wrong:**
Bank statement rows (account numbers, balances, transaction descriptions) get stored in SQLite `rag_files` or ChromaDB vector chunks in plaintext. SQLite at `~/.local/share/localis/chat_history.db` is world-readable by any process running as the same user. ChromaDB's persistent store is equally unprotected. If the user uploads a bank CSV and it is chunked and indexed, those transaction strings exist indefinitely on disk, retrievable without authentication.

**Why it happens:**
The existing RAG pipeline (`app/rag.py`) is designed for documents like PDFs and notes — it stores extracted text chunks in ChromaDB and file metadata in SQLite. Developers extending it for financial data use the same pipeline without considering data residency. The path of least resistance is to reuse `register_rag()`, which does exactly this.

**How to avoid:**
- Treat Financial Advisor as a **session-scoped, ephemeral** feature. Parsed bank data must live only in process memory during the session; never write raw transaction rows to ChromaDB or SQLite.
- The vector index for financial data should be an **in-memory ChromaDB collection** (no persist directory), destroyed when the session ends or the browser tab closes.
- Uploaded bank files must be **deleted from disk immediately** after parsing — do not retain the raw CSV/OFX in `DATA_DIR/rag/sessions/`.
- Add a prominent in-UI disclosure: "Your bank data is never stored. It is loaded into memory for this session only and discarded when you close the tab."
- If users want persistence, require an explicit opt-in with a warning. Never make persistent storage the default.

**Warning signs:**
- Any code path that calls `database.add_rag_file()` or `rag_vector.upsert_chunks()` with financial content means the data is being persisted.
- ChromaDB initialised with a `persist_directory` for the financial advisor collection is a red flag — use `chromadb.Client()` (ephemeral) not `chromadb.PersistentClient()`.

**Phase to address:** Financial Advisor phase — define the ephemeral architecture before writing a single line of parsing code. Establish "no persistence" as a non-negotiable constraint in the phase plan.

---

### Pitfall 2: LLM Parameter Combinations Crash or Silently Corrupt Model State

**What goes wrong:**
The LAB playground lets users tune `temperature`, `top_p`, `repeat_penalty`, `n_ctx`, and `n_gpu_layers`. Several combinations cause hard crashes or produce degenerate outputs with no visible error:

- `n_ctx` larger than the model's trained maximum (e.g., setting 32768 on a model with 4096 max) causes llama.cpp to allocate a KV cache it cannot satisfy, producing an immediate OOM crash that kills the inference thread silently (MODEL_LOCK is released, but the model state may be corrupted).
- `temperature=0` combined with `top_p<1.0` causes nucleus sampling to always pick the single top token — functionally equivalent to greedy but not what users expect when they set top_p.
- `repeat_penalty` values below 1.0 (the range `0.0`–`0.99`) actively encourage repetition. Users often set it to `0` thinking "no penalty" means "off," but it means the model will loop catastrophically.
- `n_gpu_layers` set higher than the model's actual layer count is harmless (llama.cpp clamps it), but changing `n_gpu_layers` requires a full model reload via `_load_model_internal()`, which holds MODEL_LOCK for 10–60 seconds depending on model size. If the LAB applies parameter changes live without reloading, `n_gpu_layers` changes are silently ignored.

**Why it happens:**
LAB playgrounds expose raw parameters with sliders. Developers pass values straight through to `create_chat_completion()` without validating against model capabilities. The existing `ChatRequest` Pydantic model accepts `temperature` and `top_p` as bare floats with no range enforcement. Adding `repeat_penalty` and `n_ctx` to the same pattern propagates the lack of validation.

**How to avoid:**
- Enforce server-side bounds before any parameter reaches `create_chat_completion()`:
  - `temperature`: clamp to `[0.0, 2.0]`
  - `top_p`: clamp to `(0.0, 1.0]` — reject `0.0` (undefined behaviour)
  - `repeat_penalty`: clamp to `[1.0, 2.0]`, document that 1.0 = off
  - `n_ctx`: cap at `min(user_value, model_trained_max)` — read this from the loaded model's `metadata` dict after load
- Parameters that require a model reload (`n_ctx`, `n_gpu_layers`) must trigger `_load_model_internal()` explicitly. Display a "Reloading model…" indicator; do not silently skip the reload.
- Provide a "Reset to defaults" button. Store LAB defaults separately from session defaults so a bad parameter set does not corrupt the base configuration.
- Show the user the actual values being used post-clamping, not the raw input values.

**Warning signs:**
- The inference thread dies but MODEL_LOCK is released with no SSE error event reaching the frontend.
- Users report the model "looping" or producing only punctuation — classic `repeat_penalty < 1.0` symptom.
- A param change in the LAB produces no visible difference in output — likely `n_gpu_layers` change was skipped without reload.

**Phase to address:** LAB phase — build the validation layer as the first task, before any UI slider work.

---

### Pitfall 3: RSS Feed Brittleness Causing Silent Feed Dropout

**What goes wrong:**
Real-world RSS/Atom feeds — including Reddit's own `/r/LocalLLaMA.rss` — frequently contain malformed XML: unescaped ampersands, illegal high-bit characters, encoding header mismatches, and missing CDATA sections. A strict XML parser raises an exception; the feed is marked as failed; the UI shows nothing; the user assumes the feed is empty, not broken. Over time, feed parsing errors accumulate silently because they are swallowed by broad exception handlers.

Reddit's RSS feeds have additional issues: they enforce rate limits (the `.rss` endpoint returns HTTP 429 without OAuth), the feed format changed after the 2023 API controversy, and the content is truncated (no full post body). Polling too frequently from a local server without caching triggers bans.

**Why it happens:**
Developers fetch RSS with `requests.get(url).text` and pass it to a strict XML parser. They test against one well-formed feed and do not test against malformed or unavailable feeds. Error handling typically catches `Exception` and returns an empty list — identical to a feed with no items.

**How to avoid:**
- Use `feedparser` (Python library) — it is designed to parse RSS "at all costs," tolerating malformed XML, encoding issues, and partial feeds. Do not use `xml.etree.ElementTree` or `lxml` for RSS.
- Implement per-feed health state: track last successful fetch, last error message, consecutive failure count. Expose this in the UI so users know a feed is down, not empty.
- For Reddit specifically: use the `.json` endpoint (`https://www.reddit.com/r/LocalLLaMA.json`) with a proper `User-Agent` header — Reddit blocks generic user agents. Consider a configurable polling interval (default: 15 minutes minimum) with jitter to avoid thundering herd.
- Cache feed responses with ETags/Last-Modified headers to respect conditional GET semantics. Store the last-fetched result so offline/error states show stale content rather than nothing.
- Validate URLs client-side before saving; reject non-http/https schemes.

**Warning signs:**
- Feed shows 0 items immediately after being added (likely parse failure, not truly empty).
- Feed worked yesterday, shows 0 today (Reddit rate limit or format change).
- Server logs show `feedparser` or `xml.etree` exceptions with no corresponding UI error state.

**Phase to address:** News RSS Feed phase — design the feed health model before implementing the fetch loop. Build failure visibility into the data model from the start.

---

### Pitfall 4: YouTube Music via HA — Entity Not Ready or Wrong Service Call

**What goes wrong:**
The HA `media_player` domain for YouTube Music (via the `ytube_music_player` custom integration or Music Assistant) is not part of HA core. Its service names, entity IDs, and attribute keys differ from the standard `media_player.play_media` interface. Voice commands like "play [song]" require the assistant to:
1. Extract the song/artist from free-form speech (STT output is noisy).
2. Map it to the correct HA service (`mass.play_media` vs `media_player.play_media`).
3. Pass the correct `media_content_id` format (a search string vs a URL vs a provider URI).

If the entity is not available or the token has expired (YouTube Music tokens expire roughly every 2 days), HA returns a 200 OK but plays nothing. The existing `app/assist.py` does not surface HA service call failures back to the user — a silent success that is actually a failure.

**Why it happens:**
The existing HA integration (`assist.py`) works well for binary controls (lights on/off) where success/failure is observable. Media playback adds state that cannot be confirmed from a single service call: did the music actually start playing? Developers port the light-control pattern to media without adding the result-verification step.

**Why it is hard:** HA's `media_player` state changes asynchronously. Polling `light.rishi_room_light` is easy — its state is `on` or `off`. Confirming music is playing requires polling `media_player.*.state == "playing"` after a delay, which is a different pattern.

**How to avoid:**
- After emitting the `media_player` service call, poll the entity state after 2 seconds. If state is not `playing`, report failure to the user explicitly: "The music player didn't start. Check that the YouTube Music integration is connected in Home Assistant."
- Do not attempt to build music entity setup into Localis — document that the user must configure the HA entity first (this is already recorded as out-of-scope in PROJECT.md). Add a pre-flight check: if the named entity does not exist in HA, tell the user immediately rather than silently failing.
- For NLU (extracting song/artist from voice), use structured extraction via the function-tuned model — do not attempt regex on raw STT output. STT output for song names is especially error-prone (proper nouns, artist names).
- Token expiry: document the known limitation that YouTube Music tokens require periodic renewal in HA. This is a HA-side concern, not Localis's, but users need to know.

**Warning signs:**
- `assist.py` logs show successful HTTP 200 from HA but the voice status bar goes to "Done" without the user hearing music.
- "play" commands work once then fail silently for days (token expiry pattern).
- Attempts to call `media_player.play_media` with a plain song name string fail — HA requires a provider-specific URI.

**Phase to address:** YouTube Music via HA phase — add result-verification (state polling) as the acceptance criterion, not just service call success.

---

### Pitfall 5: Style Mimicry Quality Degrades Silently with Insufficient Examples

**What goes wrong:**
Post+ generates Reddit/LinkedIn posts mimicking the user's writing style using few-shot examples from their provided samples. Research shows that LLMs fail completely in zero-shot style mimicry (accuracy below 7%) and have highly variable results with few samples (one-shot accuracy ranges from 67% to 95% depending on the model and style complexity). A user provides 2 Reddit posts, gets output that sounds nothing like them, and concludes the feature is broken — even though the feature is working as designed, just undersupplied.

The subtler failure is that the model silently falls back to a "generic AI writing tone" when examples are too few or too dissimilar. The output looks plausibly correct but is detectably AI-written and does not match the user's voice. Users who post this to Reddit or LinkedIn may damage their reputation without realising the mimicry failed.

**Why it happens:**
Developers implement the feature, test it with their own 10-example corpus, and ship. The minimum example count is not enforced — it is only soft-warned. Users ignore soft warnings.

**How to avoid:**
- The soft-warn system (already planned in PROJECT.md) is necessary but not sufficient. The UI must also show a **quality confidence indicator** that changes visibly as examples are added: "2 examples: low style confidence — output may not match your voice," "8+ examples: good confidence."
- Platform-specific minimums differ: Reddit posts are often short and informal (harder to mimic — needs more examples); LinkedIn posts have more formulaic structure (easier — fewer needed). Set separate minimums.
- After generating, show the user which stylistic elements were captured (sentence length distribution, vocabulary frequency) so they can judge quality themselves rather than discovering failure after posting.
- Do not mix Reddit and LinkedIn examples in a single context window. Maintain separate example stores per platform; each profile gets its own few-shot block. Cross-contamination of tones produces incoherent output.
- Cap the number of examples included in the context window (avoid stuffing 30+ examples and exhausting context). Select the most stylistically representative 5–8 examples rather than all of them.

**Warning signs:**
- Generated output uses em-dashes and bullet points the user never uses.
- Output is noticeably longer or more formal than the user's actual posts.
- Users report "it sounds like ChatGPT, not me" after the first use (zero-shot failure pattern — examples were not loaded into the prompt correctly).

**Phase to address:** Post+ phase — build the quality confidence indicator alongside the example management UI, not as a follow-up polish task.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Reuse existing RAG pipeline for financial data | Fast to build; no new infrastructure | Financial transactions persist in ChromaDB/SQLite indefinitely; privacy violation | Never — financial data must use ephemeral-only path |
| Skip model reload when `n_gpu_layers` changes in LAB | Faster UX; no spinner | Parameter change is silently ignored; user debugging confusion | Never — always reload or disallow the change |
| Use `xml.etree` for RSS parsing | Already in stdlib | Silent failure on malformed feeds (common in real world) | Never — use `feedparser` |
| Global `current_model` parameter changes between requests | Simpler LAB implementation | Race conditions: LAB params leak into concurrent chat requests from other sessions | Never — LAB params must be per-request, not global state |
| Polling HA state every second during music playback | Simple to implement | High HA API load; triggers rate limits on busy HA instances | Acceptable: poll once 2–3s after service call, then stop |
| Storing Post+ examples in SQLite TEXT column as raw newline-joined string | Simple schema | Merging/ordering/deduplication of examples becomes fragile; no per-example metadata | Acceptable for MVP; migrate to `post_examples` table in v2 |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Reddit RSS / `.rss` endpoint | Polling every minute without OAuth → 429 rate limit | Respect 15-minute minimum interval; add random jitter; use ETags for conditional GET |
| Reddit RSS | Parsing with strict XML parser → silent failure on ~10% of real feeds | Use `feedparser` library which handles malformed XML gracefully |
| HA `media_player` | Calling `media_player.play_media` with a plain song title string | Use the integration-specific service (`mass.play_media` for Music Assistant) with correct `media_content_type` |
| HA `media_player` | Treating HTTP 200 from HA as confirmation the music played | Poll entity state 2–3 seconds after service call to confirm `state == "playing"` |
| llama-cpp-python `create_chat_completion` | Passing raw LAB slider values without validation | Clamp all values server-side before the call; compare against loaded model's `metadata` |
| OFX parsing | Using a generic XML parser for OFX (OFX 1.x is SGML, not XML) | Use `ofxparse` Python library which handles both OFX 1.x SGML and OFX 2.x XML |
| ChromaDB for financial data | Using `PersistentClient` (data written to disk) | Use `chromadb.Client()` (in-memory only) for financial advisor sessions |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `n_ctx` increase in LAB triggers full model reload via `_load_model_internal()` while holding MODEL_LOCK | All pending chat requests queue behind the reload (10–60s freeze) | Show explicit "Reloading model…" UI state; reject new chat requests during reload | Every `n_ctx` or `n_gpu_layers` change in LAB |
| RSS feed fetching on the FastAPI async event loop using `requests` (sync) | Event loop blocks during HTTP fetch; all other requests stall | Use `httpx.AsyncClient` (already used in `tools.py`) for all RSS fetches | Every feed refresh — immediate from first use |
| Financial advisor: embedding all transaction rows into ChromaDB at once | Long ingest delay (100–2000 rows × embedding time) blocks the UI | Batch in chunks of 50 with SSE progress events; use the existing ingest SSE pattern from `rag.py` | Statements with >200 transactions (common for monthly CSV) |
| Post+ style examples: including all 20+ user examples in every generation request | Context window exhaustion on smaller models (Gemma 4B has 8192 context) | Select top-5 most representative examples by cosine similarity to the target topic | When user accumulates >8 examples per platform |
| RSS feed refresh: fetching all feeds simultaneously on a timer | Spike of outbound HTTP requests; HA local network congestion (if HA uses same network) | Stagger feed refreshes: fetch one feed per N seconds, not all at once | With 5+ configured feeds |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Bank CSV content in LLM context window with no sanitisation | CSV injection: crafted cell values like `=HYPERLINK("http://...")` are harmless in LLM context but could confuse the model's financial analysis; more importantly, malicious CSV content could be designed as a prompt injection to alter the assistant's behaviour | Strip or escape formula-prefix characters (`=`, `+`, `-`, `@`) from cell values before injecting into LLM context; treat all uploaded financial data as untrusted input |
| Storing bank statement file path in session state that survives browser refresh | User returns after closing tab; stale financial data reloads automatically | Session-scoped ephemeral data must be cleared on session close or server restart; never persist financial data references across sessions |
| Post+ examples containing PII (email addresses, phone numbers) embedded in writing samples | PII stored in SQLite `post_examples` table indefinitely, retrievable by anyone with DB access | Scan examples for obvious PII patterns before storing; document that examples should not contain personal contact information |
| RSS feed URLs pointing to local network addresses (SSRF) | If RSS fetcher follows redirects without restriction, a crafted feed URL could probe the local HA instance or other local services | Validate RSS URLs against an allowlist of schemes (http/https only); block private IP ranges (10.x, 192.168.x, 172.16–31.x, 127.x) from RSS fetching |
| LAB parameter changes persisted to `app_settings` table without validation | A corrupted `default_temperature` value like `"NaN"` or `"999"` gets saved; on next startup, inference crashes before the model can respond | Validate and clamp all LAB parameter values before writing to `app_settings`; add a startup sanitisation pass that resets out-of-range values to defaults |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| LAB applies parameter changes to the currently-streaming response mid-stream | Response quality changes visibly mid-message; user confused about what changed | Apply LAB parameter changes only to the next request; show "Changes take effect on next message" |
| Financial advisor shows raw transaction data in the LLM's answer (account numbers, full descriptions) | Privacy: sensitive data visible in chat history; chat history is persisted to SQLite | Mask sensitive fields (last 4 of account numbers) before displaying in chat; mark financial advisor chat as non-persistent or store separately with a deletion UI |
| RSS feed reader opens articles in a new browser tab (leaves the app) | Breaks the "local assistant" feel; users lose context | Render article summaries in-app; provide an "Open externally" option as secondary action |
| Voice command "play [song]" fails and the voice status bar goes to green "Done" anyway | User thinks music is playing; confusion when silence persists | Voice status bar should only go green after entity state confirmation; show amber "Checking…" during the 2–3s HA state poll |
| Post+ generates content without showing which example influenced which part | User cannot improve the output; cannot tell which example is "training" the style | Show per-example influence signal (e.g., highlight which examples the model referenced) — or at minimum, show the example count and quality confidence score |
| LAB's "Reset to defaults" resets to Localis hardcoded defaults, not the user's previously saved settings | User loses their personalised defaults when experimenting | Separate "Reset to Localis defaults" (0.7 temp, etc.) from "Restore my saved settings" (DB-persisted values) |

---

## "Looks Done But Isn't" Checklist

- [ ] **Financial Advisor:** Data appears to load and answers questions — verify that no transaction data was written to ChromaDB persist directory or SQLite. Check `~/.local/share/localis/` for any new files after a session. The feature is not done until this check passes.
- [ ] **LAB:** Sliders move and generation changes — verify that `n_ctx` or `n_gpu_layers` changes actually triggered a model reload (check server logs for `_load_model_internal` call). Sliders that look live but silently skip reload are not done.
- [ ] **LAB:** Parameter validation appears in the UI — verify that invalid values (e.g., `repeat_penalty=0.5`) are rejected server-side, not just client-side. POST the invalid value directly via curl to confirm server-side rejection.
- [ ] **RSS Feed:** Feed shows posts — verify the feed health state is tracked and displayed when the feed becomes unavailable (test by pointing at a non-existent URL). An empty list with no error state is not done.
- [ ] **RSS Feed:** Reddit feed works today — verify it still works after 15 minutes of repeated polling (rate limit test). Success on first fetch does not mean rate limiting is handled.
- [ ] **YouTube Music via HA:** Voice command triggers HA service call — verify the user receives a "music started" confirmation based on entity state, not just "command sent." Test when the HA entity is offline to confirm the failure path.
- [ ] **Post+:** Generated post looks stylistically similar — verify the quality confidence indicator correctly reflects low confidence when fewer than the minimum example count is provided. Provide 1 example and confirm the warning is visible and prominent.
- [ ] **Post+:** Examples saved and reloaded on next session — verify examples persist across server restarts and appear in the correct platform profile.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Financial data found persisted in ChromaDB | HIGH | Delete ChromaDB collection for affected session; audit SQLite `rag_files` table for financial entries and delete; notify user that data was stored and has been purged; rebuild feature with ephemeral-only architecture |
| LAB parameter corruption crashed model state | LOW | Implement a `/api/model/reload` endpoint that re-runs `_load_model_internal()` with last-known-good parameters from DB; user triggers manually or via UI error state |
| RSS parser silently failing all feeds | LOW | Add per-feed error visibility to UI; show last successful fetch time and last error message; user can remove and re-add the feed |
| Post+ examples mixed across platforms | MEDIUM | Per-platform example store requires a schema migration (`post_examples` table with `platform` column); existing mixed examples need manual re-tagging or deletion |
| YouTube Music token expired (silent failure) | LOW | After detection via state polling, display a specific "YouTube Music token expired — renew in Home Assistant" message with a link to the HA integration page |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Financial data persisted unencrypted | Financial Advisor — architecture design task (Day 1) | After feature complete: grep for `PersistentClient` in financial advisor code; check disk for new ChromaDB files after upload |
| LLM parameter combinations crash or corrupt state | LAB — validation layer (first implementation task) | POST invalid params via curl; confirm 422 response with descriptive error |
| RSS feed brittleness / silent dropout | News RSS Feed — feed health model design (before fetch loop) | Test with malformed feed URL; verify error state visible in UI, not silent empty list |
| YouTube Music silent failure | YouTube Music via HA — acceptance criteria definition (state polling required) | Test with HA media_player entity offline; verify failure message reaches user |
| Style mimicry silent quality degradation | Post+ — quality confidence indicator (shipped with minimum viable example UX) | Test with 1 example: confirm warning is prominent and generation is blocked or clearly flagged |
| Global model state race condition in LAB | LAB — per-request parameter scoping (architecture review before implementation) | Run concurrent chat requests while changing LAB params; verify no parameter leakage |

---

## Sources

- llama-cpp-python GitHub issue #223: GPU memory not cleaned up after model reload — https://github.com/abetlen/llama-cpp-python/issues/223
- llama.cpp GitHub issue #17284: Server fails with HTTP 400 on context size exceeded — https://github.com/ggml-org/llama.cpp/issues/17284
- feedparser library rationale: "Parsing RSS At All Costs" — https://www.xml.com/pub/a/2003/01/22/dive-into-xml.html
- RSS XML malformation rate (~10% of real feeds): feedparser GitHub issue #101 — https://github.com/kurtmckee/feedparser/issues/101
- LLM style mimicry research (zero-shot failure, one-shot variability): "Catch Me If You Can? LLMs Still Struggle to Imitate Implicit Writing Styles" — https://arxiv.org/html/2509.14543v1
- Music Assistant / HA YouTube Music integration issues: HA Community — https://community.home-assistant.io/t/getting-youtube-music-working-with-music-assistant/896023
- HA voice command latency and media_player limitations: HA Community — https://community.home-assistant.io/t/voice-command-latency/889423
- OWASP LLM01:2025 Prompt Injection — https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- FastAPI BackgroundTasks blocking event loop: FastAPI GitHub discussion #11210 — https://github.com/fastapi/fastapi/discussions/11210
- Localis codebase: `app/main.py`, `app/rag.py` (direct inspection, 2026-03-14)

---
*Pitfalls research for: Localis new feature milestone (LAB, RSS, YouTube Music, Financial Advisor, Post+)*
*Researched: 2026-03-14*
