# Phase 2: Financial Advisor - Research

**Researched:** 2026-03-15
**Domain:** Python CSV parsing, SQLite schema design, pure-CSS bar charts, FastAPI module pattern, LLM context injection
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Entry point and layout**
- New icon in the RSB icon strip opens the Finance panel
- Full-panel overlay replacing the main chat area (similar to how tutorial overlays work)
- Two tabs: Dashboard (default after onboarding) and Chat
- Finance panel accessible without model loaded (dashboard is SQL-only)

**Onboarding flow**
- Fresh purpose-built conversational onboarding — NOT the FRT/Narrator state machine (build new)
- Same concept as FRT: chat-style, step by step, warm reflective tone
- Skippable — user can skip straight to Dashboard at any time; skip shows empty state with subtle "Set up your goals" prompt
- Re-runnable — "Reset goals" button in the panel resets `fin_goals` and re-triggers onboarding
- Questions (conversational, not a form): (1) primary goal, (2) life events, (3) monthly budget per category, (4) time horizon
- Tone: reflective, not prescriptive
- Completion flag stored in `app_settings` as `fin_onboarding_done`
- All answers persist to `fin_goals` SQLite table

**CSV formats (exact, no headers)**
- CIBC Chequing: 4 columns — `Date | Description | Debit | Credit` (tab or comma separated, all amounts positive)
- CIBC Credit Card: 5 columns — `Date | Description | CAD Amount | [blank] | Masked card number`
- Parser detects account type by column count (4 = chequing, 5 = credit card)
- User specifies the time period label on upload (free text)

**Parsed schema**
- `fin_transactions`: date, description, amount, type (debit/credit), category, period_label, account_type, upload_id
- `fin_goals`: goal_type, life_events (JSON array), budgets (JSON dict), horizon, created_at
- `fin_uploads`: id, filename, period_label, account_type, uploaded_at, row_count
- Deduplication: unique constraint on (date, description, amount, account_type) — silent skip

**Categorisation**
- Predefined fixed categories: Food, Transport, Shopping, Utilities, Entertainment, Other
- Deterministic keyword/merchant matching on Description — no LLM
- Unmatched → "Other"
- No user re-categorisation in v1

**Dashboard**
- Period selector dropdown at top — all uploaded labels + "All time"
- Pure CSS charts — NO Chart.js or external library
- Midnight Glass aesthetic — glass bars, `--accent-primary: #5A8CFF`, CSS transitions
- Chart types: (1) category breakdown horizontal bars, (2) budget vs actual bars, (3) monthly trend sparkline, (4) scrollable transaction list
- Credits shown in list with green "↑ Credit" tag; NOT counted in spend totals

**LLM Chat tab**
- Reuses existing `buildMessageHTML`, `appendMessage` pipeline
- LLM receives SQL-generated context only (aggregated — no raw CSV rows)
- System prompt injected with: spend per category, top 5 merchants, budget vs actual, user goals
- Uses main inference model

### Claude's Discretion
- Exact Python keyword/merchant rules for categorisation
- SQL queries for each dashboard metric
- Finance onboarding conversation script (questions, responses, branching)
- System prompt template for finance chat context injection
- Panel open/close animation (slide or fade)
- Exact deduplication behaviour on overlapping period uploads

### Deferred Ideas (OUT OF SCOPE)
- OFX / QFX format support
- PDF bank statement support
- User re-categorisation of individual transactions
- Export dashboard as PDF/image
- Multiple bank accounts tracked separately
- Month-over-month % change trend
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FIN-01 | Goal-setting onboarding conversation; answers persist to SQLite | Onboarding state machine pattern from FRT; `app_settings` flag via existing `set_app_setting`; `fin_goals` table design |
| FIN-02 | CIBC CSV upload + parse; no data leaves device | Python stdlib `csv` module; column-count detection; `fin_transactions` + `fin_uploads` schema; FastAPI `UploadFile` pattern from `rag.py` |
| FIN-03 | Deterministic categorisation; no LLM | Keyword/merchant dict pattern; Python `re` or `str.lower().find()`; category enum; fallback to "Other" |
| FIN-04 | Glass CSS dashboard: 4 chart types, all from SQL | Pure CSS bar technique with `--accent-primary`; ghost scrollbar reuse; SQL aggregation queries |
| FIN-05 | Multiple CSV accumulation; period tagging; dedup | `fin_uploads` table; unique constraint on (date, description, amount, account_type); period_label tag per row |
| FIN-06 | Finance chat tab; LLM gets SQL-aggregated context | SQL context builder; system prompt injection; existing `api.chat` SSE streaming reuse |
</phase_requirements>

---

## Summary

