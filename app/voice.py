# app/voice.py
# Voice layer for Localis — PTT MVP (Phase 1)
# Endpoints: POST /voice/transcribe, POST /voice/speak, GET /voice/status
# Security: localhost-only by default; LOCALIS_VOICE_KEY enables LAN access.
# TTS: Piper CLI (subprocess). STT: faster-whisper.

import io
import os
import secrets
import shutil
import struct
import subprocess
import tempfile
import threading
import time
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Env vars
# ---------------------------------------------------------------------------
WHISPER_MODEL_SIZE = os.getenv("LOCALIS_WHISPER_MODEL", "small")
WHISPER_DEVICE = os.getenv("LOCALIS_WHISPER_DEVICE", "auto")
TTS_ENGINE = os.getenv("LOCALIS_TTS_ENGINE", "piper")
PIPER_MODEL = os.getenv("LOCALIS_PIPER_MODEL", "")
VOICE_PRELOAD = os.getenv("LOCALIS_VOICE_PRELOAD", "0") == "1"

# ---------------------------------------------------------------------------
# Independent locks — never interact with MODEL_LOCK or ASSIST_MODEL_LOCK
# ---------------------------------------------------------------------------
VOICE_STT_LOCK = threading.Lock()
VOICE_TTS_LOCK = threading.Lock()

# Module-level state
_stt_model = None          # faster-whisper WhisperModel instance
_stt_loaded: bool = False
_tts_loaded: bool = False  # True once Piper binary + model verified
_ffmpeg_available: bool = shutil.which("ffmpeg") is not None
_piper_binary: Optional[str] = None  # resolved path to piper CLI

router = APIRouter(prefix="/voice", tags=["voice"])


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_voice(app, data_dir):
    """Called from main.py during app construction."""
    global _piper_binary
    _piper_binary = shutil.which("piper") or shutil.which("piper-tts")
    if _piper_binary:
        logger.info(f"[Voice] Piper CLI found at: {_piper_binary}")
    else:
        logger.warning("[Voice] Piper CLI not found in PATH. TTS unavailable. Install piper and add to PATH.")

    if VOICE_PRELOAD:
        import asyncio

        async def _preload():
            try:
                _ensure_stt_model()
                logger.info("[Voice] STT model preloaded.")
            except Exception as e:
                logger.warning(f"[Voice] STT preload failed: {e}")

        app.add_event_handler("startup", _preload)

    app.include_router(router)


# ---------------------------------------------------------------------------
# Security guard
# ---------------------------------------------------------------------------

def _voice_auth(request: Request):
    """
    Block voice endpoints when server is LAN-exposed unless a key is configured.
    - LOCALIS_VOICE_KEY set → enforce X-Localis-Voice-Key header (timing-safe compare).
    - Not set → allow only loopback clients.
    """
    key = os.getenv("LOCALIS_VOICE_KEY", "")
    if key:
        provided = request.headers.get("X-Localis-Voice-Key", "")
        if not secrets.compare_digest(provided, key):
            raise HTTPException(status_code=403, detail="Voice key required")
    else:
        client_ip = (request.client.host if request.client else "") or ""
        if client_ip not in ("127.0.0.1", "::1", "localhost", ""):
            raise HTTPException(
                status_code=403,
                detail=(
                    "Voice endpoints are localhost-only by default. "
                    "Set LOCALIS_VOICE_KEY in secret.env to enable LAN access."
                ),
            )


# ---------------------------------------------------------------------------
# STT — faster-whisper (lazy load with double-check locking)
# ---------------------------------------------------------------------------

def _load_stt_model():
    """Must be called with VOICE_STT_LOCK held."""
    global _stt_model, _stt_loaded
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise RuntimeError(
            "faster-whisper not installed. Run: pip install -r requirements-voice.txt"
        )
    device = WHISPER_DEVICE
    if device == "auto":
        try:
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            device = "cpu"
    compute = "float16" if device == "cuda" else "int8"
    logger.info(f"[Voice] Loading Whisper '{WHISPER_MODEL_SIZE}' on {device} ({compute})")
    _stt_model = WhisperModel(WHISPER_MODEL_SIZE, device=device, compute_type=compute)
    _stt_loaded = True
    logger.info("[Voice] Whisper model loaded.")


def _ensure_stt_model():
    global _stt_model
    if _stt_loaded:
        return
    with VOICE_STT_LOCK:
        if _stt_loaded:
            return
        _load_stt_model()


# ---------------------------------------------------------------------------
# Audio helpers
# ---------------------------------------------------------------------------

