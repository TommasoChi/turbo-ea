# Initiative card page, PPM page and Plan Budget

Part 2 of 3 of the initiatives improvements. Part 1: `2026-11-26-cost-controller-permissions-design.md` (ships first; the amounts below are shown only to users with cost access, R22 there). Part 3: `2026-11-26-build-cost-report-design.md`. Mockups: `2026-11-26-initiatives-improvements-mockups/1-card-page.html` and `2-ppm-page.html`.

**Updated 2026-11-27, after PR E (part 1) was built** (PR TommasoChi/turbo-ea#94, code at HEAD 814349020). "What exists today", R1-R7, R10, the delivery note and "Agent's calls" were rewritten against that code; the requirements of PR B (R8, R9, R17, R20) were **not** re-verified in this pass and keep their original text.

## Why

An Initiative is read in two places: the **card page** (`/cards/<id>`) and the **PPM page** (`/ppm/<id>`, tabs Overview, Status Reports, Budget & Costs, Risk Management, Tasks, Gantt, Card Details). Today the two disagree (three different cost visuals, a Health Summary that shows only three dots), and the finance tables hide information behind fixed widths and stray text.

## Goals

1. Card page and PPM page show the same information in the same shape (shared components, not copies).
2. The finance view answers: how much was planned, how much was spent, how much was invoiced, how much is still to invoice, and who got the money (Provider).

## Non-goals

- Changing how budget lines, cost items, invoices and Providers are stored (no new tables, no migration; an API payload may gain a field, see R4 and R10).
- Earned-value figures as accounting data: they are estimates built from Completion (see R20).
- A chart for Capex vs Opex (Aruba books everything as Capex today); the Capex/Opex **detail** stays in the product.
- Permissions of costs and PPM: part 1 (built, E).

## What exists today (verified against the code of E, 2026-11-27)

- **Completion is not a stored field.** It is computed from the work packages (WBS) at `GET /ppm/initiatives/{id}/completion` (`ppm.py`, answer `{completion, wbs_count}`) and shown only in the PPM Overview as `CompletionRing` (`ppmVisuals.tsx`, called from `PpmOverviewTab.tsx`). On the card page it does not appear.
- **`costBudget` ("Budget") and `costActual` ("Actual Cost") are stored `cost` fields, overwritten by the PPM roll-up** (`_rollup_costs`, `api/v1/ppm.py`) with the sums of budget lines and cost lines; the card page shows them read-only with a "calc" badge (`AttributeSection.tsx`). **Since E**, a user without cost view sees a lock placeholder in their place (`cardDetailUtils.tsx`), not nothing.
- **Health Summary** (card page, `PpmHealthSummary.tsx`) shows only the schedule, cost and scope dots, from a reduced report type. **Since E** the backend omits `cost_health` for a user without cost view (`ppm.py` reports give `null`, `/schedule` omits it), so the Cost dot is absent for them, not grey. The status report texts (`report_date`, `summary`, `accomplishments`, `next_steps`) exist (`PpmStatusReport`) and are edited in `StatusReportDialog.tsx` (three multiline fields, no length limit; `PpmStatusReportCreate/Update` in `schemas/ppm.py` have no `max_length`; the columns are `Text`). The dialog always sends all three texts, also in a PATCH. It is the only user write path of a status report (POST and PATCH in `ppm.py`; no MCP tool, no extension path); the workspace importer writes the rows without Pydantic.
- **Risks**: the card page "Risks" tab is the GRC risk register; **PPM risks** (`PpmRisk`: probability and impact 1-5, score, status open / mitigating / mitigated / closed / accepted) appear only in the PPM Risk tab and the project report. `riskSummary` (`ppmRiskModel.ts`) counts **High in every status**, not only open ones; `PpmRiskTab` and the printable report use it. `PpmRiskMatrix` takes only `{risks}` (no size prop).
- **Manage pattern (built by E)**: a `Manage` button on the card page opens `PpmManageDialog` (props `card, tab, onClose, onChanged`; tabs `cost`, `gantt`, `reports`) in a popup (`manageTab` state in `CardDetailContent.tsx`). Gate: cost needs `ppm.manage` and `can_edit_costs`; gantt and reports need `ppm.manage` and `can_edit`, all from `/cards/{id}/my-permissions`; the dialog mounts only when the gate holds.
- **Permission defaults (built by E)**: `defaultPermissions.ts` has `DEFAULT_CARD_PERMISSIONS` (card page and side panel: `can_edit` true, cost view and edit false until `/my-permissions` answers; the server enforces anyway) and `CLOSED_CARD_PERMISSIONS` (everything false; the PPM page starts from it).
- **Cost visuals**: the PPM Overview draws costs with `BudgetBar` (`ppmVisuals.tsx`; the Overview already hides the Financials block without cost view); the card page uses an ECharts pair-bars chart (`PpmInitiativeFinancials`, only with `can_view_costs`; it also has an "Initiative total invoiced" line); the Cost tab has a "Spend over time" chart (`PpmCostCharts`). `card_comparison.budget` and `.actual` each carry `{ capex, opex, total, derived }` (amounts are strings, `derived` is a boolean), enough to feed `BudgetBar` on the card page.
- **Finance tree** (`PpmFinanceTree.tsx`, also used by the printable report with `expandAll`/`readOnly`): table "Planned Budget" with columns Item, Planned Budget, Cost Items, Remaining Budget, Invoiced, Remaining to invoice (`tableLayout: "fixed"`, `minWidth: 900`); the row label is the budget line description (FY, category and id when it is empty); FY and category show as a caption only when there is a description, the Provider as another caption. Per-budget collapse with a custom-field block (`field_definitions.budget.visible_columns`), a cost-item table and an invoice table. **"Origine Costi" is the Provider**: it is the card-reference field named by `provider_source.budget_field_key` (`ppm_providers.py`, `docs/admin/settings.md`), and "Società Gruppo Aruba" is the name of the Provider card; `provider_source` is **not** in the `field_definitions` payload the frontend reads. A `drive_file_move` icon moves a cost item or an invoice; **for a cost item in the "Unassigned" section the same icon is "Assign to budget"** (`financeTree.assignCost`), and the `move` mode of `PpmFinancialRowForm` is the only budget picker. The line "Initiative total invoiced" is drawn twice (`PpmFinanceTree.tsx` and `PpmInitiativeFinancials.tsx`). The budget line's effective Provider already comes back as `budget.provider` (id, name, status; visible only to a reader of the Provider card) from `project_providers`.
- **Layout today**: the card page field grid is `180px 1fr`, one field per row; the Timeline block is drawn under its group (`renderAfterFields`, anchored on the last visible date field); the Overview is a two-column grid in the order Health, Completion, Financials, Timeline, Description; the back arrow does `navigate("/ppm")` (`portfolio` is the default tab of `PpmHome`).
- The card page content (`CardDetailContent`) is mounted by the card page, the inventory side panel and the PPM page's Card Details tab.

## Requirements

### Card page (`/cards/<id>`, Initiative)

- **Order on the card page** (follows mockup 1): the Timeline block (the four dates, Completion and, under them, the existing `PpmInitiativeTimeline` bar, which stays), the Cost group, then **Health Summary**, then **Risk Management**. In the seed the cost fields come before the dates, so `initiativeSummaryGroups` also moves the date fields first; Health Summary and Risk Management are drawn by `CardDetailContent` right after the `Cost & Timeline` section, as siblings of its `AttributeSection`. Health Summary leaves the Timeline block (`renderAfterFields`) and becomes a section of its own.
- **R1. Budget and Actual Cost side by side.** In the Cost group the two calculated fields sit in two columns of 50% each, aligned. A user without cost view sees the lock placeholder in each column.
- **R2. Dates and Completion.** In the Timeline group the four dates (Start Date, Actual Start, End Date, Actual End) are in the **left** column and **Completion** (the existing ring or value, same calculation as the Overview, fetched like the schedule) in the **right** column.
- **R3. Health Summary.** `PpmHealthSummary` receives the **latest full status report** (from `GET /ppm/initiatives/{id}/reports`; on the card page this, the risks of R5 and Completion of R2 are three fetches that follow `scheduleRevision`; the `reports` tab of `PpmManageDialog` stays unused on the card page). Next to the three colours (the Cost colour only for a user with cost view: without it the colour is absent, as today) the **report date** of that report (format of the user's date setting, e.g. "23 Nov 2026"). Under them, three boxes in one row: **Summary**, **Accomplishments**, **Next Steps**, read-only, showing the latest report's text. **Manage** is shown with `ppm.manage` and `can_edit` (both from `/my-permissions`; closed until it answers) and opens the **status report editor** (`StatusReportDialog`) directly in create mode, not the Manage popup. With no report the existing "No status reports yet" stays.
- **R4. 250-character limit.** In the status report editor each of Summary, Accomplishments and Next Steps is limited to **250 characters**, with a counter in its label (`Summary 120/250`). Backend: `max_length=250` on those fields of `PpmStatusReportCreate` and `PpmStatusReportUpdate`; a field absent from a PATCH is not validated; the workspace import is exempt (it writes rows without Pydantic) and there is no other write path. The editor **sends only the fields the user changed** in a PATCH, so a historical report longer than 250 characters still saves when only its date changes. Whether an existing text is longer than 250 characters the code cannot tell (the demo seed stops at 143): **count them on the target database before A is merged**. OpenAPI is regenerated (the status report schemas change; R10's payload key does not, `field_definitions` is a free dict). UI: the field does not block typing; over 250 the counter takes the error colour, the field shows an error and **Save is disabled only when a field the user changed exceeds 250** (an untouched long historical text never blocks a save). The same limit applies to the Summary wherever a status report is edited.
- **R5. Risk Management section** under Health Summary: a shared component `PpmRiskSummary` showing the PPM risks of the initiative with these charts, each titled with the question it answers:
  - **Exposure** (donut): number of **active** risks (status open or mitigating) by band (high ≥ 15, medium ≥ 6, low, from `scoreBand`), with the total in the centre.
  - **Status** (horizontal bars): risks per status (open, mitigating, mitigated, closed, accepted).
  - **Heat map** (the 5x5 probability × impact matrix, `PpmRiskMatrix`, compact: it gets a size prop), drawing the same active risks as the donut.
  - Count tiles Total / Open / **High open**, computed by the component: Open and High open count the **active** risks (open and mitigating), so the tiles, the donut and the heat map agree (mockup: 9); Status shows every status. The existing `riskSummary`, which counts High in every status and is used by `PpmRiskTab` and the printable report, is **not** changed.
  A **Manage** button (`ppm.manage` and `can_edit`) opens the **Risk Management** tab in a popup: `PpmManageDialog` gains a `risks` tab (the `manageTab` type, the dialog's `tab` prop and its title gain `risks`) rendering `PpmRiskTab`, which needs `risks`, `onRefresh`, `canEdit`, `initiativeId` and `initiativeName`, so the dialog fetches the risks. Clicking a legend entry hides or shows that series (R17); the donut's centre total follows the visible series, and because `EChart` calls `setOption(..., { notMerge: true })` the option the component builds carries `legend.selected`, so a redraw does not reset the click. Tests of `PpmRiskSummary` mock `EChart` (jsdom has no ECharts).
- **R6. Cost group visual.** Shown only to a user with `can_view_costs`; without it the two fields keep the lock and no visual is drawn. The card page's financial summary uses the same visual as the PPM Overview (`BudgetBar` look: one **Total** bar, total budget vs total cost, with the Overview's colours), fed by `card_comparison` (`derived`), replacing the ECharts pair-bars chart (`PpmInitiativeFinancials`, with its "Initiative total invoiced" line). The rename "Total Actual" to "Total Cost" is R8 (PR B): A keeps the current labels.

### PPM page (`/ppm/<id>`)

- **R7. Overview layout.** In this order, full width each: **Description** (top, hidden when empty), **Timeline** with **Completion to the right of the dates**, **Health Summary** (the same component as the card page, R3/R4; its Manage needs new `canEdit` and `onRefresh` props on the Overview, with the PPM page's gate; after a save `PpmProjectDetail` reloads its data), **Risk Management** (R5), then the Financials block as today (hidden without cost view, as today). The back arrow goes to `/ppm?tab=portfolio` (the same place as today, now explicit). Health Summary and Risk Management are drawn by the full card page and the PPM Overview **only**: not by the inventory side panel and not by the PPM page's Card Details tab (both mount `CardDetailContent`), so the PPM page never shows them twice. A new prop of `CardDetailContent` (name left to the builder, `showPpmSummary` is a suggestion) switches the two sections on; only the full card page sets it.
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
- **R10. Plan Budget table** (the finance tree's "Planned Budget" table; keep the label; the printable report uses the same component and changes with it).
  - The **Item** column keeps today's label (the budget line description, or FY · category · id when it is empty); **FY, Category (CAPEX/OPEX) and Provider** (the budget line's effective parent Provider, already returned as `budget.provider`; empty for a reader who cannot see the Provider card) become columns of the table, replacing the caption lines above it. There is no separate Description column (the mockup's second column is the Item label).
  - Remove the **Provider field** from the custom-field block of the Cost tab: that is the field named by `provider_source.budget_field_key` ("Origine Costi", whose value is the Provider card, "Società Gruppo Aruba"). To let the tree skip it, the budget `field_definitions` payload gains the key of that field (a payload change, no migration; the key comes from the `cost_item` section's `provider_source` and is omitted when it is empty); the other fields of the block stay, and the Provider field stays in the budget line form (the only way to set it).
  - Remove the move icon (`drive_file_move`) from cost items and invoices. **Keep "Assign to budget" on the cost items of the "Unassigned" section** (today the same icon): it is the only way to attach a legacy cost to a budget line, so the `move` mode of `PpmFinancialRowForm` stays for that action only; the move endpoints stay.
  - Remove the line **"Initiative total invoiced"** (in `PpmFinanceTree` and, with R6, in `PpmInitiativeFinancials`).
  - The tables scroll horizontally with a scroll bar and keep their natural column widths (no `tableLayout: "fixed"`, no squeezing, no ellipsis on numbers and dates). In print (`expandAll`) the table has no scroll container: it takes the page width and its columns wrap.
- **R17. Legends.** In every chart the legend is clickable: clicking an entry hides or shows its series, and the totals follow the visible series. (Same rule as part 3.)
- **R20 (per initiative). Earned value (estimated).** **CPI**, **EAC** and **Variance at completion** are shown in the totals strip of the Budget & Costs tab (R8). Each tile has an **(i)** that explains the figure and shows the formula, with a worked example:
  - **EV** (earned value) = Completion × Budget.
  - **CPI** = EV ÷ Cost. Below 1 the spending exceeds the work done; above 1 it is lower.
  - **EAC** (estimate at completion) = Budget ÷ CPI.
  - **Variance at completion** = Budget − EAC; negative means an expected overrun.
  Marked "estimate": Completion is not an accounting value. With no Completion, no cost or no budget the tile shows "n/a" (never a division by zero). It always uses the lifetime totals of the initiative (the same totals as the strip; a parent derives them from its children) and says "does not follow the fiscal year".

## Delivery

Two pull requests, after part 1's PR **E** (built, open as #94; A branches from `main` after it merges): **A** (R1-R7, R10, the 250-character limit, backend validation, the payload field of R10) and **B** (R8, R9, R20; amounts hidden without cost access, which comes from E). E already built the gates of the Manage buttons and the closed permission defaults; A builds on them and does not redo them. OpenAPI regenerated for R4 (R10's payload key sits inside a free dict); one version bump and changelog entry per PR.

## Agent's calls (check them)

- **"Origine Costi" / "Società Gruppo Aruba"** is the Provider: a card-reference custom field (`provider_source.budget_field_key`) whose value is the Provider card. The Provider becomes a column; the tree skips that field, which needs the field's key in the `field_definitions` payload.
- **Variance** = cost − budget; green below, amber above, neutral when equal; the percentage is of the budget. **Percentages of invoicing** are relative to Total Cost.
- **The Overview visual is `BudgetBar`**; the card page adopts it as a single Total bar with the Overview's colours (the mockup's grey and blue are an illustration). Capex/Opex stay in B's popup. Mockup 1 draws Completion as a ring and mockup 2 as a number: the ring is used on both pages (R2).
- **Where Completion comes from**: the existing completion endpoint; on the card page it is fetched like the schedule.
- **Manage in the Health Summary opens `StatusReportDialog` directly** (R3 says "opens a new report in the editor"); the Manage of the Risk Management section opens the popup with the new `risks` tab. On the PPM Overview they need a new `canEdit` prop with the PPM page's gate.
- **The status report editor sends only changed fields in a PATCH** and the limit is on write only for present fields, so old long reports stay editable; the import is exempt.
- **High open** is a new count in `PpmRiskSummary`; `riskSummary` (High in every status) is left alone, so the PPM Risk tab and the printable report keep their numbers.
- **Health Summary and Risk Management are not drawn in the inventory side panel or in the PPM page's Card Details tab**, so the PPM page shows them once.
- **"Assign to budget" stays for unassigned cost items**; only the move action for assigned ones and for invoices leaves the UI.
- **The section keeps the name "Risk Management"** (as the PPM tab it manages) even though the card page also has the GRC "Risks" tab.
- **Chart wrapper**: `EChart.tsx` (`components/charts/`) forwards `legendselectchanged` (A needs it for R5, B for R9; whichever lands first adds it). `frontend/e2e/pml-financials.spec.ts` is updated for the changed finance tree: its move-an-invoice scenario (`moveInvoice`) is redone through the API.
- **Owner's decisions, 2026-11-27**: "open" risks in R5 mean **active** (open and mitigating), as in the mockup; the Plan Budget keeps one **Item** column with today's label and gets no Description column.
- **Order on the card page** follows mockup 1 (Timeline block, Cost group, Health Summary, Risk Management); the `PpmInitiativeTimeline` bar stays in the Timeline block even though the mockup does not draw it.
- **Manage is hidden, not disabled**, for a user without the right (E's behaviour); the mockup's "disabled" is an illustration.
- **`PpmRiskSummary` data on the card page**: risks, completion and the latest report are three fetches that follow `scheduleRevision`.
- **The status report editor** blocks Save only when a field the user changed exceeds 250 characters; it shows an error and never blocks typing.
- **In print** the Plan Budget table has no scroll container and its columns wrap.
- **Printing, OpenAPI and labels**: R10's payload key does not change OpenAPI (`field_definitions` is a free dict); A keeps today's "Total Actual" labels, the rename is B.
- **The count of status reports longer than 250 characters** on the target database is a manual step of the owner (an agent does not touch that database).
- **VAPT**: this part adds no route or table (a status report validation and a payload field), so it is not required for it.

## Left to the builder

Component names (`PpmRiskSummary` is a suggestion), the exact column order of the Planned Budget table, the name of the payload key of R10, the size prop of `PpmRiskMatrix`.

## Acceptance

- Each requirement R1-R10 and R20 (per initiative) is visible on the pages named; the Overview and the card page show the same Health Summary and Risk Management, and the PPM page shows them once.
- A user without cost view sees no cost visual and no Cost colour on either page, and the lock placeholder in the two fields.
- The Budget & Costs numbers equal the finance tree's totals; the Provider donut and bars sum to the total cost.
- Every legend toggles its series.
- The 250-character limit holds on both sides; a historical report longer than 250 characters can still change its date; the owner ran the length count on the target database.
- A cost item without a budget line can still be assigned to one.
- Tests: frontend (each new or changed component: `PpmHealthSummary` has none today; `PpmRiskSummary`, `PpmManageDialog` risks tab, `StatusReportDialog` counter and changed-fields PATCH, `PpmFinanceTree` columns and removed icon, `PpmOverviewTab`, `CardDetailContent`, `PpmRiskMatrix` size, `PpmInitiativeFinancials` removed or rewritten), backend (the 250-character validation on Create and Update, the PATCH rule, the payload field), `frontend/e2e/pml-financials.spec.ts`; user manual (`docs/guide/ppm.md`, `docs/guide/card-details.md`) and its screenshots (`41_ppm_overview`, `43_ppm_budget_costs`, `44_ppm_risk_management`, plus a new entry for the Initiative card page, which has none today) in the nine locales via `/translate`; changelog and version bump.
