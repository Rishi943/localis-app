# Phase 1: UI Polish - Research

**Researched:** 2026-03-14
**Domain:** Frontend CSS/JS polish — plain HTML/CSS/JS stack, no build toolchain
**Confidence:** HIGH (all findings come from direct inspection of the live codebase)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**CSS & Design System Authority**
- Claude decides the aesthetic direction for what looks most polished — no strict DESIGN.md vs CSS.md contest; Claude picks what looks amazing
- Background: Strip all colored radial-gradient backgrounds → pure black `#080808` only
- Glass panels: Subtle & dark — near-black translucent panels; content is foreground, not glass
- Glass panels: Subtle directional gradient on each panel (faint linear, lighter at top-left → rim lighting feel)
- Accent: Claude chooses the accent approach (likely `--accent-primary: #5A8CFF` for interactive states; semantic amber/green for status only)
- Typography: Strict — Inter (UI) and JetBrains Mono (code) only. No other fonts.
- Interactive states: Accent blue `#5A8CFF` for focus rings; hover = subtle opacity increase only (no color change)
- Border radius: Consistent scale via CSS variables — small elements: 8px, medium panels: 12px, input pills: 100px

**Sidebar Behavior**
- Left sidebar collapsed state: Icons only, no tooltips, 44px width
- Left sidebar footer: Add gear/settings icon pinned to the bottom — visible AND clickable when collapsed (44px state)
- Session history list: Currently broken (sometimes empty, sometimes garbled) — fix rendering and scrolling reliability
- Collapse animation: Smooth slide ~200ms ease (currently has transition, keep and ensure it works)
- Right sidebar: Collapses to ~20px toggle strip at right edge — always accessible, never fully disappears

**Chat Surface**
- Thinking/reasoning display: Collapsed under a "Thinking..." pill by default, expandable on click — content never jumps up after think phase ends
- Message distinction: Claude decides the visual treatment; assistant label = "Localis" (not "Jarvis")
- No avatar/icon for assistant messages — name label only ("Localis")
- Date group separators: Messages grouped by "Today", "Yesterday", etc.
- Auto-scroll: Must be fixed — currently broken entirely (no auto-scroll during streaming)
- Input bar: Both pill shape (`border-radius: 100px`) and glass styling broken — fix to match panel aesthetic
- Action chips after assistant messages: Add Copy, Regenerate, Continue chips below each assistant response
- Token estimate: Faint muted token count in input area as user types
- Empty input when no model loaded: Disabled with "Loading model..." placeholder text
- Tool chips (Web, Home, Upload, Remember): Smaller, inlined with input bar as toggle-style buttons — not tab-style separate row

**Voice Status Bar (Wakeword)**
- Current issue: Too prominent — looks like a second input row, confused with chat input
- Fix: Faint status line above input pill — very small muted text (~30% opacity), a dot + status text like "Hey Jarvis ready"
- Keep it clearly secondary — background information, not interactive affordance

**Branding**
- Rename "Jarvis" → "Localis" in all UI display text (message placeholder, assistant name label, status bar text, settings modal, etc.)
- Wakeword trigger phrase stays "Hey Jarvis" for now — model update is a separate workstream
- Status bar should read: `· Hey Jarvis ready` (trigger phrase) but assistant messages labelled "Localis"

**Layout & Spacing**
- Chat message column: Max-width ~720px, centered in main area — prevents ultra-wide lines on large screens
- Responsive: Layout adapts across 1280–1920px range; use `clamp()` for sidebar widths
  - 1080p baseline: left sidebar 216px, right sidebar ~260px
  - 1440p target: left sidebar ~240px, right sidebar ~300px, more breathing room in main
- Spacing consistency: All panels use a consistent padding/margin grid — fix "everything is off" feeling
- Three-column: Fixed desktop baseline, responsive within desktop range (not mobile)

**Right Sidebar**
- General: Everything is cramped — give all RSB sections more internal padding and breathing room
- Section dividers: Subtle 1px separator at ~8% white opacity between LIGHTS / STATS / MODEL sections
- System stats: Compact bar + number per metric (CPU, RAM, VRAM) — mini dashboard layout, one row per stat
- Section labels: Small all-caps section headers (LIGHTS, STATS, MODEL) above each section

