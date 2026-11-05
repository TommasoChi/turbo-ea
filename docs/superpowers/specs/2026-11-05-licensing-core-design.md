# Licensing in core — yearly history, forecast and report

**Status:** draft (not yet reviewed by a fresh agent, not approved). **Branch:** `feat/licensing-core` (off `main`). **Depends on:** PR #58 (cost report refinements) being merged first: the report reuses its colour plan, legend, drill state, trend placement and click gestures.

## Intent

The `licensing` extension (folder `software/turbo-ea-licencing-Analisys`, v1.0.2, "Licensing Analysis") compares, per Application / IT Component, the licences under contract with the ones really used, and flags an overrun per category. It stores only current values on the card, has no history and no forecast, and its chart no longer works since the core removed `loadRecharts` / `useChartTheme` (SDK 1.33). The "clean core" constraint no longer applies to this fork, so licensing becomes a **core feature shaped like card cost items** (`card_costs`): one row per card and fiscal year, a section on the card with a year navigator, a report with history, forecast and a table. The extension is retired.

## What the user sees

1. **Card section "Licensing"** on Application and IT Component, next to Costs, with the same year navigator (`current-4 … current+1`). For the selected year it shows, per metric (**Users**, **Installations**) and per **licence type**, the licensed count, the actual count, the utilisation % and the RAG status, plus a stacked bar like the Costs section. Edit/add dialog like `CostItemDialog`. The Forecast year (`current+1`) takes **licensed only**; actual cannot be entered for it.
2. **Licence type catalogue** (admin dialog like `ManageCostItemsDialog`): stable `key`, label, translations, `archived`, never deleted. It replaces the free-text categories of the extension (Admin, End User, Prod, Dev…), so colours, order and legends are stable.
3. **Report `Reports → Licensing`** (core route, same toolbar family as the cost report): card type (Application / IT Component), metric (Users, Installations), licence type (All + one per catalogue entry), group-by, fiscal year, scope filter. Metric cards on top (Compliant, Approaching, Over-licensed, No actual data, from the selected year's statuses).
   - **Trend charts above the view**, as in the cost report: licensed vs actual per fiscal year (history, current, and the Forecast year with licensed only), stacked by licence type; it follows the drill and the scope.
   - **Three views** (view switch like the cost report): **Utilisation** (the summary chart, see below), **By licence type** (stacked/grouped bars of licensed vs actual per licence type), **Table**.
   - **Table view**: every card in scope, one row per card, columns per licence type (licensed / actual / %), total, status, optional extra card fields (same Columns menu as the cost report, object-typed fields excluded), sortable, with a total row; XLSX/PPTX download and print through the existing `ReportShell` export menu (it exports the rendered `<table>`), so it behaves like the cost report.
   - **Utilisation chart (proposal, the user asked for one):** horizontal bars, one per card, value = actual / licensed % for the selected year and metric, sorted descending, coloured by status (green < 80 %, orange 80–100 %, red > 100 %), with the 80 % and 100 % reference lines (`markLine`) and shaded zones (`markArea`, available in the ECharts layer since SDK 1.33). A card with no actual data is a grey bar at zero with a "no data" label.
   - **Clicks, same as the cost report:** left click opens the card in the side panel, right click drills (a card, or a group when group-by is on), breadcrumb with Back, hint line; the trend follows the drill.
4. **Mass import from the report** ("Import" button): an Excel file in long format `Component | Metric | Licence type | Year | Licensed | Actual`. Preview before applying: matched rows, skipped rows with the reason (card not found, unknown licence type, invalid year or number), the skipped rows listed. Apply writes per `(card, year, metric, licence type)` cell; an empty cell leaves the stored value alone; a Forecast-year row with an Actual value is skipped. Requires `licenses.edit`.
5. **Status rules are kept**: per licence type, no compensation between types; a type is `over` when actual > licensed, `approaching` at ≥ 80 % and not over; card priority `over` > `approaching` > `no_actual_data` > `compliant`; `no_actual_data` when any active metric lacks actual for the year. Statuses are computed for the selected year; the Forecast year has no status (licensed only).

## Data model and rules (mirror of card costs)

- Table `card_licenses`: one row per `(card_id, fiscal_year)`, `items` JSONB `{metric: {license_type_key: {licensed, actual}}}`; catalogue table `license_types` (`key`, label, translations, `archived`, `sort_order`). Types: `LICENSE_TYPES = ("Application", "ITComponent")`, one constant per side (backend, frontend).
- Same year resolution as costs: a year with a row (even empty) is confirmed; only the **current** year with no row falls back to the latest earlier row (`confirmed=false`), never the Forecast or a past year. The Forecast row stores licensed only.
- `licensingModel` stays a normal card field (multiple select Users / Installations) and says which metrics the card tracks; it moves from the extension's field contribution to the built-in field schema of both types by a guarded migration.
- Per-card gating like costs: view = `licenses.view` OR any stakeholder on the card; edit = `licenses.edit` OR a stakeholder role with `card.edit` on that card; a hidden card is 404 (`CardReadScope`). `licenses.view` defaults like `costs.view`, `licenses.edit` admin only, added by a migration like 176.
- Writes publish `card.licenses_updated` (licence type keys only, never counts) and are not rollbackable; every event feed goes through the same redaction path as costs. Writes lock the year row (`FOR UPDATE`); the service never commits.
- Workspace transfer carries both tables (mandatory checklist), the OpenAPI spec is regenerated.
- **Migration from the extension:** for every card, `licensedUsers`, `licensedInstallations`, `actualUsers`, `actualInstallations` (`ext.licensing.multivalue` values) move into the **current fiscal year** row; each distinct free-text category becomes a catalogue entry (key = slug of the name, label = the name as first seen); the four keys are then stripped from `cards.attributes`; a report of what was moved goes to `app_settings.general_settings` (capped), as migration 175 does. The admin then uninstalls the extension (its field contribution and field type vanish).

## Non-goals

- No real IAG / OneIdentity integration, no import history, no staging table.
- No parent/child rollup of generic-product nodes (stays in the backlog).
- No per-user licence assignment, no money: cost of a licence stays in the card costs.
- No new chart library: ECharts through the shared layer only.

## Tests and docs owed

Backend: service, API (success, 403, 404 for a hidden card, rejected input: unknown licence type, forecast actual, bad year), migration (move, slug collisions, strip), import parser and preview, event redaction, workspace transfer round trip, permissions migration. Frontend: Vitest per new component (section, dialogs, report views, table, import dialog, status helpers, option builders), i18n English then `/translate`, `docs/guide` + admin catalogue page, screenshots per the two-way contract, version bump (minor) and CHANGELOG. A new rules file `.claude/rules/licensing-items.md` (fork-only, like `cost-items.md`), proposed to the user, not written alone. A render check in the browser pane before the PR.

## Agent's calls (not decided by the user — check these)

- Licence **catalogue** instead of free-text categories (stable colours/legend, translations, same pattern as cost items); import with an unknown type skips the row and lists it, it never creates a type.
- Summary chart = **Utilisation** bars (plus a "By licence type" view); both are the agent's proposal.
- `licensingModel` kept as a normal field; the metric is "active" for a card when it is selected there.
- Import columns, upsert-per-cell semantics, empty cell = unchanged, instead of the extension's replace-the-whole-field.
- Event redaction and non-rollbackable writes copied from costs even though counts are less sensitive than money, to keep one pattern.
- Migration puts the old values in the **current** fiscal year and slugifies category names for catalogue keys.
- The report reuses the cost report's drill, breadcrumb, hint, colour fold and trend placement.
