"""
tests/test_finance_db.py
FIN-05 integration tests: multi-period aggregation via dashboard endpoint.

Uses both the fin_db fixture (for direct DB setup) and the FastAPI TestClient.
Tests are written RED: they will skip until app/finance.py is implemented.

Run:
    python -m pytest tests/test_finance_db.py -v
"""
import sqlite3
import uuid
from datetime import datetime, timezone
import pytest

# ---------------------------------------------------------------------------
# Import guard
# ---------------------------------------------------------------------------
try:
    import app.finance  # noqa: F401
    _FINANCE_AVAILABLE = True
except ImportError:
    _FINANCE_AVAILABLE = False


# ---------------------------------------------------------------------------
# Helper: insert a minimal fin_uploads + fin_transactions pair
# ---------------------------------------------------------------------------

def _insert_transaction(
    conn: sqlite3.Connection,
    *,
    date: str,
    description: str,
    amount: float,
    tx_type: str = "debit",
    category: str = "Food",
    period_label: str = "Jan 2026",
    account_type: str = "chequing",
) -> None:
    upload_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    c = conn.cursor()
    c.execute(
        "INSERT OR IGNORE INTO fin_uploads (id, filename, period_label, account_type, uploaded_at, row_count)"
        " VALUES (?, ?, ?, ?, ?, 1)",
        (upload_id, "test.csv", period_label, account_type, now),
    )
    c.execute(
        "INSERT OR IGNORE INTO fin_transactions"
        " (upload_id, date, description, amount, type, category, period_label, account_type)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (upload_id, date, description, amount, tx_type, category, period_label, account_type),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Unit-level aggregation test (direct SQL on fin_db fixture)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _FINANCE_AVAILABLE, reason="app.finance not yet implemented")
def test_multi_period_aggregation_sql(fin_db):
    """
    Insert rows across two periods then verify combined totals via SQL.
    This tests the data model directly, independent of the HTTP layer.
    """
    conn = fin_db

    _insert_transaction(conn, date="2026-01-15", description="TIM HORTONS", amount=5.75, period_label="Jan 2026")
    _insert_transaction(conn, date="2026-01-20", description="UBER", amount=18.50, category="Transport", period_label="Jan 2026")
    _insert_transaction(conn, date="2026-02-10", description="NETFLIX", amount=15.99, category="Entertainment", period_label="Feb 2026")
    _insert_transaction(conn, date="2026-02-15", description="AMAZON", amount=42.99, category="Shopping", period_label="Feb 2026")

    c = conn.cursor()

    # Total spend across all periods
    c.execute("SELECT SUM(amount) FROM fin_transactions WHERE type = 'debit'")
    total = c.fetchone()[0]
    assert total == pytest.approx(5.75 + 18.50 + 15.99 + 42.99)

    # Two distinct period_labels
    c.execute("SELECT DISTINCT period_label FROM fin_transactions ORDER BY period_label")
    periods = [row[0] for row in c.fetchall()]
    assert "Jan 2026" in periods
    assert "Feb 2026" in periods


# ---------------------------------------------------------------------------
# HTTP-level aggregation test (via dashboard endpoint)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _FINANCE_AVAILABLE, reason="app.finance not yet implemented")
def test_multi_period_aggregation(client):
    """
    Upload two batches for different periods then GET /finance/dashboard?period=All+time.
    Expected: response contains combined totals across both periods.
    """
    import io

    jan_csv = "01/15/2026,TIM HORTONS,5.75,\n01/20/2026,UBER,18.50,\n"
    feb_csv = "02/10/2026,NETFLIX,15.99,\n02/15/2026,AMAZON,42.99,\n"

    # Upload January
    r1 = client.post(
        "/finance/upload_csv",
        data={"period_label": "Jan 2026 DB Test"},
        files={"file": ("jan.csv", io.BytesIO(jan_csv.encode()), "text/csv")},
    )
    assert r1.status_code == 200

    # Upload February
    r2 = client.post(
        "/finance/upload_csv",
        data={"period_label": "Feb 2026 DB Test"},
        files={"file": ("feb.csv", io.BytesIO(feb_csv.encode()), "text/csv")},
    )
    assert r2.status_code == 200

    # Dashboard with "All time" filter
    resp = client.get("/finance/dashboard", params={"period": "All time"})
    assert resp.status_code == 200
    data = resp.json()

    # Combined debit total should cover both periods (at least the sum)
    total_spend = data.get("total_spend", data.get("totals", {}).get("debit", 0))
    assert total_spend >= (5.75 + 18.50 + 15.99 + 42.99) - 0.01
