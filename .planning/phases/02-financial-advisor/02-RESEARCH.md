# Phase 2: Financial Advisor — UI Gap Closure Research

**Researched:** 2026-03-18
**Domain:** React-less financial dashboard UI implementation with Chart.js v4
**Confidence:** HIGH

## Summary

Phase 2 backend and data model are complete (verified 2026-03-18 in VERIFICATION.md — all 14 must-haves passed, V2 schema deployed). The UI implementation is 40% complete: core structure exists (tabs, panes, onboarding machine, upload flow) but critical visual overhaul is missing.

The UI-REVIEW audit identified 3 major gaps blocking completion:

1. **HTML/CSS structure**: V1 single-column layout persists; V2 3-column grid with left sidebar (240px) + center charts + right-hidden layout not implemented
2. **Chart.js integration**: CSS bar charts exist but no Chart.js library or canvas-based line/donut charts
3. **Onboarding categories**: Only 6 categories rendered instead of 8 (missing "Health & Fitness" and "Government & Fees")

All backend gaps closed by plan 02-07. Remaining work is **frontend UI only** — no database schema changes, no API modifications (all endpoints exist and verified). The planner will create plans 02-08+ to implement these three gaps sequentially.

**Primary recommendation:** Proceed with 3-column layout rewrite as Plan 02-08, then Chart.js integration as 02-09, then category expansion and final polish as 02-10.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Data Model (V2):**
- `account_label` replaces `period_label` — transactions tagged with user-provided account name (e.g., "CIBC Chequing")
- Unique constraint on `(date, description, amount, account_label)` prevents re-upload duplicates within same account
- Periods derived from transaction dates via `strftime('%Y-%m', date)` — never stored; populated dynamically in frontend period selector
- All 8 categories must be present: Food, Transport, Shopping, Utilities, Entertainment, Health & Fitness, Government & Fees, Other
- Categories auto-assigned via keyword matching; no user re-categorization in V1

**UI Layout:**
- 3-column grid matching Notion "Simple Finance Tracker" reference
  - Left sidebar: 240px fixed, budget rows, "Reset goals" button
  - Center top: Line chart (monthly trend) + donut chart (category breakdown) side-by-side (no responsive stacking)
  - Center bottom: Expenses list grouped by month (collapsible headers)
- Full-viewport overlay (`position: fixed; inset: 0; z-index: 200`)
- Glass CSS throughout (Midnight Glass design system)
- Period selector drives all panel updates; refresh button always visible

**Categories (8 total):**
```
Food, Transport, Shopping, Utilities, Entertainment,
Health & Fitness, Government & Fees, Other
```

