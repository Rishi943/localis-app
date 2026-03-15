---
phase: 01-ui-polish
plan: 03
subsystem: frontend-chat-surface
tags: [ui, css, javascript, chat, voice, welcome-state, action-chips]
dependency_graph:
  requires: [01-01, 01-02]
  provides: [chat-surface-polish, welcome-state, action-chips, thinking-collapse, token-estimate]
  affects: [app/static/css/app.css, app/static/js/app.js, app/templates/index.html]
tech_stack:
  added: []
  patterns: [message-action-chips, collapsible-thinking-pills, welcome-empty-state, token-estimate-hint]
key_files:
  modified:
    - app/templates/index.html
    - app/static/css/app.css
    - app/static/js/app.js
decisions:
  - "Used renderThinkingPills() separate from parseThinking() so the existing backward-compat return shape is preserved for voiceUI and other callers"
  - "Welcome state uses classList.add/remove('hidden') not .remove() so it can re-appear on empty sessions (new chat)"
  - "Action chips not shown in tutorial mode (isTutorialChat guard) to avoid confusing the onboarding flow"
  - "Voice bar tag element hidden via CSS (#voice-status-bar .voice-status-tag { display: none }) — JS still writes to it for forward compat"
metrics:
  duration: "7 minutes"
  completed: "2026-03-15"
  tasks_completed: 2
  files_changed: 3
---

# Phase 1 Plan 3: Chat Surface Polish Summary

**One-liner:** Glass input pill with welcome state, action chips (Copy/Regenerate/Continue), collapsible thinking pills, token estimate hint, and faint minimal voice status bar.

## What Was Built

### JS Functions Added / Modified

| Function | Status | Description |
|---|---|---|
| `addMessageActionChips(msgRowEl, plainText)` | Added | Appends Copy / Regenerate / Continue chips below completed assistant messages |
| `renderThinkingPills(text)` | Added | Converts `<thinking>` / `<think>` blocks to collapsible `.thinking-pill` + `.thinking-body` HTML |
| `parseThinking(text)` | Modified | Now handles both `<thinking>` and `<think>` tag formats via regex `<think(?:ing)?>` |
| `initWelcomeState()` | Added | Shows `#welcome-state` on empty sessions, hides on first message; wires chip clicks |
| `api.chat()` | Modified | Records `state.lastUserMessage`, hides welcome state, clears token estimate on send |
| `api.getModels()` | Modified | Enables/disables prompt with "Loading model..." when model absent |
| `api.loadHistory()` | Modified | Shows welcome state for empty sessions (instead of nothing) |
| `startApp()` | Modified | Calls `initWelcomeState()` after app init |

### HTML Elements Added

- `#welcome-state` (`.welcome-container`) — centered welcome panel inside `#chat-history` with "Localis" header, subtitle, and 4 suggestion chips
- `#token-estimate` — `<span class="token-estimate">` inside `.input-row` beside the textarea
- Updated `#prompt` placeholder: `"Message Localis..."` (was `"Message Jarvis…"`)

### CSS Classes Added

| Class | Purpose |
|---|---|
| `.token-estimate` | Faint 11px hint (opacity 0.5) showing `~N tokens` as user types |
| `.msg-actions` | Flex row container for post-message action chips |
| `.msg-action-chip` / `:hover` | Small glass chip buttons; hover tints with accent |
| `.thinking-pill` | Inline collapsed thinking indicator (`▶ Thinking...`), click toggles body |
| `.thinking-body` / `.expanded` | Hidden by default; `display:block` when `.expanded` |
| `.welcome-container` | Full-height centered flex column for empty-session welcome |
| `.welcome-logo`, `.welcome-sub` | Welcome header (32px bold) and subtitle |
| `.welcome-suggestions`, `.welcome-chip` | Suggestion chips wrapping grid |
| `.tool-chip` / `.active` | Inline tool toggle button styles (referenced by mode-pills) |

### Voice Status Bar Changes

- **Removed:** glass pill styling (border, backdrop-filter, box-shadow, background, rounded pill)
- **Added:** minimal inline status line: `opacity: 0.35`, transparent, `padding: 3px 0 5px`
- **Amber/green states:** `opacity: 0.75` (no box-shadow, no border color changes)
- **Dot:** 5px (was 7px), no glow
- **Tag element:** hidden via `#voice-status-bar .voice-status-tag { display: none }` — JS still writes to it for forward compat
- **Critical:** Zero `.voice-status-bar` class selectors remain — confirmed by grep

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `api.chat()` was calling `document.querySelector('.welcome-container').remove()` (destructive)**
- **Found during:** Task 2 implementation
- **Issue:** Original code (from plan 01-02) used `.remove()` which permanently deletes the welcome state from DOM. After navigating to a new chat session, the welcome state couldn't re-appear.
- **Fix:** Changed to `els.welcomeState?.classList.add('hidden')` so it persists in DOM and can be shown again for new empty sessions. Also updated `api.loadHistory()` to show welcome state when session has 0 messages.
- **Files modified:** `app/static/js/app.js`
- **Commit:** a1482ed

**2. [Rule 2 - Enhancement] Backward-compat for `parseThinking()` return shape**
- **Found during:** Task 2 implementation
- **Issue:** `parseThinking()` return shape (`.hasThinking`, `.blocks`, `.textWithoutThinking`) is used by the voice pipeline check at line `if (voiceUI.pendingChatText !== null)`. Rewriting to the inline replacement pattern would have broken that caller.
- **Fix:** Kept the structured return object, added separate `renderThinkingPills()` helper for the inline HTML render path.
- **Files modified:** `app/static/js/app.js`

**3. [Rule 2 - Enhancement] `initWelcomeState()` adds disabled-state guard for model**
- **Found during:** Task 2 implementation
- **Issue:** Plan specified "Input is disabled with 'Loading model...' placeholder when no model is loaded" but only mentioned wiring it in model-load events. The initial page load needed to also set the disabled state if `state.modelLoaded` is false.
- **Fix:** `initWelcomeState()` checks `state.modelLoaded` after `api.getModels()` runs (called before `initWelcomeState()` in `startApp()`), so the disabled/placeholder state is correctly applied on app boot.

## Self-Check: PASSED

- app/templates/index.html: FOUND
- app/static/css/app.css: FOUND
- app/static/js/app.js: FOUND
- 01-03-SUMMARY.md: FOUND
- Commit 973b359 (Task 1 HTML+CSS): FOUND
- Commit a1482ed (Task 2 JS): FOUND
