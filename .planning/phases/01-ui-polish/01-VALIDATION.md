---
phase: 1
slug: ui-polish
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-14
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `tests/test_ui_polish_assertions.sh` (8 grep assertions) + manual browser verification |
| **Config file** | none — UI changes verified via browser at localhost:8000 |
| **Quick run command** | `bash tests/test_ui_polish_assertions.sh` |
| **Full suite command** | `bash scripts/voice_verify.sh` (voice/backend tests only) |
| **Estimated runtime** | ~3 seconds (script) + ~5 seconds (server start for visual check) |

---

## Sampling Rate

- **After every task commit:** Reload browser, verify changed component visually
- **After every plan wave:** Full visual review across all three columns (LSB, main, RSB)
- **Before `/gsd:verify-work`:** Full suite must be green + manual UI walkthrough complete
- **Max feedback latency:** 10 seconds (server reload + browser refresh)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| wave0-test | 01-01 | 1 | UI-04 | script | `bash tests/test_ui_polish_assertions.sh` | ✅ | ⬜ pending |
| 1-css-01 | CSS | 1 | UI-04 | script+manual | assertion 1 (no legacy vars) | ✅ | ⬜ pending |
| 1-css-02 | CSS | 1 | UI-04 | script+manual | assertion 2 (no radial-gradient) | ✅ | ⬜ pending |
| 1-lsb-01 | Sidebar | 1 | UI-02 | manual | browser reload | ✅ | ⬜ pending |
| 1-lsb-02 | Sidebar | 1 | UI-02 | manual | browser reload | ✅ | ⬜ pending |
| 1-chat-01 | Chat | 2 | UI-03 | script+manual | assertion 6 (addMessageActionChips) | ✅ | ⬜ pending |
| 1-chat-02 | Chat | 2 | UI-03 | script+manual | assertion 4 (no .voice-status-bar class) | ✅ | ⬜ pending |
| 1-layout-01 | Layout | 2 | UI-01 | script+manual | assertion 3 (clamp present) | ✅ | ⬜ pending |
| 1-rsb-01 | RSB | 3 | UI-01 | manual | browser reload | ✅ | ⬜ pending |
| 1-settings-01 | Settings | 4 | UI-02 | script+manual | assertion 8 (GET /api/settings) | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 task added to Plan 01-01: creates `tests/test_ui_polish_assertions.sh` with 8 structural assertions covering all phase requirements. The assertion script is the `<automated>` verify command for the Plan 06 checkpoint.

### Assertions in tests/test_ui_polish_assertions.sh

| # | What It Checks | Requirement |
|---|----------------|-------------|
| 1 | No legacy CSS vars (--indigo, --glass-bg, etc.) in app.css | UI-04 |
| 2 | No radial-gradient in app.css | UI-04 |
| 3 | clamp() present in app.css (responsive widths) | UI-01 |
| 4 | No .voice-status-bar class selectors (only #voice-status-bar ID form) | UI-03 |
| 5 | welcome-state present in index.html | UI-03 |
| 6 | addMessageActionChips present in app.js | UI-03 |
| 7 | No bare "Jarvis" name in app.js (Hey Jarvis trigger phrase allowed) | UI-04 |
| 8 | GET /api/settings present in main.py | UI-02 |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Glass panel visual quality | UI-04 | CSS visual effects can't be automated | Check backdrop-filter blur on sidebar at localhost:8000 |
| Responsive layout at 1440p | UI-01 | Requires physical display at that resolution | Set browser viewport to 1440×900, verify no 110% zoom needed |
| Session list renders correctly | UI-02 | DOM rendering consistency | Load app with existing sessions, verify list shows and is scrollable |
| Sidebar collapse/expand animation | UI-02 | Animation smoothness | Click collapse toggle, verify smooth 200ms slide |
| Auto-scroll during streaming | UI-03 | Requires live LLM stream | Send message, verify chat scrolls as tokens arrive |
| Thinking block collapses | UI-03 | Requires model with thinking | Send reasoning-triggering prompt, verify "Thinking..." pill appears collapsed |
| Wakeword bar is faint | UI-03 | Visual judgment | Enable wakeword, verify status bar is clearly secondary to input pill |
| Settings modal opens reliably | UI-02 | Click handler reliability | Click gear icon 5 times, verify modal opens every time |
| System prompt profiles sync | UI-04 | Two-way sync between RSB and modal | Change profile in RSB, verify modal reflects change |
| 1440p layout without zoom | UI-01 | Resolution-specific | View at native 1440p, no zoom required |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (Plan 06 checkpoint now runs the script)
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending execution
