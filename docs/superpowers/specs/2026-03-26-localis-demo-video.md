# Localis Demo Video — Design Spec
**Date:** 2026-03-26
**Format:** 1920×1080 · 30fps · ~83.4s · Remotion 4.x
**Tooling:** React/TypeScript, @remotion/transitions, TailwindCSS v4

---

## Audio

**Track:** `public/music.mp3` (traditional jazz, G minor, 6A)
**BPM:** 100 · **Duration:** 87.64s
**Beat grid (30fps):** 1 beat = 18 frames · 1 bar = 72 frames
**Audio in video:** `<Audio src={staticFile("music.mp3")} volume={0.5} endAt={83.4} />`
Music fades out over the final 60 frames (2s) via `volume` interpolation from 0.5 → 0.

All scene transitions land on **bar boundaries**. All element entries land on **beat boundaries** (multiples of 18f from scene start). Spring configs use moderate damping to match the relaxed-but-purposeful jazz feel.

---

## Beat-Aligned Scene Timing

| Scene | Bars | Raw frames | Net start (cumulative, post-transitions) | Duration |
|-------|------|-----------|------------------------------------------|----------|
| 00 Intro | 3 | 216f | 0 | 7.2s |
| 01 RAG | 8 | 576f | 198f (after 18f overlap) | 19.2s |
| 02 Web Search | 6 | 432f | 756f | 14.4s |
| 03 Home Assistant | 8 | 576f | 1170f | 19.2s |
| 04 Notes | 5 | 360f | 1728f | 12s |
| 05 Climax | 6 | 432f | 2070f | 14.4s |
| 5 × 18f transitions | — | −90f | — | — |
| **Net composition** | **36 bars** | **2502f** | — | **83.4s** |

All transitions: `fade()` with `linearTiming({ durationInFrames: 18 })` (exactly 1 beat).

---

## Technical Architecture

### File Structure
```
src/
  lib/
    design.ts          — colour tokens, spacing, font stacks
    beats.ts           — beat grid constants: BPM=100, FPS=30, BEAT=18, BAR=72
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
    ZoomWrapper.tsx    — applies spring scale punch-in (0.92→1.0, ~12f) at given start frame
  scenes/
    00-Intro.tsx       — 216f / 3 bars
    01-Rag.tsx         — 576f / 8 bars
    02-WebSearch.tsx   — 432f / 6 bars
    03-HomeAssistant.tsx — 576f / 8 bars
    04-Notes.tsx       — 360f / 5 bars
    05-Climax.tsx      — 432f / 6 bars
  Composition.tsx      — TransitionSeries + Audio with fade-out
  Root.tsx             — registers composition (1920×1080, 30fps, 2502f)
  index.ts
  index.css
```

### Design Tokens (`lib/design.ts`)
```ts
bg:              '#000000'
panel:           'rgba(15,15,15,0.85)'
sidebar:         'rgba(10,10,10,0.90)'
glass:           'rgba(20,20,20,0.70)'   // + backdropFilter: blur(24px) saturate(180%)
border:          'rgba(255,255,255,0.08)'
borderHighlight: 'rgba(255,255,255,0.15)'
text:            '#ffffff'
textMuted:       'rgba(255,255,255,0.55)'
textDim:         'rgba(255,255,255,0.30)'
accent:          '#3b82f6'   // blue
green:           '#22c55e'
amber:           '#f59e0b'
sand:            '#c8b89a'   // logo "L" colour
red:             '#ef4444'
fontUI:          "'Inter', system-ui, sans-serif"
fontMono:        "'JetBrains Mono', 'Fira Code', monospace"
```

### Beat Constants (`lib/beats.ts`)
```ts
export const BPM = 100;
export const FPS = 30;
export const BEAT = 18;   // frames per beat
export const BAR  = 72;   // frames per bar (4 beats)
export const beat = (n: number) => n * BEAT;
export const bar  = (n: number) => n * BAR;
```

