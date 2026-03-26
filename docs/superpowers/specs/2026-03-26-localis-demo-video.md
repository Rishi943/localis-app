# Localis Demo Video — Design Spec
**Date:** 2026-03-26
**Format:** 1920×1080 · 30fps · ~85s · Remotion 4.x
**Tooling:** React/TypeScript, @remotion/transitions, TailwindCSS v4

---

## Overview

A polished product demo video showcasing Localis — a fully local, private AI assistant. Six scenes flow together with fade transitions. The aesthetic is Midnight Glass throughout: pure black background, liquid glass panels, Inter + JetBrains Mono fonts. Background has a slow cinematic push-in (1.0→1.05 scale over scene duration) on every scene; key beats get element-level punch-in zooms.

Audio is not included in the initial build. A clearly labelled `{/* ADD AUDIO HERE */}` slot exists in `Composition.tsx` for a single `<Audio>` component drop-in later.

---

## Technical Architecture

### File Structure
```
src/
  lib/
    design.ts          — colour tokens, spacing, font stacks
    spring.ts          — reusable spring/interpolate helpers
  components/
    Shell.tsx          — full Localis UI chrome: header, left sidebar, right sidebar, wallpaper bg
    ChatBubble.tsx     — user (right, glass bubble) + assistant (left, Localis logo avatar)
    ToolCard.tsx       — generic tool card: icon, title, key/value rows, status badge
    ThinkingBlock.tsx  — collapsible reasoning panel (auto-expands, shows dots then text)
    VoiceBar.tsx       — pill states: idle (gray) → listening (amber) → done (green)
    IngestProgress.tsx — staggered RAG checklist: Upload / Extract / Chunk / Index
    RsbPanel.tsx       — Quick Controls right sidebar: bulb, colour swatches, brightness slider
    NotesPanel.tsx     — dark overlay card grid
    TypeWriter.tsx     — character-by-character text reveal driven by useCurrentFrame
    ZoomWrapper.tsx    — wraps children, applies spring scale punch-in at a given start frame
  scenes/
    00-Intro.tsx
    01-Rag.tsx
    02-WebSearch.tsx
    03-HomeAssistant.tsx
    04-Notes.tsx
    05-Climax.tsx
  Composition.tsx      — TransitionSeries stitching all scenes + audio slot
  Root.tsx             — registers composition (1920×1080, 30fps, ~2550f)
  index.ts
  index.css
```

### Design Tokens (`lib/design.ts`)
```ts
bg:              #000000
panel:           rgba(15,15,15,0.85)
sidebar:         rgba(10,10,10,0.90)
glass:           rgba(20,20,20,0.70)  + backdrop-filter: blur(24px) saturate(180%)
border:          rgba(255,255,255,0.08)
borderHighlight: rgba(255,255,255,0.15)
text:            #ffffff
textMuted:       rgba(255,255,255,0.55)
textDim:         rgba(255,255,255,0.30)
accent:          #3b82f6   (blue — action buttons, active states)
green:           #22c55e   (Neural Engine Active, voice done)
amber:           #f59e0b   (voice listening)
sand:            #c8b89a   (logo "L" colour)
red:             #ef4444   (OFF badge)
fontUI:          'Inter', system-ui, sans-serif
fontMono:        'JetBrains Mono', 'Fira Code', monospace
```

### Animation Primitives
- **Background slow push:** every scene wraps the wallpaper in a `scale` interpolate from `1.0` → `1.06` over the full scene duration, `extrapolateRight: 'clamp'`
- **Element punch-in (ZoomWrapper):** spring from `0.92` → `1.0` over ~12 frames, triggered at element entry frame
- **TypeWriter:** maps `frame` to `Math.floor(progress * text.length)` characters, speed configurable (chars/sec)
- **Stagger:** each item in a list gets `delayInFrames = index * gapFrames`
- **Fade transitions:** `linearTiming({ durationInFrames: 15 })` with `fade()` presentation between all scenes

---

## Scenes

### Scene 00 — Intro (150f / 5s)
**Background:** Pure black
**Sequence:**
1. f0–30: Localis logo SVG (`public/logo.svg`) spring scales in (0.6→1.0) + fades
2. f20–60: "Introducing Localis" fades up in Inter 48px white
3. f50–90: Tagline "Your AI. Your machine. Your rules." fades up in Inter 22px `textMuted`
4. f100–150: Gentle hold before transition

### Scene 01 — RAG (600f / 20s)
**Background:** Midnight Glass shell (Shell component, wallpaper slow push)
**Sequence:**
1. f0–90: IngestProgress ticks stagger in top-left:
   - "From File: Ingest complete ♥" (header line, green)
   - ✓ Upload / ✓ Extract / ✓ Chunk / ✓ Index (each +12f apart)
   - "Files: 1/1"
