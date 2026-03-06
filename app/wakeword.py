# app/wakeword.py
# Always-on wakeword daemon for Localis (Phase 2 — openWakeWord + sounddevice)
#
# TROUBLESHOOTING
# ---------------
# False positives (triggers too often):
#   - Raise LOCALIS_WAKEWORD_THRESHOLD (try 0.6–0.7)
#   - Lower LOCALIS_WAKEWORD_SILENCE_DB so silence detection is more aggressive
#   - Enable noise suppression: set enable_speex_noise_suppression=True in the
#     Model() constructor below (requires native speex library:
#     apt install libspeex-dev  /  pip install pyogg speexdsp-python)
#   - Consider adding a patience counter: require N consecutive chunks above
#     threshold before triggering (edit _check_wakeword() below)
#
# False negatives (not triggering):
#   - Lower LOCALIS_WAKEWORD_THRESHOLD (try 0.4)
#   - Verify mic selection: python -c "import sounddevice as sd; print(sd.query_devices())"
#     Then set LOCALIS_WAKEWORD_SOUNDDEVICE_IDX to the correct device index
#   - Check mic gain in system mixer: pavucontrol (PulseAudio/PipeWire)
#   - Ensure the pre-trained model name matches exactly; available built-in models:
#     "hey jarvis", "alexa", "hey mycroft", "hey rhasspy"
#     Full list: python -c "from openwakeword.model import Model; print(Model.__doc__)"
#
# Mic gain too low / too high:
#   - Adjust in system mixer (pavucontrol / alsamixer)
#   - Verify signal with: python -c "import sounddevice as sd, numpy as np; \
#       sd.default.samplerate=16000; data=sd.rec(16000, channels=1, dtype='int16'); \
#       sd.wait(); print('RMS:', np.sqrt(np.mean(data.astype(float)**2)))"
#   - If RMS is very low (<100), increase mic gain or check cable
#
# Command not fully captured:
#   - Increase LOCALIS_WAKEWORD_MAX_CMD (default 8s)
#   - Raise LOCALIS_WAKEWORD_SILENCE_DB (default 300) if silence ends recording too early
#   - Lower LOCALIS_WAKEWORD_SILENCE (default 1.2s) to shorten dead-end waits
#
# PTT conflict (browser PTT vs wakeword both using mic):
#   - Browser PTT uses getUserMedia (separate OS-level audio stream)
#   - sounddevice uses PulseAudio/PipeWire capture — both coexist fine on
#     modern Linux audio servers
#   - On ALSA-only systems, only one capture stream may be allowed at a time;
#     set LOCALIS_WAKEWORD_SOUNDDEVICE_IDX to a virtual/loopback device
#
# Custom wakeword models:
#   - Train with openWakeWord: https://github.com/dscripka/openWakeWord#training
#   - Set LOCALIS_WAKEWORD_MODEL=/path/to/my_wakeword.tflite
#   - Custom .tflite files are loaded directly; built-in names are resolved
#     by openWakeWord's internal model registry

import asyncio
import collections
import io
import json
import logging
import os
import secrets
import struct
import threading
import time
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Env-var tuning knobs (documented in plan)
# ---------------------------------------------------------------------------
WAKEWORD_MODEL      = os.getenv("LOCALIS_WAKEWORD_MODEL",      "hey jarvis")
WAKEWORD_THRESHOLD  = float(os.getenv("LOCALIS_WAKEWORD_THRESHOLD",  "0.20"))
WAKEWORD_COOLDOWN   = float(os.getenv("LOCALIS_WAKEWORD_COOLDOWN",   "2.0"))
WAKEWORD_MAX_CMD    = float(os.getenv("LOCALIS_WAKEWORD_MAX_CMD",    "3.0"))
WAKEWORD_SILENCE_S  = float(os.getenv("LOCALIS_WAKEWORD_SILENCE",    "0.8"))
WAKEWORD_SILENCE_DB = float(os.getenv("LOCALIS_WAKEWORD_SILENCE_DB", "300"))
WAKEWORD_SESSION    = os.getenv("LOCALIS_WAKEWORD_SESSION",    "wakeword_default")
WAKEWORD_BASE_URL   = os.getenv("LOCALIS_WAKEWORD_BASE_URL",   "http://127.0.0.1:8000")
# Optional: override sounddevice input device by index
WAKEWORD_DEVICE_IDX = os.getenv("LOCALIS_WAKEWORD_SOUNDDEVICE_IDX", None)