Phase 2 builds a self-contained Finance module (`app/finance.py`) following the established `register_*(app, ...)` pattern. All parsing uses Python stdlib `csv` — no pandas, no new dependencies. The dashboard is a pure-CSS widget using `width` percentages on `div` bars styled with existing glass variables; no Chart.js or Canvas. The LLM Chat tab reuses the existing streaming pipeline without modification — it just injects a SQL-generated context block into the system prompt before sending.

The most intricate part of this phase is the **onboarding state machine**. The FRT precedent shows the pattern clearly: a JavaScript object with `step` index, `history` array, and `advance()`/`restart()` functions, driving a chat-style panel. The finance onboarding is simpler because it is purely conversational (no RPG-style type-writer effects required — just normal message bubbles) and has a hard exit path (skip/done).

The second-most-complex part is the **CSV parser**. CIBC's two formats differ only by column count (4 vs 5), and both are headerless. Python's `csv.reader` with `QUOTE_MINIMAL` handles this cleanly. The key edge cases are: (a) missing Debit/Credit cell detection for chequing (empty string vs whitespace), (b) foreign-currency description strings for credit card (ignore everything except column index 2 for CAD amount), and (c) encoding — CIBC exports in Windows-1252 on some platforms, UTF-8 on others; try UTF-8 first then fall back to `latin-1`.

**Primary recommendation:** Implement `app/finance.py` with `register_finance(app, db_path)`, a new IIFE `financeUI` in `app.js`, and three new SQLite tables created in `init_db()`. All SQL aggregation queries should be written once in `finance.py` and returned as JSON to the frontend — the frontend renders from those numbers only.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Python `csv` | stdlib | CSV parsing (chequing + credit card) | No new deps; handles CIBC headerless formats cleanly |
| Python `sqlite3` | stdlib | `fin_transactions`, `fin_goals`, `fin_uploads` tables | Already used throughout codebase |
| Python `json` | stdlib | Serialize `life_events` array and `budgets` dict in `fin_goals` | Already used throughout codebase |
| Python `re` | stdlib | Keyword matching for categorisation | Already used in `database.py` |
| Python `io.StringIO` | stdlib | Wrap bytes upload content for `csv.reader` | Avoids disk write for CSV parsing |
| FastAPI `UploadFile` + `Form` | existing dep | CSV upload endpoint | Already used in `rag.py` — identical pattern |
| CSS `backdrop-filter` | browser | Glass panel for Finance overlay | Already established in `app.css` via `--glass-filter` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Python `uuid` | stdlib | Generate `upload_id` for each CSV upload | Each `fin_uploads` row needs a UUID |
| Python `datetime` | stdlib | Normalize transaction date strings to ISO format | CIBC dates come as `MM/DD/YYYY` or `YYYY-MM-DD` |
| Python `hashlib` | stdlib | Optional: detect duplicate file uploads by content hash | Only if full-file dedup beyond row-level is desired |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `csv` stdlib | `pandas` | pandas is ~40MB, not in requirements.txt, overkill for headerless 4-5 column files |
| Pure CSS bars | Chart.js / D3 | External library adds JS bundle weight; pure CSS is sufficient for 6-category horizontal bars and sparklines |
| IIFE module in `app.js` | Separate `finance.js` file | Separate file requires adding a `<script>` tag and syncing load order; IIFE in `app.js` follows established project pattern |

**Installation:** No new packages required. All parsing uses Python stdlib. All chart rendering uses CSS.

---

## Architecture Patterns

### Recommended File Structure

```
app/
└── finance.py              # New: register_finance(), CSV parser, SQL queries, FastAPI routes

app/templates/index.html    # Add: #finance-panel overlay div, Finance SVG icon in RSB strip
app/static/css/app.css      # Add: .fin-* styles (panel, tabs, bars, transaction list)
app/static/js/app.js        # Add: financeUI IIFE module, finOnboarding object
app/database.py             # Modify: add fin_* tables to init_db()
app/main.py                 # Modify: import + call register_finance(app, DB_NAME)
```

### Pattern 1: FastAPI Module Registration

Follows the existing `register_rag(app, data_dir)` and `register_assist(app, ...)` pattern exactly.

```python
# app/finance.py
from fastapi import APIRouter, Request, UploadFile, File, Form, HTTPException
from . import database

router = APIRouter(prefix="/finance", tags=["finance"])

def register_finance(app, db_path: str) -> None:
    app.state.finance_db = db_path
    app.include_router(router)

def _db(request: Request) -> str:
    return request.app.state.finance_db
```

In `main.py` (after existing registrations):
```python
from .finance import register_finance
register_finance(app, str(database.DB_NAME))
```

### Pattern 2: Finance Panel as Full Overlay

The Finance panel is a full-screen overlay over `#chat-zone` — same technique as the settings overlay (`#settings-overlay`) which uses `position: fixed` with `z-index` above the chat area and toggled via `.hidden` class. The Finance panel is NOT a separate page; it shares the same DOM.

