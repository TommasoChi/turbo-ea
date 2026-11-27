# Build cost report, PML home and Reports menu

Part 3 of 3 of the initiatives improvements. Part 1: `2026-11-26-cost-controller-permissions-design.md` (ships first: this report lists only initiatives whose costs the user may see, R22 there). Part 2: `2026-11-26-initiative-pages-design.md`. Mockup: `2026-11-26-initiatives-improvements-mockups/3-build-cost.html`.

## Why

Nobody can see the cost of the whole initiative portfolio in one place: the Cost Report covers Applications and IT Components only, and the PML home (`/ppm`) carries an EA Delivery tab that is unrelated to costs. This part adds a portfolio report, **Build cost**, with the cost-control KPIs a PMO uses, and aligns the navigation.

## Goals

1. A portfolio report, **Build cost**, with KPI tiles, charts and two radar charts; each chart says which KPI it answers.
2. The Provider is the main axis: how much cost goes to which Providers.
3. Navigation matches the new structure.

## Non-goals

- Changing how budget lines, cost items, invoices and Providers are stored (no new tables, no migration).
- Earned-value figures as accounting data: estimates built from Completion (R20).
- A chart for Capex vs Opex.
- Moving the EA Delivery workspace itself (see Backlog).
- Changing the link (`/reports/cost`) or the permission of the Cost Report.

## What exists today (facts the requirements rely on)

- **PML home** (`/ppm`, `PpmHome.tsx`): tabs Portfolio and EA Delivery. EA Delivery (SoAW and decisions workspace) also lives at `/reports/ea-delivery` and, with the PPM on, as the **EA Governance** sub-tab of IT Governance (`features/grc/GovernanceTab.tsx`).
- **No endpoint returns per-initiative budget, cost and invoiced across the portfolio** (`/reports/ppm/gantt` returns capex/opex budget and cost per initiative with no fiscal-year filter and no invoices; invoiced exists only per initiative in `load_financials`).
- Reusable blocks: `FiscalYearTimeTravel`, `CardFilterSection` (+ `useCardFilterOptions`, `/reports/ppm/filter-data`), `MetricCard`, `EChart` + `useEChartsTheme` (registers Bar/Line/Pie, not Radar; the wrapper lacks `legendselectchanged`), `cost_filters.filter_conditions`, `card_ids_with_cost_access`. Budget lines carry `fiscal_year`, `category`; cost lines have a date and `provider_child_id`; the effective Provider resolves through `ppm_providers.py`.

## Requirements

### PML home and navigation

- **R11. PML tabs.** `/ppm` has two tabs: **Build cost** (first) and **Portfolio** (second). The EA Delivery tab and the `ea-delivery` tab key are removed. A link with `?tab=ea-delivery`, or with no tab, opens the first tab. Build cost is the first tab for every `ppm.view` user.
- **R12. Reports menu.** The **Cost** entry is renamed **Running costs** (label only; link `/reports/cost`, permission and saved-report key unchanged, in every locale). A new **Build cost** entry opens the same report as PML tab 1, at `/reports/build-cost`, under the PPM `ModuleGate`, in `ROUTE_PERMISSIONS`; the saved-report type allow-list (`VALID_REPORT_TYPES`) gains it.
- **R13. EA Delivery** stays where it is for IT Governance (sub-tab **EA Governance**) and at `/reports/ea-delivery`; only the PML tab goes away. `PpmHome` tests that pin `tab=ea-delivery` are updated.

### The Build cost report

Available to users with `ppm.view`. The report lists **only the initiatives whose costs the user may see** (per-card cost access, part 1), so every total is the sum of what the user can see; a user with none sees the empty state (R19), with no mention of access. Two views, switched like the Cost Report's views. The endpoint returns cards, so it uses `CardReadScope` in `module` mode.

**Fiscal year.** The year of a budget line is its `fiscal_year`; the year of a cost line or invoice is its date. An initiative counts in the chosen year when it has any line in that year (a budget line of that year, or a cost line or invoice dated in it). Undated cost lines go to an "Undated" bucket outside the year, shown in a note. In the forecast year (no cost lines yet) Cost shows zero and a note says so. Budget and Cost are never mixed across years in one figure. Only ACTIVE initiatives count; a parent initiative counts its own lines only, and the page says so.

- **R14. Toolbar.** First row: **All Cards** (card scope of Initiatives, like the Cost Report) and **Group by** (the groupings of the per-initiative charts only; grouping by a relation such as Organization double counts an initiative linked to two: same Full / Split equally toggle as the Cost Report). Second row: **Time Travel** on the fiscal year (current FY selected, `FiscalYearTimeTravel`). Under them, **filters in the PPM style** (`CardFilterSection` for the Initiative type: its fields and relations, Provider among them, with *Include sub-cards*), applied on the server.
- **R15. KPI tiles** (each with a one-line meaning): **Initiatives** (count), **Budget allocated**, **Total cost allocated**, **Total invoiced**; and derived: **Budget used** (cost ÷ budget, %), **Remaining budget**, **Remaining to invoice**, **Initiatives over budget** (cost > budget, with the threshold shown). Cost = `actual` of the cost lines.
- **R16. View "Charts" (circles and lines).** Each chart has a subtitle naming the KPI it answers:
  - **Where does the cost go, by parent Provider** (donut) and **by Provider** (sorted bars). *Provider KPIs are the priority: how much cost goes to which Providers.* A cost with no Provider, or a Provider the user cannot read, goes to "Unspecified"; the totals still add up. An invoice uses its cost item's effective Provider.
  - **Budget vs Cost vs Invoiced per initiative** (top 10 by cost, bars with the budget as a reference line).
  - **Cost vs invoiced** (donut: invoiced and still to invoice).
  - **Cost and invoicing over the fiscal year** (lines with circle markers, cumulative by month).
