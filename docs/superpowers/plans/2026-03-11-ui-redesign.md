# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Localis frontend with a Midnight Glass liquid glass visual identity, collapsible three-column shell, prose chat messages with action cards, and a quick-controls right sidebar.

**Architecture:** Backend adds two lightweight GET endpoints (`/api/system-stats`, `/assist/light_state`). Frontend is a staged rewrite: HTML shell restructured first, then CSS liquid glass applied, then JS wired to new elements. Existing element IDs for functional components (voice controls, model loader, system prompt modal) are preserved so the large `app.js` file requires only surgical additions, not a rewrite.

**Tech Stack:** FastAPI, Python (`psutil`, `pynvml`), HTML/CSS (Inter + JetBrains Mono, `backdrop-filter`), vanilla JS (IIFE modules, `setInterval` polling, `fetch`).

**Spec:** `docs/superpowers/specs/2026-03-11-ui-redesign-design.md`
**Mockups:** `.superpowers/brainstorm/18519-1773247506/` — `shell-v2.html`, `sidebar-redesign.html`

---

## File Map

| File | Change type | Notes |
|---|---|---|
| `requirements.txt` | Add 2 deps | `psutil`, `pynvml` |
| `app/main.py` | Add ~35 lines | New `/api/system-stats` GET route |
| `app/assist.py` | Add ~45 lines | New `/assist/light_state` GET route |
| `app/templates/index.html` | Structural rewrite | New shell, sidebars, icons; preserve all functional element IDs |
| `app/static/css/app.css` | Full visual rewrite | Liquid glass; preserve `.amber`/`.green` class names |
| `app/static/js/app.js` | Surgical additions | Mode pills, sidebar polling, stats, context bar (~300 new lines, no deletions in core send path) |

---

## Chunk 1: Backend Endpoints

### Task 1: `/api/system-stats` endpoint

**Files:**
- Modify: `requirements.txt`
- Modify: `app/main.py` (add after line ~1822, before the end of the file)
- Test: `tests/test_system_stats.py`

- [ ] **Step 1: Add dependencies to `requirements.txt`**

```
psutil
pynvml
```

Append both to the end of `requirements.txt`.

- [ ] **Step 2: Install**

```bash
pip install psutil pynvml
```

- [ ] **Step 3: Write the failing test**

Create `tests/test_system_stats.py`:

```python
import pytest
from fastapi.testclient import TestClient

def test_system_stats_returns_expected_fields(monkeypatch):
    """GET /api/system-stats returns the required JSON schema."""
    import psutil

    monkeypatch.setattr(psutil, "cpu_percent", lambda interval=None: 34.2)
    mock_mem = type("M", (), {"used": 11_400_000_000, "total": 16_000_000_000})()
    monkeypatch.setattr(psutil, "virtual_memory", lambda: mock_mem)

    from app.main import app
    client = TestClient(app)
    resp = client.get("/api/system-stats")
    assert resp.status_code == 200
    data = resp.json()
    assert "cpu_pct" in data
    assert "ram_used_gb" in data
    assert "ram_total_gb" in data
    assert "vram_used_gb" in data
    assert "vram_total_gb" in data
    assert abs(data["cpu_pct"] - 34.2) < 0.01
    assert abs(data["ram_used_gb"] - 11.4) < 0.1

def test_system_stats_vram_falls_back_to_zero(monkeypatch):
    """VRAM returns 0.0 when pynvml is unavailable (CPU-only machine)."""
    import sys, types
    # simulate pynvml import failure
    fake_pynvml = types.ModuleType("pynvml")
    fake_pynvml.nvmlInit = lambda: (_ for _ in ()).throw(Exception("no GPU"))
    monkeypatch.setitem(sys.modules, "pynvml", fake_pynvml)

    from app.main import app
    client = TestClient(app)
    resp = client.get("/api/system-stats")
    assert resp.status_code == 200
    assert resp.json()["vram_used_gb"] == 0.0
    assert resp.json()["vram_total_gb"] == 0.0
```

- [ ] **Step 4: Run test — expect FAIL**

```bash
cd /home/rishi/Rishi/AI/Localis
python -m pytest tests/test_system_stats.py -v
```

Expected: `FAILED` — `404 Not Found` for `/api/system-stats`.

- [ ] **Step 5: Implement the endpoint in `app/main.py`**

Add these imports near the top of `app/main.py` (after existing imports, around line 30):

```python
import psutil
try:
    import pynvml as _pynvml
    _pynvml.nvmlInit()
    _NVML_OK = True
except Exception:
    _NVML_OK = False
```

Add the route anywhere before `if __name__ == "__main__"` (around line 1822):

```python
@app.get("/api/system-stats")
async def system_stats():
    """Return current CPU, RAM, and VRAM usage for the sidebar stats panel."""
    cpu_pct = psutil.cpu_percent(interval=None)
    mem = psutil.virtual_memory()
    ram_used_gb = round(mem.used / 1e9, 1)
    ram_total_gb = round(mem.total / 1e9, 1)

    vram_used_gb = 0.0
    vram_total_gb = 0.0
    if _NVML_OK:
        try:
            handle = _pynvml.nvmlDeviceGetHandleByIndex(0)
            info = _pynvml.nvmlDeviceGetMemoryInfo(handle)
            vram_used_gb = round(info.used / 1e9, 1)
            vram_total_gb = round(info.total / 1e9, 1)
        except Exception:
            pass

    return {
        "cpu_pct": cpu_pct,
        "ram_used_gb": ram_used_gb,
        "ram_total_gb": ram_total_gb,
        "vram_used_gb": vram_used_gb,
        "vram_total_gb": vram_total_gb,
    }
```

- [ ] **Step 6: Run test — expect PASS**

```bash
python -m pytest tests/test_system_stats.py -v
```

Expected: 2 tests `PASSED`.

- [ ] **Step 7: Manual smoke test**

```bash
curl http://localhost:8000/api/system-stats
# Expected: {"cpu_pct":34.2,"ram_used_gb":11.4,"ram_total_gb":16.0,"vram_used_gb":8.1,"vram_total_gb":10.0}
```

- [ ] **Step 8: Commit**

```bash
git add requirements.txt app/main.py tests/test_system_stats.py
git commit -m "feat: add /api/system-stats endpoint (psutil + pynvml)"
```

---

### Task 2: `/assist/light_state` endpoint

**Files:**
- Modify: `app/assist.py` (add after line ~755, end of file)
- Test: `tests/test_light_state.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_light_state.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

_MOCK_HA_RESPONSE = {
    "state": "on",
    "attributes": {
        "brightness": 153,          # 0–255; 153/255 ≈ 60%
        "color_temp_kelvin": 3000,
        "rgb_color": [255, 200, 100],
        "friendly_name": "Rishi Room Light",
        "last_changed": "2026-03-11T14:32:01Z",
    },
    "last_changed": "2026-03-11T14:32:01Z",
}

@pytest.fixture(autouse=True)
def patch_assist_globals(monkeypatch):
    import app.assist as assist
    monkeypatch.setattr(assist, "_ha_url", "http://ha.local:8123", raising=False)
    monkeypatch.setattr(assist, "_ha_token", "fake_token", raising=False)
    monkeypatch.setattr(assist, "_light_entity", "light.rishi_room_light", raising=False)

async def _mock_ha_get_state(entity_id):
    return _MOCK_HA_RESPONSE

def test_light_state_returns_schema(monkeypatch):
    import app.assist as assist
    monkeypatch.setattr(assist, "ha_get_state", _mock_ha_get_state)

    from app.main import app
    client = TestClient(app)
    resp = client.get("/assist/light_state")
    assert resp.status_code == 200
    data = resp.json()
    assert data["state"] == "on"
    assert data["brightness_pct"] == 60
    assert data["entity_id"] == "light.rishi_room_light"
    assert "last_changed" in data

def test_light_state_ha_unavailable(monkeypatch):
    import app.assist as assist
    async def _failing(*a): raise Exception("HA down")
    monkeypatch.setattr(assist, "ha_get_state", _failing)

    from app.main import app
    client = TestClient(app)
    resp = client.get("/assist/light_state")
    assert resp.status_code == 503
    assert "error" in resp.json()
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
python -m pytest tests/test_light_state.py -v
```

Expected: `FAILED` — `404 Not Found`.

- [ ] **Step 3: Implement the endpoint in `app/assist.py`**

`ha_get_state` already exists at line ~519. Add this route after the existing `/assist/status` endpoint (after line ~755):

```python
@router.get("/light_state")
async def light_state_endpoint(request: Request):
    """Return current state of the configured light entity for the sidebar."""
    if not _ha_url or not _light_entity:
        raise HTTPException(status_code=503, detail={"error": "HA not configured"})
    try:
        data = await ha_get_state(_light_entity)
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})

    attrs = data.get("attributes", {})
    raw_brightness = attrs.get("brightness")          # 0–255 or None
    brightness_pct = round(raw_brightness / 255 * 100) if raw_brightness is not None else 0

    return {
        "entity_id": _light_entity,
        "state": data.get("state", "off"),            # "on" | "off"
        "brightness_pct": brightness_pct,
        "color_temp_k": attrs.get("color_temp_kelvin"),
        "rgb": attrs.get("rgb_color"),
        "last_changed": data.get("last_changed"),
    }
```

Note: `ha_get_state` is a coroutine defined at line ~519 in `app/assist.py`. The router prefix is `/assist` (set in `register_assist`), so the full URL is `/assist/light_state`.

- [ ] **Step 4: Run test — expect PASS**

```bash
python -m pytest tests/test_light_state.py -v
```

Expected: 2 tests `PASSED`.

- [ ] **Step 5: Manual smoke test** (requires running server with HA configured)

