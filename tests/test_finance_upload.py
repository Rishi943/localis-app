"""
tests/test_finance_upload.py
FIN-02 integration tests: upload endpoint and deduplication.

Tests use the FastAPI TestClient from conftest.py.
Tests are written RED: they will skip/xfail until app/finance.py is implemented.

Run:
    python -m pytest tests/test_finance_upload.py -v
"""
import io
import pytest

# ---------------------------------------------------------------------------
# Import guard
# ---------------------------------------------------------------------------
try:
    import app.finance  # noqa: F401
    _FINANCE_AVAILABLE = True
except ImportError:
    _FINANCE_AVAILABLE = False

from tests.conftest import CHEQUING_CSV_FIXTURE

# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _upload(client, csv_text: str, period_label: str = "Jan 2026"):
    """POST /finance/upload_csv with the given CSV string."""
    return client.post(
        "/finance/upload_csv",
        data={"period_label": period_label},
        files={"file": ("chequing.csv", io.BytesIO(csv_text.encode("utf-8")), "text/csv")},
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _FINANCE_AVAILABLE, reason="app.finance not yet implemented")
def test_upload_endpoint(client):
    """
    POST /finance/upload_csv with a valid chequing CSV.
    Expected: 200, response JSON contains row_count > 0.
    """
    resp = _upload(client, CHEQUING_CSV_FIXTURE, period_label="Jan 2026")
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("row_count", 0) > 0


@pytest.mark.skipif(not _FINANCE_AVAILABLE, reason="app.finance not yet implemented")
def test_dedup(client):
    """
    Same CSV uploaded twice → second upload inserts 0 new rows.
    Expected: second response has inserted=0 or skipped_count == row_count.
    """
    # First upload
    resp1 = _upload(client, CHEQUING_CSV_FIXTURE, period_label="Jan 2026 Dedup Test")
    assert resp1.status_code == 200
    first_count = resp1.json().get("row_count", 0)
    assert first_count > 0

    # Second upload of same data
    resp2 = _upload(client, CHEQUING_CSV_FIXTURE, period_label="Jan 2026 Dedup Test")
    assert resp2.status_code == 200
    data2 = resp2.json()

    # Dedup behaviour: inserted should be 0 (all skipped)
    inserted = data2.get("inserted", data2.get("row_count", -1))
    skipped = data2.get("skipped_count", 0)

    # Either inserted == 0 OR skipped == first_count
    assert inserted == 0 or skipped == first_count, (
        f"Expected duplicate upload to insert 0 rows, got: {data2}"
    )
