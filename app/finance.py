"""
app/finance.py
Finance backend module: CSV parsing, merchant categorisation, upload and status endpoints.

Phase 2 — Financial Advisor
Follows the register_*(app, ...) module pattern from rag.py and assist.py.

Exports (for tests): register_finance, parse_chequing_csv, parse_credit_card_csv,
                     parse_csv_bytes, detect_account_type, categorise, normalize_date,
                     CATEGORY_RULES
"""
import csv
import io
import json
import uuid
import logging
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

from fastapi import APIRouter, Request, UploadFile, File, Form, HTTPException
from . import database

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/finance", tags=["finance"])


# ---------------------------------------------------------------------------
# Module registration
# ---------------------------------------------------------------------------


def register_finance(app, db_path: str) -> None:
    """Register the finance router with the FastAPI app.

    Args:
        app: FastAPI application instance
        db_path: Path to the SQLite database (str or Path)
    """
    app.state.finance_db = str(db_path)
    app.include_router(router)
    logger.info("[Finance] Finance module registered")


def _db(request: Request) -> str:
    """Extract the DB path from app.state (set by register_finance)."""
    return request.app.state.finance_db


# ---------------------------------------------------------------------------
# Categorisation rules
# ---------------------------------------------------------------------------

CATEGORY_RULES: Dict[str, List[str]] = {
    "Food": [
        "TIM HORTONS", "STARBUCKS", "MCDONALD", "MCDONALDS", "SUBWAY",
        "UBER EATS", "DOORDASH", "SKIP THE DISHES", "FRESHCO", "NO FRILLS",
        "LOBLAWS", "SOBEYS", "METRO GROCERIES", "METRO GROCERY", "FOOD BASICS",
        "WALMART GROCERY", "PIZZA PIZZA", "DOMINO", "HARVEY'S", "HARVEYS",
        "WENDY'S", "WENDYS", "A&W", "POPEYES", "GROCERIES", "SUPERSTORE",
        "WHOLE FOODS", "SAFEWAY", "MARCHÉ", "MARCHE", "BOULANGERIE",
        "RESTAURANT", "SUSHI", "THAI", "INDIAN CUISINE", "CHINESE FOOD",
        "CHIPOTLE", "FIVE GUYS", "SHAKE SHACK", "BURRITO", "TACO",
        "PANERA", "QUIZNOS", "BASKIN ROBBINS",
    ],
    "Transport": [
        "TTC", "PRESTO", "OC TRANSPO", "TRANSIT", "UBER", "LYFT",
        "PETRO CANADA", "PETROCANADA", "SHELL", "ESSO", "CANADIAN TIRE GAS",
        "SUNOCO", "PARKING", "IMPARK", "GREEN P", "ENTERPRISE CAR",
        "BUDGET CAR", "VIA RAIL", "AIR CANADA", "WESTJET", "PORTER AIRLINES",
        "GO TRANSIT", "MTO", "407 ETR", "ZIPCAR",
    ],
    "Shopping": [
        "AMAZON", "WALMART", "COSTCO", "THE BAY", "HUDSON'S BAY", "SAKS",
        "NORDSTROM", "H&M", "ZARA", "UNIQLO", "INDIGO", "CHAPTERS",
        "BEST BUY", "APPLE.COM", "APPLE STORE", "IKEA", "HOME DEPOT",
        "CANADIAN TIRE", "SPORT CHEK", "SPORTCHEK", "WINNERS", "MARSHALLS",
        "TJX", "GAP", "OLD NAVY", "BANANA REPUBLIC", "ARITZIA",
        "LULULEMON", "ROOTS", "REITMANS", "SHOPIFY",
    ],
    "Utilities": [
        "HYDRO ONE", "TORONTO HYDRO", "ENBRIDGE", "ROGERS", "BELL CANADA",
        "TELUS", "FIDO", "KOODO", "FREEDOM MOBILE", "SHAW", "VIDEOTRON",
        "INTERNET", "HYDRO", "WATER BILL", "WASTE MANAGEMENT", "INSURANCE",
        "MANULIFE", "SUNLIFE", "INTACT INSURANCE", "AVIVA", "TD INSURANCE",
        "RBC INSURANCE", "ALLSTATE", "DESJARDINS",
    ],
    "Entertainment": [
        "NETFLIX", "SPOTIFY", "APPLE TV", "DISNEY PLUS", "DISNEY+",
        "CRAVE", "PRIME VIDEO", "YOUTUBE PREMIUM", "STEAM", "PLAYSTATION",
        "XBOX", "NINTENDO", "CINEPLEX", "LANDMARK CINEMA", "TICKETMASTER",
        "EVENTBRITE", "RAPTORS", "BLUE JAYS", "LEAFS", "MLSE",
        "GOOGLE PLAY", "APP STORE", "AUDIBLE", "KINDLE",
    ],
}

