# Cost Report: Sankey diagram + IT Component cost parity

**Spec status:** draft, from a brainstorming session on `feature/sankey-diagram-cost-report`.

## Goal

`/reports/cost` gets a third chart view (Sankey, alongside the existing Treemap
and Table) showing cost flows between Application and IT Component cards, and
IT Component gains the same cost fields + calculation Application already has,
so the flow has real numbers on both ends.

## Scope

In scope:
- Rename the chart-view tooltip from the shared `"Chart view"` to
  `"Treemap chart view"` — **on `/reports/cost` only**, not globally.
- A new, third toggle button `"Sankey chart view"`, between the Treemap and
  Table buttons, switching the chart panel to a Sankey diagram.
- A fullscreen button on both the Treemap and the Sankey chart panels.
- Extend `group_by` to the Treemap (already supported, unchanged) and to the
  new Sankey view, via a flag:
  - flag off: 2-level flow, item → target.
  - flag on: 3-level flow, item → group bucket → target (matches the
    "Aggregate 1 / Aggregate 2" intermediate-node pattern the user referenced).
- Remove the `aggregate` parameter and its UI entirely. It summed a cost field
  across a card's related cards of another type, but that relation is
  many-to-many in practice (one IT Component can serve several Applications,
  one Initiative can touch several Applications), so the sum silently
  double-counts. A Sankey does not have this problem — it draws one flow per
  relation instead of folding them into a single total, so no replacement
  mechanism is needed.
- Restrict the card-type selector to **Application** and **IT Component**
  only, and allow **both to be shown together** in one view — their
  `relAppToITC` relations become the flow edges directly, no `aggregate`
  needed.
- Rename Application's `"Cost & Ownership"` metamodel section to `"Cost"`
  (matches IT Component's existing section name).
- Add to IT Component's `"Cost"` section, as real metamodel fields via
  migration (not just seed data): `softwareLicensingCost`,
  `applicationManagementServicesCost`, `infrastruttureCost` — same key names,
  labels and translations as Application's.
- Add a second `Calculation` row, target type IT Component, target field
  `costTotalAnnual`, with the same formula shape as Application's (field keys
  re-pointed at IT Component's own fields — the two calculations are
  independent rows, not a shared one):
  ```
  present = data.softwareLicensingCost+data.applicationManagementServicesCost+data.infrastruttureCost
  ```
  "Treat blank numbers as zero" on, matching Application's calculation.

Out of scope (not asked, not assumed):
- Any card type other than Application / IT Component.
- Changing Application's existing calculation or its three input fields.
- A generalized N-way `group_by` beyond the 2-level/3-level Sankey shape above.

## Current state (verified, not assumed)

- Chart is `Treemap` from `recharts` (confirmed present in `recharts@3.7.0`,
  which also exports `Sankey` — same library, no new dependency).
  `frontend/src/features/reports/CostReport.tsx`.
- `"Chart view"` / `"Table view"` tooltips come from `shell.chartView` /
  `shell.tableView` in `ReportShell.tsx`, a toggle **shared by 11 report
  pages**. The `view` prop is a fixed `"chart" | "table"` union with two
  hardcoded `ToggleButton`s. Renaming the string directly would relabel every
  other report's toggle; the per-report override and the third Sankey button
  both need `ReportShellProps` extended, not the shared string edited.
- Backend: `GET /reports/cost-treemap`
  (`backend/app/api/v1/reports.py:1412`) — `type`, `cost_field`, `group_by`,
  `aggregate`, `parent_card_id` params. `aggregate` sums a cost field across
  related cards of another type (fan-out summed, not deduped per source card)
  — confirmed this is the mechanism the double-counting concern is about.
- Backend metamodel (live instance, via `list_card_types` / the Calculations
  admin UI, not the generic open-source seed — the deployed instance's own
  schema differs from `backend/app/services/seed.py`):
  - Application → section `"Cost & Ownership"`: `costTotalAnnual` (calculated,
    not editable), `softwareLicensingCost`, `applicationManagementServicesCost`,
    `infrastruttureCost`.
  - IT Component → section `"Cost"`: `costTotalAnnual` only, **not**
    calculated (plain editable cost field today).
  - The one existing `Calculation` row: name "Total Annual Cost", target type
    Application, target field `costTotalAnnual`, order 0, formula above,
    confirmed by opening it in Admin → Metamodel → Calculations.

## Open questions for the next pass

- Exact Sankey node/flow semantics when both Application and IT Component are
  shown together with `group_by` on: is the bucket a third node layer between
  the two card types, or does it replace one of them? Needs a concrete
  worked example before implementation.
- Whether `parent_card_id` drill-down (today: click a Treemap rectangle to
  descend into its related cards) carries over to the Sankey, and what
  "drilling" means for a flow diagram (click a node? click a flow?).
- Fullscreen: a shared chart-wrapper component, or a prop on each chart panel?
  No existing fullscreen pattern elsewhere in the reports to copy from yet —
  needs a short look before committing to an approach.

## Rule files and docs this touches (censito da CLAUDE.md)

- **Split `.claude/rules/card-flags-cost-eol.md` in due**, lungo il confine
  reale del contenuto attuale (non "cost vs eol" — il bullet 1 è già
  flags+EOL insieme, stesso modulo `card_flags.py`; il bullet 2 è
  fiscal-year/cost, `lifecycle.py`/`fiscal_year.py`, un modulo diverso):
  - `card-flags-eol.md` — bullet 1 invariato.
  - `cost-fiscal-year.md` — bullet 2, da aggiornare dopo la rimozione di
    `aggregate` (oggi dice "Both apply the rule to the related cards an
    aggregate sums as well as the primary cards" — frase da riscrivere).
- **`.claude/rules/api-contracts.md`** — `docs/api/openapi.json` rigenerato
  via `scripts/dump_openapi.py` dopo il cambio dei parametri di
  `GET /reports/cost-treemap`; eventuale schema nuovo in
  `backend/app/schemas/` per la risposta Sankey.
- **`.claude/rules/i18n-locales.md`** — nessuna traduzione scritta a mano:
  stringhe nuove in `frontend/src/i18n/locales/en/*.json` +
  `backend/app/services/seed.py` (translations dict dei 3 nuovi campi IT
  Component + rename sezione Application), poi `/translate` prima della PR
  per gli altri 9 locale e i `.{locale}.md`.
- **`.claude/rules/settings-and-seed.md`** — nuova migration Alembic
  (pattern `072_restore_business_process_color.py`, guarded UPDATE):
  3 campi cost su IT Component + rename sezione "Cost & Ownership" →
  "Cost" su Application, senza toccare install già customizzate.
- **`.claude/rules/docs.md`** — `docs/guide/reports.md` (+ screenshot in
  `scripts/screenshots/pages.ts` se lo screenshot del cost report cambia).
- **`.claude/rules/testing-ci.md`** — verificare se `reports.py` è già in
  `scripts/mutation/floors.toml`'s `[modules]`; diff coverage gira
  comunque automaticamente su ogni PR.

Codice applicativo (non da rule, dalla lettura diretta):
`backend/app/api/v1/reports.py`, `frontend/src/features/reports/CostReport.tsx`,
`frontend/src/features/reports/ReportShell.tsx`, `backend/app/services/seed.py`,
nuova migration in `backend/alembic/versions/`, test:
`backend/tests/api/test_reports_cost_fiscal_year.py`,
`frontend/src/features/reports/CostReport.test.tsx`, nuovo
`backend/tests/services/test_alembic_<N>_itcomponent_cost_fields.py`.
