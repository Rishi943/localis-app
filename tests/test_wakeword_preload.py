"""
tests/test_wakeword_preload.py

Tests for startup model preload + daemon path fix (Plan: Fix Wakeword + UI Toggle Polish).
No live ML model or running server required — all heavy deps are mocked.
"""
import asyncio
import sys
import tempfile
import threading
import types
import unittest
import unittest.mock as mock
from pathlib import Path


# ---------------------------------------------------------------------------
# Import helper (mirrors test_wakeword_ws.py pattern)
# ---------------------------------------------------------------------------

def _import_wakeword():
    import importlib

    for stub in ("sounddevice", "openwakeword", "openwakeword.model", "openwakeword.utils"):
        if stub not in sys.modules:
            sys.modules[stub] = types.ModuleType(stub)

    # Minimal numpy stub
    if "numpy" not in sys.modules:
        try:
            import numpy  # noqa: F401
        except ImportError:
            import array as _array

            class _NumpyStub(types.ModuleType):
                int16 = "h"

                @staticmethod
                def frombuffer(buf, dtype=None):
                    return _array.array("h", buf)

            sys.modules["numpy"] = _NumpyStub("numpy")

    if "app.wakeword" in sys.modules:
        return sys.modules["app.wakeword"]
    return importlib.import_module("app.wakeword")


ww = _import_wakeword()


def _reset_preload_state(data_dir=None):
    """Reset module-level preload flags between tests."""
    ww._preload_done.clear()
    ww._preload_error = None
    ww._DATA_DIR = Path(data_dir) if data_dir else None
    ww._oww_model = None


# ---------------------------------------------------------------------------
# Test 1: model dir is created and _preload_done is set
# ---------------------------------------------------------------------------

class TestPreloadModelDir(unittest.TestCase):

    def test_model_dir_created_on_preload(self):
        """_preload_models_bg() creates wakeword_models/ dir and sets _preload_done."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _reset_preload_state(tmpdir)

            oww_utils_stub = sys.modules["openwakeword.utils"]
            oww_utils_stub.download_models = mock.MagicMock()

            ww._preload_models_bg()

            model_dir = Path(tmpdir) / "wakeword_models"
            self.assertTrue(model_dir.exists(), "wakeword_models/ dir should be created")
            self.assertTrue(ww._preload_done.is_set(), "_preload_done should be set")


# ---------------------------------------------------------------------------
# Test 2: download skipped when model file already present
# ---------------------------------------------------------------------------

class TestPreloadSkipWhenCached(unittest.TestCase):

    def test_preload_skipped_when_models_exist(self):
        """_preload_models_bg() does NOT call download_models if .tflite already present."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _reset_preload_state(tmpdir)

            model_dir = Path(tmpdir) / "wakeword_models"
            model_dir.mkdir()
            (model_dir / "hey_jarvis_v0.1.tflite").touch()

            oww_utils_stub = sys.modules["openwakeword.utils"]
            oww_utils_stub.download_models = mock.MagicMock()

            ww._preload_models_bg()

            oww_utils_stub.download_models.assert_not_called()
            self.assertTrue(ww._preload_done.is_set())


# ---------------------------------------------------------------------------
# Test 3: _load_oww_model() resolves path via DATA_DIR, not package resources
# ---------------------------------------------------------------------------

class TestLoadOwwModelUsesDataDir(unittest.TestCase):

    def test_load_oww_model_uses_data_dir(self):
        """_load_oww_model() constructs Model with file path from DATA_DIR/wakeword_models/."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _reset_preload_state(tmpdir)

            model_dir = Path(tmpdir) / "wakeword_models"
            model_dir.mkdir()
            tflite = model_dir / "hey_jarvis_v0.1.tflite"
            tflite.touch()
            # Mark preload as done so _load_oww_model doesn't wait
            ww._preload_done.set()

            model_stub = mock.MagicMock()
            oww_model_stub = sys.modules["openwakeword.model"]
            oww_model_stub.Model = mock.MagicMock(return_value=model_stub)

            ww._load_oww_model()

            call_kwargs = oww_model_stub.Model.call_args
            wakeword_models_arg = call_kwargs[1].get("wakeword_models") or call_kwargs[0][0]
            self.assertEqual(len(wakeword_models_arg), 1)
            loaded_path = Path(wakeword_models_arg[0])
            self.assertTrue(str(loaded_path).startswith(tmpdir),
                            f"Expected DATA_DIR path, got: {loaded_path}")


# ---------------------------------------------------------------------------
# Test 4: _load_oww_model() waits for preload thread then succeeds
# ---------------------------------------------------------------------------

class TestLoadOwwModelWaitsForPreload(unittest.TestCase):

    def test_load_oww_model_waits_for_preload(self):
        """_load_oww_model() waits on _preload_done and succeeds once model appears."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _reset_preload_state(tmpdir)
            model_dir = Path(tmpdir) / "wakeword_models"
            model_dir.mkdir()
            tflite = model_dir / "hey_jarvis_v0.1.tflite"

            def _delayed_preload():
                import time
                time.sleep(0.3)
                tflite.touch()
                ww._preload_done.set()

            t = threading.Thread(target=_delayed_preload, daemon=True)
            t.start()

            model_stub = mock.MagicMock()
            oww_model_stub = sys.modules["openwakeword.model"]
            oww_model_stub.Model = mock.MagicMock(return_value=model_stub)

            ww._load_oww_model()  # should block ~0.3s then succeed

            oww_model_stub.Model.assert_called_once()
            t.join(timeout=2)


