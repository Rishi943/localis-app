# Localis

## What This Is

Localis is a privacy-first, local-first AI assistant desktop application. All AI processing runs on the user's own hardware using GGUF models via llama-cpp-python — zero cloud dependencies, zero data leaving the device. It ships as a FastAPI server that opens in the default browser, targeting Linux (CachyOS/KDE) as primary platform with Windows in scope. The goal is to make local AI genuinely useful and accessible to everyday users, especially students who want full control over model parameters without the restrictions of cloud services.

## Core Value

A local AI assistant that actually feels finished — polished enough that users trust it, powerful enough that they prefer it over ChatGPT, and private enough that they never have to think about where their data goes.

## Requirements

### Validated

- ✓ Chat interface with local LLM inference (llama-cpp-python, GGUF, GPU via GGML_CUDA) — existing
- ✓ Three model tiers: small (Gemma 3 4B), medium (Qwen3 8B), large (20B) — existing
- ✓ RAG system with ChromaDB and bge-small-en-v1.5 embeddings — existing (shipped 02/16)
- ✓ Two-tier memory system (Tier-A core identity, Tier-B auto-learned facts) — existing
- ✓ Interactive tutorial system — existing
- ✓ Voice input/output (faster-whisper STT, Piper TTS) — existing
- ✓ Wakeword detection "Hey Jarvis" via openwakeword — existing
- ✓ Home Assistant integration for smart lights — existing
- ✓ Midnight Glass UI (three-column layout, glass panels, voice status bar) — existing
- ✓ Settings persistence (DB-backed accent colour, wallpaper, model config) — existing

### Active

- [ ] UI Polish — fix layout/spacing inconsistencies, visual cohesion, sidebar/navigation, chat interface presentation
- [ ] LAB — model parameter playground exposing temp, top_p, context size, GPU/CPU layers, repeat penalty; A/B defaults system for students and power users
- [ ] News RSS Feed — aggregated feed from r/LocalLLaMA and user-configurable RSS sources; filterable, readable in-app
- [ ] YouTube Music via HA — voice command "hey jarvis, play [song]" triggers HA media_player entity to play via YouTube Music integration
- [ ] Financial Advisor — bank statement upload (CSV/OFX), categorised expense dashboard with pie charts, RAG-powered chat over statement data
- [ ] Post+ (Reddit + LinkedIn) — writing style mimicry from user-provided examples; soft-warns when below minimum example count; separate profiles per platform (Reddit posts, LinkedIn posts)

### Out of Scope

- Dynamic wallpaper-aware text colour adaptation — interesting idea but complexity unknown, defer to post-v1
- Windows installer packaging — separate workstream, not blocking features
- HA YouTube Music entity setup — user's responsibility before that phase executes
- Cloud AI fallbacks or hybrid inference — violates privacy-first principle
- Mobile app — web-first for v1
- Real-time collaboration — single-user local app

## Context

Existing codebase is substantial (~1900 lines main.py, ~6300 lines app.js). Architecture uses a Router-Generator inference pipeline with a global MODEL_LOCK for thread-safe GPU access. Features are added via a `register_*()` router registration pattern. The frontend is vanilla JS with IIFE modules (ragUI, voiceUI, wakewordUI, etc.) following the Midnight Glass design system documented in UIUX/DESIGN.md.

The open-source repo is at https://github.com/Rishi943/localis-app. A Windows installer (Inno Setup with bundled Python/Git runtimes) exists but is a separate workstream.

Primary target user is Rishi (daily driver), with a secondary goal of making the app good enough to share publicly — particularly targeting students who want local AI without ChatGPT's restrictions.

## Constraints

- **Privacy**: No network calls except HA local API, optional Brave/Tavily web search, and RSS fetching — all user-configured
- **Tech stack**: FastAPI + SQLite + llama-cpp-python + ChromaDB + vanilla JS — no framework migrations
- **Platform**: Linux (CachyOS/KDE) primary; Windows must work but secondary
- **Voice venv**: openwakeword requires separate `.venv-voice` (Python 3.11) due to tflite-runtime constraints
- **GPU**: GGML_CUDA for acceleration; MODEL_LOCK must protect all inference calls
- **Design system**: All UI changes must conform to UIUX/DESIGN.md (Midnight Glass identity)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Vanilla JS frontend (no React/Vue) | Avoids build toolchain complexity for a desktop-first app | — Pending evaluation |
| ChromaDB for vector search | Already integrated, handles RAG well for local use | ✓ Good |
| Separate voice venv (Python 3.11) | tflite-runtime incompatible with Python 3.13+ | ✓ Good |
| Function-tuned Gemma (DistilLabs) for HA tool calls | Better structured output for HA tool routing | ✓ Good — shipped |
| Post+ soft-warn below example minimum | Feature still usable, educates user on quality trade-off | — Pending |
| YouTube Music via HA media_player (user sets up entity) | Reuses existing HA integration; user owns the HA config | — Pending |

---
*Last updated: 2026-03-14 after initialization*
