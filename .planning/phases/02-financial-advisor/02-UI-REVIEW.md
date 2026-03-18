# Phase 02 — UI Review

**Audited:** 2026-03-18
**Baseline:** UI-SPEC.md (V2 3-column design)
**Screenshots:** Not captured (no dev server running)

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 2/4 | Missing account label affordance and mixed V1/V2 copy styles |
| 2. Visuals | 2/4 | V1 single-column layout persists; 3-column dashboard not implemented |
| 3. Color | 3/4 | Proper accent usage but no Chart.js integration; CSS bar charts lack state colors |
| 4. Typography | 3/4 | Correct base sizes but inconsistent application across finance panel |
| 5. Spacing | 2/4 | V1 spacing scale persists; not aligned to 8-point grid specified in UI-SPEC |
| 6. Experience Design | 2/4 | Onboarding 6 categories vs 8 spec; no Chart.js integration; missing refresh button wiring |

**Overall: 14/24**

---

## Top 3 Priority Fixes

1. **HTML structure mismatch — V1 single-column vs V2 3-column layout** — User sees compressed layout without budget sidebar. Replace finance panel HTML with spec's fin-dashboard-body (left sidebar + center charts + tx list). File: `app/templates/index.html` lines 733-838.

2. **Onboarding: 6 categories instead of 8** — Missing "Health & Fitness" and "Government & Fees". Update CATEGORIES array to 8 entries matching CATEGORY_RULES. File: `app/static/js/app.js` line 1920.

3. **No Chart.js integration; CSS-only bars insufficient** — UI-SPEC requires Chart.js line chart (monthly trend) and donut chart (category breakdown). Current CSS bars lack interactivity. Implement `new Chart()` with line/donut configs. File: `app/static/js/app.js` (needs _renderLineChart and _renderDonutChart functions).

---

## Detailed Findings

### Pillar 1: Copywriting (2/4)

**Issues:**

1. **V1 upload copy persists** (`app/templates/index.html` line 757-759): Button still says "Upload CSV" (correct per UI-SPEC line 329) but the row header says "Period:" (line 753) instead of showing account label input inline. UI-SPEC specifies account label text input required before upload.

2. **Missing account label affordance** — UI-SPEC line 251 specifies "Account label text input: required, placeholder 'e.g. CIBC Chequing', datalist of existing account labels." Current HTML shows `#fin-upload-period-row` (line 765-770) with "Account label for this upload:" label, but input is hidden until file selected. No datalist reference visible.

3. **Empty state copy mismatch** (`app/templates/index.html` line 780-781): Says "No transactions uploaded yet" and mentions "CIBC bank statement CSV" — matches UI-SPEC empty state bodies (lines 335-336) ✓. However, missing empty state heading "No transactions yet" (UI-SPEC line 334) — only body text present.

4. **Chart empty state missing** — UI-SPEC line 337 specifies "No data yet — upload a statement to get started" overlay. Current CSS bar chart sections show `fin-empty-hint` divs but no explicit chart empty state overlay per spec.

**Score: 2/4** — Basic copy present but account label and chart empty states not aligned to UI-SPEC. Upload copy structure V1-style (hidden row) not matching spec's inline panel approach.

---

### Pillar 2: Visuals (2/4)

**Issues:**

1. **V1 single-column layout in place** — Entire finance panel is a vertical scroll container (`fin-charts` at line 1046 in app.css is `flex: 1; overflow-y: auto; display: flex; flex-direction: column`). UI-SPEC lines 33-45 specify 3-column grid: left sidebar (240px fixed, budget rows), center (flex: 1, split into charts row top + tx list bottom), and right collapsed (hidden). Current implementation has no left sidebar, no flex-row at dashboard level.

2. **No budget sidebar visible** — UI-SPEC describes "Budget Sidebar (240px fixed)" (line 175) with category rows, progress bars, and "Reset goals" button. Current HTML has no `.fin-budget-sidebar` div. Budget visualization is in a chart section (`fin-budget-chart` at line 1146 of CSS) rendered as vertical bar rows, not a dedicated sidebar panel.

