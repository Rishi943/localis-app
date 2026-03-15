# Roadmap: Localis

## Overview

Localis is shipping six feature phases on top of an already-functional local AI assistant. The foundation is solid — inference, memory, RAG, voice, and Midnight Glass UI are all live. These phases layer in polish and new capabilities: first tightening the visual surface so every subsequent feature looks right, then adding model parameter control, a news feed, voice-driven music, financial analysis, and a social writing assistant. Each phase delivers one complete, verifiable capability that Rishi can use daily before the next begins.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: UI Polish** - Resolve layout/spacing/navigation inconsistencies so the app feels cohesive and demo-ready
- [ ] **Phase 2: LAB** - Expose model inference parameters (temp, top_p, context size, GPU layers, repeat penalty) with DB persistence
- [ ] **Phase 3: News RSS Feed** - Aggregated r/LocalLLaMA + custom RSS feed, filterable and readable in-app
- [ ] **Phase 4: YouTube Music via HA** - Voice-command music playback and control routed through Home Assistant media_player
- [ ] **Phase 5: Financial Advisor** - CSV bank statement upload, auto-categorised expense dashboard with charts, RAG-powered financial chat
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
- [ ] 01-01-PLAN.md — CSS foundation: variable consolidation, glass recipe, responsive widths, ghost scrollbar
- [ ] 01-02-PLAN.md — Bug fixes: session list class, sidebar collapse system, auto-scroll target
- [ ] 01-03-PLAN.md — Chat surface: input pill, tool chips, action chips, thinking collapse, empty state, voice bar, token estimate
- [ ] 01-04-PLAN.md — RSB polish + branding: section labels, dividers, compact stats, Jarvis→Localis rename, date separators
- [ ] 01-05-PLAN.md — Settings modal: build HTML, glass styling, 4-profile sync between RSB and modal, settings persistence
- [ ] 01-06-PLAN.md — Visual verification checkpoint: human sign-off on all 4 requirements at 1080p and 1440p

### Phase 2: LAB
**Goal**: Users can tune model inference parameters through the UI and have those settings persist across sessions, giving students and power users full control without editing config files
**Depends on**: Phase 1
**Requirements**: LAB-01, LAB-02, LAB-03, LAB-04, LAB-05
**Success Criteria** (what must be TRUE):
  1. User can slide or input temperature and top-p / top-k values; the next chat inference call uses those values
  2. User can change context size and GPU/CPU layer allocation; reloading the model applies the new values
  3. User can set repeat penalty and observe reduced repetition in subsequent model output
  4. After closing and reopening the app, all LAB parameters are exactly as the user left them
  5. A single "Reset to defaults" action restores all LAB parameters to their base values
**Plans**: TBD

### Phase 3: News RSS Feed
**Goal**: Users have a live, filterable news feed showing top posts from r/LocalLLaMA and any custom RSS sources they configure, readable in-app without opening a browser
**Depends on**: Phase 2
**Requirements**: RSS-01, RSS-02, RSS-03, RSS-04
**Success Criteria** (what must be TRUE):
  1. Opening the News Feed panel shows current top posts from r/LocalLLaMA with titles, sources, and timestamps
  2. User can enter a custom RSS URL in settings; it appears as a source in the feed on next refresh
  3. User can filter the feed to show only r/LocalLLaMA posts, only custom feed posts, or all combined
  4. Clicking a post opens a Midnight Glass reader panel that displays the full post content inside the app
**Plans**: TBD

### Phase 4: YouTube Music via HA
**Goal**: Users can control YouTube Music playback entirely by voice through Localis, with Home Assistant routing the actual media_player service calls — no extra apps needed
**Depends on**: Phase 3
**Requirements**: MUSIC-01, MUSIC-02, MUSIC-03, MUSIC-04
**Success Criteria** (what must be TRUE):
  1. Saying "Hey Jarvis, play [song] by [artist]" causes HA media_player to begin playing that track via YouTube Music within a few seconds
  2. Saying "Hey Jarvis, stop" or "pause the music" halts playback on the HA media_player entity
  3. Saying "Hey Jarvis, turn up the volume" or "set volume to 50%" adjusts HA media_player volume accordingly
  4. Saying "Hey Jarvis, next song" or "skip this" advances the HA media_player to the next track
**Plans**: TBD

### Phase 5: Financial Advisor
**Goal**: Users can upload a bank statement CSV and immediately see a categorised expense breakdown with a chart, then ask the LLM natural-language questions about their spending — all locally, with no financial data leaving the device
**Depends on**: Phase 4
**Requirements**: FIN-01, FIN-02, FIN-03, FIN-04
**Success Criteria** (what must be TRUE):
  1. User can upload a CSV bank statement file in the Financial Advisor section and receive a confirmation that it was ingested
  2. After upload, every transaction is assigned to a category (Food, Transport, Shopping, Utilities, Entertainment, or Other) without user intervention
  3. User sees a pie chart dashboard showing spend by category for the uploaded period, with category labels and amounts visible
  4. User can type or speak a question about their statement (e.g. "What did I spend most on last month?") and receive an accurate, RAG-grounded answer
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
| 1. UI Polish | 3/6 | In Progress|  |
| 2. LAB | 0/TBD | Not started | - |
| 3. News RSS Feed | 0/TBD | Not started | - |
| 4. YouTube Music via HA | 0/TBD | Not started | - |
| 5. Financial Advisor | 0/TBD | Not started | - |
| 6. Post+ | 0/TBD | Not started | - |