**Settings Modal**
- Issue: Gear icon doesn't reliably open the modal — fix the click handler
- Issue: Visual design doesn't match glass system — rebuild modal styling to match glass panel recipe
- Size: Make it larger — current modal is too small
- Open behavior: Center overlay with backdrop blur over the full app
- System prompt profiles: 4 profiles shared between the settings modal and the right sidebar — they must be synchronized (changing one updates both)
  - Default, Custom, Creative (for brainstorming), Planning (for implementation and task planning)

**Empty States**
- New session (no messages): Centered welcome area with app name/logo + 3-4 quick-start prompt suggestions
- Suggestions disappear when the first message is sent

**Scrollbars**
- Current issue: Too heavy/visible in some panels, missing in others (session list, RSB)
- Target: Ghost scrollbar — invisible by default, appears as thin 3px line on hover
- Apply consistently across all scrollable areas: chat message list, session history list, RSB panels

### Claude's Discretion
- Exact visual distinction between user and assistant message bubbles
- Specific accent color system (single vs semantic) and how to apply it across components
- Glass blur/saturation exact values (within "subtle & dark" constraint)
- Exact directional gradient recipe for glass panels

### Deferred Ideas (OUT OF SCOPE)
- Custom wakeword phrase (user-configurable "Hey X" instead of "Hey Jarvis") — wakeword model swap is a separate workstream
- Mobile / narrow viewport layout (< 1280px) — not in scope for this phase
- Dynamic wallpaper-aware text colour adaptation — already in v2 requirements backlog
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UI-01 | User sees consistent layout and spacing across all panels (padding, margins, alignment) | CSS variable audit + `clamp()` responsive recipe covers this; session list CSS class mismatch identified as root cause of layout inconsistency |
| UI-02 | User can navigate between sections via left rail icons; left and right sidebars collapse and expand correctly | Two conflicting collapse systems found (CSS `.collapsed` vs JS `.visible`); reconciliation documented in Pitfalls; existing `toggleRight()` / `toggleSettings()` wiring identified |
| UI-03 | Chat interface presents messages cleanly — bubbles, input bar pill, streaming display without end-pop, smooth scroll behaviour | Streaming pipeline already uses RAF-throttled plain-text + post-stream markdown parse; auto-scroll has a proximity guard that may silently abort; both identified |
| UI-04 | All components share visual cohesion — glass effects, border consistency, and typography hierarchy match UIUX/DESIGN.md | CSS variables exist but are split between old `--glass-bg/blur/border` names and new `--bg-panel/sidebar`; consolidation path documented |
</phase_requirements>

---

## Summary

This is a pure front-end polish phase — no new backend routes required. The stack is plain HTML/CSS/JS with no build toolchain; every change is immediately reflected on page reload. Direct codebase inspection reveals several concrete bugs (not cosmetic differences) that are driving the "broken" experience the user reports.

The most critical structural bugs are: (1) the session list JS creates elements with class `session-item` but the CSS defines `.sess-item` — so session history items receive no styling at all; (2) `toggleSettings()` adds/removes a `.visible` class on `#right-sidebar` but the CSS has no `.rsb.visible` rule — only `.rsb.collapsed` — meaning the gear icon's click has zero visual effect in normal mode; (3) there is no app settings modal in the current HTML — only a system-prompt-only modal (`#system-prompt-modal`) — so "settings modal doesn't open" is because the modal does not exist, not a broken click handler.

Beyond the bugs, the CSS variable system is split into two generations: the old `--glass-bg`, `--glass-blur`, `--glass-border*` variables (in use by `.lsb`, `.rsb`) and the newer `--bg-panel`, `--bg-sidebar`, `--glass-filter` variables from DESIGN.md (not yet applied). Consolidating to the DESIGN.md variable set and applying it globally is the foundation for visual cohesion. Responsive width via `clamp()` does not currently exist; all sidebar widths are hard-coded px values.