_DEBUG = os.getenv("LOCALIS_DEBUG", "0") == "1"

# Audio pipeline constants
_SAMPLE_RATE  = 16000
_CHANNELS     = 1
_DTYPE        = "int16"
_BLOCK_FRAMES = 1280   # 80ms at 16kHz — matches openWakeWord expected chunk size

# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------
# States: DISABLED, IDLE, RECORDING, TRANSCRIBING, SUBMITTING, COOLDOWN
_state: str = "DISABLED"
_state_lock = threading.Lock()
_last_error: Optional[str] = None

_daemon_thread: Optional[threading.Thread] = None
_stop_event    = threading.Event()


def _set_state(new: str) -> None:
    global _state
    with _state_lock:
        _state = new
    logger.info(f"[Wakeword] State → {new}")


def _get_state() -> str:
    with _state_lock:
        return _state


# ---------------------------------------------------------------------------
# Audio helpers
# ---------------------------------------------------------------------------

def _pcm_to_wav(pcm_frames: list, sample_rate: int = _SAMPLE_RATE) -> bytes:
    """
    Concatenate raw int16 PCM frames (list of bytes objects) into a RIFF/WAV
    suitable for passing to faster-whisper's transcribe().
    """
    raw = b"".join(pcm_frames)
    data_size   = len(raw)
    byte_rate   = sample_rate * _CHANNELS * 2  # 16-bit = 2 bytes
    block_align = _CHANNELS * 2
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,
        b"WAVE",
        b"fmt ",
        16, 1,              # Subchunk1Size, AudioFormat=PCM
        _CHANNELS,
        sample_rate,
        byte_rate,
        block_align,
        16,                 # BitsPerSample
        b"data",
        data_size,
    )
    return header + raw


def _rms(pcm_bytes: bytes) -> float:
    """Compute RMS amplitude of raw int16 PCM bytes."""
    if len(pcm_bytes) < 2:
        return 0.0
    import array as _array
    samples = _array.array("h", pcm_bytes)
    n = len(samples)
    if n == 0:
        return 0.0
    sq_sum = sum(s * s for s in samples)
    return (sq_sum / n) ** 0.5


# ---------------------------------------------------------------------------
# openWakeWord model (lazy load inside daemon thread)
# ---------------------------------------------------------------------------
_oww_model = None


_VENV_HINT = (
    "Run  bash scripts/setup_voice_venv.sh  to create a Python 3.11 venv "
    "with openwakeword==0.6.0 and tflite-runtime, then launch Localis inside "
    "that venv. See requirements-voice.txt for pinned dependencies."
)


def _load_oww_model():
    """Load openWakeWord model. Raises ImportError if not installed."""
    global _oww_model
    try:
        from openwakeword.model import Model
    except ImportError as exc:
        raise ImportError(
            f"openwakeword not installed or missing tflite-runtime: {exc}\n"
            f"{_VENV_HINT}"
        ) from exc

    model_path_or_name = WAKEWORD_MODEL
    # If it looks like a file path, load as custom tflite; otherwise use built-in name
    logger.info(
        f"[Wakeword] Loading {'custom' if os.path.isfile(model_path_or_name) else 'built-in'} "
        f"model: '{model_path_or_name}'"
    )
    try:
        _oww_model = Model(wakeword_models=[model_path_or_name])
    except TypeError as exc:
        raise RuntimeError(
            f"openwakeword API mismatch (TypeError: {exc}). "
            "The installed version is incompatible with this code. "
            f"{_VENV_HINT}"
        ) from exc
    except Exception as exc:
        raise RuntimeError(
            f"Failed to load wakeword model '{model_path_or_name}': {exc}. "
            "On first run, openWakeWord downloads model files — ensure internet access. "
            "Or set LOCALIS_WAKEWORD_MODEL=/path/to/custom.tflite. "
            f"{_VENV_HINT}"
        ) from exc

    logger.info("[Wakeword] openWakeWord model loaded.")


