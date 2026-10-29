# Cost report: fiscal-year picker, FY names and a forecast year

**Spec status:** draft, on `fix/cost-report` (from `main` 2.179.9).

## Goal

The cost report's fiscal-year picker offers a **Forecast** year (next fiscal year) next to the current
one and the past ones, and names every fiscal year in the report in a short, uniform way
(`FY26 - Current`, `FY27 - Forecast`, `FY25`…). The picker lists at most the current year, four past
years and the forecast year.

## Current behaviour

- `frontend/src/features/reports/CostReport.tsx` shows a picker with an entry "Current year" (empty
  value, live card attributes) followed by the numbers `current … current-4`. The current year therefore
  appears twice: once as "Current year" and once as its number.
- A year other than "Current year" is sent as `fiscal_year=<n>`; the server answers from
  `card_cost_history` (a card without a row for that year contributes no cost). Year = current is served
  from live attributes.
- Fiscal years are named by `fiscalYearLabel` (`frontend/src/lib/fiscalYear.ts`): `FY 2026`, or
  `FY 2025–2026` when the fiscal year does not start in January. The same function names the years in the
  PPM cost tab and charts.
- Cost history: `PUT /cards/{id}/cost-history` accepts the current fiscal year and the five before it.
  `fiscal_year` on the cost reports is validated as 1900–2200.

## Requirements

1. **Picker contents.** Six entries, top to bottom: `FY27 - Forecast`, `FY26 - Current`, `FY25`, `FY24`,
   `FY23`, `FY22` (next fiscal year, current, and the four before it). "Current" keeps the empty value, so
   the current year is requested without `fiscal_year`, as today; the duplicate numeric current entry
   disappears.
2. **Naming.** A fiscal year is written `FY` + the last two digits of the year it ends in, whatever the
   start month (`FY26`). The current year gets ` - Current`, the next year ` - Forecast`. "Current" and
   "Forecast" are not translated: they read the same in every locale.
3. **Where the new names apply.** Everywhere the cost report names a fiscal year: the picker, the
   toolbar chip, the parameters line and the trend chart axis. They do **not** apply to the PPM cost tab
   and charts, which keep `fiscalYearLabel` as it is.
4. **Forecast figures are entered by hand** in the card's cost history, as for past years. The forecast
   report reads `card_cost_history` for `current + 1`.
5. **Recording a forecast.** `PUT /cards/{id}/cost-history` accepts `fiscal_year` from `current - 5` to
   `current + 1`. Same permission as for past years; no permission added. No year beyond `current + 1`.
6. **Which cards appear in a year other than the current one.** Every readable, active card of the type
   that has a **cost recorded for that year** (a history row with a value other than zero), whatever its
   lifecycle: a card retired since, or one that only becomes active next year, is included for the years
   it has a cost. A card with no recorded cost for the year does not appear (no cost, no row), as today.
   The current year keeps its rule: live attributes, and only cards live in the current fiscal year.
7. **Trend chart.** It shows the current year and the four past years; the forecast bar (`FY27 - Forecast`)
   is added **only when the forecast year is the one selected** in the picker. Its axis uses the new names.

## Rules and allowed values

| Rule | Value |
|---|---|
| Picker entries | 6: forecast, current, current-1 … current-4 |
| Cards in a non-current year | every readable, active card with a non-zero recorded cost for that year, any lifecycle |
| Cards in the current year | unchanged: live attributes, cards live in the current fiscal year |
| Order | forecast first, then current, then past years newest first |
| Name of a fiscal year | `FY` + last two digits of the year it ends in |
| Suffixes | ` - Current` (the current year), ` - Forecast` (current + 1); not translated |
| Requested year for "Current" | none (empty value), as today |
| Years accepted by `PUT /cards/{id}/cost-history` | `current - 5` … `current + 1` |
| Years accepted by the cost reports | 1900–2200, unchanged |
| Permission to record a forecast | the one that records past years today |
| Forecast bar in the trend chart | only while the forecast year is selected |
| PPM cost tab and charts | unchanged |

## Non-goals

- Computing a projection: forecast values are typed in, not derived.
- More than one future year.
- A permission specific to forecasts.
- Translating "Current" / "Forecast".
- Changing which cards appear in the current year.
- Changing how PPM names fiscal years.

## Failure even if it technically works

- A card with a recorded cost for a year missing from that year's report because it is not live today.
- A forecast figure that looks like an actual one (the figures must be recognisably labelled
  `Forecast` everywhere the year is named).
- The PPM cost tab changing its labels as a side effect of this work.
- The current year offered twice.

## Left to the builder

- Where to put the new naming function (a second helper beside `fiscalYearLabel`, so PPM keeps using
  the old one).
- Tests, docs and screenshots for the picker (`docs/` cost-report page, `scripts/screenshots/pages.ts`).
- The user-manual wording; English only authored here, `/translate` fills the other locales.

## Agent's calls (to check)

- `PUT` keeps accepting `current - 5` although the picker shows four past years, so history entered
  for the fifth year back stays valid but cannot be picked.
- The table's year-over-year column and the treemap delta compare the selected year with the previous
  one / with the current one exactly as today; for the forecast year that means FY27 against FY26.
- The explicit numeric current year is no longer offered; a saved report whose configuration holds
  `fiscalYearParam` equal to the current year is read as "Current".