**Primary recommendation:** Fix the three structural bugs first (CSS class mismatch, `.visible` → `.collapsed` reconciliation, missing settings modal), then apply the DESIGN.md variable consolidation as a single CSS pass, then layer in the new UX features (action chips, empty state, voice bar redesign, token estimate) as additive changes that cannot break existing functionality.

---

## Standard Stack

### Core (no changes needed — already in use)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| marked.js | CDN (11.x) | Markdown → HTML, one-time post-stream parse | Already integrated; renderer has XSS guard |
| highlight.js | 11.9.0 CDN | Code block syntax highlighting | Already integrated with `atom-one-dark` theme |
| Inter (Google Fonts) | Variable | Primary UI font | Already imported in `<head>` |
| JetBrains Mono (Google Fonts) | Variable | Code/mono font | Already imported in `<head>` |

### No new libraries required
All planned changes are achievable with plain CSS and JS. Adding libraries for "clamp polyfill" or animation would be over-engineering — `clamp()` has 98%+ browser support, and the existing RAF-based animation pattern already matches CLAUDE.md standards.

**Installation:** None — no new dependencies.

---

## Architecture Patterns

### Recommended File Layout (current state is already correct)
```
app/
├── templates/index.html        # HTML structure — surgical edits only
└── static/
    ├── css/app.css             # All styles — primary change surface
    └── js/app.js               # JS behaviour — targeted fixes + additions
```

All CSS changes go in `app/static/css/app.css`. All JS changes go in `app/static/js/app.js`. No new files needed for this phase.

### Pattern 1: CSS Variable Consolidation (Foundation Pass)

**What:** Replace `--glass-bg`, `--glass-blur`, `--glass-border`, `--glass-border-top`, `--glass-border-left`, `--glass-shadow`, `--indigo`, `--indigo-soft`, `--indigo-border` with the DESIGN.md canonical variables plus a small set of semantic additions.

**When to use:** First task of the phase — everything else depends on this being consistent.

**Target `:root`:**
```css
:root {
  /* Fonts */
  --font-ui:   'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* Foundation */
  --bg-app: #080808;

  /* Glass panels */
  --bg-sidebar: rgba(10, 10, 10, 0.55);
  --bg-panel:   rgba(15, 15, 15, 0.45);

  /* Panel directional gradient (rim lighting) */
  --panel-gradient: linear-gradient(160deg, rgba(255,255,255,.06) 0%, rgba(255,255,255,.02) 100%);

  /* Blur filter */
  --glass-filter: blur(28px) saturate(160%);

  /* Borders */
  --border-subtle:    rgba(255, 255, 255, 0.10);
  --border-highlight: rgba(255, 255, 255, 0.20); /* top edge rim */
  --border-inner:     rgba(255, 255, 255, 0.06);  /* inset box-shadow */

  /* Glass shadow */
  --glass-shadow: 0 32px 80px rgba(0,0,0,.75),
                  inset 0 1px 0 var(--border-highlight),
                  inset 1px 0 0 rgba(255,255,255,.05);

  /* Accent (interactive only) */
  --accent-primary: #5A8CFF;
  --accent-soft:    rgba(90, 140, 255, .15);
  --accent-border:  rgba(90, 140, 255, .35);

  /* Semantic status (not interactive) */
  --status-green: #10b981;
  --status-amber: #f59e0b;
  --status-red:   #ef4444;

  /* Text */
  --text-primary:   rgba(255, 255, 255, 0.90);
  --text-secondary: rgba(255, 255, 255, 0.55);
  --text-muted:     rgba(255, 255, 255, 0.28);

  /* Surfaces */
  --card-bg:     rgba(255, 255, 255, .05);
  --card-border: rgba(255, 255, 255, .08);

  /* Radius scale */
  --r-sm:  8px;
  --r-md:  12px;
  --r-pill: 100px;
}
```

### Pattern 2: Glass Panel Recipe (applied via a shared utility)

```css
/* Apply to: .lsb, .rsb, .modal-dialog, .top-bar, .input-row */
background: var(--panel-gradient), var(--bg-panel);
backdrop-filter: var(--glass-filter);
-webkit-backdrop-filter: var(--glass-filter);
border: 1px solid var(--border-subtle);
border-top-color: var(--border-highlight);
box-shadow: var(--glass-shadow);
```