def _check_wakeword(chunk: bytes) -> float:
    """
    Feed one 80ms PCM chunk to openWakeWord.
    Returns the highest confidence score across all wakeword models.
    Returns 0.0 on any error.
    """
    if _oww_model is None:
        return 0.0
    try:
        import numpy as np
        audio_np = np.frombuffer(chunk, dtype=np.int16)
        prediction = _oww_model.predict(audio_np)
        if not prediction:
            return 0.0
        score = max(prediction.values())
        if _DEBUG and score > 0.05:
            logger.debug(f"[Wakeword] frame score={score:.3f}")
        return score
    except Exception as e:
        logger.debug(f"[Wakeword] predict() error: {e}")
        return 0.0


# ---------------------------------------------------------------------------
# Chat submission
# ---------------------------------------------------------------------------

def _submit_chat(text: str, session_id: str) -> None:
    """
    POST to /chat with assist_mode=True and stream-drain the response.
    Runs synchronously inside the daemon thread.
    """
    url = f"{WAKEWORD_BASE_URL}/chat"
    payload = {
        "session_id": session_id,
        "message": text,
        "assist_mode": True,
    }
    try:
        with httpx.Client(timeout=60.0) as client:
            with client.stream("POST", url, json=payload) as resp:
                resp.raise_for_status()
                for _ in resp.iter_bytes(chunk_size=4096):
                    if _stop_event.is_set():
                        break
        logger.info(f"[Wakeword] Chat submitted for: {text[:80]!r}")
    except Exception as e:
        logger.error(f"[Wakeword] Chat submission failed: {e}")


# ---------------------------------------------------------------------------
# Daemon loop
# ---------------------------------------------------------------------------

