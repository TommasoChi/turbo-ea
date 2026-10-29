# Cost report: fiscal-year picker fixes

**Spec status:** draft, started on `fix/cost-report` (from `main` 2.179.9).

## Requirements (as stated by the user, to be refined)

1. The fiscal-year picker offers **at most 5 years**.
2. The **current** fiscal year is labelled with its year and the word **Current**,
   e.g. `2026 - Current`.
3. The **next** fiscal year is offered and labelled `2027 - Forecast`.

## What exists today

- `frontend/src/features/reports/CostReport.tsx` builds the options as
  `Array.from({ length: 5 }, (_, i) => current - i)`: the current fiscal year and the four before it.
  The current year is the one the server returns as `fiscal_year`.
- Picking a year other than the current one sends `fiscal_year=<n>`, and the server answers from
  `card_cost_history`. The current year sends no parameter and is computed from live card attributes.
- The server validates `fiscal_year` on the cost reports as 1900-2200, and `PUT
  /cards/{id}/cost-history` accepts the current fiscal year and the five before it (2.179.9).
- A fiscal year is named by `fiscalYearLabel` (`frontend/src/lib/fiscalYear.ts`): `FY 2026`, or
  `FY 2025–2026` when the fiscal year does not start in January.

## Rules and allowed values

_To be filled in as the open questions below are answered._

## Open questions

1. "At most 5 years" — does it include the current and forecast years (so 3 past + current + forecast),
   or 5 past years plus those two? Today the picker shows 5 (current + 4 past) while the history
   accepts current + 5 past.
2. What does "Forecast" mean for the figures? Where do the numbers for 2027 come from: a value someone
   enters in the card's cost history for a future year, or a projection computed from other years?
3. May cost history be recorded for the forecast year (today `PUT /cards/{id}/cost-history` refuses a
   year after the current one)? Who may enter it?
4. What does a card with no forecast value show in the forecast year: zero, nothing, or the current
   year's figure?
5. Is the label `2026 - Current` instead of `FY 2026`, or in addition to it (and what about a fiscal year
   that does not start in January: `2025–2026 - Current`)?
6. The labels `Current` and `Forecast` — translated in all 10 locales, or English only?
7. Where else do these labels appear: the year picker only, or also the chip in the toolbar, the
   trend chart and the table column headers?