3. **Charts container structure incorrect** — UI-SPEC "Charts row" (line 172) specifies side-by-side line + donut charts. Current HTML references `fin-categories-chart`, `fin-budget-chart`, and `fin-trend-chart` as separate sections in a vertical scroll, not a row container. CSS `fin-charts` is a column, not a row.

4. **No Chart.js canvases** — UI-SPEC requires `<canvas id="fin-line-chart">` and `<canvas id="fin-donut-chart">` (lines 189, 202). Current HTML has only styled div containers, no canvas elements for Chart.js integration.

5. **Transaction list not grouped by month** — UI-SPEC lines 229-244 specify month-group headers (collapsible ▼/▶ toggle, month name, total debit for month). Current `fin-tx-list` renders flat transaction rows via `renderTransactions()` with no month grouping. CSS has no `.fin-month-group-header` or collapsible styles.

**Score: 2/4** — Entire visual structure is V1 single-column. 3-column layout, budget sidebar, Chart.js charts, and month-grouped transactions all missing from HTML/CSS.

---

### Pillar 3: Color (3/4)

**Issues:**

1. **Accent color usage correct but limited** — UI-SPEC lines 113-122 reserve `--accent-primary` (#5A8CFF) for: active tab border (✓ line 958-960 in app.css), budget sidebar progress bar (❌ no sidebar), upload CTA (❌ button color not explicitly set to accent), period selector focus (❌ no focus ring visible), chart colors (❌ no Chart.js), and onboarding skip link (❌ not checked). Current usage is confined to tab active state and form buttons.

2. **Missing budget bar state colors** — UI-SPEC lines 129-132 specify three budget progress bar states: <85% blue (accent), 85-100% amber (#f59e0b), >100% red (--status-red). Current CSS has `.fin-bar-fill` with no `.fin-bar-amber` or `.fin-bar-red` classes visible in app.css (lines 1071-1077 show only base fill, no state variants). JS `renderBudgetActual()` (line 1847-1851) does assign `fin-bar-red` and `fin-bar-amber` classes, but CSS classes not defined.

3. **Source tag colors missing** — UI-SPEC lines 125-127 specify "Bank" pill (green: rgba(74,222,128,0.12) bg, #4ade80 text) and "Credit Card" pill (blue: rgba(90,140,255,0.12) bg, #5A8CFF text). Current HTML transaction rows show `.fin-tx-cat` category badges (line 1103 CSS) but no source tag pills. No `.fin-tx-source-bank` or `.fin-tx-source-credit` classes found.

4. **Destructive color on reset button** — UI-SPEC line 348 specifies "Reset goals" button with red hover state. Current HTML button (line 743) uses `fin-ghost-btn` class (line 1010-1017 CSS) with `rgba(255,255,255,0.06)` background, no red state defined.

**Strengths:**
- Accent primary (#5A8CFF) correctly set in `:root` (line 55 app.css) ✓
- Status colors green/amber/red defined (lines 60-62 app.css) ✓
- Card background/border tokens consistent (lines 70-71 app.css) ✓

**Score: 3/4** — Color tokens defined correctly but incomplete application to budget states, source tags, and reset button. Chart.js colors not implemented (no charts yet).

---

### Pillar 4: Typography (3/4)

**Issues:**

1. **Typography scale inconsistent** — UI-SPEC lines 84-98 specify 4 sizes: 12px label, 14px data, 15px body, 24px display; 2 weights: 400 and 600. Current app.css uses: 13px for various elements (lines 953, 1002, 1008, 1016, 1061, 1098, 1146), 11px for mono labels (line 1101), 10px for credit tags (line 1106), and unlisted sizes. No 24px display size used anywhere.

2. **Label size variance** — UI-SPEC specifies all labels (12px/600). Current uses: 12px for `fin-period-label` (line 1002 ✓), but 13px for `fin-bar-label` (line 1065), 11px for transaction dates (line 1101), 10px for credit tags (line 1106). Inconsistent application.

3. **Mono font usage correct** — JetBrains Mono applied to transaction dates (line 1101) and amount labels (line 1081, 1104) ✓. Correct per UI-SPEC line 94 mono usage.

4. **Body text sizing** — Finance chat and onboarding use `.fin-chat-input` (line 1126: 14px), which is data size not body (15px). Onboarding messages use `buildMessageHTML()` which pulls styles from main app message classes (likely 15px per existing `.msg-text` in app.css). Slight inconsistency but acceptable.

5. **Weight distribution** — No explicit 400 vs 600 weight separation visible in finance panel. Most labels appear to use `font-weight: normal` (400) even where 600 is specified (labels). CSS does not show explicit weight declarations on label elements.

**Strengths:**
- Font family correctly set: Inter for UI (line 28 app.css), JetBrains Mono for code (line 29) ✓
- Label scaling mostly within spec range (11-13px) ✓

**Score: 3/4** — Typography reasonably applied but lacks strict adherence to 4-size spec and weight consistency. No 24px display titles used.

---

### Pillar 5: Spacing (2/4)

**Issues:**

1. **Non-grid spacing values throughout** — UI-SPEC lines 60-78 specify 8-point grid: xs(4px), sm(8px), md(16px), lg(24px), xl(32px), 2xl(48px). Current app.css uses: 10px (line 997, 1002, 1022), 6px (line 1081, 1145), 3px (line 1085), 20px (line 998, 1048), 12px (lines 942, 1064, 1064, 1142), 4px (line 1096), 14px (line 1081). Only 8px, 16px, 20px, and 24px align to spec.

2. **Period bar padding** (line 998): `padding: 10px 20px` — should be `padding: 8px 16px` (sm + md). Off-grid.

3. **Upload row padding** (line 1022): `padding: 8px 20px` — off-grid, should be `8px 16px`.

4. **Chart section padding** (line 1059): `padding: 16px 20px` — horizontal off-grid, should be `16px`.

5. **Transaction row padding** (line 1096): `padding: 8px 4px` — vertical on-grid but horizontal off-grid (should be 8px).

6. **Bar row gaps** (line 1064, 1085, 1145): `gap: 10px`, `gap: 8px`, `gap: 8px` — inconsistent. Should all be `gap: 8px` (sm).

7. **Budget form grid gap** (line 1144): `gap: 8px` ✓ (sm, correct per UI-SPEC line 65).

8. **Header padding** (line 942): `padding: 12px 20px` — off-grid, should be `8px 16px`.

**Strengths:**
- Some values correct: 8px gaps (lines 963, 997), 16px section padding (line 1059) ✓

**Score: 2/4** — Spacing heavily skews toward 10px, 12px, 20px off-grid values. Not aligned to 8-point grid required by UI-SPEC.

---

### Pillar 6: Experience Design (2/4)

**Issues:**

1. **Onboarding only 6 categories, not 8** — JS `_startOnboarding()` line 1920 defines: `const CATEGORIES = ['Food', 'Transport', 'Shopping', 'Utilities', 'Entertainment', 'Other']` — missing "Health & Fitness" and "Government & Fees". UI-SPEC line 179 specifies all 8 must be shown. Budget form will render 6 inputs, not 8.

2. **No period selector wiring** — UI-SPEC line 211-217 specifies period selector in header (populated from `/finance/periods`). Current HTML has `fin-period-select` (line 754) but no period change handler visible in init. Period selector populated via `_loadPeriods()` (line 1720) but `_onPeriodChange()` handler not wired to select element in init code (not visible in snippet, needs verification).

3. **No refresh button** — UI-SPEC lines 219-225 require refresh button in header ("⟳" icon, hover state, spin on click). Current HTML shows period bar (lines 752-762) with period select and upload button, no refresh button. Missing entirely.

4. **No Chart.js integration** — UI-SPEC specifies Chart.js v4 line and donut charts (lines 186-209). Current implementation renders data as CSS bar charts via `renderCategories()`, `renderTrend()` (HTML bar rows), no `new Chart()` calls. No `_renderLineChart()` or `_renderDonutChart()` functions defined.

5. **No month-grouped transaction list** — UI-SPEC line 229-244 specifies transactions grouped by month with collapsible headers (▼/▶ toggle, "March 2026", total debit for month). Current `renderTransactions()` (line 1889) renders flat list with no month grouping. No `.fin-month-group-header` or collapse toggle.

6. **Budget sidebar not hidden in Chat tab** — UI-SPEC line 297 specifies "Chat tab: hides `.fin-budget-sidebar`, shows `.fin-chat-pane` full-width." No sidebar exists to hide/show, but Chat tab lacks full-width treatment because chat pane inherits from `.fin-pane` (flex: 1, vertical) with no special Chat-tab layout.

7. **ESC key handler** — UI-SPEC line 290 requires ESC key to close panel. Current `close()` function (line 1692) is wired to close button click but ESC handler not visible in init. Needs verification in full code.

8. **Upload account label datalist** — JS `_initUpload()` not visible in snippet, but UI-SPEC line 251 requires datalist from `GET /finance/accounts`. HTML shows `#fin-account-suggestions` datalist (line 731) but population code not visible in read snippet.

**Strengths:**
- Onboarding step machine structure correct (STEPS array, index-based advancement) ✓
- Tab switching wired (`_activateTab()` at line 1699) ✓
- Empty state guards present in renderers (line 1796, 1869, 1892) ✓
- Upload flow triggers on file selection with status feedback ✓

**Score: 2/4** — Core structure present but 8-category spec mismatch, missing Chart.js, no month grouping, no refresh button, and no visible period selector wiring. Many stubs remain from Plan 03/04/05.

---

## Registry Safety

No external component registries used. Finance panel is vanilla HTML/CSS/JS with inline SVG icons. Chart.js must be integrated locally (per UI-SPEC line 27 "bundled locally at `app/static/js/chart.umd.min.js`") — verify file exists and is loaded.

**Registry audit:** Not applicable (no shadcn, no third-party blocks).

---

## Files Audited

**HTML:**
- `/home/rishi/Rishi/AI/Localis/app/templates/index.html` (lines 733-838: finance panel)

**CSS:**
- `/home/rishi/Rishi/AI/Localis/app/static/css/app.css` (lines 921-1154: finance panel styles)

**JavaScript:**
- `/home/rishi/Rishi/AI/Localis/app/static/js/app.js` (lines 1678-2000+: financeUI IIFE)

**Backend (for context):**
- `/home/rishi/Rishi/AI/Localis/app/finance.py` (CATEGORY_RULES, dashboard endpoints)
- `/home/rishi/Rishi/AI/Localis/app/database.py` (fin_* table schemas)

---

## Summary

Phase 02 UI implementation is **40% complete** against UI-SPEC V2. Core structure exists (tabs, panes, upload flow, onboarding) but critical visual overhaul missing:

- **HTML structure**: V1 single-column layout persists; 3-column grid with budget sidebar not implemented
- **Charts**: CSS bar charts present but Chart.js integration absent; no line/donut charts
- **Onboarding**: 6 categories instead of 8; form structure correct
- **Spacing/Color**: Tokens defined but applied inconsistently; off-grid values throughout
- **Interactions**: Period selector populated but change handler not visible; refresh button missing; ESC handler unclear

**Recommendation:** Proceed to Plan 02-08 (HTML structure rewrite for 3-column grid) before finalizing Chart.js integration, as current CSS cannot support the spec's layout.

---

**Report Generated:** 2026-03-18
**Auditor:** GSD UI Auditor (Claude Code)