### Pattern 3: RAF-Throttled Streaming (already in place — do not change)

The existing streaming pattern in `app.js` is already correct per CLAUDE.md:
- Plain text appended during stream via `scheduleUpdate()` → `requestAnimationFrame`
- One-time `marked.parse()` + `hljs` pass on stream completion
- Do not introduce debouncing into this path

### Pattern 4: IIFE Module for New Features

All new JS features follow the existing IIFE pattern:
```javascript
const FeatureName = (() => {
    // private state
    return {
        init() { /* wire DOM */ },
        // public API
    };
})();
```

Call `FeatureName.init()` inside `startApp()` or after `body.app-ready`.

### Pattern 5: Responsive Sidebar Widths via `clamp()`

```css
.lsb { width: clamp(200px, 15vw, 260px); }
.lsb.collapsed { width: 44px; }

.rsb { width: clamp(250px, 18vw, 320px); }
.rsb.collapsed { width: 20px; }

.chat-inner { max-width: clamp(560px, 55vw, 720px); }
```

### Anti-Patterns to Avoid

- **Touching streaming JS during CSS pass**: The RAF streaming pipeline is working correctly — don't touch it unless specifically fixing the auto-scroll guard.
- **Adding new Google Fonts imports**: Only Inter and JetBrains Mono are permitted.
- **`display: none` on the RSB body during expand/collapse**: Currently causes a flash. Use `width` + `overflow: hidden` (already how `.lsb` and `.rsb.collapsed` work).
- **Inline `style=` for layout values**: Always use CSS classes/variables.
- **`console.log` in production paths**: Gate with `Logger.debug()` or `LOCALIS_DEBUG`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown rendering | Custom parser | `marked.js` (already loaded) | Already tested, XSS-guarded |
| Syntax highlighting | Custom highlighter | `highlight.js` (already loaded) | 190+ language grammars |
| Responsive widths | JS resize listener | `clamp()` CSS function | Zero JS, smooth, performant |
| Copy to clipboard | Custom clipboard API wrapper | `navigator.clipboard.writeText()` | Native, async, handles permissions |
| Modal backdrop blur | SVG filter or JS | `backdrop-filter: blur()` CSS | GPU-accelerated, already used everywhere |
| Token estimation | Exact tokenizer | `text.length / 4` rough estimate | Sufficient for a faint hint — not a precise counter |

**Key insight:** This is a polish phase, not a feature build. Every problem has a one-liner CSS or one-function JS solution. Reaching for libraries adds loading overhead on a device that is already running a local LLM.

---

## Common Pitfalls

### Pitfall 1: CSS Class Name Mismatch — Session List (CONFIRMED BUG)
**What goes wrong:** Session history list items look unstyled or garbled.
**Why it happens:** `app.js` (line 4534) creates `div.className = 'session-item ...'` but `app.css` defines `.sess-item` (not `.session-item`). The active state `.sess-item.active` also never fires.
**How to avoid:** In `app.js`, change `'session-item'` → `'sess-item'`; change `'session-delete'` → add CSS for a delete button or use the existing class pattern. Cross-check every dynamically-assigned class name against the CSS definitions.
**Warning signs:** Rendered session list with no hover, no active highlight, no padding.

### Pitfall 2: Conflicting Right Sidebar Collapse Systems (CONFIRMED BUG)
**What goes wrong:** Gear icon click has no visible effect; right sidebar appears stuck.
**Why it happens:** Two independent collapse mechanisms exist:
  - CSS: `.rsb.collapsed` shrinks width to 20px (controlled by `toggleRight()` function, wired to `#right-sidebar-toggle`)
  - JS `toggleSettings()` (line 3553–3568): adds/removes `.visible` class, but **no CSS rule targets `.rsb.visible`** — the class does nothing
**How to avoid:** Merge into a single system. The CSS `.collapsed` approach (width-based) is the right pattern because it already handles the toggle strip. `toggleSettings()` should call `rsb.classList.toggle('collapsed', !show)` instead of toggling `.visible`.
**Warning signs:** Right sidebar never opens despite click handlers firing in devtools.

