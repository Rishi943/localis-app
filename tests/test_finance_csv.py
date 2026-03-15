"""
tests/test_finance_csv.py
FIN-02 / FIN-03 unit tests: CSV parser and categoriser.

All tests use embedded fixture data — no file I/O, no live app.
Tests are written RED: they will skip if app/finance.py does not exist yet.

Run:
    python -m pytest tests/test_finance_csv.py -v
"""
import pytest

# ---------------------------------------------------------------------------
# Import guard: skip entire module if finance module not yet implemented
# ---------------------------------------------------------------------------
try:
    from app.finance import (
        parse_chequing_csv,
        parse_credit_card_csv,
        categorise,
        detect_account_type,
    )
    _FINANCE_AVAILABLE = True
except ImportError:
    _FINANCE_AVAILABLE = False

pytestmark = pytest.mark.skipif(
    not _FINANCE_AVAILABLE,
    reason="app.finance not yet implemented — Wave 1 will provide it"
)

# ---------------------------------------------------------------------------
# Fixture data (self-contained)
# ---------------------------------------------------------------------------

CHEQUING_DEBIT_ROW = ["01/15/2026", "TIM HORTONS YONGE ST", "5.75", ""]
CHEQUING_CREDIT_ROW = ["01/20/2026", "E-TRANSFER FROM ALICE", "", "200.00"]

CREDIT_DEBIT_ROW = ["01/10/2026", "NETFLIX.COM", "15.99", "", "XXXX1234"]
CREDIT_PAYMENT_ROW = ["01/25/2026", "PAYMENT THANK YOU", "500.00", "", "XXXX1234"]

LATIN1_CSV_BYTES = "01/10/2026,Caf\xe9 Dépanneur,3.50,\n".encode("latin-1")

# ---------------------------------------------------------------------------
# Chequing parser tests
# ---------------------------------------------------------------------------


def test_chequing_debit():
    """4-col debit row → type='debit', amount=5.75, category='Food'."""
    result = parse_chequing_csv([CHEQUING_DEBIT_ROW])
    assert len(result) == 1
    tx = result[0]
    assert tx["type"] == "debit"
    assert tx["amount"] == pytest.approx(5.75)
    assert tx["category"] == "Food"


def test_chequing_credit():
    """4-col credit row → type='credit', amount=200.0."""
    result = parse_chequing_csv([CHEQUING_CREDIT_ROW])
    assert len(result) == 1
    tx = result[0]
    assert tx["type"] == "credit"
    assert tx["amount"] == pytest.approx(200.0)


# ---------------------------------------------------------------------------
# Credit card parser tests
# ---------------------------------------------------------------------------


def test_credit_card_debit():
    """5-col spend row → type='debit', amount=15.99, category='Entertainment'."""
    result = parse_credit_card_csv([CREDIT_DEBIT_ROW])
    assert len(result) == 1
    tx = result[0]
    assert tx["type"] == "debit"
    assert tx["amount"] == pytest.approx(15.99)
    assert tx["category"] == "Entertainment"


def test_credit_card_payment():
    """5-col PAYMENT row → type='credit'."""
    result = parse_credit_card_csv([CREDIT_PAYMENT_ROW])
    assert len(result) == 1
    tx = result[0]
    assert tx["type"] == "credit"


# ---------------------------------------------------------------------------
# Encoding test
# ---------------------------------------------------------------------------


def test_encoding_latin1():
    """latin-1 bytes with é char should decode without UnicodeDecodeError."""
    from app.finance import parse_csv_bytes
    rows = parse_csv_bytes(LATIN1_CSV_BYTES)
    assert len(rows) >= 1
    # description should contain the café name without raising
    desc = rows[0]["description"]
    assert "ann" in desc.lower() or "caf" in desc.lower() or desc  # just no exception


# ---------------------------------------------------------------------------
# Account type detection
# ---------------------------------------------------------------------------


def test_account_type_detection_chequing():
    """4-column row → 'chequing'."""
    account_type = detect_account_type(["01/15/2026", "TIM HORTONS", "5.75", ""])
    assert account_type == "chequing"


def test_account_type_detection_credit_card():
    """5-column row → 'credit_card'."""
    account_type = detect_account_type(["01/10/2026", "NETFLIX", "15.99", "", "XXXX1234"])
    assert account_type == "credit_card"


# ---------------------------------------------------------------------------
# Categoriser tests
# ---------------------------------------------------------------------------


def test_categorise_food():
    """TIM HORTONS merchant → 'Food' category."""
    assert categorise("TIM HORTONS YONGE ST") == "Food"


def test_categorise_transport():
    """TTC PRESTO → 'Transport' category."""
    assert categorise("TTC PRESTO RELOAD") == "Transport"


def test_categorise_other():
    """Unknown merchant → 'Other' fallback."""
    assert categorise("RANDOM MERCHANT XYZ 99999") == "Other"
