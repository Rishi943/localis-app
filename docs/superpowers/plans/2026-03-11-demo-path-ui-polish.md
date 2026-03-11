# Demo Path UI Polish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply Midnight Glass visual identity and add a voice status bar to make the 30–60s demo feel polished and clear.

**Architecture:** Two sequential phases — Phase 1 is a CSS-only pass over `app.css` and HTML cleanup in `index.html` with no JS changes. Phase 2 adds a voice status bar by wiring additive `onStateChange` callbacks into the existing `voiceUI` and `wakewordUI` modules, plus a new `voiceStatusBar` module.

**Tech Stack:** Vanilla JS (IIFE module pattern), CSS custom properties, FastAPI/Jinja2 templates

**Spec:** `docs/superpowers/specs/2026-03-11-demo-path-ui-polish-design.md`

---

## Chunk 1: Phase 1 — Midnight Glass CSS Pass

### Task 1: HTML Cleanup — Fonts and Theme Selector

**Files:**
- Modify: `app/templates/index.html:8-10` (font link)
- Modify: `app/templates/index.html:307` (rail appearance button)
- Modify: `app/templates/index.html:494-502` (theme selector group)

- [ ] **Step 1: Trim font import to Inter + JetBrains Mono only**

  In `index.html` line 10, replace the full combined Google Fonts `<link>` (which includes Space Grotesk, Fira Code, Comic Neue, VT323) with:

  ```html
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
  ```

  Also remove line 8 (`<link rel="preconnect" href="https://fonts.googleapis.com">`) only if no other Google Fonts remain. Since we're keeping the one link above, retain the preconnect.

- [ ] **Step 2: Remove the Appearance rail button**

  In `index.html` around line 307, delete this line:
  ```html
  <button id="btn-rail-appearance" class="rail-btn" title="Appearance">◑</button>
  ```

- [ ] **Step 3: Remove the theme selector group**

  In `index.html` lines 494–502, delete the entire block:
  ```html
  <div class="setting-group" id="grp-theme">
      <label>Interface Theme</label>
      <select id="theme-select">
          <option value="theme-default">Dark (Default)</option>
          <option value="theme-tui">Terminal (TUI)</option>
          <option value="theme-brutalist">Neo-Brutalist</option>
          <option value="theme-onepiece">Grand Line (One Piece)</option>
      </select>
  </div>
  ```

- [ ] **Step 4: Verify no JS errors from removed elements**

  Start server and open browser console. `els.themeSelect` will be `null` — this is safe, `updateTheme()` at line 3068 starts with `if(!els.themeSelect) return;`. Confirm no uncaught errors in console on page load.

- [ ] **Step 5: Commit**

  ```bash
  git add app/templates/index.html
  git commit -m "feat(ui): trim fonts to Inter+JetBrains Mono, remove theme selector"
  ```

---

### Task 2: CSS Variables — Update Root for Midnight Glass

**Files:**
- Modify: `app/static/css/app.css:2-40` (`:root` block)

- [ ] **Step 1: Update existing variable values in `:root`**

  In `app.css`, the `:root` block starts at line 2. Update these existing variables to their new values (note: this is an intentional global visual change — all ~20 selectors using these variables will shift to glass):

  ```css
  --bg-sidebar: rgba(10, 10, 10, 0.55);   /* was rgba(8, 8, 10, 0.95) */
  --bg-panel:   rgba(15, 15, 15, 0.45);   /* was #020202 */
  --border-subtle: rgba(255, 255, 255, 0.15); /* was rgba(255,255,255,0.08) */
  --text-primary: #ffffff;                 /* was #f4f4f5 */
  ```

- [ ] **Step 2: Add new variables to `:root` (do not already exist)**

  In the `:root` block, after the `--border-focus` line (~line 23), add:

  ```css
  --glass-filter:     blur(24px) saturate(180%);
  --border-highlight: rgba(255, 255, 255, 0.05);
  ```

  **Note:** The design spec erroneously lists `--text-secondary` in its "new variables" block. It already exists at line 18 with the correct value `#a1a1aa` — do not add or modify it.