```bash
curl http://localhost:8000/assist/light_state
# Expected: {"entity_id":"light.rishi_room_light","state":"on","brightness_pct":60,...}
# Or if HA not configured: HTTP 503
```

- [ ] **Step 6: Commit**

```bash
git add app/assist.py tests/test_light_state.py
git commit -m "feat: add /assist/light_state endpoint"
```

---

## Chunk 2: HTML Shell Restructure

**Context:** `app/templates/index.html` is a full structural rewrite. The key rule: **preserve every element ID that `app.js` references via the `els` object** (see lines 1507–1567 of `app.js`). New components get new IDs. The tutorial overlays, setup wizard, model loader overlays — everything below the `<!-- App Shell -->` comment — are left completely untouched.

**IDs to preserve (functional, referenced by `app.js` `els`):**
`#chat-history`, `#prompt`, `#send-btn`, `#voice-mic-btn`, `#wakeword-toggle-btn`, `#wakeword-state-label`, `#voice-status-bar` (structure + `.voice-status-dot`, `.voice-status-label`, `.voice-status-tag`), `#from-file-input`, `#system-prompt-modal`, `#btn-close-prompt-modal`, `#system-prompt-modal-editor`, `#btn-modal-save-prompt`, `#btn-modal-reset-prompt`, `#right-sidebar`, `#right-rail`, `#session-list`, `#session-title`, `#model-status`.

**New IDs added by this plan:**
`#app-shell`, `#left-sidebar`, `#left-sidebar-toggle`, `#top-bar`, `#tb-model-name`, `#tb-session-name`, `#btn-top-settings`, `#chat-zone`, `#input-zone`, `#mode-pills`, `#pill-web`, `#pill-home`, `#pill-upload`, `#pill-remember`, `#rsb-lights-section`, `#rsb-lights-name`, `#rsb-lights-toggle`, `#rsb-lights-pct`, `#rsb-lights-ago`, `#rsb-bulb-fill`, `#rsb-bulb-line`, `#rsb-btn-power`, `#rsb-btn-brightness`, `#rsb-btn-color`, `#rsb-btn-kelvin`, `#rsb-swatches`, `#rsb-model-name`, `#rsb-model-status`, `#rsb-model-chips`, `#rsb-prompt-presets`, `#btn-edit-prompt-sidebar`, `#rsb-cpu-val`, `#rsb-cpu-bar`, `#rsb-ram-val`, `#rsb-ram-bar`, `#rsb-vram-val`, `#rsb-vram-bar`, `#rsb-ctx-ascii`, `#rsb-ctx-tokens`, `#rsb-ctx-pct`, `#modal-profile-tags`.

---

### Task 3: SVG icon symbol definitions

**Files:**
- Modify: `app/templates/index.html` — add `<svg>` block as first child of `<body>`

- [ ] **Step 1: Read the source SVG files**

Open each file in `UIUX/icons/` and extract the inner SVG paths/shapes (the content between the outer `<svg>` tags). Do not include the root `<svg>` element itself — only the child elements (`<path>`, `<g>`, `<circle>`, `<line>`, etc.).

Files to inline (one `<symbol>` each):
- `localis-model.svg` → `id="ico-model"` viewBox `0 0 24 24`
- `localis-temperature.svg` → `id="ico-temp"` viewBox `0 0 24 24`
- `localis-memory.svg` → `id="ico-memory"` viewBox `0 0 24 24`
- `localis-settings.svg` → `id="ico-settings"` viewBox `0 0 24 24`
- `localis-voice.svg` → `id="ico-voice"` viewBox `0 0 24 24`
- `localis-new-chat.svg` → `id="ico-newchat"` viewBox `0 0 24 24`
- `localis-web-search.svg` → `id="ico-web"` viewBox `0 0 24 24`
- `localis-home-assistant.svg` → `id="ico-home"` viewBox `0 0 24 24`
- `localis-from-file.svg` → `id="ico-file"` viewBox `0 0 24 24`

Also add two inline chevron symbols (no source file needed):
```html
<symbol id="ico-left" viewBox="0 0 24 24">
  <polyline fill="none" stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round" stroke-linejoin="round" points="15 18 9 12 15 6"/>
</symbol>
<symbol id="ico-right" viewBox="0 0 24 24">
  <polyline fill="none" stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round" stroke-linejoin="round" points="9 18 15 12 9 6"/>
</symbol>
```

- [ ] **Step 2: Insert SVG block into `index.html`**

Add as the very first child of `<body>`, before any other elements:

```html
<svg style="display:none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <symbol id="ico-model"   viewBox="0 0 24 24"><!-- paste localis-model.svg innards --></symbol>
    <symbol id="ico-temp"    viewBox="0 0 24 24"><!-- paste localis-temperature.svg innards --></symbol>
    <symbol id="ico-memory"  viewBox="0 0 24 24"><!-- paste localis-memory.svg innards --></symbol>
    <symbol id="ico-settings" viewBox="0 0 24 24"><!-- paste localis-settings.svg innards --></symbol>
    <symbol id="ico-voice"   viewBox="0 0 24 24"><!-- paste localis-voice.svg innards --></symbol>
    <symbol id="ico-newchat" viewBox="0 0 24 24"><!-- paste localis-new-chat.svg innards --></symbol>
    <symbol id="ico-web"     viewBox="0 0 24 24"><!-- paste localis-web-search.svg innards --></symbol>
    <symbol id="ico-home"    viewBox="0 0 24 24"><!-- paste localis-home-assistant.svg innards --></symbol>
    <symbol id="ico-file"    viewBox="0 0 24 24"><!-- paste localis-from-file.svg innards --></symbol>
    <symbol id="ico-left"    viewBox="0 0 24 24"><polyline fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points="15 18 9 12 15 6"/></symbol>
    <symbol id="ico-right"   viewBox="0 0 24 24"><polyline fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points="9 18 15 12 9 6"/></symbol>
  </defs>
</svg>
```

- [ ] **Step 3: Verify icons render**

Start the server, open browser, paste in console:
```javascript
// Should show a small settings gear in the body
const t = document.createElementNS('http://www.w3.org/2000/svg','svg');
t.style.cssText = 'width:32px;height:32px;color:white;position:fixed;top:10px;left:10px;z-index:9999';
const u = document.createElementNS('http://www.w3.org/2000/svg','use');
u.setAttribute('href','#ico-settings');
t.appendChild(u); document.body.appendChild(t);
```

Expected: a settings gear icon appears.

- [ ] **Step 4: Commit**

```bash
git add app/templates/index.html
git commit -m "feat(html): inline Localis SVG icon symbols"
```

---

### Task 4: Three-column shell + top bar + left sidebar

**Files:**
- Modify: `app/templates/index.html`

The existing app renders inside a div that is shown/hidden by the tutorial/model-loader logic. We need to wrap the main UI in a new three-column shell.

- [ ] **Step 1: Identify the existing app root div**

Find the element currently containing the chat UI. It's likely `#app-container` or similar, shown after tutorial completes. Look for the div shown by `state.appReady = true` logic in `app.js`.

- [ ] **Step 2: Replace app root with three-column shell**

Replace the existing app container div with this structure (preserve the same ID the JS uses to show/hide the app shell):

```html
<div id="app-shell" class="app-shell">

  <!-- LEFT SIDEBAR -->
  <div id="left-sidebar" class="lsb">
    <div class="lsb-head">
      <button id="left-sidebar-toggle" class="toggle-btn" aria-label="Collapse sidebar">
        <svg width="12" height="12"><use href="#ico-left"/></svg>
      </button>
      <span class="lsb-title">Localis</span>
    </div>
    <button class="new-chat-btn" id="btn-new-chat">
      <svg width="14" height="14"><use href="#ico-newchat"/></svg>
      <span>New Chat</span>
    </button>
    <div id="session-list" class="sess-list">
      <!-- Populated by JS -->
    </div>
    <div class="lsb-foot">
      <div class="status-dot"></div>
      <span id="model-status" class="status-txt">Offline</span>
    </div>
  </div>

  <!-- MAIN -->
  <div class="main">

    <!-- TOP BAR -->
    <div id="top-bar" class="top-bar">
      <div class="online-dot"></div>
      <span id="tb-model-name" class="tb-model">No model loaded</span>
      <span id="tb-session-name" class="tb-sess"></span>
      <div class="tb-spacer"></div>
      <button id="btn-top-settings" class="tb-btn" title="Settings">
        <svg width="14" height="14"><use href="#ico-settings"/></svg>
      </button>
    </div>

    <!-- CHAT ZONE -->
    <div id="chat-zone" class="chat-zone">
      <div id="chat-history" class="chat-inner">
        <!-- Messages rendered by JS -->
      </div>
    </div>

    <!-- INPUT ZONE -->
    <div id="input-zone" class="input-zone">
      <div class="input-inner">

        <!-- Voice status bar — PRESERVE STRUCTURE, only CSS changes -->
        <div id="voice-status-bar" class="voice-status-bar hidden">
          <div class="voice-status-dot"></div>
          <span class="voice-status-label"></span>
          <span class="voice-status-tag"></span>
        </div>

        <!-- Mode pills (NEW — replaces tools-chip-row + tools-picker-btn) -->
        <div id="mode-pills" class="mode-pills">
          <button id="pill-web"      class="mode-pill" data-tool="web_search">
            <svg width="11" height="11"><use href="#ico-web"/></svg> Web
          </button>
          <button id="pill-home"     class="mode-pill" data-tool="assist_mode">
            <svg width="11" height="11"><use href="#ico-home"/></svg> Home
          </button>
          <button id="pill-upload"   class="mode-pill" data-tool="rag_upload">
            <svg width="11" height="11"><use href="#ico-file"/></svg> Upload
          </button>
          <button id="pill-remember" class="mode-pill" data-tool="memory_write">
            <svg width="11" height="11"><use href="#ico-memory"/></svg> Remember
          </button>
        </div>

        <!-- Input row -->
        <div class="input-row">
          <!-- Hidden file input — preserve original ID -->
          <input type="file" id="from-file-input" multiple hidden accept=".pdf,.txt,.md,.docx,.csv">
          <!-- Voice mic — preserve original ID -->
          <button id="voice-mic-btn" class="voice-mic-btn" title="Hold to speak" hidden>
            <svg width="14" height="14"><use href="#ico-voice"/></svg>
          </button>
          <!-- Wakeword toggle — preserve original ID -->
          <button id="wakeword-toggle-btn" class="wakeword-toggle-btn" title="Wake word: OFF" hidden>
            <svg width="14" height="14"><use href="#ico-voice"/></svg>
            <span id="wakeword-state-label" class="wakeword-state-label"></span>
          </button>
          <textarea id="prompt" rows="1" placeholder="Message Jarvis…" autocomplete="off"></textarea>
          <button id="send-btn" class="send-btn">SEND</button>
        </div>

      </div>
    </div>

  </div><!-- /main -->

  <!-- RIGHT SIDEBAR — see Task 5 -->
  <div id="right-sidebar" class="rsb">
    <!-- populated in Task 5 -->
  </div>

</div><!-- /app-shell -->
```

