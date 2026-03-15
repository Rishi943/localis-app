---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: planning
stopped_at: Completed 02-financial-advisor/02-05-PLAN.md
last_updated: "2026-03-15T23:10:44.971Z"
last_activity: 2026-03-14 — Roadmap created; 25 v1 requirements mapped across 6 phases
progress:
  total_phases: 6
  completed_phases: 1
  total_plans: 13
  completed_plans: 11
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-14)

**Core value:** A local AI assistant that feels finished — polished, private, and powerful enough to prefer over ChatGPT
**Current focus:** Phase 1 — UI Polish

## Current Position

Phase: 1 of 6 (UI Polish)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-03-14 — Roadmap created; 25 v1 requirements mapped across 6 phases

Progress: [░░░░░░░░░░] 0%

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

### Pending Todos

None yet.

### Blockers/Concerns

- [Pre-Phase 5] LRU eviction missing from memory_core.py retrieval cache (max 50 entries, no eviction) — will cause latency spikes on repeated Financial Advisor queries; fix before Phase 5
- [Pre-Phase 5] Memory proposal TTL: Tier-A proposals have no server-side expiry — stale proposals persist indefinitely; address before Phase 6 Post+ (new memory write patterns)
- [Parallel] llama.cpp runtime separation (embedded llama-cpp-python → standalone OpenAI-compatible server) is a separate planned workstream; validate interface contract before Phase 5 begins

## Session Continuity

Last session: 2026-03-15T23:10:44.969Z
Stopped at: Completed 02-financial-advisor/02-05-PLAN.md
Resume file: None