### Pitfall 3: Missing App Settings Modal (CONFIRMED GAP)
**What goes wrong:** Clicking gear icon for app settings opens nothing.
**Why it happens:** The CLAUDE.md changelog describes a settings modal added on 2026-03-12, but the current `index.html` only contains `#system-prompt-modal` (system prompt editor only). The app settings modal HTML (inference section, appearance section) is either never committed or was lost. The backend endpoint `POST /api/settings` exists in `main.py`.
**How to avoid:** Build the settings modal HTML from scratch in `index.html`. Wire it to `#btn-lsb-settings` and `#btn-top-settings`. Re-use the existing `.modal-overlay`/`.modal-dialog` CSS classes as the visual shell. Connect to `POST /api/settings`.
**Warning signs:** No `#settings-overlay` or `#app-settings-modal` element in DOM.

### Pitfall 4: Auto-Scroll Silently Disabled by Proximity Guard
**What goes wrong:** Streaming messages don't auto-scroll, making new content invisible.
**Why it happens:** `scrollToBottom()` in `app.js` (line 4790) only scrolls if `scrollHeight - scrollTop - clientHeight < 100`. If the user has never scrolled (fresh page), `scrollTop` is 0, but the chat history may not be at the bottom yet — the guard correctly suppresses scroll. However, on a new session start or after sending the first message, the container is empty and the guard fires vacuously. The real issue is likely that `els.chatHistory` targets `#chat-history` (the inner container, not the scroll viewport `#chat-zone`).
**How to avoid:** Verify `els.chatHistory` is the scrollable element. The CSS shows `.chat-zone` has `overflow-y: auto` and `.chat-inner` does not — so scroll operations on `els.chatHistory` (which points to `#chat-history` = `.chat-inner`) do nothing. Fix: scroll on `#chat-zone` (the `.chat-zone` wrapper), not `#chat-history`.
**Warning signs:** `scrollTop = scrollHeight` on the inner div succeeds without visual effect.

### Pitfall 5: `backdrop-filter` z-index Invalidation
**What goes wrong:** Glass panels lose their blur or show black instead of translucency.
**Why it happens:** `backdrop-filter` requires the element's stacking context to sit above the element being blurred. If a parent has `z-index: 0` with `position: relative` and a child has `backdrop-filter`, the blur composites against the parent's paint, not the full page background.
**How to avoid:** Apply `backdrop-filter` directly to the element (`.lsb`, `.rsb`, `.modal-dialog`) — never to a child wrapper. Set `background: #080808` on `html`/`body` so the blur has actual pixels to sample. Do not set `overflow: hidden` on parents of elements with `backdrop-filter` (it breaks the filter in some browsers).
**Warning signs:** Dark panel that should show wallpaper/gradient behind it looks solid black.

### Pitfall 6: Voice Status Bar DOM ID vs Class Selector Duplication
**What goes wrong:** Amber/green state changes only work via the class selector form, not the ID form (or vice versa).
**Why it happens:** `app.css` currently defines both `.voice-status-bar.amber` AND `#voice-status-bar.amber` selector variants (lines 246–285 and 440–445). The ID variants have lower specificity detail but duplicate intent, creating maintenance confusion when one is updated and the other is not.
**How to avoid:** When restyling the voice status bar, remove one selector set. Prefer the class-based selectors (`.voice-status-bar.amber`) since the JS sets classes (not IDs) for state. The `#voice-status-bar` ID selectors in CSS lines 440–445 are redundant and should be removed.

### Pitfall 7: System Prompt Preset Desync
**What goes wrong:** Selecting a preset in the right sidebar doesn't reflect in the system-prompt modal, or vice versa.
**Why it happens:** The RSB has 4 chips with `data-preset` values (`default`, `creative`, `code`, `precise`) — these use string keys and hardcode "Jarvis" in their prompt text. The modal has a different preset list (`populateModalProfileTags()` — 5 named profiles with emoji labels). These are two separate, non-synced systems; `setActiveProfile()` only partially bridges them.
**How to avoid:** Per the CONTEXT.md requirement of 4 shared profiles (Default, Custom, Creative, Planning), consolidate into a single `PROFILE_MAP` object in JS. Both the RSB chips and the modal tags must reference the same map and call `setActiveProfile()` on click. Rename "Jarvis" → "Localis" in all prompt strings at the same time.