```html
<!-- Add inside #main (sibling to #chat-zone) -->
<div id="finance-panel" class="fin-panel hidden">
  <div class="fin-header">
    <div class="fin-tabs">
      <button class="fin-tab active" data-tab="dashboard">Dashboard</button>
      <button class="fin-tab" data-tab="chat">Chat</button>
    </div>
    <button id="fin-close" class="fin-close-btn" aria-label="Close Finance">×</button>
  </div>
  <div id="fin-pane-dashboard" class="fin-pane active">
    <!-- Dashboard content injected by JS -->
  </div>
  <div id="fin-pane-chat" class="fin-pane hidden">
    <!-- Chat reuses chat render pipeline -->
  </div>
</div>
```

CSS pattern (follows settings overlay approach):
```css
.fin-panel {
    position: fixed;
    inset: 0;
    z-index: 200;  /* above RSB (z: 100) and LSB */
    background: var(--bg-panel);
    backdrop-filter: var(--glass-filter);
    -webkit-backdrop-filter: var(--glass-filter);
    display: flex;
    flex-direction: column;
}
.fin-panel.hidden { display: none; }
```

### Pattern 3: JavaScript IIFE Module

```javascript
// Follows existing rsbLights, rsbStats, ragUI pattern
const financeUI = (function() {
    let _open = false;

    function open() {
        _open = true;
        document.getElementById('finance-panel').classList.remove('hidden');
        _checkOnboarding();
    }

    function close() {
        _open = false;
        document.getElementById('finance-panel').classList.add('hidden');
    }

    function _checkOnboarding() {
        // GET /finance/status → { onboarding_done: bool, has_uploads: bool }
        // If not onboarding_done → show onboarding chat pane
        // If onboarding_done → show dashboard tab
    }

    function init() {
        document.getElementById('fin-close')?.addEventListener('click', close);
        // Wire RSB icon click
        document.getElementById('btn-finance')?.addEventListener('click', open);
    }

    return { open, close, init };
})();
```

Call `financeUI.init()` in `startApp()` unconditionally (no model required).

### Pattern 4: CSV Upload Endpoint

Mirrors `rag.py` `/rag/upload` exactly — `UploadFile` + `Form` fields.

```python
@router.post("/upload_csv")
async def upload_csv(
    request: Request,
    file: UploadFile = File(...),
    period_label: str = Form(...),
):
    content = await file.read()
    # Detect encoding: try utf-8 first, fall back to latin-1
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    rows = list(csv.reader(io.StringIO(text)))
    # Detect account type by column count of first non-empty row
    col_count = max(len(r) for r in rows if any(c.strip() for c in r))
    account_type = "chequing" if col_count == 4 else "credit_card"
    # Parse and insert...
```

### Pattern 5: Pure CSS Bar Charts

All charts are `div` elements where bar width is set as an inline `style="--pct: 62.3"` CSS custom property, driven by JavaScript after the SQL query response arrives.

```css
.fin-bar-fill {
    height: 100%;
    width: calc(var(--pct, 0) * 1%);
    background: var(--accent-primary);
    border-radius: 4px;
    transition: width 0.4s ease;
    box-shadow: 0 0 8px color-mix(in srgb, var(--accent-primary) 40%, transparent);
}
.fin-bar-fill.dominant {
    box-shadow: 0 0 16px color-mix(in srgb, var(--accent-primary) 60%, transparent);
}
```

JavaScript sets `element.style.setProperty('--pct', pctValue)` after data arrives. The dominant category (highest spend) gets class `.dominant` for accent glow.

### Pattern 6: SQL Aggregation Queries

All numbers come from SQL. Python computes these in `finance.py` and returns JSON. Frontend never does arithmetic.

```python
# Category breakdown (debits only, filtered by period)
SELECT category,
       SUM(amount) as total,
       COUNT(*) as count
FROM fin_transactions
WHERE type = 'debit'
  AND (period_label = ? OR ? = 'All time')
GROUP BY category
ORDER BY total DESC

# Budget vs actual (join with fin_goals budgets JSON)
# Budgets are stored as JSON dict in fin_goals — parse in Python, join in Python

# Monthly trend (one row per period_label, sum of debits)
SELECT period_label,
       SUM(amount) as total_spend,
       COUNT(*) as tx_count
FROM fin_transactions
WHERE type = 'debit'
GROUP BY period_label
ORDER BY MIN(date) ASC

# Transaction list (all types, filtered by period)
SELECT date, description, amount, type, category, account_type
FROM fin_transactions
WHERE (period_label = ? OR ? = 'All time')
ORDER BY date DESC
LIMIT 500
```

### Pattern 7: Finance Chat Context Injection