- [ ] **Step 3: Verify structure with DevTools**

Start server, open page. In DevTools Elements panel verify:
- Three-column structure exists: `.lsb` + `.main` + `.rsb`
- `#chat-history`, `#prompt`, `#send-btn` all exist
- `#voice-status-bar` has its three child elements (`.voice-status-dot`, `.voice-status-label`, `.voice-status-tag`)
- `#from-file-input`, `#voice-mic-btn`, `#wakeword-toggle-btn` all exist

- [ ] **Step 4: Commit**

```bash
git add app/templates/index.html
git commit -m "feat(html): three-column shell + top bar + left sidebar"
```

---

### Task 5: Right sidebar quick controls HTML

**Files:**
- Modify: `app/templates/index.html` — fill `#right-sidebar`

- [ ] **Step 1: Add right sidebar header**

Replace the empty `<div id="right-sidebar" class="rsb">` content:

```html
<div id="right-sidebar" class="rsb">

  <!-- Header -->
  <div class="rsb-head">
    <svg width="13" height="13" style="color:rgba(255,255,255,.4)"><use href="#ico-settings"/></svg>
    <span class="rsb-title">Quick Controls</span>
    <button class="toggle-btn" id="right-sidebar-toggle" aria-label="Collapse sidebar">
      <svg width="12" height="12"><use href="#ico-right"/></svg>
    </button>
  </div>

  <!-- Section 1: LIGHTS -->
  <div class="rsb-sec" id="rsb-lights-section">
    <div class="rsb-sec-lbl">
      <svg width="10" height="10"><use href="#ico-home"/></svg> Lights
    </div>
    <div class="rsb-light-name">
      <span id="rsb-lights-name">Rishi Room Light</span>
      <button class="ltoggle" id="rsb-lights-toggle" aria-label="Toggle light">
        <div class="ltoggle-k"></div>
      </button>
    </div>
    <div class="rsb-l-pct" id="rsb-lights-pct">—</div>
    <div class="rsb-l-ago" id="rsb-lights-ago"></div>
    <div class="rsb-bulb-outer">
      <div class="rsb-bulb" id="rsb-bulb">
        <div class="rsb-bulb-fill" id="rsb-bulb-fill" style="height:0%"></div>
        <div class="rsb-bulb-line" id="rsb-bulb-line" style="bottom:calc(0% + 5px)"></div>
      </div>
    </div>
    <div class="rsb-l-ctrls">
      <button class="rsb-lbtn" id="rsb-btn-power"      title="Power">
        <svg width="14" height="14"><use href="#ico-settings"/></svg><!-- placeholder; JS replaces with inline SVG power icon --></button>
      <button class="rsb-lbtn active" id="rsb-btn-brightness" title="Brightness">
        <svg width="14" height="14"><use href="#ico-temp"/></svg></button>
      <button class="rsb-lbtn" id="rsb-btn-color"      title="Colour">
        <svg width="14" height="14"><use href="#ico-memory"/></svg></button>
      <button class="rsb-lbtn" id="rsb-btn-kelvin"     title="Colour temp">
        <svg width="14" height="14"><use href="#ico-temp"/></svg></button>
    </div>
    <div id="rsb-swatches" class="rsb-swatches">
      <button class="rsb-sw" style="background:#f97316" data-color="#f97316"></button>
      <button class="rsb-sw" style="background:#fdba74" data-color="#fdba74"></button>
      <button class="rsb-sw" style="background:#fde8d3" data-color="#fde8d3"></button>
      <button class="rsb-sw" style="background:#f5f5f5" data-color="#f5f5f5"></button>
      <button class="rsb-sw" style="background:#6366f1" data-color="#6366f1"></button>
      <button class="rsb-sw" style="background:#a855f7" data-color="#a855f7"></button>
      <button class="rsb-sw" style="background:#ec4899" data-color="#ec4899"></button>
      <button class="rsb-sw" style="background:#ef4444" data-color="#ef4444"></button>
    </div>
  </div>

  <!-- Section 2: MODEL -->
  <div class="rsb-sec">
    <div class="rsb-sec-lbl">
      <svg width="10" height="10"><use href="#ico-model"/></svg> Model
    </div>
    <div class="rsb-model-drop">
      <div>
        <div id="rsb-model-name" class="rsb-model-name">No model loaded</div>
        <div id="rsb-model-status" class="rsb-model-st">● OFFLINE</div>
      </div>
      <span class="rsb-model-arr">▾</span>
    </div>
    <div id="rsb-model-chips" class="rsb-model-chips">
      <!-- Populated by JS from /models -->
    </div>
  </div>

  <!-- Section 3: SYSTEM PROMPT -->
  <div class="rsb-sec">
    <div class="rsb-sec-lbl">System Prompt</div>
    <div id="rsb-prompt-presets" class="rsb-presets">
      <button class="rsb-pchip active" data-preset="default">Default</button>
      <button class="rsb-pchip" data-preset="creative">Creative</button>
      <button class="rsb-pchip" data-preset="code">Code</button>
      <button class="rsb-pchip" data-preset="precise">Precise</button>
    </div>
    <button class="rsb-edit-btn" id="btn-edit-prompt-sidebar">
      Edit System Prompt <span>→</span>
    </button>
  </div>

  <!-- Section 4: SYSTEM STATS -->
  <div class="rsb-sec">
    <div class="rsb-sec-lbl">System</div>
    <div class="rsb-stats">
      <div class="rsb-scard">
        <div class="rsb-scard-lbl">CPU</div>
        <div class="rsb-scard-val"><span id="rsb-cpu-val">—</span><span class="rsb-unit">%</span></div>
        <div class="rsb-sbar"><div id="rsb-cpu-bar" class="rsb-sbar-f rsb-green" style="width:0%"></div></div>
      </div>
      <div class="rsb-scard">
        <div class="rsb-scard-lbl">RAM</div>
        <div class="rsb-scard-val"><span id="rsb-ram-val">—</span><span class="rsb-unit">G</span></div>
        <div class="rsb-sbar"><div id="rsb-ram-bar" class="rsb-sbar-f rsb-indigo" style="width:0%"></div></div>
      </div>
      <div class="rsb-scard">
        <div class="rsb-scard-lbl">VRAM</div>
        <div class="rsb-scard-val"><span id="rsb-vram-val">—</span><span class="rsb-unit">G</span></div>
        <div class="rsb-sbar"><div id="rsb-vram-bar" class="rsb-sbar-f rsb-amber" style="width:0%"></div></div>
      </div>
    </div>
  </div>

  <!-- Section 5: CONTEXT WINDOW -->
  <div class="rsb-sec rsb-sec-last">
    <div class="rsb-sec-lbl">Context Window</div>
    <div class="rsb-ctx">
      <div id="rsb-ctx-ascii" class="rsb-ctx-ascii">░░░░░░░░░░░░░░░░░░░░</div>
      <div class="rsb-ctx-meta">
        <span id="rsb-ctx-tokens">0 / — tokens</span>
        <span id="rsb-ctx-pct" class="rsb-ctx-pct">0%</span>
      </div>
    </div>
  </div>

  <!-- Collapsed icon rail (shown when sidebar is collapsed) -->
  <div id="right-rail" class="rsb-rail hidden">
    <button class="toggle-btn" id="right-rail-toggle" aria-label="Expand sidebar">
      <svg width="12" height="12"><use href="#ico-left"/></svg>
    </button>
    <div class="rsb-rail-icon" title="Model">
      <svg width="15" height="15"><use href="#ico-model"/></svg>
    </div>
    <div class="rsb-rail-icon" title="Temperature">
      <svg width="15" height="15"><use href="#ico-temp"/></svg>
    </div>
    <div class="rsb-rail-icon" title="Memory">
      <svg width="15" height="15"><use href="#ico-memory"/></svg>
    </div>
    <div class="rsb-rail-icon" title="Settings">
      <svg width="15" height="15"><use href="#ico-settings"/></svg>
    </div>
  </div>

</div><!-- /right-sidebar -->
```

- [ ] **Step 2: Update system prompt modal HTML**

Find `#system-prompt-modal` in `index.html` (around line 149). Replace the preset profile chip buttons (`<button class="prompt-profile-chip">...`) with a profile tags container that JS will populate:

```html
<!-- REMOVE: all <button class="prompt-profile-chip"> elements -->
<!-- ADD after the textarea: -->
<div class="modal-profile-section">
  <div class="modal-sec-lbl">Load from profile</div>
  <div id="modal-profile-tags" class="modal-profile-tags">
    <!-- Populated by JS from user memory -->
  </div>
</div>
```

Preserve all other modal HTML unchanged: `#system-prompt-modal`, `#btn-close-prompt-modal`, `#system-prompt-modal-editor`, `#btn-modal-save-prompt`, `#btn-modal-reset-prompt`.

- [ ] **Step 3: Verify in DevTools**

Open DevTools, confirm all new IDs exist:
```javascript
['rsb-lights-pct','rsb-bulb-fill','rsb-cpu-val','rsb-ctx-ascii','rsb-model-chips',
 'btn-edit-prompt-sidebar','modal-profile-tags','mode-pills'].every(id =>
  document.getElementById(id) !== null
)
// Expected: true
```

- [ ] **Step 4: Commit**

```bash
git add app/templates/index.html
git commit -m "feat(html): right sidebar quick controls + mode pills + modal profile tags"
```

---

## Chunk 3: CSS Liquid Glass Styles

**Context:** Full visual rewrite of `app/static/css/app.css`. The existing file is large (2,000+ lines). The approach: keep the file structure but replace all visual rules with the new liquid glass system. Rules to preserve verbatim: `#voice-status-bar`, `.voice-status-bar`, `.voice-status-dot`, `.amber`, `.green`, `.voice-status-label`, `.voice-status-tag`, `.hidden`, `.wakeword-toggle-btn.preloading`, `.btn-danger` — the wakeword JS pipeline sets these classes directly.

Visual reference: `.superpowers/brainstorm/18519-1773247506/sidebar-redesign.html` (open in browser for exact colour reference).

### Task 6: Base styles — reset, typography, page background, glass recipe

**Files:**
- Modify: `app/static/css/app.css`

- [ ] **Step 1: Replace the CSS reset and `:root` block**

The new `:root` must define CSS variables for the glass system. Replace the existing `:root` block with:

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --font-ui: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;

  /* Glass panel */
  --glass-bg: linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.03) 100%);
  --glass-blur: blur(28px) saturate(160%);
  --glass-border: rgba(255,255,255,.12);
  --glass-border-top: rgba(255,255,255,.22);
  --glass-border-left: rgba(255,255,255,.15);
  --glass-shadow: 0 32px 80px rgba(0,0,0,.75), inset 0 1px 0 rgba(255,255,255,.18), inset 1px 0 0 rgba(255,255,255,.08);

  /* Accent colours */
  --indigo: #6366f1;
  --indigo-soft: rgba(99,102,241,.15);
  --indigo-border: rgba(99,102,241,.35);
  --green: #10b981;
  --amber: #f59e0b;
  --amber-soft: rgba(249,168,77,.15);

  /* Text */
  --text-primary: rgba(255,255,255,.9);
  --text-secondary: rgba(255,255,255,.55);
  --text-muted: rgba(255,255,255,.28);

  /* Backgrounds */
  --bg-dark: #080808;
  --card-bg: rgba(255,255,255,.05);
  --card-border: rgba(255,255,255,.08);
}

html, body {
  height: 100%;
  font-family: var(--font-ui);
  background:
    radial-gradient(ellipse at 12% 20%, rgba(99,102,241,.09) 0%, transparent 55%),
    radial-gradient(ellipse at 82% 72%, rgba(16,185,129,.06) 0%, transparent 50%),
    radial-gradient(ellipse at 55% 45%, rgba(249,115,22,.05) 0%, transparent 55%),
    var(--bg-dark);
  color: var(--text-primary);
  overflow: hidden;
}
```

- [ ] **Step 2: Add shell layout CSS**

```css
/* ── App shell ──────────────────── */
.app-shell {
  display: flex;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

/* ── Left sidebar ────────────────── */
.lsb {
  width: 216px;
  flex-shrink: 0;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-right: 1px solid var(--glass-border);
  border-right-color: var(--glass-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--glass-shadow);
  transition: width .2s ease;
}
.lsb.collapsed { width: 44px; }
.lsb-head {
  padding: 11px 10px 8px;
  border-bottom: 1px solid rgba(255,255,255,.07);
  display: flex; align-items: center; gap: 8px;
  flex-shrink: 0;
  background: rgba(255,255,255,.02);
}
.lsb-title {
  font-size: 12px; font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap; overflow: hidden;
}
.lsb.collapsed .lsb-title { display: none; }
.new-chat-btn {
  margin: 0 8px 8px;
  padding: 7px 10px;
  border-radius: 8px;
  background: rgba(255,255,255,.07);
  border: 1px solid rgba(255,255,255,.1);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.08);
  font-size: 11px; font-weight: 500;
  color: var(--text-secondary);
  display: flex; align-items: center; gap: 7px;
  white-space: nowrap; overflow: hidden;
  cursor: pointer;
}
.lsb.collapsed .new-chat-btn { padding: 8px; justify-content: center; }
.lsb.collapsed .new-chat-btn span { display: none; }
.sess-list {
  flex: 1; overflow-y: auto; overflow-x: hidden;
  padding: 0 6px;
  display: flex; flex-direction: column; gap: 2px;
}
.lsb.collapsed .sess-list { display: none; }
.sess-date {
  font-size: 8px; color: var(--text-muted);
  padding: 5px 6px 3px;
  text-transform: uppercase; letter-spacing: .07em;
}
.sess-item {
  padding: 6px 8px; border-radius: 6px;
  font-size: 10px; color: rgba(255,255,255,.4);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  cursor: pointer;
}
.sess-item.active {
  background: rgba(255,255,255,.08);
  color: rgba(255,255,255,.85);
}
.lsb-foot {
  padding: 9px 8px;
  border-top: 1px solid rgba(255,255,255,.06);
  flex-shrink: 0;
  display: flex; align-items: center; gap: 8px;
}
.lsb.collapsed .lsb-foot { justify-content: center; }
.status-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--green); flex-shrink: 0;
}
.status-txt {
  font-size: 9px; color: var(--text-muted);
  white-space: nowrap; overflow: hidden;
}
.lsb.collapsed .status-txt { display: none; }

/* ── Toggle button (shared) ──────── */
.toggle-btn {
  width: 22px; height: 22px; border-radius: 5px;
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.09);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.08);
  display: flex; align-items: center; justify-content: center;
  color: rgba(255,255,255,.35);
  cursor: pointer; flex-shrink: 0;
}

/* ── Main area ───────────────────── */
.main {
  flex: 1; display: flex; flex-direction: column;
  min-width: 0; position: relative;
}
.top-bar {
  padding: 9px 16px;
  border-bottom: 1px solid rgba(255,255,255,.06);
  display: flex; align-items: center; gap: 9px;
  flex-shrink: 0;
  background: rgba(5,5,5,.8);
  backdrop-filter: blur(20px);
}
.online-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--green); flex-shrink: 0;
}
.tb-model {
  font-size: 11px; color: rgba(255,255,255,.45);
}
.tb-sess {
  font-size: 11px; color: var(--text-muted);
}
.tb-spacer { flex: 1; }
.tb-btn {
  width: 26px; height: 26px; border-radius: 7px;
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.08);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.08);
  display: flex; align-items: center; justify-content: center;
  color: rgba(255,255,255,.35); cursor: pointer;
}
.chat-zone {
  flex: 1; overflow-y: auto; overflow-x: hidden;
  display: flex; justify-content: center;
  padding: 16px 18px 10px;
}
.chat-inner {
  width: 100%; max-width: 600px;
  display: flex; flex-direction: column; gap: 10px;
}
.input-zone {
  padding: 8px 18px 12px;
  flex-shrink: 0;
  display: flex; justify-content: center;
}
.input-inner {
  width: 100%; max-width: 600px;
  display: flex; flex-direction: column; gap: 5px;
}
```

- [ ] **Step 3: Verify layout renders**

Start server, open browser. Expected: three-column layout visible (narrow left bar, wide center, narrow right bar). Top bar present.

- [ ] **Step 4: Commit**

```bash
git add app/static/css/app.css
git commit -m "feat(css): base glass styles, shell layout, left sidebar"
```

---

### Task 7: CSS — chat messages, action cards, input area, mode pills

**Files:**
- Modify: `app/static/css/app.css`

- [ ] **Step 1: Add chat message styles**

```css
/* ── Chat messages (prose, no bubbles) ─── */
.msg-row {
  display: flex; gap: 8px; align-items: flex-end;
}
.msg-row.user { flex-direction: row-reverse; }
.msg-avatar {
  width: 22px; height: 22px; border-radius: 50%;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 9px; font-weight: 600;
}
.msg-avatar.ai {
  background: rgba(99,102,241,.2);
  color: #a5b4fc;
  border: 1px solid rgba(99,102,241,.2);
}
.msg-avatar.user {
  background: rgba(255,255,255,.1);
  color: rgba(255,255,255,.7);
  border: 1px solid rgba(255,255,255,.12);
}
.msg-body {
  display: flex; flex-direction: column; gap: 2px;
  max-width: 72%;
}
.msg-row.user .msg-body { align-items: flex-end; }
.msg-row.ai  .msg-body { align-items: flex-start; }
.msg-name {
  font-size: 8px; font-weight: 600;
  text-transform: uppercase; letter-spacing: .05em;
  padding: 0 3px;
}
.msg-row.user .msg-name { color: rgba(255,255,255,.2); }
.msg-row.ai  .msg-name { color: rgba(99,102,241,.5); }
.msg-text {
  font-size: 13px; line-height: 1.5;
}
.msg-row.user .msg-text { color: rgba(255,255,255,.9); }
.msg-row.ai  .msg-text { color: rgba(255,255,255,.7); }

