# Phase 2: Financial Advisor - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

<domain>
## Phase Boundary

A Finance panel accessible from the RSB icon strip that opens a full-screen view with two tabs: **Dashboard** (glass CSS charts showing spending data) and **Chat** (LLM conversation about finances). Users upload CIBC bank statement CSVs, which are parsed into SQLite and analysed with deterministic SQL. The LLM is used in two places only: (1) guided goal-setting onboarding via the existing Narrator/FRT system, and (2) answering natural language questions in the Chat tab using SQL-generated context. No cloud, no RAG over raw CSV, no LLM categorisation.

</domain>

<decisions>
## Implementation Decisions

### Entry point and layout
- Finance panel is triggered from an RSB icon (new icon in the right sidebar icon strip)
- Opens as a full-panel view (replaces/overlays main content area, like a dedicated section)
- Two tabs inside the panel: **Dashboard** and **Chat**
- Dashboard is default landing tab after onboarding completes

### Onboarding flow
- Runs the first time the Finance panel is opened (one-time, stored completion flag in app_settings)
- Uses the existing Narrator/FRT system — same conversational onboarding mechanism as the tutorial
- Questions cover:
  - Primary financial goal: save money, invest, or a mix
  - Short-term vs long-term orientation
  - Specific life events they're saving toward (vacation, wedding, house purchase, emergency fund, etc.) — user can say "none" or "not sure yet"
  - Monthly budget per spending category (Food, Transport, Shopping, Utilities, Entertainment, Other)
  - Approximate time horizon for their goals (months or years)
- All answers persist to a new SQLite table (`fin_goals` or similar) — not to the existing memory system
- Goal is to make the user *think* about their finances, not to enforce rigid targets — soft, conversational tone
- After onboarding completes, user is dropped into the Dashboard tab

### CSV upload and parsing
- CIBC bank statement CSV format only (v1)
- User specifies the time period the file covers when uploading (month/year picker or free text like "Jan 2026")
- Transactions parsed into a SQLite table: `fin_transactions` with columns: date, description, amount, category, period_label, account_tag
- Multiple uploads accumulate — each tagged with the user-specified period label
- User can upload one month at a time or multiple months in one file
- No deduplication strategy defined yet — Claude's discretion (e.g., unique constraint on date+description+amount)

### Categorisation
- Predefined fixed categories: Food, Transport, Shopping, Utilities, Entertainment, Other
- Categorisation is fully deterministic — keyword/merchant matching rules, no LLM
- Rules defined in a Python dict or JSON config (Claude's discretion on exact implementation)
- Unmatched transactions fall into "Other"
- No user re-categorisation in v1 (deferred to v2)

### Dashboard charts
- Pure CSS charts — no Chart.js or other JS charting library
- Midnight Glass aesthetic: `backdrop-filter: blur`, glass surfaces, `--black-0/1/2/3` palette, `--accent-primary: #5A8CFF`
- Chart types to include:
  1. **Category breakdown** — horizontal bar chart (% and $ per category) with glass bars
  2. **Budget vs actual** — side-by-side bars per category (budget amount vs actual spend), glass styled
  3. **Monthly trend** — horizontal sparkline-style bars showing total spend per month
  4. **Transaction list** — scrollable table, ghost scrollbar, alternating row glass tint
- All data from SQL queries — no LLM touches these numbers
- Charts should feel alive: CSS transitions on bar fill, subtle glow on the dominant category bar
- Dashboard updates on every CSV upload without page reload

### LLM chat (Chat tab)
- Standard chat UI (reuses existing chat rendering pipeline where possible)
- LLM receives SQL-generated context injected into system prompt, e.g.:
  - Total spend per category for selected period
  - Top 5 merchants
  - Budget vs actual summary
  - User's stated goals from onboarding
- User's raw transactions are NOT passed to the LLM — only aggregated SQL summaries
- Chat is finance-scoped: responses should acknowledge the user's goals when relevant
- Uses the main inference model (no separate fine-tuned model needed)

### Data model (new SQLite tables)
- `fin_goals` — stores onboarding answers (goal type, life events, category budgets, horizon)
- `fin_transactions` — stores parsed transactions (date, description, amount, category, period_label)
- `fin_uploads` — tracks each CSV upload (filename, period_label, uploaded_at, row_count)
- Claude's discretion on exact schema column names and types

### Claude's Discretion
- Exact CIBC CSV column mapping (headers vary slightly between CIBC account types — researcher to verify)
- Keyword/merchant matching rules for categorisation
- Deduplication strategy for overlapping uploads
- Exact SQL queries for dashboard metrics
- System prompt template for finance chat context injection
- Whether the Finance panel is a route/section or a modal overlay

</decisions>

<specifics>
## Specific Ideas

- "The LLM is only used for onboarding and chat — all numbers are SQL" — this is a hard constraint, not a preference
- Onboarding tone should be reflective and encouraging, not prescriptive: "What are you saving toward?" not "Set your savings target"
- Dashboard should feel like a premium personal finance app — glass bars with accent glow, not plain HTML tables
- The goal-setting conversation doesn't need to be perfectly structured — it's okay if the user says "I don't know yet" — the point is to prompt reflection
- "Can combine multiple uploads" — e.g. upload Jan, Feb, Mar separately and see a 3-month trend

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `app_settings` DB table + `get_app_setting`/`set_app_setting` — use for onboarding completion flag (`fin_onboarding_done`)
- Narrator/FRT system (`FRT` state machine in `app.js`) — existing first-run tutorial mechanism; Finance onboarding reuses same pattern
- `register_*()` router registration pattern (`app/rag.py`, `app/setup_wizard.py`) — Finance feature follows this: `app/finance.py` with `register_finance(app, ...)`
- SSE streaming pattern (already in RAG ingest) — reuse for CSV parse progress if needed
- Chat rendering pipeline (`buildMessageHTML`, `appendMessage`) — Chat tab reuses existing message rendering
- Glass CSS variables (`--bg-panel`, `--glass-filter`, `--border-highlight`, `--accent-primary`) — Dashboard charts use these directly

### Established Patterns
- Module IIFE pattern in `app.js` (ragUI, voiceUI, wakewordUI) — Finance panel JS follows same pattern: `financeUI = (function() { ... })()`
- `database.py` schema init in `init_db()` — new `fin_*` tables added here with `CREATE TABLE IF NOT EXISTS`
- FastAPI router prefix: `/finance` with tag `finance`
- All DB operations use `database.DB_NAME` path

### Integration Points
- RSB icon strip (right sidebar) — needs a new Finance icon SVG `<symbol>` and click handler
- Left sidebar nav or RSB icon: click triggers `financeUI.open()` which renders the Finance panel
- Main content area: Finance panel overlays or replaces the chat zone (similar to how tutorial overlays work)
- `startApp()` in `app.js`: call `financeUI.init()` after model load or unconditionally (Finance doesn't need a model loaded to show the dashboard)
- `init_db()` in `database.py`: add `fin_transactions`, `fin_goals`, `fin_uploads` table creation

</code_context>

<deferred>
## Deferred Ideas

- OFX / QFX format support — v2 (FIN-V2-01)
- PDF bank statement support — v2 (FIN-V2-02)
- User re-categorisation of individual transactions — v2 (FIN-V2-04)
- Month-over-month trend chart with % change — could fold into v1 dashboard if simple
- Export dashboard as PDF/image — post-v1
- Multiple bank accounts with separate tracking — post-v1 (v1 accumulates all into one pool)

</deferred>

---

*Phase: 02-financial-advisor*
*Context gathered: 2026-03-15*
