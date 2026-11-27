# Initiative card page, PPM page and Plan Budget

Part 2 of 3 of the initiatives improvements. Part 1: `2026-11-26-cost-controller-permissions-design.md` (ships first; the amounts below are shown only to users with cost access, R22 there). Part 3: `2026-11-26-build-cost-report-design.md`. Mockups: `2026-11-26-initiatives-improvements-mockups/1-card-page.html` and `2-ppm-page.html`.

## Why

An Initiative is read in two places: the **card page** (`/cards/<id>`) and the **PPM page** (`/ppm/<id>`, tabs Overview, Status Reports, Budget & Costs, Risk Management, Tasks, Gantt, Card Details). Today the two disagree (three different cost visuals, a Health Summary that shows only three dots), and the finance tables hide information behind fixed widths and stray text.

## Goals

1. Card page and PPM page show the same information in the same shape (shared components, not copies).
2. The finance view answers: how much was planned, how much was spent, how much was invoiced, how much is still to invoice, and who got the money (Provider).

## Non-goals

- Changing how budget lines, cost items, invoices and Providers are stored (no new tables, no migration).
- Earned-value figures as accounting data: they are estimates built from Completion (see R20).
- A chart for Capex vs Opex (Aruba books everything as Capex today); the Capex/Opex **detail** stays in the product.
- Permissions of costs and PPM: part 1.

## What exists today (facts the requirements rely on)

- **Completion is not a stored field.** It is computed from the work packages (WBS) at `GET /ppm/initiatives/{id}/completion` and shown only in the PPM Overview as `CompletionRing` (`PpmOverviewTab.tsx`). On the card page it does not appear.
- **`costBudget` ("Budget") and `costActual` ("Actual Cost") are stored `cost` fields, overwritten by the PPM roll-up** (`_rollup_costs`, `api/v1/ppm.py`) with the sums of budget lines and cost lines; the card page shows them read-only with a "calc" badge.
- **Health Summary** (card page, `PpmHealthSummary.tsx`) shows only the schedule, cost and scope dots. The status report texts (`report_date`, `summary`, `accomplishments`, `next_steps`) exist (`PpmStatusReport`) and are edited in `StatusReportDialog.tsx` (three multiline fields, no length limit), shown in the Status Reports tab.
- **Risks**: the card page "Risks" tab is the GRC risk register; **PPM risks** (`PpmRisk`: probability and impact 1-5, score, status open / mitigating / mitigated / closed / accepted) appear only in the PPM Risk tab and the project report.
- **Manage pattern**: a `Manage` button on the card page opens `PpmManageDialog` (cost, gantt or reports tab) in a popup (`manageTab` state in `CardDetailContent.tsx`).
- **Cost visuals**: the PPM Overview draws costs with `BudgetBar`; the card page uses an ECharts pair-bars chart (`PpmInitiativeFinancials`); the Cost tab has a "Spend over time" chart (`PpmCostCharts`).
- **Finance tree** (`PpmFinanceTree.tsx`): table "Planned Budget" with columns Item, Planned Budget, Cost Items, Remaining Budget, Invoiced, Remaining to invoice; per-budget collapse with a custom-field block (where "Origine Costi" / "Società Gruppo Aruba" appears), a cost-item table and an invoice table; a `drive_file_move` icon moves a cost item or an invoice; the line "Initiative total invoiced". Budget lines carry `fiscal_year`, `category` (capex / opex), `description`; cost lines have `provider_child_id` and a date; the effective Provider resolves through `ppm_providers.py`.

## Requirements

### Card page (`/cards/<id>`, Initiative)