The finance chat endpoint is a thin wrapper around existing chat. It builds a system-prompt prefix from SQL data, then calls the same generator.

```python
def build_finance_context(period_label: str) -> str:
    """Returns a text block to prepend to the system prompt for finance chat."""
    # Run SQL aggregation queries
    # Format as plain text — NOT JSON to LLM
    lines = [
        "FINANCIAL CONTEXT (from user's bank data):",
        f"Period: {period_label}",
        "Spend by category:",
    ]
    for cat, total in category_totals.items():
        lines.append(f"  {cat}: ${total:.2f}")
    # ... top merchants, budget vs actual if goals set, user goals
    return "\n".join(lines)
```

### Anti-Patterns to Avoid

- **Passing raw CSV rows to the LLM**: Forbidden by design. Always aggregate with SQL first.
- **Using pandas for CSV parsing**: Overkill. `csv.reader` handles both CIBC formats.
- **Storing the CSV file on disk permanently**: The RAG module stores uploads on disk for indexing; finance does not need this. Parse into SQLite and discard the bytes.
- **Building a separate chat session for finance chat**: Reuse `buildMessageHTML` and `appendMessage` in the finance chat pane. Keep a separate in-memory history array for finance chat (do not mix with main chat history).
- **Debouncing bar chart updates**: Set widths in a single batch after data arrives — no incremental animation with `setTimeout` loops.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSV parsing | Custom string split / regex parser | `csv.reader` from stdlib | Handles quoted fields, escaped commas, mixed line endings; CIBC CSVs may contain commas in Description field |
| Encoding detection | Byte-order-mark inspection | `try utf-8, fallback latin-1` | CIBC exports on Windows may be Windows-1252/latin-1; two-try covers 99% of cases without chardet |
| Animated bar fills | `requestAnimationFrame` loop | CSS `transition: width 0.4s ease` + JS sets `--pct` once | Browser handles the animation; no JS timer needed |
| Date normalization | Regex date parser | Python `datetime.strptime` with two format attempts | CIBC chequing uses `MM/DD/YYYY`; credit card uses `YYYY-MM-DD` |
| SQL budget join | Python loop over every transaction | SQL GROUP BY + Python dict merge for goals JSON | SQL aggregation is faster and correctness is clearer |
| Ghost scrollbar for transaction list | New scrollbar CSS | Re-use existing `.chat-zone:hover ::-webkit-scrollbar-thumb` recipe by adding `.fin-tx-list` to the selector list in `app.css` | Already in app.css lines 10–20 |

**Key insight:** The entire data pipeline (upload → parse → store → aggregate → display) involves only Python stdlib + existing SQLite. No new Python packages are required.

---

## Common Pitfalls

### Pitfall 1: CIBC CSV Has No Headers
**What goes wrong:** `csv.DictReader` fails or creates wrong column names because the first row is a data row, not a header.
**Why it happens:** CIBC exports omit headers in both chequing and credit card CSVs (confirmed in CONTEXT.md).
**How to avoid:** Use `csv.reader` (not `csv.DictReader`). Access columns by index: `row[0]` = date, `row[1]` = description, `row[2]` = debit (chequing) / CAD amount (credit), `row[3]` = credit (chequing) / blank (credit), `row[4]` = masked card (credit only).
**Warning signs:** Parser produces rows where "date" = "Date" string or amounts are text like "Debit".

### Pitfall 2: Empty Debit or Credit Cell vs Zero
**What goes wrong:** A chequing row where Debit is empty is misclassified as debit with amount 0 instead of a credit transaction.
**Why it happens:** `float('')` raises `ValueError`; `float('0')` is valid but wrong for empty cells.
**How to avoid:** Check `row[2].strip()` — if non-empty it's a debit; else check `row[3].strip()` for the credit amount. Never try to parse an empty string as float.
**Warning signs:** Dashboard shows $0.00 debits in the transaction list.

### Pitfall 3: Credit Card "Credit" Rows Counted in Spend
**What goes wrong:** Card payments (e.g., "PAYMENT THANK YOU") appear as spend, inflating totals.
**Why it happens:** Credit card CSV has no explicit type column. All rows look like debits by structure.
**How to avoid:** Detect card payment rows by keyword matching on Description (e.g., `"PAYMENT"`, `"PAIEMENT"`, `"CREDIT BALANCE"`). Mark these as `type = 'credit'`. Exclude `type = 'credit'` from all spend aggregation SQL. Show them in transaction list with green tag.
**Warning signs:** Monthly spend total significantly higher than expected; "PAYMENT" transactions appear in category breakdown.

