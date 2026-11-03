# Card cost items — costs as a standard object of the card

**Status:** draft (not yet reviewed by the user). **Branch:** `feat/cost-history-in-card`.

## Intent

Lifecycle is a standard object on every card: a fixed shape, one place that computes
it, a dedicated section. Costs are not. Today a cost is a metamodel field of type
`cost` that an admin must redeclare type by type (`costTotalAnnual` plus, on
Application and IT Component, three breakdown fields summed by a `Calculation`),
and its history per fiscal year is a separate table of snapshots
(`card_cost_history`) with its own editor.

This work makes the **cost of an Application or an IT Component a standard object**:
a total cost of ownership (TCO) that is the sum of **cost items** chosen from one
admin-defined catalogue, each item carrying an amount and a renewal date, per fiscal
year, viewed and edited from a Costs section of the card that scrolls through fiscal
years with ‹ ›.

Why now: the cost report already treats Application and IT Component as one combined
view over the same components, and the user needs renewal dates (contracts that expire)
next to the amounts. Free-form per-card items would break the report (three spellings
of "licences" become three columns), so the items must be configured once, in the
metamodel.

## What the user sees (agreed with the user, with mockups)

A **Costs** section on the card, only for card types Application and IT Component
(a constant in code, like `EOL_TYPES`; not a metamodel flag in this work).

- Header: title, and the year navigator `‹ FY26 · Current ›`. The navigator always
  offers six fiscal years: the four before the current one, the current one, and the
  Forecast year (current + 1). Years with no data are still shown, empty.
- The **TCO** of the shown year, large; a stacked bar with the weight of each item.
- One **tile per item** with its amount (annual) and its renewal date. The renewal
  date turns orange when it is near.
- Clicking a tile opens a **modal edit dialog**: item (fixed once set), annual amount,
  renewal date, delete, and a "copy to Forecast" checkbox (offered when the shown year
  is before the Forecast year). "+ Add item" opens the same dialog empty, listing only
  the catalogue items not yet set for that year.
- Every year, past, current and Forecast, is read and edited the same way.
- A cost without `costs.view` is hidden, as everywhere today.

Costs are **always annual**: an item has no period.

## What is decided

1. **TCO is the sum of the items of the year. It is never typed by hand.**
2. **Items are defined once in the metamodel** (admin), not per card. One catalogue
   shared by the cost-bearing types. An item has a stable `key`, a label with the same
   nine-locale translations as a field, and an `archived` flag. The key never changes;
   the label can.
3. **Removing an item from the catalogue archives it, it does not delete data.** An
   archived item disappears from the card sections and from the reports; its stored
   amounts stay and come back if the item is un-archived. This mirrors how
   extension-owned fields are handled today when an extension is disabled
   (`_cleanup_removed_fields_and_options` skips them and preserves the values). No
   admin click may erase the historic amounts of past fiscal years.
4. **Storage: a table with a JSON column**, not a flat table of item rows. One row per
   `(card_id, fiscal_year)` holding the items as JSON keyed by item key, each with
   `amount` and `renewal_date`. At most one amount per item per card per year.
5. The new items **replace** the cost fields of Application and IT Component, with a
   data **migration**: for the current fiscal year from the card's attributes, for past
   years from `card_cost_history`.
6. Only Application and IT Component move to the new object. Initiative
   (`costBudget`, `costActual`) and Provider (`costTotalAnnual`) keep their `cost`
   fields and `card_cost_history`.

## Goals

- One place computes a card's cost, as `lifecycle.py` does for lifecycle.
- The cost report (treemap, Sankey, history chart, table, fiscal-year picker) keeps
  every view it has today, now reading items for Application and IT Component; the
  items of the catalogue are its cost items / components.
- Renewal dates are stored, shown on the card, and queryable.
- The existing amounts survive the migration exactly: each card's TCO for each year is
  unchanged by it.

## Non-goals (this work)

- Renewal notifications, a "renewals due" report or dashboard widget. The data model
  must allow them later; nothing is built.
- Non-annual costs (monthly, one-off), multiple currencies, per-card custom items.
- Cost items on other card types, or a metamodel switch to enable them.
- Importing or exporting cost items through Excel, ServiceNow, LeanIX or MCP write
  tools, beyond not breaking those paths (see Open points).

