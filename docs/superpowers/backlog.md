# Backlog

Things noticed while working on `fix/cost-report` that are out of scope for it. One entry each: what, why it matters, rough size.

## Extend relations to subtypes

**What.** Relation types are defined between card *types* only (for example Application → ITComponent), never between *subtypes*. Cardinality (`1:1`, `1:n`, `n:m`) is also set per relation type, so it cannot differ by subtype.

**Why it matters.** Found while specifying "Group by linked card" in the cost report (`2026-10-30-cost-report-types-sankey-fullscreen-design.md`): every relation on the instance is `n:m`, so no linked card can be offered as a group. Subtype-level relations and cardinality would let a relation be `n:1` for one subtype only.

**Size.** Believed very high: touches the metamodel, relation validation, every relation writer (`relation_orientation.py`), the metamodel editor, importers, workspace transfer and the UI pickers. Needs its own brainstorm and spec before any estimate.

## Cost report: load once, compute in the browser, with a Refresh button

**What.** Today every change of card type, cost field, group-by, fiscal year or view asks the server again (`CostReport.tsx`, the request effect). Instead, one request per card-type selection would return, per card, the cost of every cost field for every fiscal year (current − 4 … Forecast), the "does it count in that year" decision already applied by the server (`is_live_in_fiscal_year` stays the single definition), the attributes, and the names of the linked cards usable as a group (relations with at most one link per card). Year, cost field, group-by, view and scope then change in the browser with no request; only changing the card type reloads. A **Refresh** button in the report reloads the data (there is none in the cost report today).