### Pitfall 4: Encoding Mismatch Causing Silent Data Loss
**What goes wrong:** `content.decode('utf-8')` throws `UnicodeDecodeError` on a Windows-exported CSV; the upload returns 500 error with no useful message.
**Why it happens:** CIBC online banking exports UTF-8 on Mac/Chrome but Windows-1252/latin-1 on Windows Internet Explorer or older Edge.
**How to avoid:** Wrap decode in try/except: try `utf-8` first, then `latin-1`. Latin-1 is a superset of ASCII and will never throw `UnicodeDecodeError` — it's a safe fallback.
**Warning signs:** Upload endpoint returns 500 on files with é, à, ç characters in merchant names.

### Pitfall 5: Duplicate Rows on Re-Upload
**What goes wrong:** User uploads "January 2026" twice (re-download after adding a note). All 120 rows are inserted again, doubling spend totals.
**Why it happens:** No dedup guard on insert.
**How to avoid:** Unique constraint on `(date, description, amount, account_type)` in SQLite. Use `INSERT OR IGNORE INTO fin_transactions ...`. Log count of skipped rows and return it to frontend so user sees "120 rows processed, 0 new (all already uploaded)".
**Warning signs:** Dashboard totals double after re-upload of same file.

### Pitfall 6: Finance Panel z-index Conflict
**What goes wrong:** Finance panel renders behind RSB or the settings overlay.
**Why it happens:** RSB has `z-index: 100` in current CSS; settings overlay has `z-index: 300` (estimated). Finance panel at `z-index: 50` would be behind RSB.
**How to avoid:** Check existing `z-index` values in `app.css` before assigning. Set finance panel to `z-index: 200` (above RSB, below settings overlay). Finance panel is a full-viewport overlay — RSB should be hidden or rendered on top only if Finance is closed.
**Warning signs:** Finance panel partially obscured by RSB strip on the right edge.

### Pitfall 7: Onboarding Not Re-triggering After "Reset Goals"
**What goes wrong:** User clicks "Reset goals", `fin_goals` is deleted from DB, but frontend still shows Dashboard because `fin_onboarding_done` flag in `app_settings` was not cleared.
**Why it happens:** Reset only deletes `fin_goals` table rows but leaves the completion flag.
**How to avoid:** The "Reset goals" endpoint must call both `DELETE FROM fin_goals` AND `set_app_setting('fin_onboarding_done', 'false')`. Frontend checks `onboarding_done` on every `financeUI.open()` call.
**Warning signs:** After reset, Dashboard still shows (with empty data) instead of onboarding.

### Pitfall 8: Finance Chat History Leaking Into Main Chat
**What goes wrong:** Finance chat messages appear in the main chat session history, or main chat context includes finance conversation.
**Why it happens:** Finance chat pane reuses `appendMessage`/`buildMessageHTML` for rendering but could accidentally write to the main session via `add_message(session_id, ...)`.
**How to avoid:** Finance chat uses its own in-memory history array (not persisted to `messages` table). The finance chat endpoint (`POST /finance/chat`) does NOT call `database.add_message`. Finance messages are appended to `#fin-chat-history` div, not `#chat-history`.
**Warning signs:** Main chat shows "What was my biggest expense?" messages in a new session.

---

## Code Examples

Verified patterns from existing codebase:

### CSV Parsing — Chequing
```python
# Source: Python stdlib csv docs + CIBC format spec from CONTEXT.md
import csv
import io

def parse_chequing_csv(content: bytes) -> list[dict]:
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    rows = []
    reader = csv.reader(io.StringIO(text))
    for row in reader:
        if len(row) < 4:
            continue  # skip blank/short rows
        date_str = row[0].strip()
        description = row[1].strip()
        debit_str = row[2].strip()
        credit_str = row[3].strip()

        if not date_str:
            continue  # skip completely empty rows

        if debit_str:
            amount = float(debit_str.replace(",", ""))
            tx_type = "debit"
        elif credit_str:
            amount = float(credit_str.replace(",", ""))
            tx_type = "credit"
        else:
            continue  # row with no amount — skip

        rows.append({
            "date": normalize_date(date_str),
            "description": description,
            "amount": amount,
            "type": tx_type,
        })
    return rows
```

### CSV Parsing — Credit Card
```python
# Source: CIBC format spec from CONTEXT.md
def parse_credit_card_csv(content: bytes) -> list[dict]:
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    PAYMENT_KEYWORDS = ("PAYMENT", "PAIEMENT", "CREDIT BALANCE", "REMBOURSEMENT")

    rows = []
    reader = csv.reader(io.StringIO(text))
    for row in reader:
        if len(row) < 3:
            continue
        date_str = row[0].strip()
        description = row[1].strip()
        amount_str = row[2].strip()

        if not date_str or not amount_str:
            continue

        amount = float(amount_str.replace(",", ""))
        desc_upper = description.upper()
        tx_type = "credit" if any(kw in desc_upper for kw in PAYMENT_KEYWORDS) else "debit"

        rows.append({
            "date": normalize_date(date_str),
            "description": description,
            "amount": amount,
            "type": tx_type,
        })
    return rows
```