2. f80–120: User ChatBubble slides in from right: *"Summarise this file for me."*
3. f120–180: ThinkingBlock expands from top of assistant area, shows animated dots then truncated reasoning text (2 lines visible)
4. f180–600: Assistant ChatBubble (Localis logo avatar, left side). TypeWriter reveals response:
   > **The file outlines Localis**, a private AI assistant that runs entirely on your own computer using your GPU. Here's a summary:
   > - **Technology:** Runs on your local GPU, no cloud or subscriptions.
   > - **Features:** Fully local and private · Two-tier memory (Tier-A/Tier-B) · RAG · Web search · Multi-provider support
   > - **Purpose:** A fully-stack product, self-updating, and shippable (no scripts or notebooks). Let me know if you'd like further details!
5. ZoomWrapper punch-in on assistant bubble at f180

### Scene 02 — Web Search (450f / 15s)
**Background:** Same shell, chat history from scene 01 visible (slightly scrolled, dimmed)
**Sequence:**
1. f0–40: User ChatBubble slides in: *"When is the next F1 race?"*
2. f40–90: ToolCard animates in (slide up + fade):
   - Icon: 🔍 `web_search` · "3 results" label
   - Status dot: green pulsing
3. f90–120: ZoomWrapper punch-in on ToolCard
4. f120–450: Assistant bubble TypeWriter:
   > The next F1 race is the **Japanese Grand Prix**:
   > - 📅 **Date:** Sun, Mar 29 — 1:00 a.m.
   > - 🏎️ **Track:** Suzuka Circuit

### Scene 03 — Home Assistant (540f / 18s)
**Background:** Shell, RSB panel slides in from right
**Sequence:**
1. f0–40: RsbPanel slides in from right edge (translateX: 320→0, spring)
   - Header: "QUICK CONTROLS"
   - "Rishi Room Light" toggle (ON, green)
2. f40–100: Light bulb icon pulses with warm amber glow (drop-shadow colour cycles via interpolateColors)
3. f60–120: "27%" brightness text + slider bar fill animates 0→27%
4. f100–260: Colour swatches cycle — highlight moves through orange → amber → teal → cyan → white → back, one per 30 frames. Bulb colour interpolates to match active swatch.
5. f260–320: ZoomWrapper punch-in onto bulb + swatch row
6. f320–540: Hold on animated state, slow background push continues

### Scene 04 — Notes (360f / 12s)
**Background:** Shell (chat dimmed), NotesPanel slides up from bottom
**Sequence:**
1. f0–40: NotesPanel slides up (translateY: 80→0, spring)
   - Title: "Notes"
   - Card 1: "Push Day — Bench Press x5, Arnold Press x3…" (dark glass card)
   - Card 2: "Record Localis DEMO — Post (LinkedIn + Reddit)"
2. f60–100: VoiceBar transitions to amber → text: *"Hey Chotu…"*
3. f100–180: VoiceBar pulses amber (listening animation — scale 1.0→1.02 oscillate)
4. f180–280: VoiceBar green briefly → New note card springs in:
   - Title area: "Order Eggs, Milk, Dinner Rolls, Chicken thighs from Instacart"
   - Deadline badge: "22 May, 11:00"
5. f280–360: All 3 cards visible, ZoomWrapper punch-in on new card

### Scene 05 — Climax (450f / 15s)
**Background:** Full Shell, dark/moody — same wallpaper slightly more dimmed (overlay opacity 0.7)
**Sequence:**
1. f0–30: VoiceBar appears in idle gray at top-right
2. f30–60: VoiceBar → amber. Subtitle fades in below: **"light banda kar"** (Inter 32px white) + **(Marathi)** (Inter 20px textMuted) — centred lower-third
3. f60–100: VoiceBar → green. Wakeword label: "Hey Chotu" visible in bar
4. f100–160: User ChatBubble slides in from right: *"light banda kar"*
5. f140–200: AssistCard slides up (ToolCard variant):
   - Green dot · `assist.action` · "Light controlled"
   - Entity: `light.rishi_room_light`
   - Change: `→ OFF` (red badge)
6. f180–220: ZoomWrapper punch-in on AssistCard (scale 0.92→1.0)
7. f220–360: Assistant ChatBubble fades in: *"Rishi Room Light turned OFF."*
8. f300–450: Slow fade to near-black. Localis logo appears small, centred. Hold.

---

## Transitions
All scene-to-scene: `fade()` with `linearTiming({ durationInFrames: 15 })`
Total overlap: 5 × 15 = 75 frames
Net composition length: (150+600+450+540+360+450) − 75 = **2475 frames ≈ 82.5s**

---

## Wakeword: Chotu
All in-video text that previously said "Hey Jarvis" now reads "Hey Chotu". CLAUDE.md to be updated noting the rename — future app update will change `wakeword.py` and the voice status bar UI text.

---

## Audio Slot
In `Composition.tsx`, immediately after `<TransitionSeries>`:
```tsx
{/* ADD AUDIO HERE — drop an <Audio> component with your track */}
{/* Example: <Audio src={staticFile("music.mp3")} volume={0.4} /> */}
```
Remotion renders audio into the exported video. Place an MP3/WAV in `public/` and update the src.

---

## Out of Scope
- Portrait/reels format (future phase)
- Live app changes (wakeword rename in actual app deferred)
- Video overlay PiP compositing (user handles in post if needed)
