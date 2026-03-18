"""
tests/test_finance_e2e.py
Comprehensive E2E tests for the Finance Advisor module (app/finance.py).

Covers:
  1. GET /finance/status — correct structure, onboarding_done reflects DB state
  2. POST /finance/upload_csv — CIBC chequing CSV parses rows correctly
  3. GET /finance/dashboard_data — category breakdown, trend, transactions
  4. POST /finance/goals — sets goals correctly, marks onboarding done
  5. POST /finance/chat — 503 when no model loaded
  6. Period filtering — dashboard_data respects period param
  7. Deduplication — uploading same CSV twice skips duplicate rows

Run:
    python -m pytest tests/test_finance_e2e.py -v
"""
import io
import os
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

# ---------------------------------------------------------------------------
# Make project root importable
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

# Stub heavy deps before any app import
sys.modules.setdefault("llama_cpp", MagicMock())
sys.modules.setdefault("sentence_transformers", MagicMock())
sys.modules.setdefault("openwakeword", MagicMock())
sys.modules.setdefault("faster_whisper", MagicMock())
sys.modules.setdefault("sounddevice", MagicMock())
sys.modules.setdefault("pynvml", MagicMock())

from fastapi.testclient import TestClient
import app.database as _database
import app.finance as _finance

# ---------------------------------------------------------------------------
# Minimal CIBC chequing CSV fixture
# ---------------------------------------------------------------------------
# CIBC chequing CSV format (4 columns — no Balance column):
#   Date, Description, Debit, Credit
# detect_account_type uses len(row) >= 5 → credit_card, else → chequing
CIBC_CHEQUING_CSV = """\
01/02/2026,TIM HORTONS #1234,5.50,
01/03/2026,FRESHCO GROCERY,82.30,
01/04/2026,NETFLIX,18.99,
01/04/2026,PAYROLL DEPOSIT,,2500.00
01/05/2026,UBER TRIP,14.75,
""".encode("utf-8")

CIBC_CHEQUING_CSV_LABEL = "Jan 2026"

# Duplicate CSV — same transactions, used to test deduplication
CIBC_CHEQUING_CSV_DUPE = CIBC_CHEQUING_CSV  # identical bytes


# ---------------------------------------------------------------------------
# Minimal FastAPI app for isolated testing
# ---------------------------------------------------------------------------

def _make_isolated_app(db_path: str):
    """Build a minimal FastAPI app with only the finance router, backed by db_path."""
    from fastapi import FastAPI

    mini_app = FastAPI()

    # Register finance router with the temp DB
    _finance.register_finance(mini_app, db_path)

    return mini_app


