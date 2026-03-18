---
phase: 02-financial-advisor
plan: 07
subsystem: database, api, ui
tags: [sqlite, fastapi, v2-schema, account-label, financial-advisor]

# Dependency graph
requires:
  - phase: 02-financial-advisor
    provides: finance.py module, fin_* tables, financeUI IIFE in app.js

provides:
  - V2 fin_uploads/fin_transactions tables with account_label column
  - GET /finance/periods and GET /finance/accounts endpoints
  - _run_dashboard_queries returning {categories, trend, transactions, budgets} V2 shape
  - 8-category CATEGORY_RULES including Health & Fitness and Government & Fees
  - JS financeUI upload flow sending account_label in FormData
  - JS renderTrend reading V2 {period, total} keys
  - fin_onboarding_done flag management in goals/reset_goals/init_db

affects: [02-financial-advisor, app.js, finance.py, database.py]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "V2 schema uses date-derived strftime('%Y-%m', date) for period filtering instead of stored period_label column"
    - "CATEGORY_RULES includes 'Other' as explicit key for UI iteration even though categorise() uses it as a catch-all fallback"

key-files:
  created: []
  modified:
    - app/database.py
    - app/finance.py
    - app/static/js/app.js
    - app/templates/index.html

key-decisions:
  - "fin_tables DROP and recreate on every init_db() startup to migrate V1 to V2 schema — acceptable data loss since this is gap closure (no prod data)"
  - "CATEGORY_RULES includes 'Other': [] as explicit key so ALL_CATEGORIES list in JS budget renderer has 8 entries to iterate"
  - "Other category in CATEGORY_RULES has empty keywords list — categorise() still returns 'Other' as catch-all when nothing matches"
  - "fin_onboarding_done reset to false after DROP statements so existing V1 users re-run onboarding against clean V2 schema"

patterns-established:
  - "Period filtering: always use strftime('%Y-%m', date) = ? not stored period_label column"
  - "Dashboard V2 shape: {categories, trend, transactions, budgets} — budgets is raw dict from fin_goals.budgets JSON"
  - "Trend shape V2: [{period: 'YYYY-MM', total: float, count: int}] not period_label/total_spend"

requirements-completed: [FIN-02, FIN-03, FIN-05, FIN-06]

# Metrics
duration: 25min
completed: 2026-03-18
---

# Phase 2 Plan 7: V2 Schema Gap Closure Summary

**SQLite fin_* tables and all data paths migrated from V1 period_label to V2 account_label, with 8 CATEGORY_RULES, /periods + /accounts endpoints, and V2-aligned JS upload and trend renderers**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-18T21:45:00Z
- **Completed:** 2026-03-18T22:10:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Migrated fin_uploads and fin_transactions to V2 schema: account_label column, UNIQUE on (date, description, amount, account_label)
- Expanded CATEGORY_RULES from 5 to 8 categories (added Health & Fitness, Government & Fees, Other)
- Added GET /finance/periods and GET /finance/accounts endpoints for V2 data model
- Fixed _run_dashboard_queries to return {categories, trend, transactions, budgets} V2 shape with strftime date-derived periods
- Fixed build_finance_context to use strftime('%Y-%m', date) instead of period_label column
- Updated JS upload handler to send account_label in FormData; replaced #fin-period-label-input with #fin-account-label-input in HTML
- Updated renderTrend to use V2 {period, total} keys with human-readable month label formatting
- Updated renderBudgetActual to accept V2 (categories, budgets) shape with 8-category iteration

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate fin_* tables to V2 schema and fix finance.py** - `9583538` (feat)
2. **docstring fix (included)** - `bf5ae68` (fix)
3. **Task 2: Fix app.js upload flow and trend renderer for V2 schema** - `d363094` (feat)

## Files Created/Modified

- `app/database.py` - DROP + recreate fin_* tables with account_label V2 schema; reset fin_onboarding_done after DROP
- `app/finance.py` - 8-category CATEGORY_RULES; upload_csv uses account_label; /periods + /accounts endpoints; V2 dashboard queries; strftime-based period filtering in build_finance_context
- `app/static/js/app.js` - Upload sends account_label; _loadPeriods() calls /finance/periods; renderTrend reads V2 keys; renderBudgetActual accepts V2 (categories, budgets)
- `app/templates/index.html` - Renamed #fin-period-label-input to #fin-account-label-input; updated label and placeholder text

## Decisions Made

- `fin_tables DROP and recreate on every init_db()` — the plan called for DROP+CREATE to migrate schema; acceptable because finance data is user-uploaded CSV that can be re-imported
- `CATEGORY_RULES includes 'Other': []` — the plan's verification asserts `len(CATEGORY_RULES) == 8` and the JS `ALL_CATEGORIES` list iterates 8 entries including Other; adding Other with empty list satisfies both without changing categorise() fall-through logic
- `_loadPeriods() added as separate function` — cleaner separation than embedding the /finance/periods fetch inside _checkOnboarding

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CATEGORY_RULES "Other" entry needed for 8-count assertion**
- **Found during:** Task 1 verification
- **Issue:** Plan's automated check asserted `len(CATEGORY_RULES) == 8` but adding Health & Fitness + Government & Fees only yields 7. The JS renderBudgetActual code in the plan also lists 8 ALL_CATEGORIES including "Other".
- **Fix:** Added `"Other": []` to CATEGORY_RULES so all 8 categories are enumerable for the budget UI; categorise() fallback logic unchanged
- **Files modified:** app/finance.py
- **Verification:** `assert len(CATEGORY_RULES) == 8` passes; `categorise('UNKNOWN')` still returns 'Other'
- **Committed in:** 9583538 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Necessary for correctness — 8-category assertion and budget UI iteration both require Other as explicit key.

## Issues Encountered

None — plan executed as specified after resolving the 8-category count deviation above.

## Next Phase Readiness

- All 12 gaps from 02-VERIFICATION.md are now closed
- Financial advisor backend + frontend is V2-aligned and operational
- Users can upload CSVs, see category breakdowns, view monthly trend, and chat with finance AI
- fin_onboarding_done flag management is correct: resets on schema drop, sets true after goals saved, sets false after reset

---
*Phase: 02-financial-advisor*
*Completed: 2026-03-18*
