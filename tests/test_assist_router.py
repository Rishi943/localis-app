"""
tests/test_assist_router.py
Unit tests for app/assist.py — parsing, heuristic fallback, executor.
Runs without a GGUF model and without a live Home Assistant instance.

Run:
    python -m pytest tests/test_assist_router.py -v
    # or
    python -m unittest tests.test_assist_router -v
"""
import asyncio
import sys
import os
import unittest
from unittest.mock import AsyncMock, patch, MagicMock

# ---------------------------------------------------------------------------
# Make project root importable without installing the package
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

# Stub out llama_cpp so the module imports cleanly without a wheel
sys.modules.setdefault("llama_cpp", MagicMock())

# Patch env before import so ASSIST_PHASE is predictable
os.environ.setdefault("LOCALIS_ASSIST_PHASE", "2")

import importlib
import app.assist as assist
# Re-read the module-level constant after env patch
importlib.reload(assist)

from app.assist import (
    _parse_native_call,
    _heuristic_fallback,
    _build_call_from_name_args,
    _normalise_json_call,
    _execute_tool_call,
    ha_call_service,
    ha_get_state,
    ASSIST_PHASE,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def run_async(coro):
    """Run a coroutine synchronously (Python 3.7+)."""
    return asyncio.run(coro)


# ===========================================================================
# 1. Parsing tests
# ===========================================================================

class TestParseNativeCall(unittest.TestCase):
    """Tests for _parse_native_call covering all formats."""

    # --- Format B: <start_function_call>call:NAME{key:<escape>val<escape>} ---

    def test_format_b_toggle_off(self):
        content = "<start_function_call>call:toggle_lights{state:<escape>off<escape>}"
        result = _parse_native_call(content)
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "toggle_lights")
        self.assertEqual(result["arguments"]["state"], "off")

    def test_format_b_toggle_on(self):
        content = "<start_function_call>call:toggle_lights{state:<escape>on<escape>}"
        result = _parse_native_call(content)
        self.assertIsNotNone(result)
        self.assertEqual(result["arguments"]["state"], "on")

    def test_format_b_intent_unclear(self):
        content = "<start_function_call>call:intent_unclear{reason:<escape>no_matching_function<escape>}"
        result = _parse_native_call(content)
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "intent_unclear")
        self.assertEqual(result["arguments"]["reason"], "no_matching_function")

    def test_format_b_brightness_phase2(self):
        content = "<start_function_call>call:toggle_lights{state:<escape>on<escape>,brightness_pct:<escape>75<escape>}"
        result = _parse_native_call(content)
        self.assertIsNotNone(result)
        self.assertEqual(result["arguments"]["state"], "on")
        if ASSIST_PHASE >= 2:
            self.assertEqual(result["arguments"]["brightness_pct"], 75)

    def test_format_b_invalid_state_defaults_off(self):
        content = "<start_function_call>call:toggle_lights{state:<escape>maybe<escape>}"
        result = _parse_native_call(content)
        self.assertIsNotNone(result)
        self.assertEqual(result["arguments"]["state"], "off")

    # --- Format A: <start_function_call>call:NAME(tokens) ---

    def test_format_a_toggle_on(self):
        content = "<start_function_call>call:toggle_lights(turn_on_state)"
        result = _parse_native_call(content)
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "toggle_lights")
        self.assertEqual(result["arguments"]["state"], "on")

    def test_format_a_toggle_off(self):
        content = "<start_function_call>call:toggle_lights(bedroom_off)"
        result = _parse_native_call(content)
        self.assertIsNotNone(result)
        self.assertEqual(result["arguments"]["state"], "off")

    def test_format_a_intent_unclear(self):
        content = "<start_function_call>call:intent_unclear(order_pizza)"
        result = _parse_native_call(content)
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "intent_unclear")

    # --- Format C: bare call:NAME{...} without the tag ---

    def test_format_c_bare_call(self):
        content = "Sure, call:toggle_lights{state:<escape>on<escape>} done."
        result = _parse_native_call(content)
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "toggle_lights")
        self.assertEqual(result["arguments"]["state"], "on")

    # --- Format D: <tool_call>{json}</tool_call> ---

    def test_format_d_tool_call_tag(self):
        import json
        payload = json.dumps({"name": "toggle_lights", "arguments": {"state": "off"}})
        content = f"<tool_call>{payload}</tool_call>"
        result = _parse_native_call(content)
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "toggle_lights")
        self.assertEqual(result["arguments"]["state"], "off")

    def test_format_d_malformed_json_returns_none(self):
        content = "<tool_call>not valid json</tool_call>"
        result = _parse_native_call(content)
        self.assertIsNone(result)

    # --- Format E: bare JSON {"name":..., "arguments":...} ---

    def test_format_e_bare_json(self):
        import json
        payload = json.dumps({"name": "toggle_lights", "arguments": {"state": "on"}})
        result = _parse_native_call(payload)
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "toggle_lights")

    # --- get_light_state ---

    def test_get_light_state_format_b(self):
        content = "<start_function_call>call:get_light_state{}"
        result = _parse_native_call(content)
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "get_light_state")

    # --- No match ---

    def test_unrecognised_content_returns_none(self):
        content = "I cannot help with that."
        result = _parse_native_call(content)
        self.assertIsNone(result)