# Payment keywords for credit card CSV — rows matching these are credits (payments), not spend
PAYMENT_KEYWORDS = ("PAYMENT", "PAIEMENT", "CREDIT BALANCE", "REMBOURSEMENT")


# ---------------------------------------------------------------------------
# Date normalisation
# ---------------------------------------------------------------------------


def normalize_date(date_str: str) -> str:
    """Normalize various date string formats to ISO YYYY-MM-DD.

    Tries: MM/DD/YYYY, YYYY-MM-DD, DD/MM/YYYY, MM-DD-YYYY.
    Returns the input string unchanged if no format matches.
    """
    if not date_str:
        return date_str

    # Prefer MM/DD/YYYY first (CIBC chequing default)
    # Then ISO (CIBC credit card), then DD/MM/YYYY, then MM-DD-YYYY
    formats = ("%m/%d/%Y", "%Y-%m-%d", "%d/%m/%Y", "%m-%d-%Y")
    for fmt in formats:
        try:
            return datetime.strptime(date_str, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    # Return as-is — caller can handle unknown formats
    return date_str


# ---------------------------------------------------------------------------
# Categorisation
# ---------------------------------------------------------------------------


def categorise(description: str) -> str:
    """Return a category name for the given merchant description.

    Matches against CATEGORY_RULES keyword lists.
    Falls back to "Other" if nothing matches.
    """
    if not description:
        return "Other"
    desc_upper = description.upper()
    for category, keywords in CATEGORY_RULES.items():
        for kw in keywords:
            if kw in desc_upper:
                return category
    return "Other"


# ---------------------------------------------------------------------------
# Account type detection
# ---------------------------------------------------------------------------


def detect_account_type(row: List[str]) -> str:
    """Determine account type from a single CSV row.

    CIBC chequing: 4 columns
    CIBC credit card: 5 columns
    """
    if len(row) >= 5:
        return "credit_card"
    return "chequing"


# ---------------------------------------------------------------------------
# CSV parsers
# ---------------------------------------------------------------------------


def parse_chequing_csv(rows: List[List[str]]) -> List[Dict[str, Any]]:
    """Parse a list of CIBC chequing CSV rows into transaction dicts.

    Args:
        rows: List of row lists (already split, as returned by csv.reader).
              Each row: [date, description, debit, credit]

    Returns:
        List of dicts with keys: date, description, amount, type, category
    """
    result = []
    for row in rows:
        # Ensure at least 4 columns
        if len(row) < 4:
            continue

        date_str = row[0].strip() if row[0] else ""
        description = row[1].strip() if row[1] else ""
        debit_str = row[2].strip() if row[2] else ""
        credit_str = row[3].strip() if row[3] else ""

        # Skip rows with no date
        if not date_str:
            continue

        if debit_str:
            try:
                amount = float(debit_str.replace(",", ""))
            except ValueError:
                continue
            tx_type = "debit"
        elif credit_str:
            try:
                amount = float(credit_str.replace(",", ""))
            except ValueError:
                continue
            tx_type = "credit"
        else:
            # Both empty — skip
            continue

        result.append({
            "date": normalize_date(date_str),
            "description": description,
            "amount": amount,
            "type": tx_type,
            "category": categorise(description),
        })

    return result


def parse_credit_card_csv(rows: List[List[str]]) -> List[Dict[str, Any]]:
    """Parse a list of CIBC credit card CSV rows into transaction dicts.

    Args:
        rows: List of row lists (already split).
              Each row: [date, description, cad_amount, blank, masked_card]

    Returns:
        List of dicts with keys: date, description, amount, type, category
    """
    result = []
    for row in rows:
        # Need at least date, description, amount (3 cols minimum)
        if len(row) < 3:
            continue

        date_str = row[0].strip() if row[0] else ""
        description = row[1].strip() if row[1] else ""
        amount_str = row[2].strip() if row[2] else ""

        # Skip if no date or amount
        if not date_str or not amount_str:
            continue

        try:
            amount = float(amount_str.replace(",", ""))
        except ValueError:
            continue

        desc_upper = description.upper()
        tx_type = "credit" if any(kw in desc_upper for kw in PAYMENT_KEYWORDS) else "debit"

        result.append({
            "date": normalize_date(date_str),
            "description": description,
            "amount": amount,
            "type": tx_type,
            "category": categorise(description),
        })

    return result


def parse_csv_bytes(content: bytes) -> List[Dict[str, Any]]:
    """Parse raw CSV bytes, auto-detecting encoding and account type.

    Tries UTF-8 first, falls back to latin-1 (handles Windows-1252 exports).
    Detects account type by column count of the first non-empty row.
    Dispatches to the appropriate parser.

    Args:
        content: Raw CSV file bytes

    Returns:
        List of transaction dicts with: date, description, amount, type, category
    """
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    # Use Sniffer to detect delimiter; fall back to comma
    try:
        dialect = csv.Sniffer().sniff(text[:1024])
        rows = list(csv.reader(io.StringIO(text), dialect=dialect))
    except csv.Error:
        rows = list(csv.reader(io.StringIO(text)))

    # Skip empty rows for account type detection
    non_empty_rows = [r for r in rows if any(c.strip() for c in r)]
    if not non_empty_rows:
        return []

    account_type = detect_account_type(non_empty_rows[0])

    if account_type == "credit_card":
        return parse_credit_card_csv(rows)
    else:
        return parse_chequing_csv(rows)


# ---------------------------------------------------------------------------
# Upload CSV endpoint
# ---------------------------------------------------------------------------


@router.post("/upload_csv")
async def upload_csv(
    request: Request,
    file: UploadFile = File(...),
    period_label: str = Form(...),
) -> Dict[str, Any]:
    """Upload a CIBC CSV (chequing or credit card) and persist transactions.

    Returns:
        JSON: {upload_id, row_count, inserted, skipped_count, account_type}
    """
    content = await file.read()

    # Detect encoding
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    # Parse rows for account type detection
    try:
        dialect = csv.Sniffer().sniff(text[:1024])
        all_rows = list(csv.reader(io.StringIO(text), dialect=dialect))
    except csv.Error:
        all_rows = list(csv.reader(io.StringIO(text)))

    # Determine account type from first non-empty row
    non_empty = [r for r in all_rows if any(c.strip() for c in r)]
    if not non_empty:
        raise HTTPException(status_code=422, detail="CSV file is empty or contains no valid rows")

    account_type = detect_account_type(non_empty[0])

    # Parse transactions
    if account_type == "credit_card":
        rows = parse_credit_card_csv(all_rows)
    else:
        rows = parse_chequing_csv(all_rows)

    upload_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    filename = file.filename or "upload.csv"

    conn = database._connect_db()
    c = conn.cursor()

    try:
        # Insert upload record
        c.execute(
            """INSERT INTO fin_uploads (id, filename, period_label, account_type, uploaded_at, row_count)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (upload_id, filename, period_label, account_type, now_iso, len(rows)),
        )

        inserted = 0
        skipped = 0

        for row in rows:
            c.execute(
                """INSERT OR IGNORE INTO fin_transactions
                   (upload_id, date, description, amount, type, category, period_label, account_type)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    upload_id,
                    row["date"],
                    row["description"],
                    row["amount"],
                    row["type"],
                    row["category"],
                    period_label,
                    account_type,
                ),
            )
            if c.rowcount == 1:
                inserted += 1
            else:
                skipped += 1

        conn.commit()
    except Exception:
        conn.rollback()
        conn.close()
        raise
    finally:
        conn.close()

    return {
        "upload_id": upload_id,
        "row_count": len(rows),
        "inserted": inserted,
        "skipped_count": skipped,
        "account_type": account_type,
    }