### Date Normalization
```python
# Source: Python stdlib datetime
from datetime import datetime

def normalize_date(date_str: str) -> str:
    """Normalize CIBC date strings to YYYY-MM-DD ISO format."""
    formats = ("%m/%d/%Y", "%Y-%m-%d", "%d/%m/%Y", "%m-%d-%Y")
    for fmt in formats:
        try:
            return datetime.strptime(date_str, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return date_str  # Return as-is if no format matched (log warning)
```

### Categorisation Rules (Claude's Discretion — reasonable Canadian merchant set)
```python
# Source: Claude's discretion per CONTEXT.md
CATEGORY_RULES = {
    "Food": [
        "TIM HORTONS", "STARBUCKS", "MCDONALD", "SUBWAY", "UBER EATS",
        "DOORDASH", "SKIP THE DISHES", "FRESHCO", "NO FRILLS", "LOBLAWS",
        "SOBEYS", "METRO GROCERIES", "FOOD BASICS", "WALMART GROCERY",
        "PIZZA PIZZA", "DOMINO", "HARVEY'S", "WENDY'S", "A&W", "POPEYES",
        "GROCERIES", "SUPERSTORE", "WHOLE FOODS", "SAFEWAY",
    ],
    "Transport": [
        "TTC", "PRESTO", "OC TRANSPO", "TRANSIT", "UBER", "LYFT",
        "PETRO CANADA", "SHELL", "ESSO", "CANADIAN TIRE GAS", "SUNOCO",
        "PARKING", "IMPARK", "GREEN P", "ENTERPRISE CAR", "BUDGET CAR",
        "VIA RAIL", "AIR CANADA", "WESTJET", "PORTER AIRLINES",
    ],
    "Shopping": [
        "AMAZON", "WALMART", "COSTCO", "THE BAY", "SAKS", "NORDSTROM",
        "H&M", "ZARA", "UNIQLO", "INDIGO", "CHAPTERS", "BEST BUY",
        "APPLE.COM", "APPLE STORE", "IKEA", "HOME DEPOT", "CANADIAN TIRE",
        "SPORT CHEK", "SPORTCHEK", "WINNERS", "MARSHALLS",
    ],
    "Utilities": [
        "HYDRO ONE", "TORONTO HYDRO", "ENBRIDGE", "ROGERS", "BELL CANADA",
        "TELUS", "FIDO", "KOODO", "FREEDOM MOBILE", "SHAW", "VIDEOTRON",
        "INTERNET", "HYDRO", "WATER BILL", "WASTE MANAGEMENT", "INSURANCE",
        "MANULIFE", "SUNLIFE", "INTACT INSURANCE", "AVIVA",
    ],
    "Entertainment": [
        "NETFLIX", "SPOTIFY", "APPLE TV", "DISNEY PLUS", "CRAVE",
        "PRIME VIDEO", "YOUTUBE PREMIUM", "STEAM", "PLAYSTATION",
        "XBOX", "NINTENDO", "CINEPLEX", "LANDMARK CINEMA", "TICKETMASTER",
        "EVENTBRITE", "RAPTORS", "BLUE JAYS", "LEAFS", "MLSE",
    ],
}

def categorise(description: str) -> str:
    desc_upper = description.upper()
    for category, keywords in CATEGORY_RULES.items():
        if any(kw in desc_upper for kw in keywords):
            return category
    return "Other"
```

### SQLite Table Definitions (to add to `init_db()`)
```python
# Source: existing database.py CREATE TABLE IF NOT EXISTS pattern
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
        category TEXT NOT NULL,
        period_label TEXT NOT NULL,
        account_type TEXT NOT NULL,
        UNIQUE (date, description, amount, account_type)
    )
""")

c.execute("""
    CREATE TABLE IF NOT EXISTS fin_goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_type TEXT,
        life_events TEXT,
        budgets TEXT,
        horizon TEXT,
        created_at TEXT NOT NULL
    )
""")
```

### Pure CSS Bar (in `app.css`)
```css
/* Source: project CSS variable system + CSS custom property bar technique */
.fin-bar-track {
    width: 100%;
    height: 8px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 4px;
    overflow: hidden;
}
.fin-bar-fill {
    height: 100%;
    width: calc(var(--pct, 0) * 1%);
    background: var(--accent-primary, #5A8CFF);
    border-radius: 4px;
    transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}
.fin-bar-fill.fin-dominant {
    box-shadow: 0 0 12px rgba(90, 140, 255, 0.5);
}
```

JavaScript to update:
```javascript
// Set bar width after API response (no animation loop needed)
barEl.style.setProperty('--pct', percentage.toFixed(1));
```