### Animation Primitives
- **Background slow push:** every scene wraps wallpaper in `scale` interpolate `1.0 → 1.06` over full scene duration, `extrapolateRight: 'clamp'`
- **Element punch-in (ZoomWrapper):** `spring({ frame: f - startFrame, fps, config: { damping: 18, stiffness: 120 } })` mapped `0→1`, scale `0.92 → 1.0`
- **TypeWriter:** `Math.floor(interpolate(frame, [start, start + chars * speedFactor], [0, text.length]))` chars shown
- **Stagger:** `delayInFrames = index * BEAT` (stagger on beat boundaries)
- **VoiceBar pulse:** `Math.sin(frame * 0.2) * 0.015 + 1.0` scale oscillation (amber listening state)
- **Audio fade-out:** `interpolate(frame, [2442, 2502], [0.5, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })`

---

## Scenes (Beat-Aligned Keyframes)

All frame numbers are **relative to scene start**.

### Scene 00 — Intro (216f / 3 bars)
Black background only, no Shell.

| Frame | Beat | Event |
|-------|------|-------|
| f0 | — | Scene starts |
| f0–f36 | beat 1–2 | Localis logo SVG spring scales in (0.6→1.0) + fades in |
| f18 | beat 2 | "Introducing Localis" — Inter 52px white, fadeIn |
| f54 | beat 4 (bar end) | Tagline "Your AI. Your machine. Your rules." — Inter 22px textMuted, fadeIn |
| f144 | bar 2 end | Hold, gentle logo glow pulse |
| f216 | bar 3 end | Scene ends → transition |

### Scene 01 — RAG (576f / 8 bars)
Shell visible throughout. Slow background push active.

| Frame | Beat | Event |
|-------|------|-------|
| f0–f72 | bar 1 | Shell fades in with wallpaper |
| f18 | beat 2 | IngestProgress header: "From File: Ingest complete ♥" |
| f36 | beat 3 | ✓ Upload appears |
| f54 | beat 4 | ✓ Extract appears |
| f72 | bar 2 start | ✓ Chunk appears |
| f90 | beat 6 | ✓ Index + "Files: 1/1" appears |
| f108 | beat 7 | User ChatBubble slides in from right: *"Summarise this file for me."* |
| f144 | bar 3 start | ThinkingBlock expands, dots animate |
| f216 | bar 4 start | ZoomWrapper punch-in on ThinkingBlock |
| f252 | beat 15 | Assistant ChatBubble fades in (Localis logo avatar) |
| f252–f576 | bars 4–8 | TypeWriter reveals summary response (~280 chars, ~45 chars/bar) |
| f504 | bar 8 start | ZoomWrapper punch-in on assistant bubble |

**RAG summary text:**
> **The file outlines Localis**, a private AI assistant that runs entirely on your own computer using your GPU.
> - **Technology:** Runs on your local GPU, no cloud or subscriptions.
> - **Features:** Fully local · Two-tier memory · RAG · Web search · Multi-provider support
> - **Purpose:** Fully-stack, self-updating, shippable. Let me know if you'd like further details!

### Scene 02 — Web Search (432f / 6 bars)
Shell continues. Previous chat dimmed to 40% opacity.

| Frame | Beat | Event |
|-------|------|-------|
| f0 | — | Previous chat visible, dimmed |
| f18 | beat 2 | User ChatBubble slides in: *"When is the next F1 race?"* |
| f72 | bar 2 start | ToolCard slides up + fades in: 🔍 `web_search · 3 results` |
| f90 | beat 6 | Green status dot pulses on ToolCard |
| f108 | beat 7 | ZoomWrapper punch-in on ToolCard |
| f144 | bar 3 start | Assistant bubble fades in |
| f144–f432 | bars 3–6 | TypeWriter reveals F1 response |

**Web search response text:**
> The next F1 race is the **Japanese Grand Prix**:
> 📅 **Date:** Sun, Mar 29 — 1:00 a.m.
> 🏎️ **Track:** Suzuka Circuit

### Scene 03 — Home Assistant (576f / 8 bars)
Shell. RSB panel enters from right.

| Frame | Beat | Event |
|-------|------|-------|
| f0–f36 | beat 1–3 | RsbPanel slides in from right (translateX 320→0, spring) |
| f36 | beat 3 | Panel settled: "QUICK CONTROLS" header, "Rishi Room Light", toggle ON |
| f72 | bar 2 | Light bulb icon appears with warm amber glow |
| f90 | beat 6 | "27%" text fades in; brightness bar fills 0→27% over 36f |
| f144 | bar 3 | ZoomWrapper punch-in on bulb |
| f144–f432 | bars 3–7 | Colour swatch highlight cycles: orange → amber → teal → cyan → white → back. One swatch per 36f (2 beats). Bulb colour interpolates to match. |
| f432 | bar 7 | ZoomWrapper punch-in on swatch row |
| f468 | beat 27 | Brightness slider animates: 27% → 80% → 27% over 72f |
| f576 | bar 8 end | Scene ends |