# ===========================================================================
# 2. Heuristic fallback tests
# ===========================================================================

class TestHeuristicFallback(unittest.TestCase):
    """Tests for _heuristic_fallback — must never return None."""

    def test_turn_on(self):
        result = _heuristic_fallback("turn on the bedroom light")
        self.assertEqual(result["name"], "toggle_lights")
        self.assertEqual(result["arguments"]["state"], "on")

    def test_turn_off(self):
        result = _heuristic_fallback("please turn off the light")
        self.assertEqual(result["name"], "toggle_lights")
        self.assertEqual(result["arguments"]["state"], "off")

    def test_status_query(self):
        result = _heuristic_fallback("what is the current status of my light")
        self.assertEqual(result["name"], "get_light_state")

    def test_is_it_on(self):
        result = _heuristic_fallback("is it on?")
        self.assertEqual(result["name"], "get_light_state")

    def test_no_match_returns_intent_unclear(self):
        result = _heuristic_fallback("order me a pizza please")
        self.assertEqual(result["name"], "intent_unclear")

    def test_never_returns_none(self):
        for msg in ["", "blah blah", "x", "42"]:
            result = _heuristic_fallback(msg)
            self.assertIsNotNone(result, f"Should not return None for: {msg!r}")

    @unittest.skipUnless(ASSIST_PHASE >= 2, "Phase 2 only")
    def test_brightness_percent(self):
        result = _heuristic_fallback("set brightness to 40%")
        self.assertEqual(result["name"], "toggle_lights")
        self.assertEqual(result["arguments"]["brightness_pct"], 40)

    @unittest.skipUnless(ASSIST_PHASE >= 2, "Phase 2 only")
    def test_kelvin(self):
        result = _heuristic_fallback("set color temperature to 4000K")
        self.assertEqual(result["name"], "toggle_lights")
        self.assertEqual(result["arguments"]["color_temp_kelvin"], 4000)

    @unittest.skipUnless(ASSIST_PHASE >= 2, "Phase 2 only")
    def test_brightness_clamp_upper(self):
        result = _heuristic_fallback("brightness 150%")
        self.assertEqual(result["arguments"]["brightness_pct"], 100)

    @unittest.skipUnless(ASSIST_PHASE >= 2, "Phase 2 only")
    def test_kelvin_clamp_lower(self):
        result = _heuristic_fallback("1000k")
        self.assertEqual(result["arguments"]["color_temp_kelvin"], 1500)


# ===========================================================================
# 3. _build_call_from_name_args tests
# ===========================================================================

class TestBuildCallFromNameArgs(unittest.TestCase):

    def test_toggle_lights_on(self):
        result = _build_call_from_name_args("toggle_lights", {"state": "on"})
        self.assertEqual(result["arguments"]["state"], "on")

    def test_toggle_lights_invalid_state(self):
        result = _build_call_from_name_args("toggle_lights", {"state": "maybe"})
        self.assertEqual(result["arguments"]["state"], "off")

    def test_get_light_state(self):
        result = _build_call_from_name_args("get_light_state", {})
        self.assertEqual(result["name"], "get_light_state")
        self.assertEqual(result["arguments"], {})

    def test_intent_unclear_valid_reason(self):
        result = _build_call_from_name_args("intent_unclear", {"reason": "ambiguous_command"})
        self.assertEqual(result["arguments"]["reason"], "ambiguous_command")

    def test_intent_unclear_invalid_reason_defaults(self):
        result = _build_call_from_name_args("intent_unclear", {"reason": "GARBAGE"})
        self.assertEqual(result["arguments"]["reason"], "no_matching_function")

    def test_unknown_function_returns_none(self):
        result = _build_call_from_name_args("order_pizza", {})
        self.assertIsNone(result)

    @unittest.skipUnless(ASSIST_PHASE >= 2, "Phase 2 only")
    def test_brightness_pct_clamp(self):
        result = _build_call_from_name_args("toggle_lights", {"state": "on", "brightness_pct": 200})
        self.assertEqual(result["arguments"]["brightness_pct"], 100)

    @unittest.skipUnless(ASSIST_PHASE >= 2, "Phase 2 only")
    def test_color_temp_kelvin_clamp(self):
        result = _build_call_from_name_args("toggle_lights", {"color_temp_kelvin": 100})
        self.assertEqual(result["arguments"]["color_temp_kelvin"], 1500)


# ===========================================================================
# 4. Executor tests (mocked HA)
# ===========================================================================