---

## Code Examples

### CSS: Ghost Scrollbar Recipe (apply everywhere)
```css
/* Source: existing app.css lines 6-9, confirmed pattern */
::-webkit-scrollbar { width: 3px; height: 3px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: transparent; border-radius: 2px; transition: background .2s; }

/* Only the containing element needs this rule */
.sess-list:hover ::-webkit-scrollbar-thumb,
.rsb-body:hover  ::-webkit-scrollbar-thumb,
.chat-zone:hover ::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,.08);
}
/* Firefox */
.sess-list, .rsb-body, .chat-zone {
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
}
.sess-list:hover, .rsb-body:hover, .chat-zone:hover {
    scrollbar-color: rgba(255,255,255,.08) transparent;
}
```

### JS: Action Chips (Copy / Regenerate / Continue)
```javascript
// Append after assistant message bubble; call on stream complete only
function addMessageActionChips(msgRowEl, plainText) {
    const chips = document.createElement('div');
    chips.className = 'msg-actions';
    chips.innerHTML = `
        <button class="msg-action-chip" data-action="copy">Copy</button>
        <button class="msg-action-chip" data-action="regen">Regenerate</button>
        <button class="msg-action-chip" data-action="continue">Continue</button>
    `;
    chips.querySelector('[data-action="copy"]').onclick = () => {
        navigator.clipboard.writeText(plainText);
    };
    chips.querySelector('[data-action="regen"]').onclick = () => {
        // Re-submit last user message
        api.chat(state.lastUserMessage);
    };
    // "Continue" sends special continuation prompt
    chips.querySelector('[data-action="continue"]').onclick = () => {
        api.chat('Please continue.');
    };
    msgRowEl.appendChild(chips);
}
```

### JS: Token Estimate Display
```javascript
// Wire in the 'input' event on #prompt; append to input-inner
// ~4 chars per token is sufficient approximation
els.prompt.addEventListener('input', function () {
    const chars = this.value.length;
    const estimate = Math.round(chars / 4);
    if (els.tokenEstimate) {
        els.tokenEstimate.textContent = estimate > 0 ? `~${estimate} tokens` : '';
    }
});
```

### CSS: Responsive Sidebar Widths
```css
/* Source: locked decision from CONTEXT.md */
.lsb          { width: clamp(200px, 15vw, 260px); transition: width .2s ease; }
.lsb.collapsed { width: 44px; }
.rsb          { width: clamp(250px, 18vw, 320px); transition: width .2s ease; }
.rsb.collapsed { width: 20px; padding-left: 0; }
.chat-inner   { max-width: clamp(560px, 55vw, 720px); }
```

### JS: Right Sidebar Collapse Fix
```javascript
// Replace current toggleSettings() which uses non-existent .visible class
const toggleSettings = (show) => {
    state.rightSidebarOpen = show;
    const rsb = els.rightSidebar;
    if (!rsb) return;
    rsb.classList.toggle('collapsed', !show);
    // Rail icon (the 20px strip) always stays visible — no hiding needed
};
```

### JS: Auto-Scroll Fix (scroll the viewport, not the inner container)
```javascript
// In the streamingMessage section, replace:
//   els.chatHistory.scrollTop = els.chatHistory.scrollHeight;
// with (els.chatZone = document.getElementById('chat-zone')):
const chatViewport = document.getElementById('chat-zone');
const scrollToBottom = () => {
    if (scrollPending) return;
    scrollPending = true;
    requestAnimationFrame(() => {
        const isNearBottom = chatViewport.scrollHeight - chatViewport.scrollTop - chatViewport.clientHeight < 120;
        if (isNearBottom) chatViewport.scrollTop = chatViewport.scrollHeight;
        scrollPending = false;
    });
};
```

