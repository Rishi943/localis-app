---
phase: 01-ui-polish
plan: 02
subsystem: frontend-js
tags: [bug-fix, session-list, sidebar, auto-scroll, css-class-mismatch]
dependency_graph:
  requires: []
  provides: [sess-item-class, collapsed-sidebar-system, chat-zone-scroll]
  affects: [session-list-ui, right-sidebar-toggle, streaming-auto-scroll]
tech_stack:
  added: []
  patterns: [css-class-alignment, collapsed-state-pattern, viewport-scroll-target]
key_files:
  created: []
  modified:
    - app/static/js/app.js
decisions:
  - "Kept toggleRight() as-is — it already used .collapsed correctly; only toggleSettings() needed fixing"
  - "Fixed scroll in 3 locations: ingestStatusMessage (line 2264), appendMessage (line 3727), scrollToBottom streaming (line 4800)"
  - "session-delete class on delete buttons left unchanged — no CSS rule needed for it (JS-only usage)"
metrics:
  duration_minutes: 2
  completed_date: "2026-03-15"
  tasks_completed: 2
  files_modified: 1
---

# Phase 01 Plan 02: JS Structural Bug Fixes Summary

Three confirmed structural bugs fixed in `app/static/js/app.js`. Zero CSS, zero HTML changes.

## One-liner

Fixed CSS class mismatch on session list items (`session-item` → `sess-item`), replaced `.visible` sidebar toggle with `.collapsed` (CSS-defined), and retargeted auto-scroll to `#chat-zone` (the actual scrollable viewport).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix session list CSS class mismatch | ba2eba9 | app/static/js/app.js |
| 2 | Fix sidebar collapse system and auto-scroll target | d518ab9 | app/static/js/app.js |

## What Was Fixed

### Task 1 — Session List CSS Class Mismatch (line 4534)

**Bug:** `div.className = 'session-item ...'` — but CSS only defines `.sess-item` (not `.session-item`). Session list items received no styling — no hover state, no active highlight, no font size.

**Fix:** Changed `'session-item'` to `'sess-item'` at line 4534.

**Also added:** `els.chatZone = document.getElementById('chat-zone')` to the `els` object (line 1602) for use in Task 2.

### Task 2 — Sidebar Collapse System (lines 3553–3572)

**Bug:** `toggleSettings(show)` called `els.rightSidebar.classList.toggle('visible', show)` — but `.rsb.visible` has no CSS rule. The right sidebar never opened/closed via the gear icon or settings button.

**Fix:** Replaced `.visible` toggle with `.collapsed` toggle:
- `rsb.classList.toggle('collapsed', !shouldOpen)` — matches the CSS `.rsb.collapsed` width rule
- Extracted `const rsb = els.rightSidebar` with null guard
- Preserved tutorial mode `frt-settings-open` body class and rail hide/show logic

Note: `toggleRight()` (line 2494) already used `.collapsed` correctly — no change needed there.

### Task 2 — Auto-Scroll Viewport Target (3 locations)

**Bug:** All scroll operations targeted `els.chatHistory` (`#chat-history`, the inner `.chat-inner` div). This element has no `overflow` property — it cannot scroll. The scrollable viewport is `#chat-zone` (`overflow-y: auto`).

**Fixes applied:**

| Location | Line | Function | Change |
|----------|------|----------|--------|
| `createIngestStatusMessage` | 2263–2265 | RAG ingest status | `chatHistory.scrollTop` → `chatViewport.scrollTop` via `els.chatZone` |
| `appendTutorialMessage` | 3726–3728 | Tutorial/general message append | `els.chatHistory.scrollTop` → `_vp.scrollTop` via `els.chatZone` |
| `scrollToBottom` (streaming) | 4798–4802 | RAF-throttled streaming scroll | `els.chatHistory` → `vp` via `els.chatZone` with 120px near-bottom threshold |

All three use `els.chatZone || document.getElementById('chat-zone')` as fallback.

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

1. `grep session-item app.js | grep -v '//'` → 0 results (PASS)
2. `grep '\.visible' app.js | grep -i 'sidebar\|rsb'` → 0 results (PASS)
3. `grep 'chatZone\|chat-zone' app.js` → 6 lines showing scroll targets (PASS)
4. `node --check app/static/js/app.js` → exit 0 (PASS)

## Self-Check: PASSED

Files exist:
- FOUND: app/static/js/app.js (modified)

Commits exist:
- ba2eba9: fix(01-02): session list CSS class mismatch — session-item → sess-item
- d518ab9: fix(01-02): sidebar collapse system and auto-scroll viewport target