- [ ] **Step 3: Verify variables load**

  In browser devtools console: `getComputedStyle(document.documentElement).getPropertyValue('--glass-filter')` should return `blur(24px) saturate(180%)`. `getComputedStyle(document.documentElement).getPropertyValue('--bg-panel')` should return `rgba(15, 15, 15, 0.45)`.

- [ ] **Step 4: Commit**

  ```bash
  git add app/static/css/app.css
  git commit -m "feat(ui): update CSS variables for Midnight Glass identity"
  ```

---

### Task 3: Apply Glass Panel Recipe to Major UI Panes

**Files:**
- Modify: `app/static/css/app.css:1176-1184` (sidebar)
- Modify: `app/static/css/app.css:1734-1742` (right-sidebar)
- Modify: `app/static/css/app.css:1749` (settings-header)

- [ ] **Step 1: Update sidebar to glass**

  At lines 1176–1181, replace the entire `.sidebar` rule with:

  ```css
  .sidebar {
      width: 300px;
      background: var(--bg-sidebar);
      backdrop-filter: var(--glass-filter);
      -webkit-backdrop-filter: var(--glass-filter);
      border-right: 1px solid var(--border-subtle);
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 var(--border-highlight);
      display: flex; flex-direction: column; padding: 20px; gap: 16px; flex-shrink: 0;
      transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1), padding 0.3s ease, opacity 0.2s;
      overflow: hidden; white-space: nowrap;
  }
  ```

  (The existing `backdrop-filter: blur(10px)` inline on line 1180 is replaced by the new `var(--glass-filter)` property above.)

- [ ] **Step 2: Update right-sidebar to glass**

  At line 1734, `#right-sidebar` currently has `background: var(--bg-panel)`. Add the glass recipe:

  ```css
  #right-sidebar {
      position: fixed; top: 0; right: 0; height: 100%; width: 360px;
      background: var(--bg-panel);
      backdrop-filter: var(--glass-filter);
      -webkit-backdrop-filter: var(--glass-filter);
      border-left: 1px solid var(--border-subtle);
      box-shadow: -5px 0 25px rgba(0,0,0,0.3), inset 0 1px 0 var(--border-highlight);
      z-index: 60;
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex; flex-direction: column;
  }
  ```

- [ ] **Step 3: Update settings-header to glass**

  At line 1749, `.settings-header` has `background: var(--bg-panel)`. Update to:

  ```css
  .settings-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 20px 24px;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--bg-panel);
      backdrop-filter: var(--glass-filter);
      -webkit-backdrop-filter: var(--glass-filter);
  }
  ```

- [ ] **Step 4: Verify glass effect is visible**

  Open settings panel (right sidebar). The panel should appear translucent with the page content blurred behind it. If `--bg-panel` at 45% opacity is too transparent for readability, note it — but do not change values; adjust opacity in a follow-up.

- [ ] **Step 5: Commit**

  ```bash
  git add app/static/css/app.css
  git commit -m "feat(ui): apply glass backdrop-filter to sidebar and settings panels"
  ```

---

### Task 4: Typography, User Bubble, and Input Pill

**Files:**
- Modify: `app/static/css/app.css:1323-1329` (user message bubble)
- Modify: `app/static/css/app.css:1351-1362` (input container)

- [ ] **Step 1: Update user message bubble**

  At line 1323, `.message.user-msg .msg-content` currently uses `background: var(--accent, #60A5FA)` with `color: #000`. Replace with a high-contrast glass bubble. Note: removing `var(--accent)` here is intentional — the Midnight Glass identity does not use accent-colored user bubbles:

  ```css
  .message.user-msg .msg-content {
      background: rgba(255, 255, 255, 0.1);
      color: var(--text-primary);
      border: 1px solid var(--border-subtle);
      padding: 12px 18px;
      border-radius: 18px 18px 4px 18px;
      max-width: 70%; font-size: 0.95rem;
      word-wrap: break-word;
  }
  ```