def _is_16khz_mono_wav(data: bytes) -> bool:
    """Check RIFF/WAV header for 16kHz mono PCM."""
    if len(data) < 44:
        return False
    try:
        if data[0:4] != b"RIFF" or data[8:12] != b"WAVE":
            return False
        # fmt chunk starts at byte 12
        if data[12:16] != b"fmt ":
            return False
        audio_fmt = struct.unpack_from("<H", data, 20)[0]  # 1 = PCM
        channels = struct.unpack_from("<H", data, 22)[0]
        sample_rate = struct.unpack_from("<I", data, 24)[0]
        return audio_fmt == 1 and channels == 1 and sample_rate == 16000
    except Exception:
        return False


def _ffmpeg_normalize(audio_bytes: bytes) -> bytes:
    """Use ffmpeg to convert audio to 16kHz mono WAV PCM."""
    with tempfile.NamedTemporaryFile(suffix=".input", delete=False) as fin:
        fin.write(audio_bytes)
        fin_path = fin.name
    fout_path = fin_path + ".wav"
    try:
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", fin_path,
                "-ar", "16000", "-ac", "1", "-f", "wav",
                fout_path,
            ],
            check=True,
            capture_output=True,
            timeout=30,
        )
        with open(fout_path, "rb") as f:
            return f.read()
    finally:
        try:
            os.unlink(fin_path)
        except OSError:
            pass
        try:
            os.unlink(fout_path)
        except OSError:
            pass


def _to_wav_bytes(audio_bytes: bytes, content_type: str) -> bytes:
    """
    Fast path: 16kHz mono WAV → return as-is.
    Fallback: other formats → ffmpeg normalize (503 if ffmpeg absent).
    """
    ct = (content_type or "").lower().split(";")[0].strip()
    if ct in ("audio/wav", "audio/x-wav", "audio/wave"):
        if _is_16khz_mono_wav(audio_bytes):
            return audio_bytes  # Fast path
    if not _ffmpeg_available:
        raise HTTPException(
            status_code=503,
            detail=(
                "Audio requires format conversion but ffmpeg is not installed. "
                "Send 16kHz mono WAV (browser WebAudio path), or install ffmpeg."
            ),
        )
    return _ffmpeg_normalize(audio_bytes)


# ---------------------------------------------------------------------------
# TTS — Piper CLI
# ---------------------------------------------------------------------------

def _check_piper_available() -> bool:
    """True if piper binary found AND model file is configured and exists."""
    if not _piper_binary:
        return False
    model = os.getenv("LOCALIS_PIPER_MODEL", "")
    return bool(model and Path(model).exists())


def _synthesize_sync(text: str) -> bytes:
    """
    Run Piper CLI synchronously (call inside run_in_executor).
    Must be called with VOICE_TTS_LOCK held.
    Returns raw WAV bytes.
    """
    model_path = os.getenv("LOCALIS_PIPER_MODEL", "")
    if not model_path or not Path(model_path).exists():
        raise RuntimeError(
            f"Piper model not found at '{model_path}'. "
            "Set LOCALIS_PIPER_MODEL=<path/to/model.onnx> in secret.env. "
            "Download voices: https://github.com/rhasspy/piper/blob/master/VOICES.md"
        )

    # Truncate to avoid very long TTS calls
    if len(text) > 2000:
        text = text[:2000] + "..."

    cmd = [_piper_binary, "--model", model_path, "--output-raw"]
    result = subprocess.run(
        cmd,
        input=text.encode("utf-8"),
        capture_output=True,
        timeout=60,
    )
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")
        raise RuntimeError(f"Piper TTS failed (exit {result.returncode}): {stderr[:300]}")

    raw_pcm = result.stdout

    # Wrap raw PCM in a RIFF/WAV header (Piper --output-raw is 16kHz 16-bit mono)
    sample_rate = 16000
    channels = 1
    bits = 16
    wav_bytes = _build_wav_header(raw_pcm, sample_rate, channels, bits) + raw_pcm
    return wav_bytes