### JS: Session List Class Name Fix
```javascript
// Line 4534 in app.js — change:
div.className = `session-item ${s.id === state.sessionId ? 'active' : ''}`;
// to:
div.className = `sess-item ${s.id === state.sessionId ? 'active' : ''}`;
```

### HTML: Empty State / Welcome Area
```html
<!-- Inject inside #chat-history when session has 0 messages -->
<div class="welcome-container" id="welcome-state">
  <div class="welcome-logo">Localis</div>
  <div class="welcome-sub">Your private AI. On your machine.</div>
  <div class="welcome-suggestions">
    <button class="welcome-chip" data-prompt="What can you help me with?">What can you help me with?</button>
    <button class="welcome-chip" data-prompt="Turn off the lights">Turn off the lights</button>
    <button class="welcome-chip" data-prompt="Search the web for latest AI news">Search the web for latest AI news</button>
    <button class="welcome-chip" data-prompt="Remember that I prefer dark mode">Remember that I prefer dark mode</button>
  </div>
</div>
```

### CSS: Voice Status Bar (faint secondary style)
```css
/* Replace the current prominent glass pill with a minimal indicator */
.voice-status-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0 5px;
    opacity: 0.35;
    transition: opacity 0.2s;
}
.voice-status-bar.amber,
.voice-status-bar.green { opacity: 0.75; }
.voice-status-dot {
    width: 5px; height: 5px;
    border-radius: 50%;
    background: rgba(255,255,255,.4);
    flex-shrink: 0;
}
.voice-status-label {
    font-size: 11px;
    color: var(--text-muted);
}
/* Remove border, backdrop-filter, box-shadow entirely */
```

---

## State of the Art

| Old Approach | Current Approach | Impact for This Phase |
|--------------|------------------|----------------------|
| Debounced markdown render on each token | RAF-throttled plain text + one-time parse on completion | Already correct in codebase — don't regress |
| Multiple Google Font families | Inter + JetBrains Mono only | Already enforced in CSS |
| CSS `px` fixed sidebar widths | `clamp()` for responsive range | Needs to be applied |
| `backdrop-filter` without `-webkit-` prefix | Both prefixes | Already applied to `.lsb` and `.rsb` |

**Deprecated/outdated in current codebase:**
- `--indigo`, `--indigo-soft`, `--indigo-border` variables: replace with `--accent-primary` / `--accent-soft` / `--accent-border`
- `--glass-bg`, `--glass-blur`, `--glass-border`, `--glass-border-top`, `--glass-border-left`, `--glass-shadow`: replace with DESIGN.md variable set
- Colored radial-gradient body background: remove entirely, use `#080808` solid
- `body.theme-default` class on `<body>`: vestigial theme selector system; can be removed

---

## Open Questions

1. **Does `main.py` `POST /api/settings` currently handle inference settings (model, context size, GPU layers)?**
   - What we know: The endpoint exists. CLAUDE.md says it handles accent colour and wallpaper. Changelog says it also handles "Inference section (default model, context size, GPU layers)".
   - What's unclear: Whether all settings fields are wired in `main.py` or only wallpaper/accent.
   - Recommendation: Planner should include a sub-task to read `main.py` around `POST /api/settings` before implementing the settings modal.

2. **Does the `continue` / `regenerate` action require backend changes (re-streaming a previous message)?**
   - What we know: `api.chat()` accepts a `textOverride` string — so Continue can pass `"Please continue."` and Regenerate can pass the last user message.
   - What's unclear: Whether the backend properly handles short continuation prompts (context may not contain the last assistant response).
   - Recommendation: Use the simple client-side approach (re-submit as a new message) for this phase; full regeneration with history truncation is out of scope.

3. **`thinking` block parsing: is `<thinking>...</thinking>` the actual format the models produce?**
   - What we know: `parseThinking()` in `app.js` looks for `<thinking>...</thinking>` tags.
   - What's unclear: Whether the currently-loaded models actually emit this format or use `<think>...</think>`.
   - Recommendation: Make the parser accept both variants; the collapse UI renders the same either way.

---

## Validation Architecture