- [ ] **Step 2: Update chat input to pill shape**

  At line 1351, `.input-container` currently has `border-radius: 16px` and `background: var(--bg-surface)` — note `--bg-surface` is not defined in `:root` (a pre-existing bug); replace it with `var(--bg-panel)`. Update the full rule to pill with glass and recessed inset:

  ```css
  .input-container {
      display: flex; align-items: flex-end; gap: 8px;
      padding: 12px 16px;
      background: var(--bg-panel);
      backdrop-filter: var(--glass-filter);
      -webkit-backdrop-filter: var(--glass-filter);
      border: 1px solid var(--border-subtle);
      border-radius: 100px;
      box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.4), 0 0 0 1px var(--border-highlight);
      transition: border-color 0.2s, box-shadow 0.2s;
  }
  .input-container:focus-within {
      border-color: rgba(255, 255, 255, 0.25);
      box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.4), 0 0 0 2px rgba(255, 255, 255, 0.06);
  }
  ```

- [ ] **Step 3: Update hover states via the variable**

  In `app.css` `:root` at line 27, change `--btn-ghost-hover` from `rgba(255, 255, 255, 0.08)` to `rgba(255, 255, 255, 0.10)`. This propagates the opacity bump to all 8 hover selectors that reference it (lines 787, 863, 1113, 1221, 1236, 1262, 1288, 1649) in one change — no individual selectors need touching.

- [ ] **Step 4: Visual check**

  - Type a message and confirm the user bubble is white-on-dark glass, not blue
  - Confirm the input area is a pill shape with visible inset shadow
  - Confirm Inter font is rendering (devtools → Computed → font-family on body)

- [ ] **Step 5: Commit**

  ```bash
  git add app/static/css/app.css
  git commit -m "feat(ui): glass user bubble, pill input, hover states"
  ```

---

## Chunk 2: Phase 2 — Voice Status Bar

### Task 5: Add Voice Status Bar HTML Element

**Files:**
- Modify: `app/templates/index.html:241` (inside `.input-wrapper`)

- [ ] **Step 1: Insert the status bar element**

  In `index.html`, inside `.input-wrapper` (line 241), insert as the **first child** — before the `#tools-chip-row` div (line 243):

  ```html
  <div class="input-wrapper">
      <!-- Voice Status Bar -->
      <div id="voice-status-bar" class="voice-status-bar hidden">
          <div class="voice-status-dot"></div>
          <span class="voice-status-label"></span>
          <span class="voice-status-tag"></span>
      </div>

      <!-- Tools Chip Row (Shows selected tools) -->
      <div id="tools-chip-row" class="tools-chip-row"></div>
      ...
  ```

- [ ] **Step 2: Verify element exists in DOM**

  In browser console: `document.getElementById('voice-status-bar')` should return the element, not `null`.

- [ ] **Step 3: Commit**

  ```bash
  git add app/templates/index.html
  git commit -m "feat(ui): add voice status bar HTML element to input-wrapper"
  ```

---

### Task 6: Add Voice Status Bar CSS

**Files:**
- Modify: `app/static/css/app.css` (append new section after wakeword styles, around line 2626)