def _daemon_loop() -> None:
    """
    Main daemon thread body.

    State machine:
        IDLE
          → score > threshold AND no PTT/TTS lock held
          → RECORDING

        RECORDING
          → accumulate chunks
          → silence_timeout OR max_cmd_duration exceeded
          → TRANSCRIBING

        TRANSCRIBING
          → _transcribe_wav_sync() returns text
          → SUBMITTING (or back to IDLE on empty)

        SUBMITTING
          → _submit_chat() completes
          → COOLDOWN

        COOLDOWN
          → cooldown elapsed
          → IDLE

    Any state: _stop_event.set() exits the loop → DISABLED
    """
    global _last_error

    # ---- Import sounddevice inside thread (avoids import-time audio init) ----
    try:
        import sounddevice as sd
    except ImportError:
        _last_error = "sounddevice not installed: pip install sounddevice"
        logger.error(f"[Wakeword] {_last_error}")
        _set_state("DISABLED")
        return

    # ---- Load openWakeWord model ----
    try:
        _load_oww_model()
    except Exception as e:
        _last_error = str(e)
        logger.error(f"[Wakeword] Model load failed: {_last_error}")
        _set_state("DISABLED")
        return

    # ---- Import voice locks (lazy to avoid circular at module level) ----
    from .voice import VOICE_STT_LOCK, VOICE_TTS_LOCK, _transcribe_wav_sync

    device_idx = int(WAKEWORD_DEVICE_IDX) if WAKEWORD_DEVICE_IDX is not None else None

    # Log which mic sounddevice will use
    try:
        _dev_idx = device_idx if device_idx is not None else sd.default.device[0]
        _dev_info = sd.query_devices(_dev_idx)
        logger.info(f"[Wakeword] Microphone: idx={_dev_idx} name='{_dev_info['name']}'")
    except Exception:
        logger.warning("[Wakeword] Could not query sounddevice info (non-fatal)")

    logger.info(
        f"[Wakeword] Daemon started — model='{WAKEWORD_MODEL}' "
        f"threshold={WAKEWORD_THRESHOLD} cooldown={WAKEWORD_COOLDOWN}s "
        f"max_cmd={WAKEWORD_MAX_CMD}s silence={WAKEWORD_SILENCE_S}s "
        f"silence_db={WAKEWORD_SILENCE_DB} session='{WAKEWORD_SESSION}'"
    )

    _set_state("IDLE")

    try:
        with sd.RawInputStream(
            samplerate=_SAMPLE_RATE,
            blocksize=_BLOCK_FRAMES,
            channels=_CHANNELS,
            dtype=_DTYPE,
            device=device_idx,
        ) as stream:
            while not _stop_event.is_set():
                current = _get_state()

                # ---- IDLE: listen for wakeword ----
                if current == "IDLE":
                    chunk_bytes, _ = stream.read(_BLOCK_FRAMES)
                    chunk = bytes(chunk_bytes)

                    # PTT mutual exclusion: skip wakeword check while PTT/TTS active
                    if VOICE_STT_LOCK.locked() or VOICE_TTS_LOCK.locked():
                        continue

                    score = _check_wakeword(chunk)
                    if score >= WAKEWORD_THRESHOLD:
                        logger.info(
                            f"[Wakeword] Detected '{WAKEWORD_MODEL}' "
                            f"(score={score:.3f})"
                        )
                        _set_state("RECORDING")
                        # Fall through into RECORDING on the next loop iteration

                # ---- RECORDING: accumulate command audio ----
                elif current == "RECORDING":
                    frames: list = []
                    t_start = time.monotonic()
                    t_last_sound = t_start

                    while not _stop_event.is_set():
                        chunk_bytes, _ = stream.read(_BLOCK_FRAMES)
                        chunk = bytes(chunk_bytes)
                        frames.append(chunk)

                        elapsed = time.monotonic() - t_start
                        rms_val = _rms(chunk)

                        if rms_val >= WAKEWORD_SILENCE_DB:
                            t_last_sound = time.monotonic()

                        silence_elapsed = time.monotonic() - t_last_sound
                        if silence_elapsed >= WAKEWORD_SILENCE_S:
                            logger.debug(
                                f"[Wakeword] Silence detected after "
                                f"{elapsed:.1f}s — ending recording"
                            )
                            break

                        if elapsed >= WAKEWORD_MAX_CMD:
                            logger.debug(
                                f"[Wakeword] Max command duration "
                                f"({WAKEWORD_MAX_CMD}s) reached"
                            )
                            break

                    if _stop_event.is_set():
                        break

                    if not frames:
                        _set_state("IDLE")
                        continue

                    _set_state("TRANSCRIBING")
                    wav_bytes = _pcm_to_wav(frames)

                    # ---- TRANSCRIBING ----
                    text: Optional[str] = None
                    try:
                        text = _transcribe_wav_sync(wav_bytes)
                    except Exception as e:
                        logger.error(f"[Wakeword] STT error: {e}")

                    if not text:
                        logger.info("[Wakeword] Empty transcription — returning to IDLE")
                        _set_state("IDLE")
                        continue

                    logger.info(f"[Wakeword] Command: {text!r}")

                    # ---- SUBMITTING ----
                    _set_state("SUBMITTING")
                    _submit_chat(text, WAKEWORD_SESSION)

                    # ---- COOLDOWN ----
                    _set_state("COOLDOWN")
                    deadline = time.monotonic() + WAKEWORD_COOLDOWN
                    while time.monotonic() < deadline and not _stop_event.is_set():
                        # Drain audio during cooldown so the buffer doesn't fill
                        stream.read(_BLOCK_FRAMES)

                    _set_state("IDLE")

                else:
                    # Unexpected state: drain mic and wait
                    stream.read(_BLOCK_FRAMES)
                    time.sleep(0.05)

    except Exception as e:
        _last_error = f"Daemon crashed: {e}"
        logger.error(f"[Wakeword] {_last_error}", exc_info=True)
    finally:
        _set_state("DISABLED")
        logger.info("[Wakeword] Daemon stopped.")


# ---------------------------------------------------------------------------
# FastAPI router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/voice/wakeword", tags=["wakeword"])

# ---------------------------------------------------------------------------
# WebSocket path — module-level data_dir reference
# ---------------------------------------------------------------------------
_DATA_DIR: Optional[Path] = None


def register_wakeword(app, data_dir):
    """Called from main.py during app construction."""
    global _DATA_DIR
    _DATA_DIR = Path(data_dir)
    app.include_router(router)
    logger.info("[Wakeword] Router registered at /voice/wakeword")


# ---------------------------------------------------------------------------
# Per-connection model loader (fresh instance per WS to avoid buffer contamination)
# ---------------------------------------------------------------------------