# ---------------------------------------------------------------------------
# Finance status endpoint
# ---------------------------------------------------------------------------


@router.get("/status")
async def finance_status(request: Request) -> Dict[str, Any]:
    """Return current finance onboarding and upload status.

    Returns:
        JSON: {onboarding_done, upload_count, periods}
    """
    onboarding_done = database.get_app_setting("fin_onboarding_done") == "true"

    conn = database._connect_db()
    c = conn.cursor()

    c.execute("SELECT COUNT(*) FROM fin_uploads")
    upload_count = c.fetchone()[0]

    periods: List[str] = []
    if upload_count > 0:
        c.execute(
            """SELECT period_label FROM fin_transactions
               GROUP BY period_label
               ORDER BY MIN(date) ASC"""
        )
        periods = [r[0] for r in c.fetchall()]

    conn.close()

    return {
        "onboarding_done": onboarding_done,
        "upload_count": upload_count,
        "periods": periods,
    }


# ---------------------------------------------------------------------------
# Goals endpoints (FIN-01 — used in onboarding and reset)
# ---------------------------------------------------------------------------


@router.post("/goals")
async def save_goals(
    request: Request,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """Persist the user's financial goals from onboarding.

    Accepts JSON body: {goal_type, life_events, budgets, horizon}
    Replaces any existing goals row (only one row kept at a time).
    Sets app_settings.fin_onboarding_done = 'true'.
    """
    goal_type = payload.get("goal_type", "")
    life_events = json.dumps(payload.get("life_events", []))
    budgets = json.dumps(payload.get("budgets", {}))
    horizon = payload.get("horizon", "")
    now_iso = datetime.now(timezone.utc).isoformat()

    conn = database._connect_db()
    c = conn.cursor()
    try:
        # Replace strategy: only one goals row at a time
        c.execute("DELETE FROM fin_goals")
        c.execute(
            """INSERT INTO fin_goals (goal_type, life_events, budgets, horizon, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (goal_type, life_events, budgets, horizon, now_iso),
        )
        conn.commit()
    finally:
        conn.close()

    database.set_app_setting("fin_onboarding_done", "true")
    return {"ok": True, "status": "saved"}


@router.get("/goals")
async def get_goals(request: Request) -> Dict[str, Any]:
    """Return the latest saved financial goals, or {goals: null} if none."""
    conn = database._connect_db()
    c = conn.cursor()
    try:
        c.execute("SELECT * FROM fin_goals ORDER BY id DESC LIMIT 1")
        row = c.fetchone()
    finally:
        conn.close()

    if row is None:
        return {"goals": None}

    # row: (id, goal_type, life_events, budgets, horizon, created_at)
    col_names = ["id", "goal_type", "life_events", "budgets", "horizon", "created_at"]
    goals = dict(zip(col_names, row))
    goals["life_events"] = json.loads(goals["life_events"] or "[]")
    goals["budgets"] = json.loads(goals["budgets"] or "{}")
    return {"goals": goals}


# ---------------------------------------------------------------------------
# Dashboard aggregation endpoint
# ---------------------------------------------------------------------------


def _run_dashboard_queries(conn, period: str) -> Dict[str, Any]:
    """Run the four SQL aggregation queries and return dashboard JSON payload.

    Args:
        conn: open sqlite3.Connection
        period: period label string, or "All time" for all periods

    Returns:
        dict with keys: categories, budget_actual, trend, transactions, has_goals, total_spend
    """
    c = conn.cursor()
    period_filter = period if period != "All time" else None

    # 1. Category breakdown (debits only)
    if period_filter:
        c.execute(
            """SELECT category, SUM(amount) as total, COUNT(*) as count
               FROM fin_transactions
               WHERE type = 'debit' AND period_label = ?
               GROUP BY category
               ORDER BY total DESC""",
            (period_filter,),
        )
    else:
        c.execute(
            """SELECT category, SUM(amount) as total, COUNT(*) as count
               FROM fin_transactions
               WHERE type = 'debit'
               GROUP BY category
               ORDER BY total DESC"""
        )
    cat_rows = c.fetchall()

    grand_total = sum(r[1] for r in cat_rows) or 1.0  # avoid division by zero
    categories = [
        {
            "category": r[0],
            "total": round(r[1], 2),
            "count": r[2],
            "pct": round(r[1] / grand_total * 100, 1),
        }
        for r in cat_rows
    ]

    # 2. Monthly trend (all periods, debits only — not filtered by period)
    c.execute(
        """SELECT period_label, SUM(amount) as total_spend, COUNT(*) as tx_count
           FROM fin_transactions
           WHERE type = 'debit'
           GROUP BY period_label
           ORDER BY MIN(date) ASC"""
    )
    trend = [
        {"period_label": r[0], "total_spend": round(r[1], 2), "tx_count": r[2]}
        for r in c.fetchall()
    ]

    # 3. Transaction list (500 most recent, filtered by period)
    if period_filter:
        c.execute(
            """SELECT date, description, amount, type, category, account_type
               FROM fin_transactions
               WHERE period_label = ?
               ORDER BY date DESC
               LIMIT 500""",
            (period_filter,),
        )
    else:
        c.execute(
            """SELECT date, description, amount, type, category, account_type
               FROM fin_transactions
               ORDER BY date DESC
               LIMIT 500"""
        )
    transactions = [
        {
            "date": r[0],
            "description": r[1],
            "amount": round(r[2], 2),
            "type": r[3],
            "category": r[4],
            "account_type": r[5],
        }
        for r in c.fetchall()
    ]

    # 4. Budget vs actual — join goals budgets JSON with category totals
    c.execute("SELECT budgets FROM fin_goals ORDER BY id DESC LIMIT 1")
    goals_row = c.fetchone()
    has_goals = goals_row is not None

    budget_actual: List[Dict[str, Any]] = []
    if has_goals:
        try:
            budgets_dict: Dict[str, float] = json.loads(goals_row[0] or "{}")
        except (json.JSONDecodeError, TypeError):
            budgets_dict = {}

        # Build a lookup from category totals
        actuals_by_cat = {r["category"]: r["total"] for r in categories}

        # Include all categories that have either a budget or actual spend
        all_cats = set(budgets_dict.keys()) | set(actuals_by_cat.keys())
        for cat in sorted(all_cats):
            budget_actual.append({
                "category": cat,
                "actual": actuals_by_cat.get(cat, 0.0),
                "budget": float(budgets_dict.get(cat, 0)),
            })

    total_spend = sum(r[1] for r in cat_rows)

    return {
        "categories": categories,
        "budget_actual": budget_actual,
        "trend": trend,
        "transactions": transactions,
        "has_goals": has_goals,
        "total_spend": round(total_spend, 2),
    }


@router.get("/dashboard_data")
async def dashboard_data(request: Request, period: str = "All time") -> Dict[str, Any]:
    """Return aggregated dashboard data for the Finance panel.

    Query params:
        period: period label string, or "All time" (default) for all periods

    Returns JSON with keys:
        categories, budget_actual, trend, transactions, has_goals, total_spend
    """
    conn = database._connect_db()
    try:
        return _run_dashboard_queries(conn, period)
    finally:
        conn.close()


@router.get("/dashboard")
async def dashboard(request: Request, period: str = "All time") -> Dict[str, Any]:
    """Alias for /finance/dashboard_data — same response shape."""
    conn = database._connect_db()
    try:
        return _run_dashboard_queries(conn, period)
    finally:
        conn.close()


@router.post("/reset_goals")
async def reset_goals(request: Request) -> Dict[str, Any]:
    """Clear all financial goals and reset the onboarding flag."""
    conn = database._connect_db()
    c = conn.cursor()
    try:
        c.execute("DELETE FROM fin_goals")
        conn.commit()
    finally:
        conn.close()

    database.set_app_setting("fin_onboarding_done", "false")
    return {"ok": True, "status": "reset"}