def _build_wav_header(pcm_data: bytes, sample_rate: int, channels: int, bits: int) -> bytes:
    """Build a minimal RIFF WAV header for raw PCM data."""
    data_size = len(pcm_data)
    byte_rate = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,   # ChunkSize
        b"WAVE",
        b"fmt ",
        16,               # Subchunk1Size (PCM)
        1,                # AudioFormat (PCM)
        channels,
        sample_rate,
        byte_rate,
        block_align,
        bits,
        b"data",
        data_size,
    )
    return header


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class SpeakRequest(BaseModel):
    text: str
    voice: Optional[str] = None  # reserved for future multi-voice support


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    _: None = Depends(_voice_auth),
):
    """
    Transcribe uploaded audio → {text, language, duration_s}.
    Fast path: 16kHz mono WAV (browser WebAudio) — no ffmpeg needed.
    Fallback: other formats via ffmpeg (503 if absent).
    """
    audio_bytes = await audio.read()

    if len(audio_bytes) < 100:
        raise HTTPException(status_code=400, detail="Audio too short or empty")

    t0 = time.monotonic()

    wav_bytes = _to_wav_bytes(audio_bytes, audio.content_type or "")

    # Lazy-load Whisper
    try:
        _ensure_stt_model()
    except Exception as e:
        logger.error(f"[Voice] STT model load failed: {e}")
        raise HTTPException(status_code=503, detail=str(e))

    # Transcribe (release GIL via thread, but acquire STT lock)
    import asyncio

    loop = asyncio.get_event_loop()

    def _do_transcribe():
        with VOICE_STT_LOCK:
            segments, info = _stt_model.transcribe(
                io.BytesIO(wav_bytes),
                beam_size=5,
                vad_filter=True,
            )
            text = " ".join(s.text for s in segments).strip()
            return text, info.language, getattr(info, "duration", None)

    text, language, duration_s = await loop.run_in_executor(None, _do_transcribe)

    stt_ms = round((time.monotonic() - t0) * 1000)
    logger.info(f"[Voice] Transcribed in {stt_ms}ms: {text[:80]!r}")

    from fastapi.responses import JSONResponse
    return JSONResponse(
        content={"text": text, "language": language, "duration_s": duration_s},
        headers={"X-Voice-STT-Ms": str(stt_ms)},
    )


@router.post("/speak")
async def speak(
    req: SpeakRequest,
    _: None = Depends(_voice_auth),
):
    """
    Synthesize text to speech via Piper CLI.
    Returns audio/wav (RIFF format, 16kHz mono 16-bit PCM).
    """
    if not _piper_binary:
        raise HTTPException(
            status_code=503,
            detail=(
                "Piper CLI not found in PATH. Install piper and add to PATH. "
                "See: https://github.com/rhasspy/piper/releases"
            ),
        )
    if not _check_piper_available():
        raise HTTPException(
            status_code=503,
            detail=(
                "Piper model not configured or file not found. "
                "Set LOCALIS_PIPER_MODEL=<path/to/model.onnx> in secret.env. "
                "Download voices: https://github.com/rhasspy/piper/blob/master/VOICES.md"
            ),
        )

    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty")

    t0 = time.monotonic()
    import asyncio

    loop = asyncio.get_event_loop()

    def _do_tts():
        with VOICE_TTS_LOCK:
            return _synthesize_sync(text)

    try:
        wav_bytes = await loop.run_in_executor(None, _do_tts)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    tts_ms = round((time.monotonic() - t0) * 1000)
    logger.info(f"[Voice] TTS synthesized {len(wav_bytes)} bytes in {tts_ms}ms")

    return StreamingResponse(
        io.BytesIO(wav_bytes),
        media_type="audio/wav",
        headers={"X-Voice-TTS-Ms": str(tts_ms)},
    )


def _transcribe_wav_sync(wav_bytes: bytes) -> Optional[str]:
    """
    Synchronous in-process STT helper for the wakeword daemon.
    Lazy-loads Whisper if not already loaded, acquires VOICE_STT_LOCK, and
    returns the stripped transcription text, or None if empty / error.

    Called directly from app/wakeword.py to avoid an HTTP round-trip.
    """
    try:
        _ensure_stt_model()
    except Exception as e:
        logger.error(f"[Voice] STT model unavailable for wakeword: {e}")
        return None

    with VOICE_STT_LOCK:
        try:
            segments, _info = _stt_model.transcribe(
                io.BytesIO(wav_bytes),
                beam_size=5,
                vad_filter=True,
            )
            text = " ".join(s.text for s in segments).strip()
            return text or None
        except Exception as e:
            logger.error(f"[Voice] _transcribe_wav_sync error: {e}")
            return None


@router.get("/status")
async def voice_status(_: None = Depends(_voice_auth)):
    """Readiness check for voice endpoints."""
    piper_ok = _check_piper_available()
    model_path = os.getenv("LOCALIS_PIPER_MODEL", "")
    return {
        "available": _stt_loaded and piper_ok,
        "ffmpeg": _ffmpeg_available,
        "stt_loaded": _stt_loaded,
        "tts_loaded": piper_ok,
        "tts_engine": TTS_ENGINE,
        "whisper_model": WHISPER_MODEL_SIZE,
        "whisper_device": WHISPER_DEVICE,
        "piper_binary": _piper_binary,
        "piper_model": model_path if model_path else None,
        "piper_model_exists": bool(model_path and Path(model_path).exists()),
    }