- [ ] **Step 1: Add voice status bar styles**

  Insert before line 2628 (the `/* --- Server Control Button --- */` comment). The wakeword styles end at line 2626; insert the new section between them and the server-control section:

  ```css
  /* ============================================================
     VOICE STATUS BAR
  ============================================================ */
  .voice-status-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 14px;
      margin-bottom: 6px;
      background: var(--bg-panel);
      backdrop-filter: var(--glass-filter);
      -webkit-backdrop-filter: var(--glass-filter);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 100px;
      opacity: 1;
      transition: opacity 0.2s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .voice-status-bar.hidden {
      display: none;
  }

  .voice-status-bar.amber {
      border-color: rgba(245, 158, 11, 0.35);
      box-shadow: 0 0 16px rgba(245, 158, 11, 0.12);
  }

  .voice-status-bar.green {
      border-color: rgba(16, 185, 129, 0.35);
      box-shadow: 0 0 16px rgba(16, 185, 129, 0.12);
  }

  .voice-status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
      background: #3f3f46; /* gray default */
      transition: background 0.15s ease, box-shadow 0.15s ease;
  }

  .voice-status-bar.amber .voice-status-dot {
      background: #f59e0b;
      box-shadow: 0 0 8px #f59e0b;
  }

  .voice-status-bar.green .voice-status-dot {
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
  }

  .voice-status-label {
      flex: 1;
      font-size: 12px;
      font-weight: 500;
      color: #71717a; /* gray default */
      transition: color 0.15s ease;
  }

  .voice-status-bar.amber .voice-status-label { color: #fcd34d; }
  .voice-status-bar.green  .voice-status-label { color: #6ee7b7; }

  .voice-status-tag {
      font-size: 10px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #3f3f46; /* gray default */
      transition: color 0.15s ease;
  }

  .voice-status-bar.amber .voice-status-tag { color: #92400e; }
  .voice-status-bar.green  .voice-status-tag { color: #064e3b; }
  ```

- [ ] **Step 2: Verify bar renders**

  In browser console, temporarily show it: `document.getElementById('voice-status-bar').classList.remove('hidden')`. The bar should appear above the input as a gray pill. Then: `document.getElementById('voice-status-bar').classList.add('amber')` — pill should turn amber. Then `.add('green')` — green. Then re-add `hidden`.

- [ ] **Step 3: Commit**

  ```bash
  git add app/static/css/app.css
  git commit -m "feat(ui): add voice status bar CSS (glass pill, 3-color states)"
  ```

---

### Task 7: Add `onStateChange` to `wakewordUI`

**Files:**
- Modify: `app/static/js/app.js:5264-5552` (`wakewordUI` IIFE)

- [ ] **Step 1: Add callback registry and fire inside `_setStateLabel`**

  In `app.js`, inside the `wakewordUI` IIFE (which starts at line 5264):

  After the existing `let` variable declarations at the top of the IIFE (around line 5265–5288), add:

  ```javascript
  const _stateChangeCallbacks = [];
  function onStateChange(cb) { _stateChangeCallbacks.push(cb); }
  ```

  Then inside `_setStateLabel(state)` (line 5289), add one line at the **very top** of the function body (before the `const label = ...` line):

  ```javascript
  function _setStateLabel(state) {
      _stateChangeCallbacks.forEach(cb => cb(state));   // ← ADD THIS LINE
      const label = document.getElementById('wakeword-state-label');
      // ... rest of existing function unchanged
  ```

- [ ] **Step 2: Export `onStateChange` in the return object**

  At line 5551, update the return statement:

  ```javascript
  return { init, enable, disable, onStateChange, get enabled() { return _isEnabled(); } };
  ```

- [ ] **Step 3: Verify the export works**

  In browser console (after page load): `typeof wakewordUI.onStateChange` should return `"function"`.

- [ ] **Step 4: Commit**

  ```bash
  git add app/static/js/app.js
  git commit -m "feat(ui): add onStateChange callback export to wakewordUI"
  ```

---

### Task 8: Add `onStateChange` to `voiceUI`

**Files:**
- Modify: `app/static/js/app.js:4857-5259` (`voiceUI` IIFE)

- [ ] **Step 1: Add callback registry and fire inside `_setState`**

  Inside the `voiceUI` IIFE (starts at line 4857), after the existing `let` declarations (around lines 4858–4871), add:

  ```javascript
  const _stateChangeCallbacks = [];
  function onStateChange(cb) { _stateChangeCallbacks.push(cb); }
  ```

  Then inside `_setState(s)` (line 4888), add one line at the **very top**:

  ```javascript
  function _setState(s) {
      _stateChangeCallbacks.forEach(cb => cb(s));   // ← ADD THIS LINE
      _state = s;
      // ... rest of existing function unchanged
  ```

