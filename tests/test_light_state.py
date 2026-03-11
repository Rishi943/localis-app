import pytest
from fastapi.testclient import TestClient

# Import app at module level so register_assist() runs only once.
from app.main import app

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

    client = TestClient(app)
    resp = client.get("/assist/light_state")
    assert resp.status_code == 503
    assert "error" in resp.json().get("detail", {})