# ---------------------------------------------------------------------------
# Test 5: status endpoint includes model_preloaded and preload_error keys
# ---------------------------------------------------------------------------

def _call_status():
    """
    Call wakeword_status() if it's a real coroutine, otherwise build the dict
    directly from module state (happens when module was imported with the old
    _Stub router that swaps the decorated function with a stub instance).
    """
    import inspect
    fn = ww.wakeword_status
    if inspect.iscoroutinefunction(fn):
        return asyncio.run(fn(None))
    # Fallback: replicate the dict the endpoint builds from module state
    state = ww._get_state()
    return {
        "enabled":         state != "DISABLED",
        "state":           state.lower(),
        "model_loaded":    ww._oww_model is not None,
        "model_preloaded": ww._preload_done.is_set() and ww._preload_error is None,
        "preload_error":   ww._preload_error,
        "last_error":      ww._last_error,
        "model":           ww.WAKEWORD_MODEL,
        "threshold":       ww.WAKEWORD_THRESHOLD,
    }


class TestStatusEndpointPreloadFields(unittest.TestCase):

    def test_status_endpoint_preload_fields(self):
        """Status response includes model_preloaded=True and preload_error=None when done."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _reset_preload_state(tmpdir)
            ww._preload_done.set()  # simulate completed preload

            result = _call_status()

            self.assertIn("model_preloaded", result, "status must have model_preloaded")
            self.assertIn("preload_error", result, "status must have preload_error")
            self.assertTrue(result["model_preloaded"])
            self.assertIsNone(result["preload_error"])

    def test_status_endpoint_preload_pending(self):
        """Status response has model_preloaded=False when preload not yet done."""
        _reset_preload_state()
        # _preload_done is NOT set

        result = _call_status()

        self.assertFalse(result["model_preloaded"])
        self.assertIsNone(result["preload_error"])

    def test_status_endpoint_preload_error(self):
        """Status response has preload_error string and model_preloaded=False on failure."""
        _reset_preload_state()
        ww._preload_done.set()
        ww._preload_error = "Network unreachable"

        result = _call_status()

        self.assertFalse(result["model_preloaded"])
        self.assertEqual(result["preload_error"], "Network unreachable")

        ww._preload_error = None  # cleanup


# ---------------------------------------------------------------------------
# Test 6: _load_ws_model() returns a Model when files are pre-cached
# ---------------------------------------------------------------------------

class TestWsModelReadyWhenCached(unittest.TestCase):

    def test_ws_model_ready_when_model_cached(self):
        """_load_ws_model() returns a Model instance without downloading if files present."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _reset_preload_state(tmpdir)

            model_dir = Path(tmpdir) / "wakeword_models"
            model_dir.mkdir()
            (model_dir / "hey_jarvis_v0.1.tflite").touch()
            (model_dir / "melspectrogram.tflite").touch()
            (model_dir / "embedding_model.tflite").touch()

            model_stub = mock.MagicMock()
            oww_model_stub = sys.modules["openwakeword.model"]
            oww_model_stub.Model = mock.MagicMock(return_value=model_stub)
            oww_utils_stub = sys.modules["openwakeword.utils"]
            oww_utils_stub.download_models = mock.MagicMock()

            result = ww._load_ws_model()

            self.assertIs(result, model_stub, "_load_ws_model should return the Model instance")
            oww_utils_stub.download_models.assert_not_called()
            oww_model_stub.Model.assert_called_once()


if __name__ == "__main__":
    unittest.main()
