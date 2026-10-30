# Cost report: more card types, a combined view, a history chart on Forecast, full-screen and a Sankey that behaves like the treemap

**Spec status:** draft, on `fix/cost-report` (continues `2026-10-29-cost-report-fiscal-year-picker-design.md`, which is approved and built on this branch; where the two disagree, this one wins). Decisions below are the user's answers of 2026-10-30.

## Goal

Five improvements to `/reports/cost`:

1. **Initiatives** can be reported on, like Application and IT Component.
2. A **combined "Application + IT Component"** choice in the Card type selector shows both types in one treemap/table.
3. The **history chart** (bars per fiscal year) appears **only while the Forecast year is selected** and shows every cost field that concurs to the total cost.
4. **Full screen** fills the whole screen for the treemap and the Sankey.
5. The **Sankey page behaves like the treemap page**: same combo boxes and filters, only the diagram changes.

## Current behaviour

- The Card type selector (`COST_REPORT_TYPE_KEYS` in `frontend/src/features/reports/CostReport.tsx`) offers `Application` and `ITComponent`. `Initiative` has two cost fields in the seed, `costBudget` and `costActual`, and no total formula.
- `GET /reports/cost-treemap?type=<one type>` returns the cards of one type. `GET /reports/cost-sankey` is fixed to Application → IT Component through `app_to_itc` relations.
- The trend chart (`CostTrendChart.tsx`) shows whenever a year other than "Current" is selected, with three hard-coded series (`softwareLicensingCost`, `applicationManagementServicesCost`, `infrastruttureCost`) named by their labels.
- `FullscreenPanel` puts the panel in the browser's full screen but the treemap keeps a fixed height (450 px), so it stretches only horizontally.
- In the Sankey view the toolbar hides Card type, the card scope filter and Cost field; Group by is offered for the table and the Sankey, not for the treemap.
- The total cost of Application and IT Component is a calculation defined by the administrator (`calculations`: `present = data.softwareLicensingCost + data.applicationManagementServicesCost + data.infrastruttureCost`).

## Requirements

1. **Initiative in the selector.** `Initiative` is offered. The "Cost field" selector lists the fields of type `cost` in the card type's schema (read from the metamodel, not hard-coded), so for Initiative it lists `costBudget` and `costActual`.
2. **Combined option.** The selector gains "Application + IT Component". Treemap and table show the cards of both types together, each with its own cost, in one chart. The treemap endpoint accepts several types (for example `type=Application,ITComponent`); a single `type` keeps working unchanged. Each item carries its card type.
3. **History chart.** It is displayed only while the Forecast year is the selected year (not on Current, not on past years). It shows one stacked bar per fiscal year (the current year and the four before it, plus the Forecast bar), the segments being **every cost field that concurs to the total cost**: the cost fields named in the active calculation whose target is the type's total field; for a type with no such calculation, all its cost fields. The **legend and tooltip use the technical field key** (for example `softwareLicensingCost`), not the label. (This replaces requirement 7 of the earlier spec, and the three hard-coded series.)
4. **Full screen.** In full screen the treemap and the Sankey take the whole width and height of the screen and do not distort; the existing exit button stays. In the normal page the chart keeps its current size.
5. **Sankey like the treemap.** The Sankey view shows the same toolbar as the treemap: Card type (including the combined option and Initiative), the card scope filter, Cost field, fiscal-year picker, and Group by. Year, scope and cost field filter the Sankey as they filter the treemap. Group by is also offered in the treemap view (the endpoint already supports it).
   - **Diagram.** The Sankey shows the cost items that concur to the total flowing into the cards of the chosen type, and on to the group when a Group by is chosen. For the combined option it shows cost items → IT Component → Application, the IT Component's cost flowing to the applications that use it through `app_to_itc`, as it does today.
6. **Group by in the combined case.** Offered only on fields that have the **same technical key in both types**; disabled when there is none.

## Rules and allowed values

| Rule | Value |
|---|---|
| Card type options | Application, IT Component, Application + IT Component, Initiative |
| Cost field options | the `cost`-typed fields of the chosen type; for the combined option, those with the same key in both types |
| Group by options (combined) | fields with the same technical key in both types; disabled if none |
| `type` parameter of the treemap endpoint | one type key, or several separated by commas; each must be a card type that has cost fields |
| History chart shown | only while the Forecast year is selected |
| History chart series | the cost fields concurring to the total (from the active calculation), else all the type's cost fields |
| History chart legend | technical field keys |
| History chart years | current year + four before + the Forecast year |
| Full screen | width and height of the screen, no distortion |
| Fiscal year, scope, cost field | apply to treemap, table and Sankey alike |
| Names of fiscal years | unchanged: `FY26 - Current`, `FY27 - Forecast`, `FY25`… |

## Non-goals

- Changing how the total cost is calculated or which cards count in a year (unchanged from the earlier spec).
- A Sankey for card types other than the four above.
- Translating the technical field keys in the history legend.
- Touching PPM screens.

## Failure even if it technically works

- A card the reader may not see appearing in the combined view (the read scope applies to every type in the list).
- The combined view double counting a card or mixing cost fields that are not the same quantity in the two types.
- The history chart showing a field that does not concur to the total, or hiding one that does.
- Full screen deforming the chart.

## Left to the builder

- The exact shape of the multi-type response and the Sankey response, as long as an item carries its type.
- How the cost fields concurring to a total are read from the formula (parsing the `data.<key>` references).
- Tests, docs (`docs/guide/reports.md`), translations through `/translate`.

## Agent's calls (to check)

- The Sankey shape in requirement 5 (cost items → cards → group; items → IT Component → Application for the combined option) is my reading of "the Sankey must report all the cost items that flow into the total"; the user did not choose between the two shapes offered.
- Cost-field options for the combined option are the keys common to both types (same rule as Group by).
- The Group by selector appearing in the treemap is my reading of "same page as the treemap"; today it is hidden there.
- A history chart for the combined option uses the cost fields common to both types.