/* ── Action cards (tool results) ─── */
.action-card {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 12px;
  border-radius: 0 8px 8px 0;
  font-size: 11px;
  max-width: 360px;
}
.action-card.home {
  background: rgba(16,185,129,.07);
  border: 1px solid rgba(16,185,129,.18);
  border-left: 3px solid var(--green);
  color: #6ee7b7;
}
.action-card.memory {
  background: rgba(99,102,241,.07);
  border: 1px solid rgba(99,102,241,.18);
  border-left: 3px solid var(--indigo);
  color: #a5b4fc;
}
.action-card-title { font-weight: 600; }
.action-card-sub   { font-size: 9px; opacity: .5; margin-top: 1px; }
```

- [ ] **Step 2: Add input area + voice status bar + mode pill styles**

```css
/* ── Voice status bar (restyle only — preserve .amber/.green) ─── */
.voice-status-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 12px;
  background: rgba(15,15,15,.5);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 100px;
}
.voice-status-bar.hidden { display: none; }
.voice-status-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #3f3f46; flex-shrink: 0;
}
.voice-status-label {
  flex: 1; font-size: 10px; color: #71717a;
}
.voice-status-tag {
  font-size: 8px; color: #3f3f46;
  text-transform: uppercase; letter-spacing: .06em;
}
/* amber state (listening) */
.voice-status-bar.amber .voice-status-dot { background: var(--amber); box-shadow: 0 0 6px rgba(245,158,11,.5); }
.voice-status-bar.amber .voice-status-label { color: #fcd34d; }
.voice-status-bar.amber .voice-status-tag { color: rgba(245,158,11,.6); }
/* green state (done) */
.voice-status-bar.green .voice-status-dot { background: var(--green); box-shadow: 0 0 6px rgba(16,185,129,.5); }
.voice-status-bar.green .voice-status-label { color: #6ee7b7; }
.voice-status-bar.green .voice-status-tag { color: rgba(16,185,129,.6); }

/* ── Mode pills ──────────────────── */
.mode-pills { display: flex; gap: 4px; }
.mode-pill {
  padding: 4px 10px; border-radius: 100px;
  font-size: 9px; font-weight: 500;
  background: rgba(255,255,255,.03);
  border: 1px solid rgba(255,255,255,.08);
  color: rgba(255,255,255,.3);
  display: flex; align-items: center; gap: 5px;
  cursor: pointer; transition: all .15s;
}
.mode-pill.active {
  background: rgba(245,158,11,.12);
  border-color: rgba(245,158,11,.3);
  color: #fcd34d;
  box-shadow: 0 0 8px rgba(245,158,11,.1);
}
.mode-pill.active svg { color: #fcd34d; }

/* ── Input row ───────────────────── */
.input-row {
  display: flex; align-items: center; gap: 7px;
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.09);
  border-top-color: rgba(255,255,255,.13);
  border-radius: 100px;
  padding: 7px 10px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.07);
}
.voice-mic-btn, .wakeword-toggle-btn {
  width: 26px; height: 26px; border-radius: 50%;
  background: rgba(255,255,255,.07);
  border: 1px solid rgba(255,255,255,.09);
  display: flex; align-items: center; justify-content: center;
  color: rgba(255,255,255,.4); cursor: pointer;
  flex-shrink: 0;
}
#prompt {
  flex: 1; background: none; border: none; outline: none;
  font-family: var(--font-ui); font-size: 13px;
  color: var(--text-primary); resize: none; line-height: 1.4;
}
#prompt::placeholder { color: rgba(255,255,255,.2); }
.send-btn {
  padding: 5px 14px; border-radius: 100px;
  background: rgba(255,255,255,.1);
  border: 1px solid rgba(255,255,255,.12);
  font-size: 10px; font-weight: 600;
  color: rgba(255,255,255,.5);
  letter-spacing: .04em; cursor: pointer;
}
```

- [ ] **Step 3: Verify**

Open browser. Expected: mode pills visible above input row; input row is pill-shaped; voice status bar hidden (`.hidden`).

- [ ] **Step 4: Commit**

```bash
git add app/static/css/app.css
git commit -m "feat(css): chat messages, action cards, input area, mode pills"
```

---

### Task 8: CSS — right sidebar + system prompt modal

**Files:**
- Modify: `app/static/css/app.css`

- [ ] **Step 1: Add right sidebar glass panel styles**

```css
/* ── Right sidebar ───────────────── */
.rsb {
  width: 252px; flex-shrink: 0;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-left: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: var(--glass-shadow);
  transition: width .2s ease;
}
.rsb.collapsed { width: 44px; }
.rsb-head {
  padding: 11px 13px 10px;
  border-bottom: 1px solid rgba(255,255,255,.07);
  display: flex; align-items: center; gap: 8px;
  background: rgba(255,255,255,.02); flex-shrink: 0;
}
.rsb-title { font-size: 11px; font-weight: 600; color: var(--text-secondary); flex: 1; white-space: nowrap; }
.rsb.collapsed .rsb-title { display: none; }
.rsb-sec {
  padding: 11px 13px;
  border-bottom: 1px solid rgba(255,255,255,.05);
  display: flex; flex-direction: column; gap: 8px;
}
.rsb-sec-last { border-bottom: none; }
.rsb.collapsed .rsb-sec { display: none; }
.rsb-sec-lbl {
  font-size: 7.5px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .1em;
  color: rgba(255,255,255,.25);
  display: flex; align-items: center; gap: 5px;
}