class TestExecuteToolCall(unittest.TestCase):
    """Executor tests. HA calls are mocked — no live HA needed."""

    def _run(self, coro):
        return asyncio.run(coro)

    def setUp(self):
        # Reset module-level HA config to non-empty so guards pass
        assist._ha_url = "http://homeassistant.local:8123"
        assist._ha_token = "test_token"
        assist._light_entity = "light.bedroom_light"

    # --- intent_unclear ---

    def test_intent_unclear_response(self):
        tc = {"name": "intent_unclear", "arguments": {"reason": "no_matching_function"}}
        result = self._run(_execute_tool_call(tc))
        self.assertIn("No function available", result["response"])
        self.assertEqual(result["raw"], tc)

    # --- toggle_lights on ---

    def test_toggle_on_calls_ha(self):
        tc = {"name": "toggle_lights", "arguments": {"state": "on"}}
        with patch("app.assist.ha_call_service", new_callable=AsyncMock) as mock_svc:
            mock_svc.return_value = {}
            result = self._run(_execute_tool_call(tc))
        mock_svc.assert_called_once_with("light", "turn_on", {"entity_id": "light.bedroom_light"})
        self.assertIn("ON", result["response"])

    # --- toggle_lights off ---

    def test_toggle_off_calls_ha(self):
        tc = {"name": "toggle_lights", "arguments": {"state": "off"}}
        with patch("app.assist.ha_call_service", new_callable=AsyncMock) as mock_svc:
            mock_svc.return_value = {}
            result = self._run(_execute_tool_call(tc))
        mock_svc.assert_called_once_with("light", "turn_off", {"entity_id": "light.bedroom_light"})
        self.assertIn("OFF", result["response"])

    # --- HA unreachable ---

    def test_ha_connect_error_returns_friendly_message(self):
        # Use RuntimeError (always in the catch list) to simulate unreachable HA
        tc = {"name": "toggle_lights", "arguments": {"state": "on"}}
        with patch("app.assist.ha_call_service", new_callable=AsyncMock) as mock_svc:
            mock_svc.side_effect = RuntimeError("connection refused")
            result = self._run(_execute_tool_call(tc))
        self.assertIn("Could not reach", result["response"])

    # --- get_light_state: ON with brightness ---

    def test_get_light_state_on_with_brightness(self):
        tc = {"name": "get_light_state", "arguments": {}}
        fake_state = {
            "state": "on",
            "attributes": {"brightness": 128, "color_temp": 370}
        }
        with patch("app.assist.ha_get_state", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = fake_state
            result = self._run(_execute_tool_call(tc))
        self.assertIn("ON", result["response"])
        self.assertIn("50%", result["response"])   # 128/255*100 ≈ 50
        # mired→kelvin: 1_000_000/370 ≈ 2703K — should contain "K"
        self.assertIn("K", result["response"])

    # --- get_light_state: OFF ---

    def test_get_light_state_off(self):
        tc = {"name": "get_light_state", "arguments": {}}
        fake_state = {"state": "off", "attributes": {}}
        with patch("app.assist.ha_get_state", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = fake_state
            result = self._run(_execute_tool_call(tc))
        self.assertIn("OFF", result["response"])

    # --- get_light_state: prefers color_temp_kelvin over mired ---

    def test_get_light_state_prefers_kelvin_attr(self):
        tc = {"name": "get_light_state", "arguments": {}}
        fake_state = {
            "state": "on",
            "attributes": {"color_temp_kelvin": 4000, "color_temp": 250}
        }
        with patch("app.assist.ha_get_state", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = fake_state
            result = self._run(_execute_tool_call(tc))
        self.assertIn("4000K", result["response"])

    # --- Phase 2: brightness in toggle response ---

    @unittest.skipUnless(ASSIST_PHASE >= 2, "Phase 2 only")
    def test_toggle_on_with_brightness_includes_detail(self):
        tc = {"name": "toggle_lights", "arguments": {"state": "on", "brightness_pct": 60}}
        with patch("app.assist.ha_call_service", new_callable=AsyncMock) as mock_svc:
            mock_svc.return_value = {}
            result = self._run(_execute_tool_call(tc))
        self.assertIn("60%", result["response"])

    @unittest.skipUnless(ASSIST_PHASE >= 2, "Phase 2 only")
    def test_toggle_on_with_temp_includes_detail(self):
        tc = {"name": "toggle_lights", "arguments": {"state": "on", "color_temp_kelvin": 3000}}
        with patch("app.assist.ha_call_service", new_callable=AsyncMock) as mock_svc:
            mock_svc.return_value = {}
            result = self._run(_execute_tool_call(tc))
        self.assertIn("3000K", result["response"])

    # --- spurious 'room' arg stripped ---

    def test_room_arg_stripped(self):
        tc = {"name": "toggle_lights", "arguments": {"state": "on", "room": "bedroom"}}
        with patch("app.assist.ha_call_service", new_callable=AsyncMock) as mock_svc:
            mock_svc.return_value = {}
            result = self._run(_execute_tool_call(tc))
        # room should not be in service data
        call_args = mock_svc.call_args[0][2]
        self.assertNotIn("room", call_args)

    # --- unknown function ---

    def test_unknown_function_returns_no_function(self):
        tc = {"name": "order_pizza", "arguments": {}}
        result = self._run(_execute_tool_call(tc))
        self.assertIn("No function available", result["response"])


if __name__ == "__main__":
    unittest.main()