### Ghost Scrollbar Extension for Transaction List
```css
/* Source: existing app.css lines 10-12 — add .fin-tx-list to selector */
.sess-list:hover ::-webkit-scrollbar-thumb,
.rsb-body:hover ::-webkit-scrollbar-thumb,
.chat-zone:hover ::-webkit-scrollbar-thumb,
.fin-tx-list:hover ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); }
```

### Register in `main.py` (after existing registrations)
```python
# Source: existing main.py register_* pattern (lines 283-288)
from .finance import register_finance
register_finance(app, str(database.DB_NAME))
```

### Finance Status Endpoint
```python
@router.get("/status")
async def finance_status(request: Request):
    onboarding_done = database.get_app_setting("fin_onboarding_done") == "true"
    conn = database._connect_db()
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM fin_uploads")
    upload_count = c.fetchone()[0]
    periods = []
    if upload_count > 0:
        c.execute("SELECT DISTINCT period_label FROM fin_transactions ORDER BY MIN(date) ASC")
        periods = [r[0] for r in c.fetchall()]
    conn.close()
    return {
        "onboarding_done": onboarding_done,
        "upload_count": upload_count,
        "periods": periods,
    }
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Chart.js for bar charts in web apps | Pure CSS custom-property bars for simple categorical data | ~2022 (CSS has matured) | Removes 50KB+ JS bundle; no canvas rendering; GPU inference not competing with chart animations |
| pandas for all CSV parsing | stdlib `csv` for simple row-by-row data | Ongoing project trend | Zero new dependencies; faster startup; headerless CSVs are ideal for `csv.reader` |
| LLM receives raw data for analysis | SQL aggregation → LLM receives summary text | Best practice 2024+ | Prevents prompt injection via CSV content; reduces context tokens; deterministic numbers |

**Deprecated/outdated:**
- Passing raw CSV content to LLM for analysis: Replaced by SQL context injection per CONTEXT.md hard constraint.
- Storing CSV files as uploaded RAG documents: Intentionally not done here — finance CSV is parsed and discarded; no document chunking needed.

---

## Open Questions

1. **CIBC CSV delimiter: tab vs comma**
   - What we know: CONTEXT.md says "tab/comma separated" for chequing
   - What's unclear: Whether both delimiters appear in the same file or one per export
   - Recommendation: Use `csv.Sniffer().sniff(text[:1024])` to auto-detect delimiter before parsing. Fall back to comma if sniffer fails.

2. **Date format on credit card CSV**
   - What we know: Chequing uses `MM/DD/YYYY`; credit card format not specified in CONTEXT.md
   - What's unclear: Whether CIBC credit card uses the same `MM/DD/YYYY` or ISO `YYYY-MM-DD`
   - Recommendation: Try both formats with the `normalize_date()` multi-format function above. User has both CSVs to share — actual files will confirm.

3. **Finance chat: new backend endpoint or reuse `/chat`**
   - What we know: Finance chat injects SQL context into system prompt; uses main inference model
   - What's unclear: Whether to create `POST /finance/chat` (separate endpoint that builds context + calls generator) or modify `/chat` to accept an optional `context_prefix`
   - Recommendation: Create `POST /finance/chat` as a separate endpoint. It builds SQL context, then calls the same generator function with a finance-specific system prompt. Cleaner separation.

4. **Onboarding: where to display budget input**
   - What we know: Budget per category is step 3 of onboarding; 6 categories
   - What's unclear: Chat-style input for 6 budget amounts in sequence vs a mini form mid-conversation
   - Recommendation (Claude's discretion): Render a compact inline form card inside the chat bubble for the budget step — 6 labeled inputs in a 2-column grid, submit button. This is consistent with RPG questionnaire pattern in FRT but faster for numeric entry.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Python `unittest` (stdlib) — existing tests use `python -m pytest` as runner when installed, `python -m unittest` as fallback |
| Config file | None — no pytest.ini found; tests run from project root |
| Quick run command | `python -m unittest tests.test_finance -v` |
| Full suite command | `python -m unittest discover -s tests -p "test_*.py" -v` |

Note: `pytest` is not installed in the project venv. All existing tests are written as `unittest.TestCase` subclasses that also work with pytest when installed. New finance tests should follow this pattern.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FIN-02 | Chequing CSV parser: debit row parsed correctly | unit | `python -m unittest tests.test_finance.TestCSVParser.test_chequing_debit -v` | Wave 0 |
| FIN-02 | Chequing CSV parser: credit row parsed correctly | unit | `python -m unittest tests.test_finance.TestCSVParser.test_chequing_credit -v` | Wave 0 |
| FIN-02 | Credit card CSV parser: spend row parsed | unit | `python -m unittest tests.test_finance.TestCSVParser.test_credit_card_debit -v` | Wave 0 |
| FIN-02 | Credit card CSV parser: card payment row → type=credit | unit | `python -m unittest tests.test_finance.TestCSVParser.test_credit_card_payment -v` | Wave 0 |
| FIN-02 | Latin-1 encoded CSV decoded without error | unit | `python -m unittest tests.test_finance.TestCSVParser.test_encoding_latin1 -v` | Wave 0 |
| FIN-02 | Account type detected from column count | unit | `python -m unittest tests.test_finance.TestCSVParser.test_account_type_detection -v` | Wave 0 |
| FIN-03 | Tim Hortons → Food category | unit | `python -m unittest tests.test_finance.TestCategoriser.test_food -v` | Wave 0 |
| FIN-03 | TTC → Transport category | unit | `python -m unittest tests.test_finance.TestCategoriser.test_transport -v` | Wave 0 |
| FIN-03 | Unknown merchant → Other | unit | `python -m unittest tests.test_finance.TestCategoriser.test_other_fallback -v` | Wave 0 |
| FIN-05 | Duplicate row silently skipped on re-insert | unit | `python -m unittest tests.test_finance.TestDeduplication.test_duplicate_ignored -v` | Wave 0 |
| FIN-04 | SQL category breakdown returns correct totals | unit | `python -m unittest tests.test_finance.TestSQLQueries.test_category_breakdown -v` | Wave 0 |
| FIN-01 | `fin_onboarding_done` flag set after goals saved | integration | `python -m unittest tests.test_finance.TestOnboarding.test_goals_persist -v` | Wave 0 |
| FIN-01 | Reset clears both `fin_goals` and `fin_onboarding_done` flag | integration | `python -m unittest tests.test_finance.TestOnboarding.test_reset -v` | Wave 0 |
| FIN-04 | Dashboard CSS bar renders with `--pct` custom property | manual | Open browser, upload CSV, verify bars animate | N/A |
| FIN-06 | Finance chat context contains SQL totals not raw CSV | manual | Send finance chat message, verify LLM sees aggregated numbers | N/A |

### Sampling Rate

- **Per task commit:** `python -m unittest tests.test_finance -v`
- **Per wave merge:** `python -m unittest discover -s tests -p "test_*.py" -v`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/test_finance.py` — covers FIN-02, FIN-03, FIN-04, FIN-05; test CSV parser with fixture strings (no file I/O needed), categoriser, SQL queries against in-memory SQLite
- [ ] Fixture CSV strings embedded in `test_finance.py` — chequing sample (3 debit + 1 credit row), credit card sample (2 spend + 1 payment row), latin-1 encoded version