/* Lights */
.rsb-light-name { font-size: 11px; font-weight: 600; color: rgba(255,255,255,.78); display: flex; align-items: center; justify-content: space-between; }
.ltoggle { width: 28px; height: 16px; border-radius: 100px; background: rgba(255,255,255,.12); position: relative; border: none; cursor: pointer; transition: background .2s; }
.ltoggle.on { background: linear-gradient(135deg, rgba(251,191,36,.9), rgba(245,158,11,.8)); box-shadow: 0 0 8px rgba(251,191,36,.3); }
.ltoggle-k { position: absolute; right: 2px; top: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.5); transition: right .2s; }
.ltoggle:not(.on) .ltoggle-k { right: auto; left: 2px; }
.rsb-l-pct { text-align: center; font-size: 26px; font-weight: 700; color: rgba(255,255,255,.92); letter-spacing: -.03em; line-height: 1; font-variant-numeric: tabular-nums; }
.rsb-l-ago { text-align: center; font-size: 9px; color: var(--text-muted); }
.rsb-bulb-outer { display: flex; justify-content: center; }
.rsb-bulb { width: 78px; height: 130px; border-radius: 22px; overflow: hidden; border: 1.5px solid rgba(249,168,77,.35); position: relative; background: #0c0c0c; box-shadow: 0 0 24px rgba(249,168,77,.1); }
.rsb-bulb-fill { position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(180deg, rgba(249,168,77,.38) 0%, rgba(249,115,22,.88) 100%); box-shadow: 0 -4px 12px rgba(249,168,77,.35) inset; transition: height .4s ease; }
.rsb-bulb-line { position: absolute; left: 18%; right: 18%; height: 1.5px; background: rgba(255,255,255,.65); border-radius: 1px; }
.rsb-l-ctrls { display: flex; justify-content: center; gap: 6px; }
.rsb-lbtn { width: 32px; height: 32px; border-radius: 50%; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.09); box-shadow: inset 0 1px 0 rgba(255,255,255,.1); display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,.45); cursor: pointer; }
.rsb-lbtn.active { background: var(--amber-soft); border-color: rgba(249,168,77,.4); box-shadow: 0 0 10px rgba(249,168,77,.2), inset 0 1px 0 rgba(255,255,255,.12); color: #fbbf24; }
.rsb-swatches { display: flex; gap: 5px; justify-content: center; flex-wrap: wrap; padding: 0 4px; }
.rsb-sw { width: 17px; height: 17px; border-radius: 50%; flex-shrink: 0; cursor: pointer; border: 2px solid transparent; transition: transform .1s; }
.rsb-sw.sel { border-color: rgba(255,255,255,.7); transform: scale(1.1); }

/* Model */
.rsb-model-drop { background: var(--card-bg); border: 1px solid var(--card-border); border-top-color: rgba(255,255,255,.14); border-radius: 8px; padding: 8px 10px; display: flex; align-items: center; justify-content: space-between; box-shadow: inset 0 1px 0 rgba(255,255,255,.08); }
.rsb-model-name { font-size: 11px; color: rgba(255,255,255,.82); font-weight: 500; }
.rsb-model-st { font-size: 8px; font-weight: 600; letter-spacing: .05em; margin-top: 1px; }
.rsb-model-st.online { color: #34d399; }
.rsb-model-st.offline { color: rgba(255,255,255,.25); }
.rsb-model-arr { font-size: 11px; color: rgba(255,255,255,.28); }
.rsb-model-chips { display: flex; gap: 4px; flex-wrap: wrap; }
.rsb-mchip { padding: 4px 9px; border-radius: 5px; font-size: 9px; font-weight: 500; background: var(--card-bg); border: 1px solid var(--card-border); color: rgba(255,255,255,.4); cursor: pointer; }
.rsb-mchip.active { background: var(--indigo-soft); border-color: var(--indigo-border); color: #c7d2fe; }

/* System prompt */
.rsb-presets { display: flex; gap: 4px; flex-wrap: wrap; }
.rsb-pchip { padding: 4px 10px; border-radius: 100px; font-size: 9px; font-weight: 600; background: var(--card-bg); border: 1px solid var(--card-border); color: rgba(255,255,255,.4); cursor: pointer; }
.rsb-pchip.active { background: var(--indigo-soft); border-color: var(--indigo-border); color: #a5b4fc; }
.rsb-edit-btn { display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; border-radius: 8px; background: var(--card-bg); border: 1px solid var(--card-border); border-top-color: rgba(255,255,255,.12); font-size: 10px; color: rgba(255,255,255,.48); cursor: pointer; }

/* Stats */
.rsb-stats { display: grid; grid-template-columns: repeat(3,1fr); gap: 5px; }
.rsb-scard { background: var(--card-bg); border: 1px solid var(--card-border); border-top-color: rgba(255,255,255,.14); border-radius: 8px; padding: 7px 6px; display: flex; flex-direction: column; gap: 3px; box-shadow: inset 0 1px 0 rgba(255,255,255,.1); }
.rsb-scard-lbl { font-size: 7px; font-weight: 700; text-transform: uppercase; letter-spacing: .09em; color: rgba(255,255,255,.28); }
.rsb-scard-val { font-size: 17px; font-weight: 700; color: var(--text-primary); line-height: 1; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.rsb-unit { font-size: 8px; color: rgba(255,255,255,.35); font-weight: 400; }
.rsb-sbar { height: 2px; background: rgba(255,255,255,.08); border-radius: 1px; overflow: hidden; margin-top: 3px; }
.rsb-sbar-f { height: 100%; border-radius: 1px; transition: width .5s ease; }
.rsb-green  { background: linear-gradient(90deg,#10b981,#34d399); }
.rsb-indigo { background: linear-gradient(90deg,#6366f1,#818cf8); }
.rsb-amber  { background: linear-gradient(90deg,#f59e0b,#fbbf24); }

/* Context */
.rsb-ctx { background: var(--card-bg); border: 1px solid var(--card-border); border-top-color: rgba(255,255,255,.13); border-radius: 8px; padding: 9px 10px; display: flex; flex-direction: column; gap: 5px; box-shadow: inset 0 1px 0 rgba(255,255,255,.08); }
.rsb-ctx-ascii { font-family: var(--font-mono); font-size: 12px; color: #818cf8; letter-spacing: .01em; text-shadow: 0 0 8px rgba(129,140,248,.4); }
.rsb-ctx-meta { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 9px; color: var(--text-muted); }
.rsb-ctx-pct { color: #818cf8; font-weight: 600; }

/* Collapsed rail */
.rsb-rail { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 0 8px; }
.rsb-rail.hidden { display: none; }
.rsb-rail-icon { width: 28px; height: 28px; border-radius: 8px; background: var(--card-bg); border: 1px solid var(--card-border); display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,.4); }
```

- [ ] **Step 2: Add system prompt modal styles**

```css
/* ── System prompt modal ────────── */
.modal-overlay {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0,0,0,.55);
  backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
}
.modal-overlay.hidden { display: none; }
.modal-dialog {
  background: linear-gradient(160deg,rgba(255,255,255,.07) 0%,rgba(255,255,255,.02) 100%);
  backdrop-filter: blur(44px) saturate(180%);
  border: 1px solid rgba(255,255,255,.14);
  border-top-color: rgba(255,255,255,.28);
  border-radius: 16px;
  width: 460px; overflow: hidden;
  box-shadow: 0 40px 100px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,255,255,.22);
}
.modal-header {
  padding: 15px 16px 12px;
  border-bottom: 1px solid rgba(255,255,255,.08);
  display: flex; align-items: center; gap: 10px;
  background: rgba(255,255,255,.03);
}
.modal-header h2 { font-size: 13px; font-weight: 600; flex: 1; }
.modal-close {
  width: 22px; height: 22px; border-radius: 6px;
  background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.12);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: rgba(255,255,255,.45); cursor: pointer;
}
.modal-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.modal-textarea {
  background: rgba(0,0,0,.25); border: 1px solid rgba(255,255,255,.1);
  border-top-color: rgba(255,255,255,.06);
  border-radius: 9px; padding: 10px 12px;
  font-family: var(--font-mono); font-size: 10px; line-height: 1.65;
  color: rgba(255,255,255,.65); resize: vertical;
  box-shadow: inset 0 2px 8px rgba(0,0,0,.3);
}
.modal-sec-lbl { font-size: 7.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: rgba(255,255,255,.25); margin-bottom: 6px; }
.modal-profile-tags { display: flex; gap: 5px; flex-wrap: wrap; }
.modal-profile-tag {
  padding: 4px 10px; border-radius: 100px;
  font-size: 9px; font-weight: 600;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
  color: rgba(255,255,255,.45); cursor: pointer;
}
.modal-profile-tag.active { background: rgba(99,102,241,.2); border-color: rgba(99,102,241,.45); color: #c7d2fe; }
.modal-footer {
  padding: 10px 16px 14px;
  border-top: 1px solid rgba(255,255,255,.07);
  display: flex; align-items: center; gap: 8px;
  background: rgba(0,0,0,.1);
}
.modal-footer-note { font-size: 9px; color: rgba(255,255,255,.2); flex: 1; }
.modal-btn-secondary {
  padding: 7px 16px; border-radius: 7px; font-size: 11px; font-weight: 500;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
  color: rgba(255,255,255,.45); cursor: pointer;
}
.modal-btn-primary {
  padding: 7px 16px; border-radius: 7px; font-size: 11px; font-weight: 600;
  background: linear-gradient(135deg,rgba(129,140,248,.9),rgba(99,102,241,.85));
  border: 1px solid rgba(99,102,241,.5); border-top-color: rgba(165,180,252,.4);
  box-shadow: 0 4px 14px rgba(99,102,241,.3), inset 0 1px 0 rgba(255,255,255,.2);
  color: #fff; cursor: pointer;
}
```

- [ ] **Step 3: Final visual check**

Open browser. Verify:
- Sidebar renders with frosted glass look (backdrop-filter visible against page background)
- Lights section shows bulb container
- Stats grid shows 3 equal-width cards
- System prompt modal (open via `document.getElementById('system-prompt-modal').classList.remove('hidden')`) looks polished

- [ ] **Step 4: Commit**

```bash
git add app/static/css/app.css
git commit -m "feat(css): right sidebar glass styles + system prompt modal"
```

---

## Chunk 4: JS Wiring

**Context:** `app/static/js/app.js` is 5,683 lines. Do NOT rewrite it. Make targeted additions only.

Key existing code to know:
- `els` object: lines 1507–1567 (DOM element cache)
- `toolsUI` IIFE: lines 1771–1870+
- `voiceStatusBar` IIFE: lines 1572–1621
- Send path reads `toolsUI`: line 4150 (`isAssistMode`), line 4178 (`getSelectedTools`)
- System prompt modal: lines 4481–4572
- Tutorial gate: lines 768–790 and 3052–3072 — **DO NOT TOUCH**

---

### Task 9: Mode pills — replace toolsUI chip/modal UX

**Files:**
- Modify: `app/static/js/app.js`

The pills (`#pill-web`, `#pill-home`, `#pill-upload`, `#pill-remember`) must feed the exact same `ChatRequest` fields as `toolsUI.selectedTools` did. The send-path code at lines 4150 and 4178 reads from `toolsUI` — we'll keep those reads but update `toolsUI.selectedTools` to mirror pill state, so the send path requires zero changes.

- [ ] **Step 1: Add `modePills` IIFE to `app.js`**

Find the end of the `toolsUI` IIFE (around line 1870). Add the following **after** the `toolsUI` closing `})()`:

```javascript
// ── modePills — Mode pill toggles (replaces toolsUI chip/modal UX) ──────────
const modePills = (() => {
  const PILL_TO_TOOL = {
    'web_search':   'web_search',
    'assist_mode':  'assist_mode',
    'rag_upload':   null,           // triggers file picker, no mode flag
    'memory_write': 'memory_write',
  };

  function _syncToToolsUI() {
    // Mirror pill state into toolsUI.selectedTools so the send path at line ~4150
    // continues to work without modification.
    toolsUI.selectedTools.clear();
    document.querySelectorAll('.mode-pill.active').forEach(pill => {
      const tool = pill.dataset.tool;
      if (PILL_TO_TOOL[tool]) toolsUI.selectedTools.add(PILL_TO_TOOL[tool]);
    });
  }

  function _togglePill(pillEl) {
    const tool = pillEl.dataset.tool;
    if (tool === 'rag_upload') {
      // Don't toggle — just open file picker
      const fi = document.getElementById('from-file-input');
      if (fi) fi.click();
      return;
    }
    pillEl.classList.toggle('active');
    _syncToToolsUI();
  }

  function init() {
    document.querySelectorAll('.mode-pill').forEach(pill => {
      pill.addEventListener('click', () => _togglePill(pill));
    });

    // Restore sticky tools from toolsUI into pill state on init
    if (toolsUI.stickyTools.has('assist_mode')) {
      const p = document.getElementById('pill-home');
      if (p) p.classList.add('active');
    }
    if (toolsUI.stickyTools.has('web_search')) {
      const p = document.getElementById('pill-web');
      if (p) p.classList.add('active');
    }
    _syncToToolsUI();
  }

  return { init };
})();
```

- [ ] **Step 2: Call `modePills.init()` in `startApp()`**

Find `startApp()` or the equivalent initialisation function that calls `toolsUI.init()`. Add `modePills.init()` on the next line after `toolsUI.init()`:

```javascript
toolsUI.init();
modePills.init();  // ← add this line
```

- [ ] **Step 3: Update `els` object with new element references**

In the `els` object (lines 1507–1567), add new entries for the sidebar elements. Find the closing `};` of the `els` object and add before it:

```javascript
  // New elements — right sidebar quick controls
  rsbLightsName:   document.getElementById('rsb-lights-name'),
  rsbLightsToggle: document.getElementById('rsb-lights-toggle'),
  rsbLightsPct:    document.getElementById('rsb-lights-pct'),
  rsbLightsAgo:    document.getElementById('rsb-lights-ago'),
  rsbBulbFill:     document.getElementById('rsb-bulb-fill'),
  rsbBulbLine:     document.getElementById('rsb-bulb-line'),
  rsbModelName:    document.getElementById('rsb-model-name'),
  rsbModelStatus:  document.getElementById('rsb-model-status'),
  rsbModelChips:   document.getElementById('rsb-model-chips'),
  rsbCpuVal:       document.getElementById('rsb-cpu-val'),
  rsbCpuBar:       document.getElementById('rsb-cpu-bar'),
  rsbRamVal:       document.getElementById('rsb-ram-val'),
  rsbRamBar:       document.getElementById('rsb-ram-bar'),
  rsbVramVal:      document.getElementById('rsb-vram-val'),
  rsbVramBar:      document.getElementById('rsb-vram-bar'),
  rsbCtxAscii:     document.getElementById('rsb-ctx-ascii'),
  rsbCtxTokens:    document.getElementById('rsb-ctx-tokens'),
  rsbCtxPct:       document.getElementById('rsb-ctx-pct'),
  modalProfileTags:document.getElementById('modal-profile-tags'),
  btnEditPromptSidebar: document.getElementById('btn-edit-prompt-sidebar'),
  // Sidebar collapse toggles
  leftSidebarToggle:  document.getElementById('left-sidebar-toggle'),
  rightSidebarToggle: document.getElementById('right-sidebar-toggle'),
```

- [ ] **Step 4: Smoke test — send still works**

Start server, load a model, send a message. Verify:
- Chat response arrives
- With "Home" pill active: message goes through assist mode (check console for "assist" log)
- With "Home" pill inactive: message goes through normal LLM path

- [ ] **Step 5: Commit**

```bash
git add app/static/js/app.js
git commit -m "feat(js): modePills IIFE replaces toolsUI chip/modal UX"
```

---

### Task 10: Right sidebar collapse toggles

**Files:**
- Modify: `app/static/js/app.js`

- [ ] **Step 1: Add collapse/expand logic after `modePills`**

```javascript
// ── Sidebar collapse toggles ─────────────────────────────────────────────────
(function initSidebarToggles() {
  const lsb = document.getElementById('left-sidebar');
  const rsb = document.getElementById('right-sidebar');
  const rsbRail = document.getElementById('right-rail');

  function toggleLeft() {
    if (!lsb) return;
    const collapsed = lsb.classList.toggle('collapsed');
    const btn = document.getElementById('left-sidebar-toggle');
    if (btn) btn.querySelector('use').setAttribute('href', collapsed ? '#ico-right' : '#ico-left');
  }

  function toggleRight() {
    if (!rsb) return;
    const collapsed = rsb.classList.toggle('collapsed');
    if (rsbRail) rsbRail.classList.toggle('hidden', !collapsed);
    const btn = document.getElementById('right-sidebar-toggle');
    if (btn) btn.querySelector('use').setAttribute('href', collapsed ? '#ico-left' : '#ico-right');
  }

  const lBtn = document.getElementById('left-sidebar-toggle');
  const rBtn = document.getElementById('right-sidebar-toggle');
  const rRailBtn = document.getElementById('right-rail-toggle');
  if (lBtn) lBtn.addEventListener('click', toggleLeft);
  if (rBtn) rBtn.addEventListener('click', toggleRight);
  if (rRailBtn) rRailBtn.addEventListener('click', toggleRight);
})();
```

- [ ] **Step 2: Verify toggles**

Click left sidebar toggle — sidebar should animate to 44px wide, titles/list hidden. Click again — expands. Same for right sidebar.

- [ ] **Step 3: Commit**

```bash
git add app/static/js/app.js
git commit -m "feat(js): sidebar collapse/expand toggles"
```

---

### Task 11: Right sidebar — lights polling

**Files:**
- Modify: `app/static/js/app.js`

- [ ] **Step 1: Add `rsbLights` IIFE**

Add after the sidebar toggles code:

```javascript
// ── rsbLights — Right sidebar lights control ─────────────────────────────────
const rsbLights = (() => {
  let _pollTimer = null;

  function _msSince(isoStr) {
    if (!isoStr) return '';
    const diff = Math.round((Date.now() - new Date(isoStr).getTime()) / 1000);
    if (diff < 60)  return `${diff} seconds ago`;
    if (diff < 3600) return `${Math.round(diff/60)} minutes ago`;
    return `${Math.round(diff/3600)} hours ago`;
  }

  async function _refresh() {
    try {
      const data = await fetch('/assist/light_state').then(r => r.json());
      if (data.error) { _showUnavailable(); return; }

      const pct = data.brightness_pct ?? 0;
      const isOn = data.state === 'on';

      if (els.rsbLightsPct) els.rsbLightsPct.textContent = isOn ? `${pct}%` : 'Off';
      if (els.rsbLightsAgo) els.rsbLightsAgo.textContent = _msSince(data.last_changed);

      // Bulb fill
      if (els.rsbBulbFill) els.rsbBulbFill.style.height = isOn ? `${pct}%` : '0%';
      if (els.rsbBulbLine) els.rsbBulbLine.style.bottom = `calc(${isOn ? pct : 0}% + 5px)`;

      // Toggle state
      const toggle = els.rsbLightsToggle;
      if (toggle) toggle.classList.toggle('on', isOn);
    } catch (_) {
      _showUnavailable();
    }
  }

  function _showUnavailable() {
    if (els.rsbLightsPct) els.rsbLightsPct.textContent = '—';
    if (els.rsbLightsAgo) els.rsbLightsAgo.textContent = 'HA unavailable';
  }

  function start() {
    _refresh();
    _pollTimer = setInterval(_refresh, 5000);
  }

  function stop() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  return { start, stop };
})();
```

- [ ] **Step 2: Wire the lights toggle button**

Add an event listener to call the HA toggle service when the user clicks the toggle:

```javascript
if (els.rsbLightsToggle) {
  els.rsbLightsToggle.addEventListener('click', async () => {
    try {
      await fetch('/assist/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'toggle the light',
          session_id: state.sessionId || 'sidebar',
        }),
      });
      setTimeout(() => rsbLights._refresh?.(), 600); // re-poll after toggle
    } catch (_) {}
  });
}
```

- [ ] **Step 3: Start polling in `startApp()`**

Find `startApp()`. After `modePills.init()` add:

```javascript
rsbLights.start();
```

- [ ] **Step 4: Verify**

With server running and HA configured, the bulb fill should update to match the real light state within 5 seconds.

- [ ] **Step 5: Commit**

```bash
git add app/static/js/app.js
git commit -m "feat(js): right sidebar lights polling + toggle wiring"
```

---

### Task 12: Right sidebar — stats polling + context bar

**Files:**
- Modify: `app/static/js/app.js`

- [ ] **Step 1: Add `rsbStats` IIFE**

```javascript
// ── rsbStats — System stats + context bar polling ───────────────────────────
const rsbStats = (() => {
  let _statsTimer = null;

  function _ascii(pct, len = 20) {
    const filled = Math.round(pct / 100 * len);
    return '█'.repeat(filled) + '░'.repeat(len - filled);
  }

  async function _refreshStats() {
    try {
      const d = await fetch('/api/system-stats').then(r => r.json());
      if (els.rsbCpuVal) els.rsbCpuVal.textContent = Math.round(d.cpu_pct);
      if (els.rsbCpuBar) els.rsbCpuBar.style.width = `${d.cpu_pct}%`;
      if (els.rsbRamVal) els.rsbRamVal.textContent = d.ram_used_gb;
      if (els.rsbRamBar) els.rsbRamBar.style.width = `${Math.round(d.ram_used_gb / d.ram_total_gb * 100)}%`;
      if (els.rsbVramVal) els.rsbVramVal.textContent = d.vram_used_gb;
      if (d.vram_total_gb > 0 && els.rsbVramBar) {
        const vPct = Math.round(d.vram_used_gb / d.vram_total_gb * 100);
        els.rsbVramBar.style.width = `${vPct}%`;
        // Amber warning at >80%
        els.rsbVramBar.classList.toggle('rsb-amber', vPct > 80);
        els.rsbVramBar.classList.toggle('rsb-indigo', vPct <= 80);
      }
    } catch (_) {}
  }

  function updateContextBar() {
    // Token estimate from conversation history characters
    const nCtx = state.nCtx || 8192;
    const history = state.conversationHistory || [];
    const totalChars = history.reduce((s, m) => s + (m.content?.length || 0), 0);
    const tokenEst = Math.ceil(totalChars / 4);
    const pct = Math.min(100, Math.round(tokenEst / nCtx * 100));

    if (els.rsbCtxAscii) els.rsbCtxAscii.textContent = _ascii(pct);
    if (els.rsbCtxTokens) {
      const used = tokenEst.toLocaleString();
      const max = nCtx.toLocaleString();
      els.rsbCtxTokens.textContent = `${used} / ${max} tokens`;
    }
    if (els.rsbCtxPct) els.rsbCtxPct.textContent = `${pct}%`;
  }

  function start() {
    _refreshStats();
    _statsTimer = setInterval(_refreshStats, 3000);
  }

  function stop() {
    if (_statsTimer) { clearInterval(_statsTimer); _statsTimer = null; }
  }

  return { start, stop, updateContextBar };
})();
```

- [ ] **Step 2: Start stats polling and wire context updates**

In `startApp()` add after `rsbLights.start()`:

```javascript
rsbStats.start();
```

Find where messages are added to `state.conversationHistory` (search for `conversationHistory.push`). On the line after each push, add:

```javascript
rsbStats.updateContextBar();
```

- [ ] **Step 3: Verify**

Open app. Stats cards should show real CPU/RAM/VRAM values updating every 3 seconds. Send a message — context bar should fill proportionally.

- [ ] **Step 4: Commit**

```bash
git add app/static/js/app.js
git commit -m "feat(js): stats polling + ASCII context bar"
```

---

### Task 13: System prompt modal — new trigger + dynamic profile tags

**Files:**
- Modify: `app/static/js/app.js`

- [ ] **Step 1: Wire new sidebar "Edit System Prompt" button**

Find the system prompt modal section in `app.js` (around line 4482, `openSystemPromptModal` function). Add a new click listener for the sidebar button:

```javascript
// Wire sidebar "Edit System Prompt" button to existing modal open function
if (els.btnEditPromptSidebar) {
  els.btnEditPromptSidebar.addEventListener('click', openSystemPromptModal);
}
```

Add this immediately after the existing open-modal button listener (around line 4500).

- [ ] **Step 2: Add profile tags population function**

Add a new function `populateModalProfileTags()` after the `closeSystemPromptModal` function (around line 4496):

```javascript
function populateModalProfileTags() {
  if (!els.modalProfileTags) return;

  // Profile → prompt template mapping
  const PROFILES = {
    '🏠 Home Control': 'You are Jarvis, a smart home AI assistant. Prioritise interpreting commands as home control actions. Confirm device actions clearly.',
    'हि Hinglish': 'You are Jarvis. Respond naturally in the same language the user writes in — mix Hindi and English freely (Hinglish). Be conversational and warm.',
    '🌙 Night Owl': 'You are Jarvis. Keep responses brief and low-key. The user is likely relaxing or winding down — match that energy.',
    '⚡ Tech Mode': 'You are Jarvis, a technical AI assistant. Prioritise accuracy, include relevant details, use correct terminology. Assume the user is technically capable.',
    '💻 Coding': 'You are Jarvis, a coding assistant. Provide working code with concise explanations. Prefer minimal, idiomatic solutions.',
  };

  // Build tags from memory Tier-B + fixed set
  const tags = Object.keys(PROFILES);

  els.modalProfileTags.innerHTML = '';
  tags.forEach(label => {
    const btn = document.createElement('button');
    btn.className = 'modal-profile-tag';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      // Deactivate all, activate clicked
      els.modalProfileTags.querySelectorAll('.modal-profile-tag').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Populate textarea
      const editor = document.getElementById('system-prompt-modal-editor');
      if (editor) {
        editor.value = PROFILES[label];
        editor.dispatchEvent(new Event('input'));
      }
    });
    els.modalProfileTags.appendChild(btn);
  });
}
```

- [ ] **Step 3: Call `populateModalProfileTags()` when modal opens**

Find `openSystemPromptModal()` (around line 4482). At the end of the function body, add:

```javascript
populateModalProfileTags();
```

- [ ] **Step 4: Preset chips in right sidebar**

Find where `#rsb-prompt-presets` chips should do something. Add after the sidebar toggles wiring:

```javascript
// Right sidebar system prompt preset chips
document.querySelectorAll('#rsb-prompt-presets .rsb-pchip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#rsb-prompt-presets .rsb-pchip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    // Apply preset to the live system prompt editor (if accessible)
    const editor = document.getElementById('system-prompt-modal-editor');
    if (!editor) return;
    const PRESETS = {
      default:   '',  // empty = uses server default
      creative:  'You are Jarvis, a creative AI assistant. Embrace imaginative thinking, explore unconventional angles, and write with personality and flair.',
      code:      'You are Jarvis, a coding assistant. Provide working, minimal, idiomatic code. Explain only when the logic is non-obvious.',
      precise:   'You are Jarvis, a precise AI assistant. Prioritise factual accuracy. Cite uncertainty. Avoid speculation. Be concise.',
    };
    const preset = chip.dataset.preset;
    if (preset in PRESETS) {
      editor.value = PRESETS[preset];
      // Auto-save
      api.saveSystemPrompt?.();
    }
  });
});
```

- [ ] **Step 5: Test**

1. Click "Edit System Prompt →" in right sidebar → modal opens
2. Profile tags render below textarea
3. Click "🏠 Home Control" → textarea fills with home control prompt
4. Click "Code" preset chip in sidebar → applies code preset
5. Modal Save → system prompt persists

- [ ] **Step 6: Commit**

```bash
git add app/static/js/app.js
git commit -m "feat(js): system prompt modal sidebar trigger + dynamic profile tags"
```

---

### Task 14: Chat message rendering — prose layout with avatars

**Files:**
- Modify: `app/static/js/app.js`

The existing `renderMessage()` function (search for `function renderMessage` or `appendMessage`) appends chat messages to `#chat-history`. Update it to output the new prose layout with avatars.

- [ ] **Step 1: Find the existing message render function**

Search `app.js` for: `function renderMessage`, `appendMessage`, or `addMessage`. Note the exact function name and line number.

- [ ] **Step 2: Replace the message HTML template**

Inside the render function, replace the part that builds the message HTML. The new template is:

```javascript
function buildMessageHTML(role, text, name) {
  const isUser = role === 'user';
  const avatarClass = isUser ? 'user' : 'ai';
  const rowClass = isUser ? 'user' : 'ai';
  const initial = isUser ? (state.userName?.[0]?.toUpperCase() || 'U') : 'J';
  const displayName = isUser ? (state.userName || 'You') : 'Jarvis';
  return `
    <div class="msg-row ${rowClass}">
      <div class="msg-avatar ${avatarClass}">${initial}</div>
      <div class="msg-body">
        <div class="msg-name">${displayName}</div>
        <div class="msg-text">${text}</div>
      </div>
    </div>`;
}
```

Where `state.userName` should be derived from the Tier-A `name` memory key (already loaded during app init into `state`).

- [ ] **Step 3: Add action card rendering**

Add a helper that renders a tool result as an action card:

```javascript
function buildActionCardHTML(type, title, subtitle) {
  const cardClass = type === 'home' ? 'home' : 'memory';
  const iconId = type === 'home' ? 'ico-home' : 'ico-memory';
  return `
    <div class="action-card ${cardClass}">
      <svg width="16" height="16" style="flex-shrink:0">
        <use href="#${iconId}"/>
      </svg>
      <div>
        <div class="action-card-title">${title}</div>
        <div class="action-card-sub">${subtitle}</div>
      </div>
    </div>`;
}
```

Call `buildActionCardHTML` when the SSE stream emits a tool result event (search for where `tool_call` or `tool_result` events are handled in the SSE reader).

- [ ] **Step 4: Smoke test**

Send a message, confirm:
- Messages show avatar circles with initials
- Name labels appear above text
- User messages are right-aligned, AI messages left-aligned
- After a home control command: green action card appears between messages

- [ ] **Step 5: Commit**

```bash
git add app/static/js/app.js
git commit -m "feat(js): prose message layout with avatars + action cards"
```

---

### Task 15: Final smoke test + CLAUDE.md update

- [ ] **Step 1: Full manual smoke test**

```
1. Start server: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
2. Open http://localhost:8000
3. Verify three-column layout renders (left sidebar + main + right sidebar)
4. Verify page background shows subtle colour pools
5. Sidebar has frosted glass look (backdrop-filter blur visible)
6. Load a model — rsb model name + status updates
7. Send a text message — prose layout, avatars visible
8. Activate Home pill — send "turn off the light" — green action card appears
9. Stats section shows real CPU/RAM/VRAM values
10. Context bar updates with each message
11. Collapse both sidebars — icon rails visible
12. Open system prompt modal via sidebar button — profile tags render below textarea
13. Click a profile tag — textarea populates
14. No console errors on any step
```

- [ ] **Step 2: Update CLAUDE.md**

Add dated changelog entry:
```markdown
### 2026-03-11 — UI Redesign (Midnight Glass)
Replaced plain chat UI with Midnight Glass liquid glass design:
three-column shell with collapsible sidebars, prose messages with avatars
and action cards, quick-controls right sidebar (lights, model, stats, context),
mode pill toggles replacing toolsUI chip/modal UX.
```

Update Current Phase / Next Step section to reflect completion.

- [ ] **Step 3: Final commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for UI redesign completion"
```

---

## Manual Tests Per Task

| Task | Quick test |
|---|---|
| 1 — system-stats | `curl localhost:8000/api/system-stats` → JSON with cpu_pct |
| 2 — light_state | `curl localhost:8000/assist/light_state` → JSON or 503 |
| 3 — icons | Console snippet verifies `#ico-settings` renders |
| 4 — shell | DevTools confirms `#chat-history`, `#prompt`, three-column layout |
| 5 — sidebar HTML | `['rsb-lights-pct','rsb-cpu-val'].every(id => !!document.getElementById(id))` |
| 6 — base CSS | Page background visible, three columns visible |
| 7 — chat CSS | Send message → prose layout, no bubble boxes |
| 8 — sidebar CSS | Sidebar shows frosted glass + bulb container |
| 9 — mode pills | Send with Home pill active → assist mode fires |
| 10 — toggles | Click collapse buttons → sidebars animate |
| 11 — lights | Bulb fill matches real HA brightness |
| 12 — stats | Numbers update every 3s, context bar grows on each message |
| 13 — sys prompt | Profile tags load on modal open, clicking populates textarea |
| 14 — messages | Avatars, name labels, right/left alignment, action cards |