> `nyquist_validation: true` — this section is required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (no config file — runs with `pytest tests/` from project root) |
| Config file | None — Wave 0 gap |
| Quick run command | `pytest tests/test_system_stats.py tests/test_light_state.py tests/test_ha_controls.py -x -q` |
| Full suite command | `pytest tests/ -x -q` |

**Note:** pytest and httpx are already used in the test directory. No `pytest.ini` exists; Wave 0 should add one.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | CSS variables are consolidated (no `--indigo` or `--glass-bg` remaining) | smoke/grep | `grep -c '\-\-indigo\|--glass-bg\|--glass-blur' app/static/css/app.css` should return 0 | ❌ Wave 0 |
| UI-01 | Session list items have correct CSS class (`sess-item`, not `session-item`) | smoke/grep | `grep -c "session-item" app/static/js/app.js` should return 0 | ❌ Wave 0 |
| UI-02 | Left sidebar collapse toggles `.collapsed` class (not `.visible`) on `#right-sidebar` | manual | Browser devtools: click gear, inspect `#right-sidebar` classList | manual-only |
| UI-02 | `toggleSettings()` uses `.collapsed` (not `.visible`) | smoke/grep | `grep -c "\.visible" app/static/js/app.js` should return 0 for sidebar toggles | ❌ Wave 0 |
| UI-03 | Auto-scroll targets `#chat-zone` (scrollable viewport) not `#chat-history` | smoke/grep | `grep -n "chatHistory.scrollTop" app/static/js/app.js` should return 0 | ❌ Wave 0 |
| UI-03 | Streaming does not do markdown parse during tokens | smoke/grep | No `marked.parse` call inside the streaming RAF callback | ❌ Wave 0 |
| UI-04 | No colored radial-gradient on body | smoke/grep | `grep -c "radial-gradient" app/static/css/app.css` should return 0 | ❌ Wave 0 |
| UI-04 | No fonts other than Inter and JetBrains Mono imported | smoke/grep | `grep -c "googleapis.com/css2" app/templates/index.html` should return 1 (single import) | ❌ Wave 0 |

**Note on smoke tests:** These are grep-based assertions run via bash — they validate negative conditions (removed bad patterns) and are fast (< 1s). They complement the existing pytest suite without requiring a running server.

### Sampling Rate
- **Per task commit:** `pytest tests/ -x -q` (backend) + grep assertions per requirement (frontend)
- **Per wave merge:** Full pytest suite green
- **Phase gate:** Full pytest suite green + all 8 grep assertions pass before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `pytest.ini` — add minimal config (`testpaths = tests`, `addopts = -q`) to project root
- [ ] `tests/test_ui_polish_assertions.sh` — shell script wrapping the 8 grep-based smoke checks above
- [ ] Framework install note: `pip install pytest httpx` if not already in venv (httpx is in `requirements.txt`; pytest may not be)

---

## Sources

### Primary (HIGH confidence)
- Direct file inspection: `app/static/css/app.css` (832 lines, fully read)
- Direct file inspection: `app/static/js/app.js` (lines 1–5140+, key sections read)
- Direct file inspection: `app/templates/index.html` (full structure read)
- Direct file inspection: `UIUX/DESIGN.md` (canonical design spec)
- Direct file inspection: `.planning/phases/01-ui-polish/01-CONTEXT.md` (locked decisions)

### Secondary (MEDIUM confidence)
- `CLAUDE.md` changelog entries — describes features claimed as implemented; cross-checked against current file state (several discrepancies found, documented as bugs)

### Tertiary (LOW confidence)
- None — all findings are directly verified from source files.

---

## Metadata

**Confidence breakdown:**
- Confirmed bugs: HIGH — directly observed in source code (class name mismatch, `.visible` vs `.collapsed`, missing modal HTML)
- CSS variable consolidation path: HIGH — both old and new variables read directly from app.css and DESIGN.md
- Auto-scroll bug: HIGH — `els.chatHistory` maps to `#chat-history` (inner, non-scrollable div); scroll viewport is `#chat-zone`
- Responsive `clamp()` pattern: HIGH — native CSS, well-established
- Streaming pipeline assessment: HIGH — RAF + post-stream markdown is correct, do not modify

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable codebase, no fast-moving dependencies)