- [ ] **Step 2: Export `onStateChange` in the return object**

  At line 5258, update the return statement:

  ```javascript
  return { init, triggerPTT, _onStreamComplete, onStateChange, get haMode() { return _getHaMode(); }, get pendingChatText() { return _pendingChatText; }, get isIdle() { return _state === 'idle'; } };
  ```

- [ ] **Step 3: Verify the export works**

  In browser console: `typeof voiceUI.onStateChange` should return `"function"`.

- [ ] **Step 4: Commit**

  ```bash
  git add app/static/js/app.js
  git commit -m "feat(ui): add onStateChange callback export to voiceUI"
  ```

---

### Task 9: Add `voiceStatusBar` Module, Wire to State Machines, Add `done` Trigger

**Files:**
- Modify: `app/static/js/app.js:1507-1565` (`els` object — add new refs)
- Modify: `app/static/js/app.js` (add `voiceStatusBar` module after `els`)
- Modify: `app/static/js/app.js:4307` (`api.chat` stream completion — add done trigger)
- Modify: `app/static/js/app.js:5599-5612` (`startApp` — call `voiceStatusBar.init()`)

- [ ] **Step 1: Add element references to `els`**

  In the `els` object (line 1507), after `wakewordToggleBtn` (line 1552), add:

  ```javascript
  voiceStatusBar: document.getElementById('voice-status-bar'),
  voiceStatusLabel: document.querySelector('#voice-status-bar .voice-status-label'),
  voiceStatusTag: document.querySelector('#voice-status-bar .voice-status-tag'),
  ```

- [ ] **Step 2: Add `voiceStatusBar` module**

  After the closing `};` of the `els` object (around line 1565), add the module:

  ```javascript
  // ============================================================
  // voiceStatusBar — slim glass pill showing voice pipeline state
  // ============================================================
  const voiceStatusBar = (() => {
      let _doneTimer = null;

      const STATE_MAP = {
          // wakewordUI states
          idle:         { label: 'Say "Hey Jarvis"', tag: 'wakeword',  color: null    },
          recording:    { label: 'Hey Jarvis — listening…', tag: 'triggered', color: 'amber' },
          transcribing: { label: 'Transcribing…',    tag: 'stt',       color: 'amber' },
          submitting:   { label: 'Processing…',      tag: 'thinking',  color: 'amber' },
          cooldown:     { label: 'Say "Hey Jarvis"', tag: 'wakeword',  color: null    },
          disabled:     { label: 'Say "Hey Jarvis"', tag: 'wakeword',  color: null    },
          // voiceUI states
          listening:    { label: 'Listening…',       tag: 'recording', color: 'amber' },
          confirming:   { label: 'Processing…',      tag: 'thinking',  color: 'amber' },
          waiting:      { label: 'Processing…',      tag: 'thinking',  color: 'amber' },
          speaking:     { label: 'Processing…',      tag: 'thinking',  color: 'amber' },
          // done (synthetic)
          done:         { label: 'Done',             tag: 'success',   color: 'green' },
      };

      function _apply(key) {
          const bar   = els.voiceStatusBar;
          const label = els.voiceStatusLabel;
          const tag   = els.voiceStatusTag;
          if (!bar) return;
          const s = STATE_MAP[key] || STATE_MAP.idle;
          bar.classList.remove('amber', 'green');
          if (s.color) bar.classList.add(s.color);
          if (label) label.textContent = s.label;
          if (tag)   tag.textContent   = s.tag;
      }

      function show() { els.voiceStatusBar?.classList.remove('hidden'); }
      function hide() { els.voiceStatusBar?.classList.add('hidden');    }

      function setState(state) {
          clearTimeout(_doneTimer);
          _apply(state);
      }

      function setDone() {
          clearTimeout(_doneTimer);
          _apply('done');
          _doneTimer = setTimeout(() => _apply('idle'), 2000);
      }

      function init() {
          wakewordUI.onStateChange(state => setState(state));
          voiceUI.onStateChange(state => setState(state));
      }

      return { show, hide, setState, setDone, init };
  })();
  ```

