"""
tests/conftest.py
Shared fixtures for Phase 2 Finance tests.

Provides:
- fin_db: in-memory SQLite connection with fin_* tables created
- client: FastAPI TestClient around the main app (with llama_cpp stubbed)
- CHEQUING_CSV_FIXTURE: 3 debit + 1 credit rows, no header
- CREDIT_CARD_CSV_FIXTURE: 2 spend + 1 payment rows, no header
"""
import os
import sys
import sqlite3
import pytest
from unittest.mock import MagicMock

# ---------------------------------------------------------------------------
# Project root importable without package install
# ---------------------------------------------------------------------------
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

# ---------------------------------------------------------------------------
# Stub heavy optional modules before any app import
# ---------------------------------------------------------------------------
sys.modules.setdefault("llama_cpp", MagicMock())
sys.modules.setdefault("sentence_transformers", MagicMock())

# ---------------------------------------------------------------------------
# CSV fixture strings (embedded — no file I/O)
# ---------------------------------------------------------------------------

# CIBC Chequing: 4 columns, Date | Description | Debit | Credit
# Rows: 3 debits (TIM HORTONS, UBER, AMAZON) + 1 credit (E-TRANSFER)
CHEQUING_CSV_FIXTURE = (
    "01/15/2026,TIM HORTONS YONGE ST,5.75,\n"
    "01/16/2026,UBER TRIP,18.50,\n"
    "01/17/2026,AMAZON.CA,42.99,\n"
    "01/20/2026,E-TRANSFER FROM ALICE,,200.00\n"
)

# CIBC Credit Card: 5 columns, Date | Description | CAD Amount | [blank] | Masked card
# Rows: 2 spend (NETFLIX, SHOPIFY) + 1 payment (PAYMENT THANK YOU)
CREDIT_CARD_CSV_FIXTURE = (
    "01/10/2026,NETFLIX.COM,15.99,,XXXX1234\n"
    "01/12/2026,SHOPIFY PURCHASE,25.00,,XXXX1234\n"
    "01/25/2026,PAYMENT THANK YOU,500.00,,XXXX1234\n"
)

# ---------------------------------------------------------------------------
# fin_db fixture: in-memory SQLite with fin_* tables
# ---------------------------------------------------------------------------

def _create_fin_tables(conn: sqlite3.Connection) -> None:
    """Create the finance tables in the given connection (matches planned schema)."""
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS fin_uploads (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            period_label TEXT NOT NULL,
            account_type TEXT NOT NULL,
            uploaded_at TEXT NOT NULL,
            row_count INTEGER NOT NULL DEFAULT 0
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS fin_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            upload_id TEXT NOT NULL,
            date TEXT NOT NULL,
            description TEXT NOT NULL,
            amount REAL NOT NULL,
            type TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'Other',
            period_label TEXT NOT NULL,
            account_type TEXT NOT NULL,
            FOREIGN KEY(upload_id) REFERENCES fin_uploads(id),
            UNIQUE(date, description, amount, account_type)
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS fin_goals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            goal_type TEXT NOT NULL,
            life_events TEXT NOT NULL DEFAULT '[]',
            budgets TEXT NOT NULL DEFAULT '{}',
            horizon TEXT,
            created_at TEXT NOT NULL
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            last_updated TEXT
        )
    """)

    conn.commit()


@pytest.fixture
def fin_db():
    """
    In-memory SQLite connection with fin_* tables and app_settings.
    Isolated per test — no disk I/O.
    """
    conn = sqlite3.connect(":memory:")
    _create_fin_tables(conn)
    yield conn
    conn.close()


# ---------------------------------------------------------------------------
# client fixture: FastAPI TestClient with stubs
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def client():
    """
    FastAPI TestClient wrapping the main app.
    llama_cpp is stubbed out so no model file is needed.

    Uses a context manager so the startup event fires and init_db() runs,
    creating all tables including fin_* tables before any test runs.
    """
    from fastapi.testclient import TestClient
    import app.main as main_module
    with TestClient(main_module.app, raise_server_exceptions=False) as test_client:
        yield test_client