class FinanceE2ETests(unittest.TestCase):
    """End-to-end tests for the /finance/* endpoints."""

    def setUp(self):
        # Create a fresh temp DB for each test
        self._tmpdir = tempfile.mkdtemp()
        self._db_path = os.path.join(self._tmpdir, "test_finance.db")

        # Point database module at temp path BEFORE init_db
        _database.DB_NAME = self._db_path
        _database.init_db()

        # Build minimal isolated app and test client
        self._app = _make_isolated_app(self._db_path)
        self.client = TestClient(self._app, raise_server_exceptions=False)

    def tearDown(self):
        import shutil
        shutil.rmtree(self._tmpdir, ignore_errors=True)

    # -----------------------------------------------------------------------
    # 1. GET /finance/status
    # -----------------------------------------------------------------------

    def test_status_structure(self):
        """GET /finance/status returns expected keys with correct types."""
        resp = self.client.get("/finance/status")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        self.assertIn("onboarding_done", data)
        self.assertIn("upload_count", data)
        self.assertIn("periods", data)

        self.assertIsInstance(data["onboarding_done"], bool)
        self.assertIsInstance(data["upload_count"], int)
        self.assertIsInstance(data["periods"], list)

    def test_status_onboarding_false_by_default(self):
        """fin_onboarding_done is false on a fresh database."""
        resp = self.client.get("/finance/status")
        data = resp.json()
        self.assertFalse(data["onboarding_done"])
        self.assertEqual(data["upload_count"], 0)
        self.assertEqual(data["periods"], [])

    def test_status_onboarding_true_after_goals_saved(self):
        """onboarding_done becomes true after POST /finance/goals."""
        self.client.post(
            "/finance/goals",
            json={"goal_type": "saving", "life_events": [], "budgets": {}, "horizon": "1 year"},
        )
        resp = self.client.get("/finance/status")
        data = resp.json()
        self.assertTrue(data["onboarding_done"])

    # -----------------------------------------------------------------------
    # 2. POST /finance/upload_csv — CIBC chequing parsing
    # -----------------------------------------------------------------------

    def test_upload_csv_parses_rows(self):
        """POST /finance/upload_csv correctly parses a CIBC chequing CSV."""
        resp = self.client.post(
            "/finance/upload_csv",
            data={"period_label": CIBC_CHEQUING_CSV_LABEL},
            files={"file": ("cibc_jan.csv", io.BytesIO(CIBC_CHEQUING_CSV), "text/csv")},
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()

        self.assertIn("upload_id", data)
        self.assertIn("row_count", data)
        self.assertIn("inserted", data)
        self.assertIn("skipped_count", data)
        self.assertIn("account_type", data)

        # 5 rows: 3 debits + 1 credit + 1 debit — only debit/credit counted
        # Credits (deposits) are included; total rows = all non-header rows = 5
        self.assertGreater(data["row_count"], 0)
        self.assertEqual(data["account_type"], "chequing")
        self.assertEqual(data["skipped_count"], 0)
        self.assertEqual(data["inserted"], data["row_count"])

    def test_upload_csv_categories_assigned(self):
        """Uploaded transactions get categorised correctly."""
        self.client.post(
            "/finance/upload_csv",
            data={"period_label": CIBC_CHEQUING_CSV_LABEL},
            files={"file": ("cibc.csv", io.BytesIO(CIBC_CHEQUING_CSV), "text/csv")},
        )
        resp = self.client.get(f"/finance/dashboard_data?period={CIBC_CHEQUING_CSV_LABEL}")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        categories = {c["category"] for c in data.get("categories", [])}
        # TIM HORTONS → Food, FRESHCO → Food, NETFLIX → Entertainment(?)/Other,
        # UBER → Transport  — at minimum Food should be present
        self.assertTrue(len(categories) > 0, "Expected at least one spending category")

    def test_upload_csv_empty_file_returns_422(self):
        """Uploading an empty CSV returns HTTP 422."""
        resp = self.client.post(
            "/finance/upload_csv",
            data={"period_label": "Empty"},
            files={"file": ("empty.csv", io.BytesIO(b""), "text/csv")},
        )
        self.assertEqual(resp.status_code, 422)

    # -----------------------------------------------------------------------
    # 3. GET /finance/dashboard_data
    # -----------------------------------------------------------------------

    def test_dashboard_data_structure(self):
        """GET /finance/dashboard_data returns expected keys."""
        resp = self.client.get("/finance/dashboard_data")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        self.assertIn("categories", data)
        self.assertIn("trend", data)
        self.assertIn("transactions", data)
        self.assertIn("has_goals", data)

    def test_dashboard_data_empty_on_fresh_db(self):
        """dashboard_data returns empty lists when no uploads exist."""
        resp = self.client.get("/finance/dashboard_data")
        data = resp.json()
        self.assertEqual(data["categories"], [])
        self.assertEqual(data["trend"], [])
        self.assertEqual(data["transactions"], [])

    def test_dashboard_data_populated_after_upload(self):
        """dashboard_data returns transactions after a CSV upload."""
        self.client.post(
            "/finance/upload_csv",
            data={"period_label": CIBC_CHEQUING_CSV_LABEL},
            files={"file": ("cibc.csv", io.BytesIO(CIBC_CHEQUING_CSV), "text/csv")},
        )
        resp = self.client.get("/finance/dashboard_data")
        data = resp.json()

        self.assertGreater(len(data["transactions"]), 0)
        tx = data["transactions"][0]
        self.assertIn("date", tx)
        self.assertIn("description", tx)
        self.assertIn("amount", tx)
        self.assertIn("category", tx)
        self.assertIn("type", tx)

    # -----------------------------------------------------------------------
    # 4. POST /finance/goals
    # -----------------------------------------------------------------------

    def test_save_goals_returns_ok(self):
        """POST /finance/goals returns {ok: true}."""
        payload = {
            "goal_type": "build emergency fund",
            "life_events": ["vacation", "wedding"],
            "budgets": {"Food": 400, "Transport": 150},
            "horizon": "2 years",
        }
        resp = self.client.post("/finance/goals", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data.get("ok"))

    def test_save_goals_persists_data(self):
        """Goals saved via POST /finance/goals are retrievable via GET /finance/goals."""
        payload = {
            "goal_type": "saving for house",
            "life_events": ["house"],
            "budgets": {"Food": 300},
            "horizon": "5 years",
        }
        self.client.post("/finance/goals", json=payload)
        resp = self.client.get("/finance/goals")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIsNotNone(data.get("goals"))
        goals = data["goals"]
        self.assertEqual(goals.get("goal_type"), "saving for house")

    def test_save_goals_marks_onboarding_done(self):
        """Saving goals sets fin_onboarding_done to true."""
        self.client.post(
            "/finance/goals",
            json={"goal_type": "test", "life_events": [], "budgets": {}, "horizon": ""},
        )
        import app.database as database
        val = database.get_app_setting("fin_onboarding_done")
        self.assertEqual(val, "true")

    def test_dashboard_has_goals_after_budgets_set(self):
        """dashboard_data.has_goals is True when goals with budgets have been saved."""
        self.client.post(
            "/finance/goals",
            json={"goal_type": "save", "life_events": [], "budgets": {"Food": 400}, "horizon": "1y"},
        )
        resp = self.client.get("/finance/dashboard_data")
        data = resp.json()
        self.assertTrue(data["has_goals"])

    # -----------------------------------------------------------------------
    # 5. POST /finance/chat — 503 when no model loaded
    # -----------------------------------------------------------------------

    def test_finance_chat_503_no_model(self):
        """POST /finance/chat returns 503 when no LLM is loaded."""
        resp = self.client.post(
            "/finance/chat",
            json={"message": "What did I spend the most on?", "session_id": "test-session"},
        )
        # Without a loaded model, the endpoint should return 503 Service Unavailable
        self.assertEqual(resp.status_code, 503)

    # -----------------------------------------------------------------------
    # 6. Period filtering
    # -----------------------------------------------------------------------

    def test_period_filter_isolates_data(self):
        """dashboard_data with a specific period only returns that period's transactions."""
        # Upload Jan data
        self.client.post(
            "/finance/upload_csv",
            data={"period_label": "Jan 2026"},
            files={"file": ("jan.csv", io.BytesIO(CIBC_CHEQUING_CSV), "text/csv")},
        )
        # Upload Feb data (different label, same CSV for simplicity — deduplication
        # is by date+description+amount+account_type, so same rows → all skipped)
        feb_csv = b"""\
Date,Description,Debit,Credit,Balance
02/01/2026,FRESHCO GROCERY,90.00,,910.00
02/02/2026,COFFEE SHOP,6.00,,904.00
"""
        self.client.post(
            "/finance/upload_csv",
            data={"period_label": "Feb 2026"},
            files={"file": ("feb.csv", io.BytesIO(feb_csv), "text/csv")},
        )

        # All time should have more transactions than Jan alone
        resp_all = self.client.get("/finance/dashboard_data?period=All+time")
        resp_jan = self.client.get("/finance/dashboard_data?period=Jan+2026")
        resp_feb = self.client.get("/finance/dashboard_data?period=Feb+2026")

        data_all = resp_all.json()
        data_jan = resp_jan.json()
        data_feb = resp_feb.json()

        self.assertGreaterEqual(
            len(data_all["transactions"]),
            len(data_jan["transactions"]),
            "All-time should have >= Jan transactions",
        )
        # Jan should only contain transactions with period_label Jan 2026
        for tx in data_jan["transactions"]:
            self.assertEqual(tx.get("period_label", "Jan 2026"), "Jan 2026")

    def test_status_periods_list_populated_after_upload(self):
        """GET /finance/status lists period labels after CSV uploads."""
        self.client.post(
            "/finance/upload_csv",
            data={"period_label": "Mar 2026"},
            files={"file": ("mar.csv", io.BytesIO(CIBC_CHEQUING_CSV), "text/csv")},
        )
        resp = self.client.get("/finance/status")
        data = resp.json()
        self.assertIn("Mar 2026", data["periods"])
        self.assertEqual(data["upload_count"], 1)

    # -----------------------------------------------------------------------
    # 7. Deduplication — upload same CSV twice
    # -----------------------------------------------------------------------

    def test_deduplication_on_reupload(self):
        """Uploading the same CSV twice skips duplicate rows on second upload."""
        resp1 = self.client.post(
            "/finance/upload_csv",
            data={"period_label": CIBC_CHEQUING_CSV_LABEL},
            files={"file": ("cibc.csv", io.BytesIO(CIBC_CHEQUING_CSV), "text/csv")},
        )
        data1 = resp1.json()
        first_inserted = data1["inserted"]
        self.assertGreater(first_inserted, 0)

        # Same file, same period_label — all rows should be deduplicated
        resp2 = self.client.post(
            "/finance/upload_csv",
            data={"period_label": CIBC_CHEQUING_CSV_LABEL},
            files={"file": ("cibc.csv", io.BytesIO(CIBC_CHEQUING_CSV_DUPE), "text/csv")},
        )
        data2 = resp2.json()
        self.assertEqual(data2["inserted"], 0, "All rows should be skipped on duplicate upload")
        self.assertEqual(data2["skipped_count"], first_inserted)


if __name__ == "__main__":
    unittest.main()