- [ ] **Step 3: Wire `show`/`hide` via `_updateToggleUI`**

  In `wakewordUI`, find `_updateToggleUI(active)` at line 5284. This function is the single point called at every activation and deactivation code path (WS `ready` event at line 5373, mic permission error at line 5458, `disable()` at line 5473). Add show/hide here:

  ```javascript
  function _updateToggleUI(active) {
      els.wakewordToggleBtn?.classList.toggle('active', active);
      els.wakewordToggleBtn?.setAttribute('title', active ? 'Wake word: ON' : 'Wake word: OFF');
      if (active) voiceStatusBar.show(); else voiceStatusBar.hide();   // ← ADD
  }
  ```

  **Important:** `voiceStatusBar` is declared after `wakewordUI` in the file. This call inside `_updateToggleUI` is safe — by the time it runs at runtime, `voiceStatusBar` is defined.

- [ ] **Step 4: Add `done` trigger in `api.chat` stream completion**

  In `app.js`, `await readSSE(res, ...)` is called at line 4203 and returns when the stream ends. The insertion point is **before** `state.isGenerating = false` at line 4307 (so the `done` signal fires before `isGenerating` is cleared and before the TTS callback at line 4310):

  ```javascript
  // Voice status: signal done for Home Control commands
  if (isAssistMode) voiceStatusBar.setDone();   // ← INSERT HERE

  state.isGenerating = false;                   // line 4307 (unchanged)

  // Voice: trigger TTS on stream completion if a voice request is pending
  if (voiceUI.pendingChatText !== null) {        // line 4310 (unchanged)
  ```

  `isAssistMode` (declared at line 4135 in the same function scope) is in scope here.

- [ ] **Step 5: Initialize `voiceStatusBar` in `startApp`**

  **Prerequisite:** Tasks 7 and 8 must be complete before this step — `wakewordUI.onStateChange` and `voiceUI.onStateChange` must exist before `voiceStatusBar.init()` is called, or it will throw at runtime.

  In the `startApp` function (around line 5599–5612), after `wakewordUI.init()`, add:

  ```javascript
  voiceStatusBar.init();
  ```

- [ ] **Step 6: Regression smoke test**

  1. Page loads → no console errors → status bar hidden
  2. Enable wakeword via UI toggle → status bar appears (gray, "Say Hey Jarvis")
  3. Click PTT mic button manually → bar turns amber "Listening…" → "Transcribing…" → "Processing…" (as voice state machine runs)
  4. Submit a normal text chat (non-voice) → bar stays gray / unchanged
  5. Disable wakeword → status bar hides
  6. Enable wakeword, say "Hey Jarvis" → bar goes amber "Hey Jarvis — listening…" → then cycles through voice states
  7. If Home Control is wired and light command sent → bar turns green "Done" → fades back to gray after 2s

- [ ] **Step 7: Commit**

  ```bash
  git add app/static/js/app.js
  git commit -m "feat(ui): add voice status bar module, wire to state machines, add done trigger"
  ```

---

## Final Verification

- [ ] Run the full 30–60s demo path:
  1. Open http://localhost:8000 → clean glass UI, Inter font, no theme selector
  2. Enable wakeword → status bar shows gray
  3. Say "Hey Jarvis" → bar goes amber
  4. Speak command → bar cycles through states
  5. Command executes → bar goes green "Done", fades back after 2s
  6. Open settings panel → glass panel visible with blur

- [ ] Update `CLAUDE.md` changelog with dated entry for this feature
