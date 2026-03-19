---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
stopped_at: Phase 02.1 context gathered
last_updated: "2026-03-19T12:32:24.272Z"
progress:
  total_phases: 7
  completed_phases: 2
  total_plans: 16
  completed_plans: 16
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-14)

**Core value:** A local AI assistant that feels finished — polished, private, and powerful enough to prefer over ChatGPT
**Current focus:** Phase 02 — financial-advisor

## Current Position

Phase: 02 (financial-advisor) — EXECUTING
Plan: 1 of 10

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01-ui-polish P02 | 2 | 2 tasks | 1 files |
| Phase 01-ui-polish P01 | 25 | 3 tasks | 2 files |
| Phase 01-ui-polish P03 | 7 | 2 tasks | 3 files |
| Phase 01-ui-polish P04 | 12 | 2 tasks | 3 files |
| Phase 01-ui-polish P05 | 4 | 3 tasks | 4 files |
| Phase 02-financial-advisor P01 | 161 | 1 tasks | 6 files |
| Phase 02-financial-advisor P03 | 15 | 2 tasks | 2 files |
| Phase 02-financial-advisor P02 | 5 | 2 tasks | 4 files |
| Phase 02-financial-advisor P04 | 15 | 2 tasks | 4 files |
| Phase 02-financial-advisor P05 | 2 | 2 tasks | 2 files |
| Phase 02-financial-advisor P07 | 25 | 2 tasks | 4 files |
| Phase 02-financial-advisor P08 | 198 | 2 tasks | 2 files |
| Phase 02-financial-advisor P09 | 6 | 2 tasks | 3 files |
| Phase 02-financial-advisor P10 | 2 | 2 tasks | 1 files |

## Accumulated Context

### Decisions

