# Requirements: Localis

**Defined:** 2026-03-14
**Core Value:** A local AI assistant that feels finished — polished, private, and powerful enough to prefer over ChatGPT.

## v1 Requirements

Requirements for the active feature build cycle. Adds to the existing shipped baseline.

### UI Polish

- [x] **UI-01**: User sees consistent layout and spacing across all panels (padding, margins, alignment)
- [x] **UI-02**: User can navigate between sections via left rail icons; left and right sidebars collapse and expand correctly
- [x] **UI-03**: Chat interface presents messages cleanly — bubbles, input bar pill, streaming display without end-pop, smooth scroll behaviour
- [x] **UI-04**: All components share visual cohesion — glass effects, border consistency, and typography hierarchy match UIUX/DESIGN.md

### Financial Advisor

- [x] **FIN-01**: First time the Finance panel opens, the Narrator/FRT onboarding flow runs — user is guided to articulate financial goals (save, invest, life events such as vacation/wedding/house), monthly budgets per category, and time horizon; all answers persist to SQLite
- [x] **FIN-02**: User can upload a CIBC bank statement CSV, specify the time period it covers, and have all transactions parsed into a SQLite transactions table — no data leaves the device
- [x] **FIN-03**: App auto-categorises transactions into predefined categories (Food, Transport, Shopping, Utilities, Entertainment, Other) via deterministic rules — no LLM involved in categorisation
- [x] **FIN-04**: Dashboard tab shows glass CSS charts: category spend breakdown, budget vs actual per category, monthly trend, and a scrollable transaction list — all numbers from SQL queries
- [x] **FIN-05**: Multiple CSV uploads accumulate correctly, each tagged with its user-defined time period; dashboard aggregates across all uploaded periods
- [x] **FIN-06**: Chat tab lets the user ask natural language questions about their spending; LLM receives SQL-generated context (not raw CSV) and answers accurately

### LAB (Model Parameter Playground)

- [ ] **LAB-01**: User can adjust temperature and top-p / top-k sampling parameters and see them applied to the next inference call
- [ ] **LAB-02**: User can set context size and GPU/CPU layer allocation; changes apply on next model load
- [ ] **LAB-03**: User can set repeat penalty to control token repetition in output
- [ ] **LAB-04**: LAB parameters persist to the database and are restored on next app launch
- [ ] **LAB-05**: User can reset all LAB parameters to base defaults with one click

### News RSS Feed

- [ ] **RSS-01**: App displays a News Feed tab/panel showing top posts from r/LocalLLaMA by default
- [ ] **RSS-02**: User can add and remove custom RSS feed URLs via settings
- [ ] **RSS-03**: User can filter the feed by source (show only r/LocalLLaMA, or only custom feeds, or all)
- [ ] **RSS-04**: User can read a post in-app in a Midnight Glass reader panel without leaving the app

### YouTube Music via HA

- [ ] **MUSIC-01**: User can say "Hey Jarvis, play [song] by [artist]" and HA media_player starts playback via YouTube Music
- [ ] **MUSIC-02**: User can say "Hey Jarvis, stop" or "pause the music" and HA media_player stops/pauses
- [ ] **MUSIC-03**: User can say "Hey Jarvis, turn up/down the volume" or "set volume to [N]%" and HA adjusts media_player volume
- [ ] **MUSIC-04**: User can say "Hey Jarvis, next song" or "skip this" and HA advances to the next track

### Post+ (Writing Style Mimicry)

- [ ] **POST-01**: User can add writing examples per platform (Reddit posts, LinkedIn posts separately)
- [ ] **POST-02**: App displays a soft warning and quality indicator when a platform has fewer than 5 examples
- [ ] **POST-03**: User can generate a Reddit post draft in their writing style given a topic prompt
- [ ] **POST-04**: User can generate a LinkedIn post draft in their writing style given a topic prompt
- [ ] **POST-05**: Reddit and LinkedIn profiles are independent — adding examples to one does not affect the other

## v2 Requirements

Acknowledged but deferred to next milestone.

### UI Enhancements

- **UI-V2-01**: Dynamic text colour adaptation based on wallpaper brightness/hue — adjust foreground text so it remains readable as wallpaper changes

### LAB Enhancements

- **LAB-V2-01**: A/B preset system — save two parameter configs, run the same prompt against both, compare outputs side by side

### RSS Enhancements

- **RSS-V2-01**: r/MachineLearning as a built-in default source
- **RSS-V2-02**: r/artificial as a built-in default source

### Financial Advisor Enhancements

- **FIN-V2-01**: OFX / QFX bank statement format support
- **FIN-V2-02**: PDF bank statement support (text-layer extraction)
- **FIN-V2-04**: User can tag or re-categorise individual transactions

### Post+ Enhancements

- **POST-V2-01**: Chat-message writing style (WhatsApp / DM tone) as a third platform profile
- **POST-V2-02**: Email writing style profile
- **POST-V2-03**: Suggested improvements to a draft before finalising (style consistency score)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cloud AI fallbacks / hybrid inference | Violates privacy-first principle — all inference stays local |
| Windows installer packaging | Separate workstream, not blocking features |
| HA YouTube Music entity setup | User's responsibility; Localis only issues service calls |
| Auto-post to Reddit or LinkedIn | Localis generates drafts only — it is a writer, not a publisher |
| Mobile app | Web-first for v1 |
| Real-time collaboration | Single-user local app |
| Any external analytics or telemetry | Privacy-first — no data leaves the device |
| RAG over raw CSV for financial chat | Replaced by deterministic SQL context injection |

## Traceability

Which phases cover which requirements. Updated after phase reorder (2026-03-15).

| Requirement | Phase | Status |
|-------------|-------|--------|
| UI-01 | Phase 1 | Complete |
| UI-02 | Phase 1 | Complete |
| UI-03 | Phase 1 | Complete |
| UI-04 | Phase 1 | Complete |
| FIN-01 | Phase 2 | Complete |
| FIN-02 | Phase 2 | Complete |
| FIN-03 | Phase 2 | Complete |
| FIN-04 | Phase 2 | Complete |
| FIN-05 | Phase 2 | Complete |
| FIN-06 | Phase 2 | Complete |
| LAB-01 | Phase 3 | Pending |
| LAB-02 | Phase 3 | Pending |
| LAB-03 | Phase 3 | Pending |
| LAB-04 | Phase 3 | Pending |
| LAB-05 | Phase 3 | Pending |
| RSS-01 | Phase 4 | Pending |
| RSS-02 | Phase 4 | Pending |
| RSS-03 | Phase 4 | Pending |
| RSS-04 | Phase 4 | Pending |
| MUSIC-01 | Phase 5 | Pending |
| MUSIC-02 | Phase 5 | Pending |
| MUSIC-03 | Phase 5 | Pending |
| MUSIC-04 | Phase 5 | Pending |
| POST-01 | Phase 6 | Pending |
| POST-02 | Phase 6 | Pending |
| POST-03 | Phase 6 | Pending |
| POST-04 | Phase 6 | Pending |
| POST-05 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 29 total
- Mapped to phases: 29
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-14*
*Last updated: 2026-03-15 — Financial Advisor moved to Phase 2, spec updated (CIBC CSV, SQL-only analysis, goal-setting onboarding, glass dashboard). Phase order: 1→UI Polish, 2→Financial Advisor, 3→LAB, 4→RSS, 5→YouTube Music, 6→Post+*