## Anti-goals (a failure even if it technically works)

- Losing a historic amount because an admin edited the catalogue.
- A TCO that exists in two places and can disagree.
- A report whose columns depend on how a user spelled an item.
- Existing consumers of `costTotalAnnual` (dashboards, portals, saved reports, grid
  filters, PPM, TurboLens) silently reading 0 or nothing after the migration.

## Constraints

- Repository rules apply (`CLAUDE.md` and `.claude/rules/*`): data-driven metamodel;
  `CardReadScope` on every card-returning endpoint; permission checks on reads and
  writes; a write path that can move `cards.updated_at` also persists a card event (or
  runs in `derived_maintenance`); route handlers delegate to a service; new routes
  mean a regenerated `docs/api/openapi.json`; a new table or migration means the
  workspace-transfer checklist (`.claude/rules/workspace-transfer.md`) and a VAPT pass;
  tests and mutation score for every change; English-only authoring then `/translate`;
  user docs updated; minor version bump and a `CHANGELOG.md` entry; the next free
  Alembic revision is `175`.
- The extension SDK version constants stay pinned (`SDK_VERSION` 1.5, `UI_SDK_VERSION`
  1.19). This work must not bump them.
- The fiscal-year rules stay as they are: `fiscal_year.py` for the arithmetic, a year
  named after the calendar year it ends in; `is_live_in_fiscal_year` for whether a
  card's cost counts in the current year.
- This is fork-only work on a fork that merges `upstream/main`; keep the footprint in
  shared upstream files small to keep later syncs cheap.

## Agent's calls (to be confirmed by the user)

- **Where the catalogue lives.** One global registry in the metamodel admin (a precedent
  is `card_type_categories`: a registry the route validates), shared by Application and
  IT Component, rather than a list per card type. It lets the combined cost view keep
  working on shared components.
- **`costTotalAnnual` stays as a derived copy.** The cost service writes the current
  fiscal year's TCO into `attributes.costTotalAnnual` on every cost save (as a
  calculated field is written today), read-only in the UI. The `Calculation` that sums
  the three old fields and those three fields are removed from the two types. This
  keeps every consumer that reads `attributes.costTotalAnnual` working without a
  rewrite, at the price of one derived value that is not a second source of truth.
- **Residual item.** A card whose old total is larger than the sum of its breakdown
  fields (or that only had a total) gets the difference in a catalogue item `other`
  ("Other costs"), seeded by the migration, so its TCO is preserved exactly.
- **Renewal "near".** Orange when the renewal date is within 90 days; one constant, not
  a setting.
- **Window.** The API accepts exactly the six years the section shows
  (`current-4` … `current+1`); older history rows migrate but are not shown.
- **Catalogue seed.** The three old fields become the first items: software licensing,
  application management services, infrastructure (the existing key
  `infrastruttureCost` carries a typo that is not reproduced in the new keys).

## Open points left to the builder

- Table and column names, the exact JSON shape, indexes, and whether the TCO is also
  materialised in a column.
- The API shape (new routes under `/cards/{id}/costs` versus extending
  `/cards/{id}/cost-history`) and the permission needed to write; default is the same
  gates as `PUT /cards/{id}/cost-history` today.
- How each existing consumer is moved or kept working: `reports.py` (cost-treemap,
  cost-sankey, cost), `cost_report.py`, `cost_components.py`, `cost_grouping.py`,
  `cost_field_filter.py`, `cost_history.py`, `card_write_service.py`,
  `dashboard_query.py`, `ppm_portfolio_service.py`, `saved_reports.py`,
  `web_portals.py`, `servicenow.py`, `turbolens*.py`, `process_map_service.py`,
  the MCP tool `get_cost_treemap`, the LeanIX mapping, the data-quality weight of the
  cost field, the inventory grid and the Excel import/export.
- What the card type editor shows for the removed fields on those two types, and the
  migration's downgrade.
- Whether the migration backfills a `card_cost_history` row for a year that had items.

## Success

On a copy of the live workspace, after the migration: every Application and IT
Component shows the same TCO for each of its years as before; the cost report gives
the same totals for each year and each view; an admin can add, rename and archive an
item without losing a past amount; a user can step ‹ › through six years and edit any
of them; the renewal date of an item is visible on the tile.