Decisions logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Post+ soft-warn at <5 examples (not blocking — educates on quality trade-off)
- YouTube Music via HA media_player (user owns HA entity setup — out of scope for Localis)
- All UI changes must conform to UIUX/DESIGN.md (Midnight Glass identity)
- [Phase 01-ui-polish]: toggleSettings() must use .collapsed (not .visible) — .rsb.visible has no CSS rule
- [Phase 01-ui-polish]: Auto-scroll must target #chat-zone (overflow-y: auto), not #chat-history (inner non-scrollable div)
- [Phase 01-ui-polish]: ID selectors only for #voice-status-bar — class selectors removed, element is unique in DOM
- [Phase 01-ui-polish]: Ghost scrollbar uses container :hover descendant targeting to prevent thumb-hover flicker
- [Phase 01-ui-polish]: CSS foundation (01-01): canonical variable set established — all downstream plans reference these variables
- [Phase 01-ui-polish]: renderThinkingPills() kept separate from parseThinking() to preserve backward-compat return shape for voiceUI callers
- [Phase 01-ui-polish]: Welcome state uses classList.add/remove('hidden') not DOM .remove() so it re-appears on new empty sessions
- [Phase 01-ui-polish]: Action chips not shown in tutorial mode (isTutorialChat guard) to avoid confusing onboarding
- [Phase 01-ui-polish]: Preset chips renamed code->planning and precise->custom to match canonical 4 profiles
- [Phase 01-ui-polish]: Hey Jarvis wakeword trigger phrases preserved unchanged; only assistant name labels renamed to Localis
- [Phase 01-ui-polish]: Legacy rsb-cpu/ram/vram-bar IDs hidden (display:none) for JS compatibility; new stat-bar-* IDs drive visible compact rows
- [Phase 01-ui-polish]: GET /api/settings added from scratch (did not exist); all 6 settings fields in both GET and POST handlers
- [Phase 01-ui-polish]: PROFILE_MAP replaces old inline PRESETS in RSB chip handler — single source of truth for 4 canonical profiles (default/custom/creative/planning)
- [Phase 01-ui-polish]: setActiveProfile() is the single bridge function between RSB chips and settings modal profile chips
- [Phase 02-financial-advisor]: Import guard pattern (try/except ImportError + pytest.skipif) chosen over xfail for clear skip reason at collection time
- [Phase 02-financial-advisor]: fin_db fixture creates fin_* tables inline (not via init_db) to avoid the production health-check path in tests
- [Phase 02-financial-advisor]: [Phase 02-financial-advisor P03]: Finance panel z-index is 200 (settings overlay is z-index:100, not 300 as RESEARCH.md estimated)
- [Phase 02-financial-advisor]: Finance parsers accept list[list[str]] for testability; parse_csv_bytes() wraps bytes path
- [Phase 02-financial-advisor]: register_finance() added in Plan 02 (not deferred to 04) — integration tests require live endpoint
- [Phase 02-financial-advisor]: TestClient conftest fixture uses context manager so on_event(startup)/init_db() fires before tests
- [Phase 02-financial-advisor]: Both /finance/dashboard_data and /finance/dashboard added — existing test calls /dashboard, plan spec uses /dashboard_data; both share _run_dashboard_queries() helper
- [Phase 02-financial-advisor]: fin_onboarding_done added to GET /api/settings key list so test_finance_onboarding.py can verify flag via settings endpoint
- [Phase 02-financial-advisor]: requestAnimationFrame fires after innerHTML render to allow CSS transition on --pct property to animate bar fills
- [Phase 02-financial-advisor]: Onboarding step machine advances by index — no NLP parsing of user replies; step determines which answer key to store
- [Phase 02-financial-advisor]: current_model variable name used instead of llm (plan had wrong name) — matches actual app/finance.py module-level variable
- [Phase 02-financial-advisor]: fin_tables DROP+recreate on every init_db() startup to migrate V1 to V2 schema — data loss acceptable since finance data is user-uploaded CSV
- [Phase 02-financial-advisor]: CATEGORY_RULES includes 'Other': [] as explicit 8th key so JS budget renderer can iterate all 8 categories; categorise() fallback logic unchanged
- [Phase 02-financial-advisor]: V2 period filtering always uses strftime('%Y-%m', date) = ? not stored period_label column — periods derived from transaction dates not upload metadata
- [Phase 02-financial-advisor]: Backward-compat hidden divs (#fin-budget-chart, #fin-trend-chart, #fin-categories-chart) kept with display:none so existing JS renderers do not throw errors until 02-09/02-10 migrates them
- [Phase 02-financial-advisor]: fin-period-bar section removed; period select moved into .fin-header-actions (V2 header contract)
- [Phase 02-financial-advisor]: Chart.js loaded via locally bundled UMD file (not CDN) so app works fully offline
- [Phase 02-financial-advisor]: Literal hex and rgba() values used in Chart.js config — Chart.js does not resolve CSS custom properties
- [Phase 02-financial-advisor]: renderBudgetSidebar added as separate function targeting #fin-budget-sidebar-rows (sidebar) while renderBudgetActual kept for hidden #fin-budget-chart div — class names differ (fin-budget-fill vs fin-bar-fill)
- [Phase 02-financial-advisor]: renderTransactions uses createElement/appendChild (not innerHTML map) so month-header click event listeners are preserved after DOM insertion

### Roadmap Evolution

- Phase 02.1 inserted after Phase 02: Notes and Reminders — voice-triggered Google Keep-style notepad with timed reminder pings (URGENT)

### Pending Todos

None yet.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260318-qay | UI polish fixes, check UI-REVIEW md and proceed to fix all | 2026-03-18 | 9e611dc | [260318-qay-ui-polish-fixes-check-ui-review-md-and-p](.planning/quick/260318-qay-ui-polish-fixes-check-ui-review-md-and-p/) |

### Blockers/Concerns

- [Pre-Phase 5] LRU eviction missing from memory_core.py retrieval cache (max 50 entries, no eviction) — will cause latency spikes on repeated Financial Advisor queries; fix before Phase 5
- [Pre-Phase 5] Memory proposal TTL: Tier-A proposals have no server-side expiry — stale proposals persist indefinitely; address before Phase 6 Post+ (new memory write patterns)
- [Parallel] llama.cpp runtime separation (embedded llama-cpp-python → standalone OpenAI-compatible server) is a separate planned workstream; validate interface contract before Phase 5 begins

## Session Continuity

Last session: 2026-03-19T12:32:24.270Z
Stopped at: Phase 02.1 context gathered
Resume file: .planning/phases/02.1-notes-and-reminders-voice-triggered-google-keep-style-notepad-with-timed-reminder-pings/02.1-CONTEXT.md