def _load_ws_model():
    """
    Load (and download if missing) the hey_jarvis model from DATA_DIR/wakeword_models/.
    Returns a fresh Model instance for one WebSocket connection.
    Raises ImportError / RuntimeError on failure.
    """
    try:
        from openwakeword.model import Model
        import openwakeword.utils as oww_utils
    except ImportError as exc:
        raise ImportError(
            f"openwakeword not installed or missing tflite-runtime: {exc}\n"
            f"{_VENV_HINT}"
        ) from exc

    if _DATA_DIR is None:
        raise RuntimeError("_DATA_DIR not set — register_wakeword() not called")

    model_dir = _DATA_DIR / "wakeword_models"
    model_dir.mkdir(parents=True, exist_ok=True)

    # Use glob to find any versioned hey_jarvis tflite file (e.g. hey_jarvis_v0.1.tflite)
    matches = sorted(model_dir.glob("hey_jarvis*.tflite"))
    if not matches:
        logger.info("[Wakeword WS] Downloading hey_jarvis model...")
        try:
            oww_utils.download_models(
                model_names=["hey_jarvis"],
                target_directory=str(model_dir),
            )
        except Exception as exc:
            raise RuntimeError(
                f"Failed to download hey_jarvis model: {exc}. "
                "Ensure internet access on first run, or pre-place the hey_jarvis tflite file "
                f"in {model_dir}. {_VENV_HINT}"
            ) from exc
        matches = sorted(model_dir.glob("hey_jarvis*.tflite"))

    if not matches:
        raise RuntimeError(
            f"hey_jarvis model not found in {model_dir} after download attempt. "
            f"{_VENV_HINT}"
        )

    tflite_path = matches[0]
    logger.info(f"[Wakeword WS] Loading model: {tflite_path.name}")

    # Resolve feature extractor model paths (downloaded alongside hey_jarvis)
    melspec_matches = sorted(model_dir.glob("melspectrogram*.tflite"))
    embed_matches   = sorted(model_dir.glob("embedding_model*.tflite"))
    feature_kwargs = {}
    if melspec_matches:
        feature_kwargs["melspec_model_path"] = str(melspec_matches[0])
    if embed_matches:
        feature_kwargs["embedding_model_path"] = str(embed_matches[0])

    try:
        return Model(
            wakeword_models=[str(tflite_path)],
            inference_framework="tflite",
            **feature_kwargs,
        )
    except TypeError as exc:
        raise RuntimeError(
            f"openwakeword API mismatch (TypeError: {exc}). "
            "The installed version is incompatible with this code. "
            f"{_VENV_HINT}"
        ) from exc
    except Exception as exc:
        raise RuntimeError(
            f"Failed to load hey_jarvis model from {tflite_path}: {exc}. "
            f"{_VENV_HINT}"
        ) from exc


# ---------------------------------------------------------------------------
# Anti-spam detector (moving average + arm/disarm)
# ---------------------------------------------------------------------------

_WINDOW = 16            # frames → ~1.28 s at 80ms/frame
_COOLDOWN_FRAMES = 25   # frames → ~2.0 s after trigger


def _make_detector() -> dict:
    return {"scores": collections.deque(maxlen=_WINDOW), "armed": True, "cooldown": 0}


def _feed_frame(det: dict, chunk_bytes: bytes, threshold: float, model) -> bool:
    """
    Feed one 1280-sample Int16 chunk (2560 bytes).
    Returns True exactly once per wake event.
    """
    if det["cooldown"] > 0:
        det["cooldown"] -= 1
        if det["cooldown"] == 0:
            det["armed"] = True
            det["scores"].clear()
        return False

    import numpy as np
    audio_np = np.frombuffer(chunk_bytes, dtype=np.int16)
    try:
        prediction = model.predict(audio_np)
        score = max(prediction.values()) if prediction else 0.0
    except Exception:
        score = 0.0

    det["scores"].append(score)

    if det["armed"] and len(det["scores"]) >= _WINDOW // 2:
        avg = sum(det["scores"]) / len(det["scores"])
        if avg >= threshold:
            det["armed"] = False
            det["cooldown"] = _COOLDOWN_FRAMES
            det["last_score"] = avg   # capture before clear so caller can report it
            det["scores"].clear()
            return True

    return False


# ---------------------------------------------------------------------------
# WebSocket auth helper
# ---------------------------------------------------------------------------

def _ws_auth(websocket: WebSocket) -> bool:
    """
    Browser WS API cannot send custom headers.
    - No LOCALIS_VOICE_KEY set → only loopback IPs allowed.
    - LOCALIS_VOICE_KEY set → check ?key=<value> query param (timing-safe).
    """
    key = os.getenv("LOCALIS_VOICE_KEY", "")
    client_ip = (websocket.client.host if websocket.client else "") or ""
    if key:
        provided = websocket.query_params.get("key", "")
        return secrets.compare_digest(provided, key)
    return client_ip in ("127.0.0.1", "::1", "localhost", "")


