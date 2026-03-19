# Roadmap: Localis

## Overview

Localis is shipping six feature phases on top of an already-functional local AI assistant. The foundation is solid — inference, memory, RAG, voice, and Midnight Glass UI are all live. These phases layer in polish and new capabilities: first tightening the visual surface so every subsequent feature looks right, then adding a goal-oriented financial advisor, model parameter control, a news feed, voice-driven music, and a social writing assistant. Each phase delivers one complete, verifiable capability that Rishi can use daily before the next begins.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: UI Polish** - Resolve layout/spacing/navigation inconsistencies so the app feels cohesive and demo-ready
- [x] **Phase 2: Financial Advisor** - Goal-oriented financial onboarding + CIBC CSV upload → SQLite → glass dashboard + LLM chat over spending data (completed 2026-03-18)
- [ ] **Phase 3: LAB** - Expose model inference parameters (temp, top_p, context size, GPU layers, repeat penalty) with DB persistence
- [ ] **Phase 4: News RSS Feed** - Aggregated r/LocalLLaMA + custom RSS feed, filterable and readable in-app
- [ ] **Phase 5: YouTube Music via HA** - Voice-command music playback and control routed through Home Assistant media_player
- [ ] **Phase 6: Post+** - Per-platform (Reddit/LinkedIn) writing style mimicry from user examples with soft-warn quality indicator

## Phase Details

### Phase 1: UI Polish
**Goal**: The app looks and behaves cohesively — every panel, sidebar, and chat surface conforms to UIUX/DESIGN.md with no visible layout breaks, spacing inconsistencies, or navigation failures
**Depends on**: Nothing (first phase)
**Requirements**: UI-01, UI-02, UI-03, UI-04
**Success Criteria** (what must be TRUE):
  1. Every panel and sidebar uses consistent padding, margin, and alignment — no element feels visually misaligned relative to its neighbours
  2. Left rail icon navigation scrolls to or activates the correct section; left and right sidebars collapse and expand without layout breakage
  3. Chat messages render cleanly — streaming arrives without end-pop, bubbles are properly sized, the input pill is correctly styled, and scroll behaviour is smooth
  4. All glass effects, border radii, and typography hierarchy match UIUX/DESIGN.md across every visible component
**Plans**: 6 plans

Plans:
- [x] 01-01-PLAN.md — CSS foundation: variable consolidation, glass recipe, responsive widths, ghost scrollbar
- [x] 01-02-PLAN.md — Bug fixes: session list class, sidebar collapse system, auto-scroll target
- [x] 01-03-PLAN.md — Chat surface: input pill, tool chips, action chips, thinking collapse, empty state, voice bar, token estimate
- [x] 01-04-PLAN.md — RSB polish + branding: section labels, dividers, compact stats, Jarvis→Localis rename, date separators
- [x] 01-05-PLAN.md — Settings modal: build HTML, glass styling, 4-profile sync between RSB and modal, settings persistence
- [x] 01-06-PLAN.md — Visual verification checkpoint: human sign-off on all 4 requirements at 1080p and 1440p

### Phase 2: Financial Advisor
**Goal**: Users go through a goal-setting onboarding conversation, then upload CIBC bank statement CSVs to see a Midnight Glass 3-column spending dashboard (Chart.js line + donut charts, 8-category budget sidebar, month-grouped expenses list) and chat with the LLM about their finances — all deterministic SQL for numbers, all local, zero cloud
**Depends on**: Phase 1
**Requirements**: FIN-01, FIN-02, FIN-03, FIN-04, FIN-05, FIN-06
**Success Criteria** (what must be TRUE):
  1. First time the Finance panel opens, the onboarding flow runs — user is asked about financial goals, budgets per 8 categories, and time horizon; answers persist to DB
  2. User can upload a CIBC CSV export with an account label, and have all transactions parsed into SQLite with no data leaving the device
  3. Every transaction is automatically assigned to one of 8 predefined categories via deterministic rules — no LLM involved in categorisation
  4. The Dashboard tab shows a 3-column layout: budget sidebar with progress bars, Chart.js line + donut charts, and month-grouped expenses list — all numbers from SQL queries
  5. Multiple CSV uploads accumulate correctly with deduplication; dashboard aggregates across all uploaded periods derived from transaction dates
  6. The Chat tab lets the user ask natural language questions about their spending; LLM receives SQL-generated context (not raw CSV) and answers accurately
**Plans**: 10 plans

Plans:
- [ ] 02-01-PLAN.md — Backend V2: schema migration (account_label, 8 categories), updated endpoints, test updates
- [ ] 02-02-PLAN.md — Frontend V2 shell: Chart.js bundle, 3-column HTML layout, CSS rewrite
- [ ] 02-03-PLAN.md — JS core wiring: financeUI IIFE rewrite (periods, upload, refresh, expenses renderer)
- [ ] 02-04-PLAN.md — Charts + budget sidebar: Chart.js line/donut renderers, budget sidebar with color states
- [ ] 02-05-PLAN.md — Onboarding + chat: 8-category step machine, finance chat with SQL context
- [ ] 02-06-PLAN.md — Human verification checkpoint: all 6 FIN requirements signed off
- [ ] 02-07-PLAN.md — Gap closure: V2 schema migration (account_label, 8 categories, /periods, /accounts, dashboard_data), JS upload fix
- [ ] 02-08-PLAN.md — HTML/CSS rewrite: 3-column layout structure, budget sidebar, canvas elements, ghost scrollbars
- [ ] 02-09-PLAN.md — Chart.js integration: bundle, script tag, line + donut renderers wired to _loadDashboard
- [ ] 02-10-PLAN.md — UI completion: 8-category onboarding, month-grouped transactions, budget sidebar renderer, refresh button