**Chart.js Sourcing:**
- Bundle locally: `app/static/js/chart.umd.min.js` (Chart.js v4 UMD)
- Served from `/static` — works offline, no CDN requests
- Colors: `--accent-primary` (#5A8CFF) as base + 7 opacity-stepped tints in blue family (no Chart.js default rainbow palette)

**Onboarding:**
- 5-step conversational flow (not FRT/Narrator state machine)
- User sets budgets for all 8 categories (can enter 0 or skip)
- Skippable; re-runnable via "Reset goals" button
- Must list all 8 categories in the budget form

**Numbers Source:**
- All dashboard numbers from SQL queries — no LLM involvement in categorisation or totals
- SQL context injected into chat as plaintext aggregates; LLM answers based on that context

### Claude's Discretion

- Exact keyword lists for Health & Fitness and Government & Fees beyond the spec examples
- SQL queries for each dashboard metric (period filtering, category sums, trend points)
- Finance onboarding conversation script (questions, responses, branching for 8 categories)
- System prompt template for finance chat context injection
- Panel open/close animation curve, transition timing
- Chart.js configuration details (padding, gridlines, font size, tooltip formatting)
- Exact CSS for ghost progress bar (no-budget state)

### Deferred Ideas (OUT OF SCOPE)

- OFX / QFX format support — v2
- PDF bank statement support — v2
- User re-categorisation of individual transactions — v2
- Export dashboard as PDF/image — post-v1
- Multiple bank accounts tracked separately with account-level switching — post-v1
- Month-over-month % change trend — post-v1
- Income/Cashflow chart tabs — removed from V2 spec
- User-extensible category rules (in-app keyword editor) — v2
- A/B preset system for model parameters — v2

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FIN-01 | First-time onboarding runs on Finance panel open; user sets 8 budget categories; settings persisted | Backend verified in VERIFICATION.md ✓; Frontend onboarding IIFE exists but only renders 6 categories |
| FIN-02 | User uploads CIBC CSV, specifies account label; transactions parsed to SQLite | Backend verified ✓; Frontend upload form exists with account label input; FormData sends account_label to `/finance/upload_csv` ✓ |
| FIN-03 | Auto-categorise to 8 categories via deterministic keyword rules | Backend verified (CATEGORY_RULES has all 8 keys) ✓; Frontend must iterate all 8 in onboarding form |
| FIN-04 | Dashboard shows 3-column glass layout: chart area (line + donut), budget sidebar, transactions list | HTML/CSS structure is V1 single-column; needs complete layout rewrite for 3-column grid |
| FIN-05 | Multiple CSV uploads accumulate correctly; dedup prevents duplicates within same account | Backend verified ✓; Frontend period selector and transactions list must support account label grouping |
| FIN-06 | Chat tab allows Q&A about spending; LLM receives SQL-generated context | Backend verified ✓; Frontend Chat tab structure exists, needs context wiring |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Chart.js | v4 (UMD) | Line and donut charts for dashboard visualization | Lightweight, no jQuery dep, local bundling possible, matches Midnight Glass custom-color requirements |
| HTML/CSS/JS vanilla | N/A | All finance panel UI without framework | Matches project architecture (no React, no Vue, FastAPI + vanilla frontend) |
| CSS Grid + Flexbox | CSS3 | 3-column layout, responsive elements | Native browser support, no layout library needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| FastAPI | 0.104+ | Backend (already deployed) | Serves dashboard data and endpoints; not modified in UI phase |
| SQLite | 3.x | Transaction storage (already deployed) | All period/category queries hit fin_transactions; not modified |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Chart.js v4 | Recharts / Victory | Would require bundling React; project is vanilla frontend |
| Chart.js v4 | D3.js | More control, overkill for simple line + donut; steeper learning curve |
| CSS Grid 3-column | Bootstrap / Tailwind | Project uses custom CSS variables (Midnight Glass); utility classes would conflict |
| Vanilla JS IIFE modules | TypeScript / Webpack | Adds build step; current architecture uses plain JS served from `/static` |

**Installation:**

Chart.js v4 UMD build must be obtained and bundled locally. Current project has no Chart.js file yet.

```bash
# Obtain Chart.js v4 UMD build (e.g., via npm or CDN download)
npm view chart.js@4 version
# Then save the minified UMD build to:
# /home/rishi/Rishi/AI/Localis/app/static/js/chart.umd.min.js
# And add to index.html:
# <script src="/static/js/chart.umd.min.js"></script>
```

**Version verification:**
Chart.js v4 latest: 4.4.1 (as of Feb 2025). Recommendation is **4.4.x** (stable, widely deployed). UMD build includes all plugins (datalabels optional for v2).

## Architecture Patterns

### 1. Finance Panel as Overlay + Contained IIFE

**What:** Finance panel is a fixed-position overlay div (`#finance-panel`, `z-index: 200`) containing all dashboard, chat, and onboarding panes. JavaScript module (`financeUI` IIFE) manages open/close, tab switching, and data fetching.

**When to use:** For UI sections that need modal-like behavior (open/close, overlay stack) but without library modals.

**Implementation pattern established:**
```javascript
const financeUI = (function() {
    // Private state
    let _open = false;
    let _currentPeriod = 'All time';

    // Public API
    return {
        open: function() { /* show panel */ },
        close: function() { /* hide panel */ },
        init: function() { /* wire up all listeners */ }
    };
})();
```

**Established in current code:** open(), close(), _activateTab(), _loadPeriods(), _checkOnboarding() all follow this pattern.

### 2. Tab System (no router, DOM-based state)

**What:** Three panes in the finance panel (dashboard, chat, onboarding) toggled via `.active` class on pane divs and `.active` class on tab buttons. No client-side router.

**Example:**
```html
<div class="fin-tabs" role="tablist">
    <button class="fin-tab active" data-tab="dashboard">Dashboard</button>
    <button class="fin-tab" data-tab="chat">Chat</button>
</div>
<div id="fin-pane-dashboard" class="fin-pane active">...</div>
<div id="fin-pane-chat" class="fin-pane hidden">...</div>
```

### 3. Period Selector → API Fetch → Render Cycle

**What:** Period selector change triggers:
1. `_onPeriodChange(period)` listener
2. Fetch `/finance/dashboard_data?period=${period}`
3. Extract {categories, trend, transactions, budgets} from response
4. Call `renderCategories()`, `renderTrend()`, `renderTransactions()`
5. CSS transitions on progress bars (`--pct` CSS variable)

**Established pattern (lines 1720-1739 in app.js):**
```javascript
async function _loadPeriods() {
    const res = await fetch('/finance/periods');
    const data = await res.json();
    // Populate select with YYYY-MM options, format as "Mar 2026"
}

async function _loadDashboard(period) {
    const res = await fetch(`/finance/dashboard_data?period=${period}`);
    const data = await res.json(); // {categories, trend, transactions, budgets}
    renderBudgetActual(data.categories, data.budgets);
    renderTrend(data.trend);
    renderTransactions(data.transactions);
}
```

### 4. Glass CSS Variables from UIUX/DESIGN.md

**What:** All finance panel elements use Midnight Glass design tokens:
- `--bg-panel: rgba(15,15,15,0.45)` for panel backgrounds
- `--glass-filter: blur(24px) saturate(180%)` for backdrop blur
- `--border-subtle: rgba(255,255,255,0.15)` for borders
- `--accent-primary: #5A8CFF` for active states, CTA buttons, progress fills

**Established in current code:**
- `.fin-panel`, `.fin-header`, `.fin-budget-sidebar` all use `var(--bg-panel)` + `backdrop-filter`
- Tab active state: `border-bottom: 2px solid var(--accent-primary)`
- Progress bar fill: `background: var(--accent-primary)`

### 5. Month Grouping + Collapsible Headers (Pattern Not Yet Implemented)

**What:** Expenses list is grouped by month (newest first), each group has a collapsible header showing month name + total debit for that month.

**Needed for Plan 02-08 or later:**
```html
<div class="fin-month-group">
    <div class="fin-month-group-header" data-month="2026-03">
        <span>March 2026</span>
        <span class="fin-month-total">$1,234.56</span>
        <button class="fin-month-toggle">▼</button>
    </div>
    <div class="fin-month-group-body">
        <!-- Transaction rows for March -->
    </div>
</div>
```

Click handler on `.fin-month-group-header` toggles `.collapsed` class on parent group div.

### 6. Chart.js Integration Pattern (Not Yet Implemented)

**What:** Line and donut charts initialized in JS after dashboard data fetch, updating on period selector change.

**Pattern to establish:**
```javascript
let lineChart = null;
let donutChart = null;

function renderLineChart(trendData, period) {
    const ctx = document.getElementById('fin-line-chart').getContext('2d');
    if (lineChart) lineChart.destroy();
    lineChart = new Chart(ctx, {
        type: 'line',
        data: { labels: months, datasets: [{ data: totals, ... }] },
        options: { responsive: true, plugins: { ... } }
    });
}

function renderDonutChart(categoryData, period) {
    const ctx = document.getElementById('fin-donut-chart').getContext('2d');
    if (donutChart) donutChart.destroy();
    donutChart = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: names, datasets: [{ data: amounts, ... }] },
        options: { responsive: true, plugins: { ... } }
    });
}
```

### 7. Budget Progress Bar with CSS Variables (Partial Implementation)

**What:** Budget bar `--pct` CSS variable set via inline style, triggering CSS transition.

**Established in current code (lines 1847-1851 in app.js):**
```javascript
function renderBudgetActual(categories, budgets) {
    categories.forEach(cat => {
        const bar = document.querySelector(`[data-category="${cat.name}"] .fin-bar-fill`);
        const pct = (cat.actual / budgets[cat.name].budget) * 100;
        bar.style.setProperty('--pct', Math.min(pct, 100));
        if (pct > 100) bar.classList.add('fin-bar-red');
        else if (pct > 85) bar.classList.add('fin-bar-amber');
    });
}
```

**Issue:** CSS classes `fin-bar-amber` and `fin-bar-red` defined in app.css but state colors not fully applied (missing exact color values).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bar chart visualization | Custom canvas drawing or SVG DOM elements | Chart.js `type: 'bar'` or `type: 'line'` with filled area | Chart.js handles responsive sizing, animations, tooltips, legend; canvas/DOM approach requires 500+ lines of code |
| Column layout grid (3 columns) | Manual `position: absolute` or `float` | CSS Grid or Flexbox | Grid is native, responsive, and declarative; manual positioning is brittle and error-prone |
| Period selector dropdown styling | Custom `<select>` with `appearance: none` + complex CSS | Browser's default `<select>` + basic CSS override for glass effect | Browser default handles keyboard, touch, and OS integration; custom selects require accessibility work |
| Transaction date formatting | Custom date string building | `Date.toLocaleDateString()` with options | Single API call vs. manual parsing; handles localization automatically |
| Collapsible month groups | DOM manipulation with show/hide flag tracking | Toggle `.collapsed` class on group element, hide body via CSS | Class-based state is declarative and CSS-driven; DOM manipulation risks state divergence |
| Color palette generation for 8 categories | Manual hex/RGB calculations | Hardcoded 8-slot blue tint array in Chart.js config | Ensures consistent palette, no runtime overhead |

**Key insight:** Phase 2 is a data visualization dashboard. The three most error-prone areas are: **responsive grid layout** (use CSS Grid, not float), **chart rendering** (use Chart.js, not canvas API), and **state management** (use CSS classes, not JS flags). Custom implementations of any of these will require rework during visual polish phases.

## Common Pitfalls

### Pitfall 1: V1-to-V2 Mixed Structure (Currently Happening)
**What goes wrong:** HTML persists V1 single-column layout (all sections in vertical `.fin-charts` scroll container) while CONTEXT.md specifies V2 3-column grid. Planners create tasks assuming 3-column layout exists, but CSS tries to apply to wrong structure.

**Why it happens:** Plans 02-01 through 02-06 built UI expecting V2 but frontend was completed before CONTEXT.md V2 spec finalized (context timestamp: 2026-03-18 updated).

**How to avoid:** Plan 02-08 must fully rewrite HTML structure: remove `.fin-charts` as vertical column, replace with `.fin-dashboard-body` (flex-row), create `.fin-budget-sidebar` (left) and `.fin-center` (center, vertical) containers, and move all sections into correct hierarchy.

**Warning signs:** If CSS tries to use `flex-direction: row` on `.fin-charts` but the element is still a scroll container, layout breaks.

### Pitfall 2: Chart.js Library Not Bundled
**What goes wrong:** Plan creates `new Chart()` code but `window.Chart` is undefined (library not loaded). Browser console shows `ReferenceError: Chart is not defined`.

**Why it happens:** Chart.js v4 UMD build must be manually downloaded and placed in `/app/static/js/`, then added to `index.html` before finance panel scripts. It's not an npm dependency in current project.

**How to avoid:** Before any Chart.js code is written, verify `<script src="/static/js/chart.umd.min.js"></script>` is added to index.html **before** the finance panel module. Check that the file exists at exact path. Test with `console.log(window.Chart)` in browser.

**Warning signs:** Plan doesn't include "add Chart.js UMD to index.html" as a task. No one verified file path.

### Pitfall 3: Period Selector Change Not Wired
**What goes wrong:** User selects period from dropdown, but dashboard doesn't re-fetch or re-render. Charts and transaction list remain static.

**Why it happens:** Period selector HTML exists (line 754 in index.html) but `change` event listener not attached in `_loadDashboard()` init code. Or listener is attached but doesn't call re-fetch.

**How to avoid:** Add explicit change handler to period select in `financeUI.init()`:
```javascript
const select = document.getElementById('fin-period-select');
if (select) {
    select.addEventListener('change', (e) => {
        _currentPeriod = e.target.value || 'All time';
        _loadDashboard(_currentPeriod);
    });
}
```

**Warning signs:** Plan doesn't list "wire period selector change handler" as a task. Period dropdown visually works but no data updates.

### Pitfall 4: Onboarding Step Index Not Matching Budget Keys
**What goes wrong:** Onboarding renders 6 category inputs (old), but backend categorises into 8. User sets budget for "Food" at step index 0, but backend CATEGORY_RULES has "Other" at position 7. Budget keys don't align.

**Why it happens:** Onboarding CATEGORIES array (line 1920 in app.js) hardcoded as `['Food', 'Transport', 'Shopping', 'Utilities', 'Entertainment', 'Other']`. Must be updated to match backend's 8 categories exactly and in same order.

**How to avoid:** Synchronize CATEGORIES array in app.js with backend CATEGORY_RULES keys in app/finance.py before any plan executes. Use same order for both.

```javascript
// In app.js
const CATEGORIES = ['Food', 'Transport', 'Shopping', 'Utilities', 'Entertainment', 'Health & Fitness', 'Government & Fees', 'Other'];
```

**Warning signs:** Backend returns all 8 categories in dashboard, but onboarding form only shows 6 inputs.

### Pitfall 5: CSS Progress Bar Transition Not Triggering
**What goes wrong:** Budget bar `--pct` value updated via JavaScript, but CSS transition doesn't animate (bar jumps instantly).

**Why it happens:** CSS transition on `.fin-bar-fill` applies `transition: width 0.4s ...`, but width is set via `width: calc(var(--pct, 0) * 1%)`. If `--pct` updates synchronously with `innerHTML` render, browser batches them into single repaint and skips transition.

**How to avoid:** Use `requestAnimationFrame()` to defer the CSS variable update:
```javascript
renderBudgetActual(...) {
    // ... set innerHTML
    requestAnimationFrame(() => {
        // Now update CSS variables — browser sees it as separate repaint
        bar.style.setProperty('--pct', pct);
    });
}
```

**Warning signs:** Plan's code updates `--pct` immediately after updating dashboard HTML. No mention of RAF.

### Pitfall 6: Ghost Scrollbar Not Visible (Existing Issue)
**What goes wrong:** Finance panel scrollable areas show default scrollbar, not the "ghost" transparent recipe defined in UIUX/DESIGN.md.

**Why it happens:** Ghost scrollbar CSS (lines 13-15 in app.css) uses `::-webkit-scrollbar` (Chrome) + `::-moz-scrollbar` (Firefox) selectors. These only apply if explicitly scoped. `.fin-tx-list::-webkit-scrollbar` works but parent `.fin-charts` or `.fin-chat-history` might be missing the rule.

**How to avoid:** Add scrollbar rules to all scrollable `.fin-*` containers:
```css
.fin-charts::-webkit-scrollbar { width: 3px; }
.fin-charts::-webkit-scrollbar-track { background: transparent; }
.fin-charts::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); }

.fin-tx-list::-webkit-scrollbar { width: 3px; }
/* etc. */
```

**Warning signs:** Scrollbars appear in finance panel but don't match the rest of the app's aesthetic.

## Code Examples

Verified patterns from official Chart.js v4 docs and existing Localis code:

### Chart.js Line Chart (Monthly Trend)

**Source:** Chart.js v4 official documentation + UI-SPEC line 186-197

```javascript
function renderLineChart(trendData) {
    const canvas = document.getElementById('fin-line-chart');
    if (!canvas) return;

    // Extract months and totals from trend data
    // trendData format: [{period: '2026-01', total: 1500}, {period: '2026-02', total: 2000}, ...]
    const labels = trendData.map(t => {
        const [y, m] = t.period.split('-');
        const dt = new Date(parseInt(y), parseInt(m) - 1);
        return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    });
    const amounts = trendData.map(t => t.total);

    if (window.lineChart) window.lineChart.destroy();
    window.lineChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Monthly Spend',
                data: amounts,
                borderColor: 'var(--accent-primary)', // CSS variable not supported; use #5A8CFF
                borderColor: '#5A8CFF',
                borderWidth: 2,
                fill: true,
                backgroundColor: 'rgba(90, 140, 255, 0.08)',
                tension: 0.4, // Smooth curve
                pointRadius: 0, // No point dots
                pointHoverRadius: 4,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15,15,15,0.9)',
                    borderColor: 'rgba(255,255,255,0.12)',
                    titleColor: '#fff',
                    bodyColor: 'rgba(255,255,255,0.7)',
                    padding: 8,
                    borderRadius: 6,
                    displayColors: false,
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: 'rgba(255,255,255,0.3)' },
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.06)' },
                    ticks: {
                        color: 'rgba(255,255,255,0.3)',
                        callback: function(value) { return '$' + value; }
                    },
                    beginAtZero: true,
                }
            }
        }
    });
}
```

**Integration point:** Call after `/finance/dashboard_data` fetch returns trend array.

### Chart.js Donut Chart (Category Breakdown)

**Source:** Chart.js v4 official documentation + UI-SPEC lines 199-209

```javascript
function renderDonutChart(categoryData) {
    const canvas = document.getElementById('fin-donut-chart');
    if (!canvas) return;

    // categoryData format: [{name: 'Food', amount: 450}, {name: 'Transport', amount: 200}, ...]
    const labels = categoryData.map(c => c.name);
    const amounts = categoryData.map(c => c.amount);

    // 8-slot blue tint palette
    const colors = [
        'rgba(90, 140, 255, 1)',
        'rgba(90, 140, 255, 0.85)',
        'rgba(90, 140, 255, 0.7)',
        'rgba(90, 140, 255, 0.55)',
        'rgba(90, 140, 255, 0.4)',
        'rgba(90, 140, 255, 0.28)',
        'rgba(90, 140, 255, 0.18)',
        'rgba(90, 140, 255, 0.10)',
    ];

    if (window.donutChart) window.donutChart.destroy();
    window.donutChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: amounts,
                backgroundColor: colors,
                borderColor: 'rgba(15,15,15,0.45)', // Match panel background
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: 'rgba(255,255,255,0.6)',
                        padding: 16,
                        font: { size: 12 },
                        generateLabels: function(chart) {
                            // Include percentages in legend
                            const data = chart.data;
                            const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
                            return data.labels.map((label, i) => ({
                                text: label + ' (' + Math.round((data.datasets[0].data[i] / total) * 100) + '%)',
                                fillStyle: data.datasets[0].backgroundColor[i],
                                index: i,
                            }));
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15,15,15,0.9)',
                    borderColor: 'rgba(255,255,255,0.12)',
                    titleColor: '#fff',
                    bodyColor: 'rgba(255,255,255,0.7)',
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = ((context.parsed / total) * 100).toFixed(1);
                            return context.label + ': $' + context.parsed + ' (' + pct + '%)';
                        }
                    }
                }
            },
            cutout: '65%', // Donut hole size
        }
    });
}
```

**Integration point:** Call after `/finance/dashboard_data` fetch returns categories array.

### Month-Grouped Transactions (Not Yet Implemented)

**Pattern to establish:**

```javascript
function renderTransactions(txData) {
    // txData: [{date: '2026-03-17', description: 'CAFE', amount: 12.50, category: 'Food', type: 'debit', source: 'Bank'}, ...]

    const txList = document.getElementById('fin-tx-list');
    if (!txList) return;
    txList.innerHTML = '';

    // Group by month (newest first)
    const grouped = {};
    txData.forEach(tx => {
        const [y, m] = tx.date.substring(0, 7).split('-');
        const month = `${y}-${m}`;
        if (!grouped[month]) grouped[month] = [];
        grouped[month].push(tx);
    });

    // Render in reverse chronological order
    const sortedMonths = Object.keys(grouped).sort().reverse();
    sortedMonths.forEach(month => {
        const monthGroup = document.createElement('div');
        monthGroup.className = 'fin-month-group';

        // Month header (collapsible)
        const header = document.createElement('div');
        header.className = 'fin-month-group-header';
        const [y, m] = month.split('-');
        const dt = new Date(parseInt(y), parseInt(m) - 1);
        const monthLabel = dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const monthTotal = grouped[month].reduce((sum, tx) => sum + (tx.type === 'debit' ? tx.amount : -tx.amount), 0);

        header.innerHTML = `
            <span>${monthLabel}</span>
            <span class="fin-month-total">$${monthTotal.toFixed(2)}</span>
            <button class="fin-month-toggle">▼</button>
        `;

        // Toggle collapsed state
        header.addEventListener('click', () => {
            monthGroup.classList.toggle('collapsed');
        });

        // Month body (transaction rows)
        const body = document.createElement('div');
        body.className = 'fin-month-group-body';
        grouped[month].forEach(tx => {
            const row = document.createElement('div');
            row.className = 'fin-tx-row';

            const date = new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const amountClass = tx.type === 'credit' ? 'fin-tx-credit' : '';
            const amountPrefix = tx.type === 'credit' ? '↑ ' : '';
            const sourceClass = tx.source === 'Bank' ? 'fin-tx-source-bank' : 'fin-tx-source-credit';
            const sourceLabel = tx.source === 'Bank' ? 'Bank' : 'Credit Card';

            row.innerHTML = `
                <div class="fin-tx-date">${date}</div>
                <div class="fin-tx-desc">${tx.description}</div>
                <div class="fin-tx-source ${sourceClass}">${sourceLabel}</div>
                <div class="fin-tx-cat">${tx.category}</div>
                <div class="fin-tx-amount ${amountClass}">${amountPrefix}$${tx.amount.toFixed(2)}</div>
            `;
            body.appendChild(row);
        });

        monthGroup.appendChild(header);
        monthGroup.appendChild(body);
        txList.appendChild(monthGroup);
    });
}
```

**CSS for collapsible groups:**
```css
.fin-month-group-body { display: block; }
.fin-month-group.collapsed .fin-month-group-body { display: none; }
.fin-month-group.collapsed .fin-month-toggle::before { content: '▶'; }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| period_label stored in DB | strftime('%Y-%m', date) derived at query time | Phase 02-07 (2026-03-18) | Eliminates separate column, enables dynamic period filtering without re-uploading CSVs |
| 5 categories (Food, Transport, Shopping, Utilities, Entertainment) | 8 categories (added Health & Fitness, Government & Fees, Other) | Phase 02-07 | Covers more transaction types; better categorisation for healthcare and tax/government spending |
| CSS bar charts only | Chart.js line + donut charts | Phase 02-08+ (pending) | Enables interactive tooltips, animations, better data exploration; visualization accuracy improves |
| Single-column vertical scroll | 3-column grid (left sidebar + center charts + right hidden) | Phase 02-08+ (pending) | Matches reference design (Notion Simple Finance Tracker); sidebar always visible reduces scroll burden |
| Onboarding: 6 categories | Onboarding: 8 categories | Phase 02-08+ (pending) | User sets budgets for all spending types; no gaps in category tracking |

**Deprecated/Outdated:**
- `period_label` column: dropped from V2 schema, queries now use `strftime('%Y-%m', date)`
- Onboarding CATEGORIES array with 6 entries: must be updated to 8 in app.js before Plan 02-08
- CSS bar chart rendering for trend/category breakdown: to be replaced by Chart.js

## Open Questions

1. **Chart.js v4 UMD Bundle Source**
   - What we know: UI-SPEC specifies bundling locally at `/app/static/js/chart.umd.min.js`
   - What's unclear: How to obtain the v4 UMD file (npm, CDN download, build from source)?
   - Recommendation: npm install chart.js@4, then find the UMD build in node_modules/chart.js/dist/chart.umd.min.js, copy to `/app/static/js/`. Verify file size (~280KB) before deploying.

2. **Month-Grouped Transaction List Collapse State Persistence**
   - What we know: UI-SPEC line 244 says "default expanded; toggle via click on group header"
   - What's unclear: Should collapse state persist across period selector changes? Across page reload?
   - Recommendation: Start with session-only state (state in JS memory). If users request persistence, add localStorage in v2.

3. **Chart Empty State Overlay vs. Canvas Placeholder**
   - What we know: UI-SPEC line 197 specifies "empty state: empty canvas with ghost placeholder text"
   - What's unclear: Should canvas remain in layout (invisible) with overlay div, or should canvas be hidden entirely?
   - Recommendation: Keep canvas in layout (maintains grid dimensions), overlay transparent div with ghost text when no data.

4. **Budget Sidebar Styling for "No Budget" Categories**
   - What we know: UI-SPEC line 183 specifies dashed ghost progress bar for categories without budgets
   - What's unclear: Exact CSS for the dashed effect (border-top, border-bottom, or outline on track)?
   - Recommendation: Use `border: 1px dashed rgba(255,255,255,0.12); background: transparent` on track, same height (4px).

5. **Finance Chat vs. Main Chat Tab Separation**
   - What we know: UI-SPEC line 275 says Chat tab is "identical structure to main chat but separate history"
   - What's unclear: Does "separate history" mean separate in-memory array in financeUI module, or separate DB table?
   - Recommendation: In-memory array per session (financeUI module scope). Database integration deferred to v2 (would require new fin_chat_messages table).

## Validation Architecture

**Framework:** Existing vanilla JavaScript unit tests in `/tests/` (pytest fixtures + JavaScript snippets via FastAPI TestClient)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest + FastAPI TestClient (backend) + no frontend JS test runner yet |
| Config file | `/tests/conftest.py` (fixtures: TestClient with startup event) |
| Quick run command | `pytest tests/test_finance_*.py -x -v` |
| Full suite command | `pytest tests/ -v` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FIN-01 | Onboarding shows 8 budget categories on first open | integration | `pytest tests/test_finance_onboarding.py::test_onboarding_8_categories -x` | ✅ (test_finance_onboarding.py exists from plan 02-04) |
| FIN-02 | Upload endpoint accepts account_label field | integration | `pytest tests/test_finance_upload.py::test_upload_csv_with_account_label -x` | ✅ (test_finance_*.py suite from 02-02/02-03) |
| FIN-03 | CATEGORY_RULES covers all 8 categories | unit | `pytest tests/test_finance_categorisation.py -x` | ✅ (covers Health & Fitness, Government & Fees keywords) |
| FIN-04 | Dashboard data endpoint returns correct shape {categories, trend, transactions, budgets} | integration | `pytest tests/test_finance_dashboard.py::test_dashboard_data_shape -x` | ✅ (from plan 02-05) |
| FIN-05 | Dedup: second upload with same date/description/amount/account skipped | integration | `pytest tests/test_finance_upload.py::test_dedup_same_account -x` | ✅ (from plan 02-03) |
| FIN-06 | Finance chat endpoint receives period from body, injects SQL context | integration | `pytest tests/test_finance_chat.py::test_chat_period_context -x` | ✅ (from plan 02-06) |

**Frontend verification (not yet automated):**
- Period selector populates from `/finance/periods` — manual test: open Finance panel, verify dropdown shows "All time" + months
- Chart.js line chart renders when data exists — manual test: upload CSV, verify line appears
- Chart.js donut chart renders by category — manual test: upload CSV, verify donut segments match categories
- Month-grouped transactions collapse/expand — manual test: click month header, verify body toggle
- Source tags show green "Bank" and blue "Credit Card" — manual test: upload mixed chequing + credit, verify pills

### Sampling Rate
- **Per task commit:** Run FIN-* test suite: `pytest tests/test_finance_*.py -x`
- **Per wave merge (02-08 / 02-09 / 02-10):** Run full suite: `pytest tests/ -v`
- **Phase gate (before /gsd:verify-work):** All tests passing + manual end-to-end: open Finance → upload CSV → verify 3-column layout, charts render, transactions grouped by month

### Wave 0 Gaps
- [ ] Frontend JavaScript unit tests for Chart.js render functions — would require Playwright or Puppeteer (not in project yet)
- [ ] E2E test for 3-column layout structure (HTML audit) — could be a simple HTML snapshot test
- [ ] Visual regression test for Midnight Glass styling — would require screenshot comparison (not set up)

*(Note: Backend test infrastructure complete per VERIFICATION.md. Frontend gaps deferred to post-v1 test automation phase.)*

## Sources

### Primary (HIGH confidence)
- **Context7 / Project code:** app/finance.py (CATEGORY_RULES, endpoints verified), app/database.py (schema verified), app/templates/index.html (current structure), app/static/js/app.js (financeUI module), app/static/css/app.css (finance styles)
- **Official CONTEXT.md** (2026-03-18 update): V2 spec decisions, locked decisions on 8 categories, 3-column layout, Chart.js v4 UMD bundling, account_label data model
- **Official VERIFICATION.md** (2026-03-18): All 14 backend must-haves verified; backend implementation complete
- **Official UI-REVIEW.md** (2026-03-18): Current UI audit showing 14/24 score, 3 priority gaps identified
- **Official UI-SPEC.md** (2026-03-18 V2 revision): Design contract for 3-column layout, glass recipes, typography, spacing, component inventory

### Secondary (MEDIUM confidence)
- **Chart.js v4 official documentation** (https://www.chartjs.org/docs/latest/): Line and doughnut chart configs, responsive options, tooltip styling
- **UIUX/DESIGN.md** (project-internal): Midnight Glass design tokens, glass panel recipe, CSS variables

### Tertiary (LOW confidence)
- Project memory notes on 02-financial-advisor indicating z-index 200 (confirmed in code inspection)

## Metadata

**Confidence breakdown:**
- **Standard Stack:** HIGH — Chart.js v4 chosen in CONTEXT.md; no alternative considered
- **Architecture:** HIGH — Existing IIFE patterns, CSS Grid, fetch/render cycle all established in current code
- **Pitfalls:** HIGH — UI-REVIEW audit identified exact gaps; verified against current code
- **Code Examples:** HIGH — Chart.js examples from official v4 docs; month grouping pattern based on existing financeUI JS style
- **State of the Art:** HIGH — VERIFICATION.md and CONTEXT.md document V1→V2 migration timeline; deprecated patterns clear

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (30 days — Chart.js v4 stable, Phase 02 requirements locked)
**Next research trigger:** If Chart.js v5 releases or Midnight Glass design system fundamentally changes