### Scene 04 — Notes (360f / 5 bars)
Shell. Chat area dimmed. NotesPanel overlay.

| Frame | Beat | Event |
|-------|------|-------|
| f0–f36 | beat 1–3 | NotesPanel slides up (translateY 80→0, spring) |
| f36 | beat 3 | Panel settled: title "Notes", 2 cards visible |
| f72 | bar 2 | Card 1: "Push Day — Bench Press x5…" fully readable |
| f90 | beat 6 | Card 2: "Record Localis DEMO — Post (LinkedIn + Reddit)" |
| f108 | beat 7 | VoiceBar transitions gray → amber · text: "Hey Chotu…" |
| f108–f180 | — | VoiceBar pulses amber (sin oscillation) |
| f180 | bar 3 end | VoiceBar → green briefly |
| f198 | beat 12 | New note card springs in (ZoomWrapper): "Order Eggs, Milk, Dinner Rolls, Chicken thighs from Instacart" + deadline badge "22 May, 11:00" |
| f252 | bar 4 | ZoomWrapper punch-in on new card |
| f360 | bar 5 end | Scene ends |

### Scene 05 — Climax (432f / 6 bars)
Shell, darkened wallpaper overlay (extra rgba(0,0,0,0.3) layer). Full drama.

| Frame | Beat | Event |
|-------|------|-------|
| f0 | — | Scene starts, VoiceBar in idle gray |
| f18 | beat 2 | VoiceBar → amber pulse. Subtitle fades in lower-third: **"light banda kar"** Inter 36px white + **(Marathi)** Inter 20px textMuted |
| f36 | beat 3 | VoiceBar label: "Hey Chotu" |
| f72 | bar 2 | VoiceBar → green |
| f90 | beat 6 | User ChatBubble slides in: *"light banda kar"* |
| f126 | beat 8 | AssistCard slides up (spring): green dot · `assist.action · Light controlled` · Entity: `light.rishi_room_light` · Change: `→ OFF` (red badge) |
| f144 | bar 3 | ZoomWrapper punch-in on AssistCard (scale 0.92→1.0) |
| f198 | beat 12 | Assistant bubble fades in: *"Rishi Room Light turned OFF."* |
| f216 | bar 4 | ZoomWrapper punch-in on assistant bubble |
| f288 | bar 5 | Subtitle fades out. Screen begins slow fade to near-black. |
| f360 | bar 6 | Localis logo appears centred, small, fades in |
| f432 | bar 6 end | Scene + video ends. Audio fade-out complete. |

---

## Shell Component Spec
Faithful Midnight Glass recreation — no screenshot backgrounds.

**Layout (1920×1080):**
- **Wallpaper bg:** radial gradient dark mountain approximation — `radial-gradient(ellipse at 50% 70%, rgba(20,25,35,1) 0%, rgba(5,5,8,1) 60%, rgba(0,0,0,1) 100%)` + slow push scale
- **Left sidebar:** 48px wide, `bg-sidebar`, icons (logo, +, settings) — decorative only
- **Header:** full width, 52px tall, glass panel — "Localis" + "NO MODEL LOADED" left; "● Neural Engine Active" + avatar right
- **Chat area:** centred column, max-width 760px, scrolled to show relevant messages
- **Right sidebar:** 280px, initially hidden, slides in for Scene 03 (RsbPanel)
- **Bottom bar:** input pill + mode pills (Web · Home · Think · Remember) — static, decorative

**ChatBubble (assistant):** 36px avatar = `public/logo.svg` in a dark circle, text in glass panel left-aligned.
**ChatBubble (user):** blue "U" avatar right, glass panel right-aligned.

---

## Wakeword Rename
All in-video UI text: "Hey Chotu" (not Jarvis). CLAUDE.md updated to note future app rename (`wakeword.py` + voice status bar text).

---

## Out of Scope
- Portrait/reels format (future phase)
- Live app wakeword rename (deferred)
- Video overlay PiP (user handles in post if needed)