### Phase 02.1: Notes and Reminders — voice-triggered Google Keep-style notepad with timed reminder pings (INSERTED)

**Goal:** Voice-triggered Google Keep-style notepad — say "Hey Jarvis, add note: X" or "remind me to X at Y" to create notes/reminders stored in SQLite, displayed in a Midnight Glass masonry grid dashboard, with timed reminder delivery via chime + Web Notifications
**Requirements**: (none — driven by CONTEXT.md decisions)
**Depends on:** Phase 2
**Plans:** 1/6 plans executed

Plans:
- [ ] 02.1-01-PLAN.md — DB schema (notes table) + app/notes.py backend module (6 endpoints: add, list, due, update, delete, dismiss)
- [ ] 02.1-02-PLAN.md — Tool integration: notes.add + notes.retrieve in ALLOWED_TOOLS, execute_tool branches, router prompt schemas
- [ ] 02.1-03-PLAN.md — Test suite: 6 unit tests (test_notes.py) + 3 integration tests (test_notes_e2e.py) + chime.mp3 audio asset
- [ ] 02.1-04-PLAN.md — HTML/CSS: notes SVG icon, RSB button with badge, notes-dashboard overlay, masonry grid, 6 card tints, overdue pulse, undo toast
- [ ] 02.1-05-PLAN.md — JS: notesUI IIFE (open/close/render/create/edit/delete), reminder polling (30s), Web Notifications, post-chat refresh hook
- [ ] 02.1-06-PLAN.md — Human verification checkpoint: all functional areas signed off

### Phase 3: LAB
**Goal**: Users can tune model inference parameters through the UI and have those settings persist across sessions, giving students and power users full control without editing config files
**Depends on**: Phase 2
**Requirements**: LAB-01, LAB-02, LAB-03, LAB-04, LAB-05
**Success Criteria** (what must be TRUE):
  1. User can slide or input temperature and top-p / top-k values; the next chat inference call uses those values
  2. User can change context size and GPU/CPU layer allocation; reloading the model applies the new values
  3. User can set repeat penalty and observe reduced repetition in subsequent model output
  4. After closing and reopening the app, all LAB parameters are exactly as the user left them
  5. A single "Reset to defaults" action restores all LAB parameters to their base values
**Plans**: TBD

### Phase 4: News RSS Feed
**Goal**: Users have a live, filterable news feed showing top posts from r/LocalLLaMA and any custom RSS sources they configure, readable in-app without opening a browser
**Depends on**: Phase 3
**Requirements**: RSS-01, RSS-02, RSS-03, RSS-04
**Success Criteria** (what must be TRUE):
  1. Opening the News Feed panel shows current top posts from r/LocalLLaMA with titles, sources, and timestamps
  2. User can enter a custom RSS URL in settings; it appears as a source in the feed on next refresh
  3. User can filter the feed to show only r/LocalLLaMA posts, only custom feed posts, or all combined
  4. Clicking a post opens a Midnight Glass reader panel that displays the full post content inside the app
**Plans**: TBD

### Phase 5: YouTube Music via HA
**Goal**: Users can control YouTube Music playback entirely by voice through Localis, with Home Assistant routing the actual media_player service calls — no extra apps needed
**Depends on**: Phase 4
**Requirements**: MUSIC-01, MUSIC-02, MUSIC-03, MUSIC-04
**Success Criteria** (what must be TRUE):
  1. Saying "Hey Jarvis, play [song] by [artist]" causes HA media_player to begin playing that track via YouTube Music within a few seconds
  2. Saying "Hey Jarvis, stop" or "pause the music" halts playback on the HA media_player entity
  3. Saying "Hey Jarvis, turn up the volume" or "set volume to 50%" adjusts HA media_player volume accordingly
  4. Saying "Hey Jarvis, next song" or "skip this" advances the HA media_player to the next track
**Plans**: TBD

### Phase 6: Post+
**Goal**: Users can build separate writing style profiles for Reddit and LinkedIn from their own example posts, then generate on-brand draft posts for either platform on demand — with clear feedback when the example count is too low for reliable mimicry
**Depends on**: Phase 5
**Requirements**: POST-01, POST-02, POST-03, POST-04, POST-05
**Success Criteria** (what must be TRUE):
  1. User can paste or upload writing examples tagged to either Reddit or LinkedIn; examples are saved and associated with the correct platform profile
  2. When a platform profile has fewer than 5 examples, the UI displays a visible soft-warning and a quality indicator without blocking the feature
  3. Giving a topic prompt generates a Reddit post draft that reads in the user's documented Reddit writing style
  4. Giving a topic prompt generates a LinkedIn post draft that reads in the user's documented LinkedIn writing style
  5. Adding examples to Reddit profile has zero effect on LinkedIn profile and vice versa
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. UI Polish | 6/6 | Complete | 2026-03-15 |
| 2. Financial Advisor | 10/10 | Complete   | 2026-03-18 |
| 2.1. Notes and Reminders | 0/6 | In progress | - |
| 3. LAB | 0/TBD | Not started | - |
| 4. News RSS Feed | 0/TBD | Not started | - |
| 5. YouTube Music via HA | 0/TBD | Not started | - |
| 6. Post+ | 0/TBD | Not started | - |