# ---------------------------------------------------------------------------
# WebSocket endpoint — /voice/wakeword/ws
# ---------------------------------------------------------------------------

@router.websocket("/ws")
async def wakeword_ws(websocket: WebSocket):
    """
    Browser streams raw 16kHz mono Int16 PCM frames (1280 samples = 2560 bytes each).
    Server runs openWakeWord frame-by-frame and emits {"event":"wake","score":...}
    when the wakeword is detected.
    """
    if not _ws_auth(websocket):
        await websocket.close(code=4403)
        return

    await websocket.accept()

    loop = asyncio.get_event_loop()
    try:
        model = await loop.run_in_executor(None, _load_ws_model)
    except Exception as exc:
        await websocket.send_json({"event": "error", "message": str(exc)})
        await websocket.close()
        return

    await websocket.send_json({"event": "ready"})
    det = _make_detector()
    threshold = WAKEWORD_THRESHOLD

    try:
        while True:
            msg = await websocket.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("bytes"):
                chunk = msg["bytes"]
                if len(chunk) != 2560:      # 1280 int16 samples × 2 bytes
                    continue
                fired = await loop.run_in_executor(
                    None, _feed_frame, det, chunk, threshold, model
                )
                if fired:
                    score = det.get("last_score", 0.0)
                    await websocket.send_json({"event": "wake", "score": round(score, 3)})
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning(f"[Wakeword WS] Error: {exc}")
    finally:
        logger.debug("[Wakeword WS] Connection closed.")


def _voice_auth_dep(request: Request):
    """Delegate to voice module's auth guard."""
    from .voice import _voice_auth
    return _voice_auth(request)


@router.post("/enable")
async def wakeword_enable(_: None = Depends(_voice_auth_dep)):
    """Start the wakeword daemon thread."""
    global _daemon_thread, _last_error

    if _get_state() != "DISABLED":
        return {"ok": True, "state": _get_state(), "message": "Already running"}

    # Pre-flight: check optional dependencies are installed
    try:
        import sounddevice   # noqa: F401
        import openwakeword  # noqa: F401
    except ImportError as e:
        _last_error = (
            f"Missing dependency: {e}. "
            f"{_VENV_HINT}"
        )
        return {"ok": False, "state": "DISABLED", "error": _last_error}

    _last_error = None
    _stop_event.clear()
    _daemon_thread = threading.Thread(
        target=_daemon_loop,
        name="wakeword-daemon",
        daemon=True,
    )
    _daemon_thread.start()

    # Give the thread time to complete model loading before responding.
    # TFLite model load is the slow path; 0.8 s covers it on most hardware.
    import asyncio
    await asyncio.sleep(0.8)
    state = _get_state()
    if state == "DISABLED" and _last_error:
        return {"ok": False, "state": "disabled", "error": _last_error}
    response = {"ok": state != "DISABLED", "state": state}
    return response


@router.post("/disable")
async def wakeword_disable(_: None = Depends(_voice_auth_dep)):
    """Stop the wakeword daemon thread."""
    _stop_event.set()
    if _daemon_thread and _daemon_thread.is_alive():
        _daemon_thread.join(timeout=3.0)
    _set_state("DISABLED")
    return {"ok": True, "state": "DISABLED"}


@router.get("/status")
async def wakeword_status(_: None = Depends(_voice_auth_dep)):
    """Return current daemon state and configuration."""
    state = _get_state()
    return {
        "enabled":      state != "DISABLED",
        "state":        state.lower(),
        "model_loaded": _oww_model is not None,
        "last_error":   _last_error,
        "model":        WAKEWORD_MODEL,
        "threshold":    WAKEWORD_THRESHOLD,
        "cooldown_s":   WAKEWORD_COOLDOWN,
        "max_cmd_s":    WAKEWORD_MAX_CMD,
        "silence_s":    WAKEWORD_SILENCE_S,
        "silence_db":   WAKEWORD_SILENCE_DB,
        "session":      WAKEWORD_SESSION,
        "base_url":     WAKEWORD_BASE_URL,
    }