- **R17. Legends.** In every chart the legend is clickable: clicking an entry hides or shows its series, and the totals and the Min/Max indicator follow the visible series.
- **R18. View "Radar"** with the two radars one above the other. Terms: *radial axes* = the spokes; *measure* = the value drawn on each spoke; *series* = the polygons being compared; *scale* = the value at the outer ring.
  - **Radar 1, where does the money go.**
    - Radial axes: a selector over the single-select fields of the **Initiative information** section; Provider and Organization (relations) are offered too, grouped by the linked card. Each value of the chosen field is a spoke.
    - Measure: a selector: **number of initiatives / Budget / Cost / Invoiced**.
    - Series: a selector over every **single-select field of budget lines and cost items**, calculated text fields included (for example Category, or a custom field); each value of the chosen field is a coloured polygon with a **selectable legend**.
    - Scale: a selector: **Total** (the total of the measure over all spokes, e.g. all initiatives when the measure is the number of initiatives) or **Subtotal** (the largest spoke).
  - **Radar 2, how it is distributed.**
    - Radial axes: the same selector as Radar 1.
    - Measure: **Cost / Invoiced** (numbers only; single-select fields of budget and cost lines are never a measure).
    - Series (fixed, legend **not** selectable, coloured): **Budget** when the measure is Cost; **Budget** and **Cost** when it is Invoiced.
    - Scale: same selector as Radar 1.
  - **Min / Max indicator** under each radar: the lowest and the highest spoke with their value and a spread figure (max ÷ min), updated by the selectors and the legend.
  - With fewer than 3 spokes a message and plain bars replace the radar, with an "Unspecified" spoke for initiatives with no value.
- **R19. States.** An empty portfolio (which also covers a user with cost access to no initiative: no message about access, as on the Application and IT Component pages) and a failed request each show a message instead of an empty chart; a spoke with no value is drawn at zero and listed.
- **R20 (portfolio). Earned value (estimated).** **CPI**, **EAC** and **Variance at completion** are shown as a second row of tiles over the whole portfolio. Each tile has an **(i)** that explains the figure and shows the formula, with a worked example:
  - **EV** (earned value) = Completion × Budget.
  - **CPI** = EV ÷ Cost. Below 1 the spending exceeds the work done; above 1 it is lower.
  - **EAC** (estimate at completion) = Budget ÷ CPI.
  - **Variance at completion** = Budget − EAC; negative means an expected overrun.
  Marked "estimate"; always on the lifetime totals ("does not follow the fiscal year"). Portfolio CPI = sum of EV ÷ sum of Cost over the initiatives that have a Completion, Cost and Budget; the others show "n/a" and their count is shown in the (i).

## The aggregate endpoint

One request returns one row per budget line, cost line and invoice (with its initiative id, the initiative field values the selectors need, the effective parent Provider, capex/opex, the line's single-select fields and its date), for the chosen fiscal year and filters, with a documented cap and paging; the radars and charts aggregate client-side from it. It uses `CardReadScope` with `mode="module"` and the cost-access filter of part 1. Fiscal-year handling as above, with the fiscal-year service.

## Delivery

Two pull requests, after part 1's PR **E**: **C** (the endpoint, Charts view, PML tab and menu: R11-R17, R19, R20 portfolio) and **D** (Radar view, R18; needs C). VAPT runs on C (a new route); OpenAPI regenerated; one version bump and changelog entry per PR.

## Agent's calls (check them)

- Build cost is visible to `ppm.view` and limited to the cards the user can see costs of (part 1).
- **Initiatives over budget** = cost > budget. **Build cost and the Cost Report differ on purpose**: the report groups items, Build cost groups per initiative.
- **Radar scale "Subtotal"** is the largest spoke. **Colours** come from the categorical chart theme (`useEChartsTheme`); the same Provider has the same colour in every chart.
- **Chart wrapper**: `EChart.tsx` registers the radar chart and component and forwards `legendselectchanged`.

## Backlog (not in this work)

- EA Delivery with GRC off and PPM on: the PML tab is gone and EA Delivery is no longer reachable from the menu in that case. **Accepted by the owner for now**; a menu entry returning for that case is a later development.

## Left to the builder

The endpoint name and response shape, the exact list of fields offered by the selectors, and component names.

## Acceptance

- Each requirement R11-R19 and R20 (portfolio) is visible on the pages named.
- Build cost's totals equal the sum of the initiatives it lists, and the Provider donut and bars sum to the total cost.
- A user without cost access never sees an amount in any chart, tile or radar.
- Every legend toggles its series; the Min/Max indicator follows.
- Tests: backend (aggregate endpoint: success, permission denial, filters, fiscal year, hidden initiatives), frontend (each new or changed component); user manual and nine locales via `/translate`; changelog and version bump.