- **R1. Budget and Actual Cost side by side.** In the Cost group the two calculated fields sit in two columns of 50% each, aligned.
- **R2. Dates and Completion.** In the Timeline group the four dates (Start Date, Actual Start, End Date, Actual End) are in the **left** column and **Completion** (the existing ring or value, same calculation as the Overview) in the **right** column.
- **R3. Health Summary.** Next to the three colours, the **report date** of the latest status report (format of the user's date setting, e.g. "23 Nov 2026"). Under them, three boxes in one row: **Summary**, **Accomplishments**, **Next Steps**, read-only, showing the latest report's text; **Manage** (existing, needs `ppm.manage` and `card.edit`) opens a new report in the editor. With no report the existing "No status reports yet" stays.
- **R4. 250-character limit.** In the status report editor each of Summary, Accomplishments and Next Steps is limited to **250 characters**, with a counter in its label (`Summary 120/250`). The limit is also validated by the backend on write, only for the fields present in a PATCH (an import is not validated). (No existing text is longer.) The same applies to the Summary of the status report wherever it is edited.
- **R5. Risk Management section** under Health Summary: a shared component `PpmRiskSummary` showing the PPM risks of the initiative with these charts, each titled with the question it answers:
  - **Exposure** (donut): number of open risks by band (high ≥ 15, medium ≥ 6, low, from `scoreBand`), with the total in the centre.
  - **Status** (horizontal bars): risks per status (open, mitigating, mitigated, closed, accepted).
  - **Heat map** (the 5x5 probability × impact matrix, `PpmRiskMatrix`, compact).
  - Count tiles Total / Open / **High open** (existing `riskSummary`; "High" counts only open risks so it matches the donut).
  A **Manage** button (needs `ppm.manage` and `card.edit`) opens the **Risk Management** tab in a popup (`PpmManageDialog` gains a `risks` tab rendering `PpmRiskTab`). Clicking a legend entry hides or shows that series (R17).
- **R6. Cost group visual.** The card page's financial summary uses the same visual as the PPM Overview (`BudgetBar` look: total budget vs total cost, with the same colours), replacing the ECharts pair-bars chart.

### PPM page (`/ppm/<id>`)

- **R7. Overview layout.** In this order, full width each: **Description** (top, hidden when empty), **Timeline** with **Completion to the right of the dates**, **Health Summary** (the same component as the card page, R3/R4), **Risk Management** (R5), then the Financials block as today. The back arrow goes to `/ppm?tab=portfolio`.
- **R8. Budget & Costs tab: totals strip.**
  - "Total Actual" is renamed **Total Cost** (also on the Overview and the card page). Cost = `actual` of the cost lines everywhere.
  - **Variance** = Total Cost − Total Budget, with a **percentage** (variance ÷ budget). Colour: **green** when cost is below budget, **amber** when above, the current colour when equal. The percentage has the same colour.
  - New tiles: **Total Invoiced** and **Remaining to Invoice**, each with a percentage (of Total Cost). Shown only to users with cost access (there is no separate invoice permission).
  - **Capex / Opex detail**: clicking **Total Budget** opens a small popup with Budget, Cost, Variance and the percentages split by Capex and Opex.
  - **Earned value (estimated)**: **CPI**, **EAC** and **Variance at completion** with an **(i)** (R20).
- **R9. Charts of the tab.** "Spend over time" is **not shown** (its code and `buildCumulativeOption` stay in the repository, unmounted, to be reused; no feature flag). In its place three charts, each titled with its question:
  1. **Cost by parent Provider** (donut, at most 6 slices plus "Other", the total in the centre).
  2. **Cost by Provider** (horizontal bars, sorted, same colours as chart 1 by parent).
  3. **Cost vs invoiced** (a bar with the budget as a reference line; two bars, Cost and Invoiced; and which Providers invoiced, as the legend entries). An invoice has no Provider of its own: it uses its cost item's effective Provider.
  Legends are clickable (R17). A cost with no Provider goes to "Unspecified"; the totals still add up. Colours come from the categorical chart theme (`useEChartsTheme`), never raw hex; the same Provider has the same colour in every chart.
- **R10. Plan Budget table** (the finance tree's "Planned Budget" table; keep the label).
  - **Description, FY, Category (CAPEX/OPEX) and Provider** (the effective parent Provider of the budget line) become columns of the table, replacing the text line above it.
  - Remove the **Provider field** (the custom-field block heading **"Origine Costi"** and its value, **"Società Gruppo Aruba"**) from the Cost tab, since the Provider is now a column; other custom fields of the block stay. If "Società Gruppo Aruba" is not the Provider, say so.
  - Remove the move icon (`drive_file_move`) from cost items and invoices (the "move" action leaves the UI; the endpoints stay).
  - Remove the line **"Initiative total invoiced"**.
  - The tables scroll horizontally with a scroll bar and keep their natural column widths (no squeezing, no ellipsis on numbers and dates).
- **R17. Legends.** In every chart the legend is clickable: clicking an entry hides or shows its series, and the totals follow the visible series. (Same rule as part 3.)
- **R20 (per initiative). Earned value (estimated).** **CPI**, **EAC** and **Variance at completion** are shown in the totals strip of the Budget & Costs tab (R8). Each tile has an **(i)** that explains the figure and shows the formula, with a worked example:
  - **EV** (earned value) = Completion × Budget.
  - **CPI** = EV ÷ Cost. Below 1 the spending exceeds the work done; above 1 it is lower.
  - **EAC** (estimate at completion) = Budget ÷ CPI.
  - **Variance at completion** = Budget − EAC; negative means an expected overrun.
  Marked "estimate": Completion is not an accounting value. With no Completion, no cost or no budget the tile shows "n/a" (never a division by zero). It always uses the lifetime totals of the initiative (the same totals as the strip; a parent derives them from its children) and says "does not follow the fiscal year".

## Delivery

Two pull requests, after part 1's PR **E**: **A** (R1-R7, R10, the 250-character limit, backend validation) and **B** (R8, R9, R20; amounts hidden without cost access, which comes from E). A and E touch the same Manage buttons: whichever merges second updates the other's. OpenAPI regenerated for R4; one version bump and changelog entry per PR.

## Agent's calls (check them)

- **"Origine Costi" / "Società Gruppo Aruba"** is read as a custom financial field shown above the Cost tab's table; "Description · FY 2026 · OPEX · Società Gruppo Aruba" are the budget line's own description, fiscal year, category and Provider, now columns.
- **Variance** = cost − budget; green below, amber above, neutral when equal; the percentage is of the budget. **Percentages of invoicing** are relative to Total Cost.
- **The Overview visual is `BudgetBar`**; the card page adopts it.
- **Where Completion comes from**: the existing completion endpoint; on the card page it is fetched like the schedule.
- **Chart wrapper**: `EChart.tsx` forwards `legendselectchanged` (also needed by part 3). `frontend/e2e/pml-financials.spec.ts` is updated for the changed finance tree.
- **VAPT**: this part adds no route or table, so it is not required for it.

## Left to the builder

Component names (`PpmRiskSummary` is a suggestion), the exact column order of the Planned Budget table.

## Acceptance

- Each requirement R1-R10 and R20 (per initiative) is visible on the pages named; the Overview and the card page show the same Health Summary and Risk Management.
- The Budget & Costs numbers equal the finance tree's totals; the Provider donut and bars sum to the total cost.
- Every legend toggles its series.
- The 250-character limit holds on both sides.
- Tests: frontend (each new or changed component), backend (the 250-character validation, the PATCH rule); user manual and nine locales via `/translate`; changelog and version bump.