*(No new framework install needed — unittest is stdlib)*

---

## Sources

### Primary (HIGH confidence)

- Codebase: `app/rag.py` — FastAPI `UploadFile` + `Form` pattern, `register_rag()` signature, `_safe_session_id()` pattern
- Codebase: `app/database.py` — `CREATE TABLE IF NOT EXISTS` pattern, `get_app_setting`/`set_app_setting`, `_connect_db()`
- Codebase: `app/static/js/app.js` lines 6537–6612 — `startApp()` init call sequence, IIFE module pattern
- Codebase: `app/static/css/app.css` lines 1–25 — ghost scrollbar recipe, `--glass-filter` variable
- Codebase: `app/templates/index.html` lines 387–576 — RSB structure, existing overlay pattern
- CONTEXT.md — exact CSV column formats, locked decisions, data model

### Secondary (MEDIUM confidence)

- Python docs: `csv.reader` — QUOTE_MINIMAL default, delimiter sniffing via `csv.Sniffer`
- Python docs: `io.StringIO` — wrapping bytes for csv.reader without disk write
- CSS specification: custom properties `--pct` technique for dynamic bar widths — widely used, browser support is universal

### Tertiary (LOW confidence)

- CIBC date format assumption for credit card (`MM/DD/YYYY`): Extrapolated from chequing format; actual format to be confirmed with user's test files
- Credit card payment row keywords (`PAYMENT`, `PAIEMENT`): Based on common CIBC export patterns; actual keywords to be confirmed with user's test files

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all identified libraries are stdlib or already in requirements.txt
- Architecture: HIGH — follows established project patterns exactly (register_*, IIFE, overlay)
- CSV parsing: HIGH (chequing) / MEDIUM (credit card date format) — confirmed format specs with one MEDIUM gap (credit card date)
- Categorisation rules: MEDIUM — common Canadian merchants; actual keywords confirmed against real files in testing
- Pitfalls: HIGH — derived from direct code analysis of existing patterns and format specs

**Research date:** 2026-03-15
**Valid until:** Stable — no external dependencies; valid until CIBC changes their export format