**Why it matters.** The history chart on Forecast sends one full treemap request per year per cost field (4 fields = 24 requests, each with every card's attributes) and the Sankey rereads all cards once per cost item. With thousands of cards the report is slow and loads the backend. The same payload would also give the Sankey the true per-item values after the scope filter, which it estimates today.

**Size.** Medium: a new response shape, so a new route (OpenAPI regeneration, VAPT), then a frontend rewrite of how `CostReport.tsx`, `CostTrendChart.tsx` and the Sankey read their data. `GET /reports/cost-treemap` stays for the MCP tool. Estimated payload under 1 MB for 2,000 cards × 4 fields × 6 years (not measured). Needs its own spec and plan.

## Existence oracle: 403 for a hidden card, 404 for a missing one

**What.** On endpoints that check the permission first and the card scope second (`upload_file_attachment`, `comments.create` and similar), a caller who holds the app-level permission gets 403 for an existing card whose type is hidden from them and 404 for an id that does not exist, so the two cases can be told apart. The remedy is to call `require_card_readable` before the permission check.

**Why it matters.** The card-read-scope rule says a hidden card does not exist for the caller. Low risk: the caller must already know the card's UUID, and before 2.188.2 the same probe returned 403 versus 500. Found by the security review of the upload 404 fix.

**Size.** Small per endpoint, but it reorders checks on endpoints that already have many tests: do it one endpoint at a time, with its permission-denial tests updated.

## A malformed card id is a 500, not a 404 or 422

**What.** Many route handlers start with `uuid.UUID(card_id)`, which raises `ValueError` on a malformed id, and no global handler turns it into a client error, so the answer is 500. `parse_uuid` (in `app/api/`) already does the conversion properly and is the helper to use everywhere.

**Why it matters.** Robustness, not security: noisy 500s in the logs and a wrong status for the client. Seen in `list_file_attachments` and `upload_file_attachment`; the same pattern is across `app/api/v1/`.

**Size.** Medium and mechanical: grep `uuid.UUID(` in `app/api/v1/`, switch to `parse_uuid`, one regression test per file (or a guard test that forbids the bare call), in one dedicated PR.

## Card read scope on comment and stakeholder writes

**What.** `comments.py` (create, update, delete) and `stakeholders.py` (add, change, remove) check `check_permission(app_perm, card_id, card_perm)` and never call `require_card_readable`. A stakeholder holding `card.create_comments`, `card.manage_comments` or `card.manage_stakeholders` without `card.view`, on a card whose type is View-denied for their app role, can still write there; `create_comment` even sends notifications that carry the card's name, and the stakeholder POST answers 404 only for a card that does not exist, so it also confirms existence. Same gap that 2.188.2 and 2.188.3 closed for attachments and documents.

**Why it matters.** The card-read-scope rule says a card the caller may not read does not exist for them. `tests/services/test_card_read_scope_guard.py` cannot see this: it only scans modules that query `Card` and lack any scope marker, `comments.py` and `stakeholders.py` already import `require_card_readable` for their GET handlers, and the sentinel sweep calls GET routes only. Not affected: relation PATCH/DELETE (`_relation_readable`), todos, the observe endpoints.

**Size.** Small: one or two lines after each permission check plus a hidden-type test per endpoint, modelled on `tests/api/test_attachment_document_write_scope.py`. Worth adding a guard that fails a write handler taking a card id without the scope.

## Cost year window reads one year at a time

**What.** `card_costs.get_window` (the Costs section's `GET /cards/{id}/costs`) resolves each of its six years with its own query and one catalogue read per year, up to about 18 queries to open the section. The licensing work (`card_licenses.items_by_card`, built on `yearly_rows.resolve_year`) loads the card's rows once and resolves every year in memory, so the licensing section opens with 2 queries (rows + catalogue).

**Why it matters.** Performance only, no behaviour change: one card at a time, so nobody is hurt today. It is also two code paths for the same year rules, which is how they drift.

**Size.** Small and mechanical, in its own pull request after the licensing one merges: generalise `items_by_card` in `yearly_rows` over the row model, make `card_costs.get_window` call it, and keep the cost tests as the guard unchanged (`test_card_costs.py`, `test_card_costs_api.py`, `test_cost_rollover_loop.py`, the cost report tests). Use `simplify` as a step of that PR.

## Compatibility shims left in the cost code by the licensing work

**What.** Four shims exist only so the unchanged cost tests keep monkeypatching old names: `redact_event_costs` in `cost_field_filter.py` (no production caller, only `test_cost_field_filter.py`), the `FISCAL_YEAR_LOOKBACK` re-export with `# noqa: F401` in `card_costs.py`, the `row_fn` / `fallback_fn` hook parameters on `yearly_rows.resolve` / `editable`, and the `_row` / `_fallback_row` wrappers in `card_costs.py`.

**Why it matters.** About 25 lines and a second code path for the same rules. No behaviour impact.

**Size.** Small, with the "Cost year window reads one year at a time" item above: point those tests at `strip_change_keys`, `fiscal_year.FISCAL_YEAR_LOOKBACK` and `yearly_rows.row` / `fallback_row`, then delete the shims and the hook parameters.

## Cost delete ignores the write window; saved reports leak past their permission

**What.** (1) `card_costs.delete_item` has no `in_window` check, so `DELETE /cards/{id}/costs/{fy}/items/{key}` can erase a year that PUT refuses (the licensing twin was fixed in the licensing branch). (2) `GET /saved-reports` returns `thumbnail` and `config` of public reports of any type without checking the permission that type needs: a viewer without `licenses.view` (or `costs.view`) receives the thumbnail, a picture of the figures, and a role that cannot read a card type receives the hidden card's id in `config.cardId` / `pickedCardId`. Creating a report is correctly gated.

**Why it matters.** Both are Low (found by the licensing VAPT): the first needs an old row to exist, the second shows a picture of numbers the caller cannot open.

**Size.** (1) one line and a test in `card_costs.py`. (2) Small-medium, in its own pull request: in the saved-reports list, withhold `thumbnail` and `config` of reports whose type needs a permission the caller lacks, and drop card ids that `CardReadScope` hides; one test per report type that carries a card id.
