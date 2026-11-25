# Cost report: Provider on cost items, group by Provider, field filters. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this repository the backend tasks (1-4) go to the `backend-dev` agent and the frontend tasks (5-7) to `frontend-dev`; neither commits, the session owns git.

**Goal:** an optional Provider on each Application / IT Component cost item, a "Provider" grouping in the cost treemap, Sankey and table, and a server-evaluated field / relation filter (one group per selected card type) in the cost report.

**Architecture:** the provider id lives inside `card_costs.items[key].provider_id` (JSONB, no schema migration). Grouping by provider splits **items**, not cards, so one card can appear in several groups; the backend returns one entry per (card, provider) and the page keys its maps on `(card, group)`. The filter reuses the web-portal evaluator (`portal_card_filters.preset_conditions`) and the `CardFilterSection` the PPM board and Lifecycle report render.

**Tech Stack:** FastAPI + SQLAlchemy async, Pydantic, pytest; React 19 + MUI 6 + ECharts, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-cost-provider-and-field-filters-design.md`

## Global Constraints

- No schema migration, no new table. The workspace-transfer checklist still applies (Task 2).
- `card.costs_updated` keeps carrying item keys only (never a provider id).
- `/reports/cost` (the plain cost endpoint) and `/reports/licensing` do not change; `group_by=provider` is accepted only by `/reports/cost-treemap` and `/reports/cost-sankey`.
- One provider per item. Items recorded before this feature have no provider and land in `__other__` ("Unspecified"). No back-fill.
- A provider the reader cannot read is shown as no provider and **a write never drops a link the caller could not see**.
- `docs/api/openapi.json` is regenerated (`python scripts/dump_openapi.py`) in the same PR; English only in the implementation session, translations via `/translate`.
- Services never commit; route handlers commit. Every new or changed endpoint has an API test with success, permission denial (403 / 404) and a rejected input.
- Group key for provider grouping is the provider's card id (string); names travel separately.

## Review Focus

- Amount-only save on an item whose stored provider is archived, unlinked or unreadable to the caller: must succeed and leave `provider_id` untouched (Task 1).
- An explicit `provider_id: null` from a caller who cannot read the stored provider: must not clear it (Task 1).
- Two different providers with the same name stay two groups; a provider card deleted or unreadable falls into `__other__` (Task 3).
- A card with items from two providers: the sum of all groups equals the ungrouped total, in treemap, table and Sankey (Task 3).
- `group_by=provider` with a type or `cost_field` that is not an item cost (Initiative, a plain cost field) answers 400, and `/reports/licensing` still ignores / refuses `provider` (Task 3).
- `card_filters` malformed JSON, oversized, unknown type key, a filter for a type that is not selected: 400 or ignored as stated, never a 500 (Task 4).
- The Excel cost import re-saving an amount must not wipe providers (Task 1).
- Delta badge and year-on-year % are computed per `(card, provider)` share (Task 6).

## File map

| File | Responsibility |
|------|----------------|
| `backend/app/services/cost_providers.py` (new) | candidates, write resolution, name lookup, per-card provider split |
| `backend/app/services/card_costs.py` | `CostLine.provider_id`, `_shifted`, `upsert_item` provider argument, `UNSET` |
| `backend/app/schemas/cost_items.py` | `CostItemWrite.provider_id`, `CostLineOut.provider_id/provider_name`, `ProviderCandidateOut` |
| `backend/app/api/v1/card_costs.py` | `GET /cards/{id}/cost-providers`, provider on PUT, name resolution on every read |
| `backend/app/services/cost_grouping.py` | `GroupBy.kind == "provider"`, `allow_provider` |
| `backend/app/services/cost_report.py` | `extra` conditions, provider splits in `build_cost_sankey` |
| `backend/app/services/cost_filters.py` (new) | parse and evaluate the `card_filters` parameter |
| `backend/app/services/portfolio_payload.py` | `filter_options_payload` shared by portals and cost report |
| `backend/app/api/v1/reports.py`, `web_portals.py` | treemap / sankey parameters, `GET /reports/cost-filter-options` |
| `backend/app/services/workspace_io/sections.py`, `remap.py` | `CardCosts` becomes id-bearing |
| `frontend/src/features/cards/sections/CostItemDialog.tsx` | Provider select |
| `frontend/src/features/reports/CostReport.tsx` (+ `costRowKey.ts`, `CostFilters.tsx`, `costFilters.ts`, `costTreemapOption.ts`, `CostTrendChart.tsx`, `useCostBreakdown.ts`) | group selector, composite keys, filters |
| `frontend/src/types/index.ts` | `CostLine`, `CostItem`, responses |

---

### Task 1: Provider on a cost item (service, schema, routes)

**Files:**
- Create: `backend/app/services/cost_providers.py`
- Modify: `backend/app/services/card_costs.py`, `backend/app/schemas/cost_items.py`, `backend/app/api/v1/card_costs.py`
- Test: `backend/tests/services/test_cost_providers.py` (new), `backend/tests/services/test_card_costs.py`, `backend/tests/api/test_card_costs_api.py`, `backend/tests/api/test_card_costs_permissions.py`, `backend/tests/services/test_cost_import.py` (or the file that holds the import tests; find it with `grep -l cost_import backend/tests`)

**Interfaces:**
- Produces:
  - `card_costs.UNSET` (module-level sentinel, `class _Unset`).
  - `CostLine.provider_id: uuid.UUID | None = None`.
  - `card_costs.upsert_item(db, card_id, fiscal_year, key, amount, renewal_date, *, provider_id: uuid.UUID | None | _Unset = UNSET, read_scope: CardReadScope | None = None) -> None`. `UNSET` keeps the stored value and `read_scope` may then be omitted; any other value requires `read_scope`.
  - `cost_providers.PROVIDER_RELATIONS = {"Application": "relProviderToApp", "ITComponent": "relProviderToITC"}`.
  - `async cost_providers.candidate_providers(db, read_scope, card_id: uuid.UUID, card_type: str) -> list[tuple[uuid.UUID, str]]`: ACTIVE Provider cards readable in module mode, linked through the type's relation to the card, any ancestor (walk `parent_id`, readable or not) or any descendant (`portal_card_filters.descendant_ids`); sorted by name.
  - `async cost_providers.resolve_write(db, read_scope, card_id, card_type, stored: str | None, requested) -> str | None`: the provider id to store.
  - `async cost_providers.provider_names(db, read_scope, ids) -> dict[uuid.UUID, str]`: ids of existing Provider cards (any status) readable in module mode.
  - Schemas: `CostItemWrite.provider_id: uuid.UUID | None = None`; `CostLineOut.provider_id: str | None = None`, `provider_name: str | None = None`; `ProviderCandidateOut(id: str, name: str)`.
  - Route `GET /cards/{card_id}/cost-providers` -> `list[ProviderCandidateOut]` (a path of its own, not under `/costs/{fiscal_year}`, so it cannot collide with the year parameter).
  - `CostError("invalid_provider")` mapped to 400 in `_STATUS`.

- [ ] **Step 1: write the failing service tests** in `test_cost_providers.py`. Names and assertions: `test_candidates_walk_card_ancestors_and_descendants` (providers linked to the card, to its parent and to its child are all listed; a provider linked to a sibling is not), `test_candidates_use_the_relation_of_the_card_type` (an ITComponent ignores `relProviderToApp` links), `test_candidates_skip_archived_and_unreadable_providers`, `test_unreadable_ancestor_does_not_stop_the_walk` (a hidden parent drops itself, its own parent's provider is still offered), `test_resolve_write_keeps_stored_when_unset`, `test_resolve_write_accepts_the_stored_id_even_if_no_longer_a_candidate`, `test_resolve_write_rejects_a_new_non_candidate` (`CostError.code == "invalid_provider"`), `test_resolve_write_null_clears_a_visible_stored_provider`, `test_resolve_write_null_keeps_an_unreadable_stored_provider`, `test_resolve_write_new_pick_replaces_an_unreadable_stored_provider`, `test_provider_names_hide_unreadable_and_non_provider_cards`. In `test_card_costs.py`: `test_upsert_item_without_provider_argument_keeps_stored_provider`, `test_shifted_and_copy_to_forecast_carry_provider_id`, `test_cost_lines_expose_provider_id`. Build fixtures with the `conftest.py` factories; relations through the orientation-safe writer already used in other cost tests.
- [ ] **Step 2: run them** (`cd backend && pytest tests/services/test_cost_providers.py tests/services/test_card_costs.py -q`). Expected: FAIL (missing module / argument).
- [ ] **Step 3: implement `card_costs` changes.** `_lines` fills `provider_id` from `v.get("provider_id")`; `_shifted` copies `provider_id` only when present and truthy; `upsert_item` builds the stored dict as `{"amount", "renewal_date"}` plus `provider_id` when the resolved value is not `None`, keeping the stored one when the argument is `UNSET`; `generic yearly_rows` untouched.
- [ ] **Step 4: implement `cost_providers.py`.** `resolve_write` rules: `requested is UNSET` -> `stored`; `requested == stored` -> `stored`; `requested is None` -> `None` if the stored provider is readable (or there is none), else `stored`; any other id must be in `candidate_providers` else `CostError("invalid_provider")`. Relation lookups use `Relation.type` and the relation's stored direction (Provider is the source end); status ACTIVE and `read_scope.where(Card, mode="module")` apply to the provider card only.
- [ ] **Step 5: run the service tests.** Expected: PASS.
- [ ] **Step 6: write the failing API tests.** `test_card_costs_api.py`: `test_put_item_with_provider_stores_it_and_returns_name`, `test_put_item_without_provider_key_keeps_the_stored_one`, `test_put_item_null_provider_clears_it`, `test_put_item_with_non_candidate_provider_is_400`, `test_get_costs_returns_provider_name_for_a_readable_provider_and_omits_an_unreadable_one`, `test_provider_candidates_lists_card_parent_child_providers`, `test_copy_to_forecast_keeps_the_provider`. `test_card_costs_permissions.py`: candidates endpoint 403 for a reader without edit right, 404 for a card the caller cannot read, 404 for a non-cost card type; PUT with provider by a caller with no edit right is 403. Import test: `test_import_resave_keeps_providers`.
- [ ] **Step 7: implement the schema and route changes.** PUT passes `body.provider_id if "provider_id" in body.model_fields_set else UNSET` and a `CardReadScope.load(db, user)`; `_out` receives the names map and blanks `provider_id` when the provider is not in it; the three read paths and `_write` resolve names with `provider_names`; `cost_import.py` is not changed.
- [ ] **Step 8: run the API tests** (`pytest tests/api/test_card_costs_api.py tests/api/test_card_costs_permissions.py -q`). Expected: PASS.
- [ ] **Step 9: commit** `feat(costs): a Provider on each cost item`.

---

### Task 2: Workspace transfer of the provider id

**Files:**
- Modify: `backend/app/services/workspace_io/sections.py` (the `CardCosts` section), `backend/app/services/workspace_io/remap.py`, `backend/tests/services/test_workspace_io_id_bearing_columns.py`
- Test: `backend/tests/services/test_workspace_io_id_remap.py`, `test_workspace_io_cost_items.py`

**Interfaces:**
- Consumes: `IdMap.lookup(CARDS, value)` (`remap.py`), `RewriteTally`, `RemapContext`.
- Produces: `remap.rewrite_card_costs_row(kwargs: dict, ctx: RemapContext) -> RewriteTally`, registered as `rewrite=` with `id_bearing_columns=("items",)` on the `CardCosts` `EntitySection`.

- [ ] **Step 1: write failing tests.** In `test_workspace_io_id_bearing_columns.py`: remove the `("CardCosts", "items")` entry from `ID_FREE_COLUMNS` and add `CardCosts` with `("items",)` to the expected map of `test_the_sections_that_hold_ids_are_the_known_ones`. In `test_workspace_io_id_remap.py`: `test_card_costs_provider_id_is_remapped_into_a_wiped_inventory` (export a workspace holding an Application with a costed item naming a Provider, wipe the cards, import: the item's `provider_id` equals the new Provider card id and no source id survives anywhere in `card_costs`), `test_card_costs_provider_absent_on_target_is_dropped_but_the_amount_stays`. Expected now: FAIL.
- [ ] **Step 2: implement `rewrite_card_costs_row`**: for each `items[key]` holding `provider_id`, replace it with `ids.lookup(CARDS, …)`; when there is no mapping drop the key and `tally.bump(UNRESOLVED)`; leave every other key and the amounts untouched.
- [ ] **Step 3: wire the section** and drop the `ID_FREE_COLUMNS` entry.
- [ ] **Step 4: run** `pytest tests/services/test_workspace_io_id_bearing_columns.py tests/services/test_workspace_io_id_remap.py tests/services/test_workspace_io_cost_items.py -q`. Expected: PASS.
- [ ] **Step 5: commit** `feat(workspace-transfer): remap the provider id inside card costs`.

---

### Task 3: Group by Provider (treemap and Sankey)

**Files:**
- Modify: `backend/app/services/cost_grouping.py`, `backend/app/services/cost_report.py`, `backend/app/services/cost_providers.py`, `backend/app/api/v1/reports.py`, and the response models for the two endpoints (`grep -n "CostTreemapResponse" backend/app/schemas`)
- Test: `backend/tests/services/test_cost_grouping.py`, `backend/tests/services/test_cost_providers.py`, `backend/tests/api/test_reports_cost_provider_group.py` (new), `backend/tests/api/test_reports_cost_sankey_parity.py`

**Interfaces:**
- Consumes: `CostLine.provider_id` (Task 1), `cost_report.item_costs_by_card`, `cost_report.is_item_field`.
- Produces:
  - `GroupBy.kind` gains `"provider"`; `parse_group_by(raw, field_keys, *, allow_provider: bool = False)` returns `GroupBy("provider", "")` for the exact string `provider` only when `allow_provider`; otherwise it is read as before (a bare unknown key is ignored). `assign_groups` raises `ValueError` for a provider grouping (it is not a card-level grouping).
  - `async cost_report.provider_splits(db, read_scope, card_ids: list[uuid.UUID], cost_field: str, target_fy: int, fy_start: int) -> tuple[dict[uuid.UUID, dict[str, dict[str, float]]], dict[str, str]]`: `{card_id: {group_key: {item_key: amount}}}` and `{group_key: provider name}`. Lines are all lines when `cost_field == DERIVED_KEY`, else only the line whose key equals `cost_field`; zero amounts skipped; a missing, deleted, unreadable or non-Provider id falls in `OTHER_GROUP`; archived providers keep their own group.
  - `cost_report.require_item_grouping(db, type_keys, cost_field)` raises `ValueError` unless every type is a cost-item type and `cost_field` is the item total or a catalogue item.
  - Treemap response: one `items` entry per (card, group) with the same `id`, `cost` = the share, `group` = the provider id or `__other__`; `groups` sums them; new `group_names: dict[str, str] | None` (present only for provider grouping).
  - Sankey: one `group:<id>` node per provider with `name` = the provider name (`__other__` stays `__other__`), links `item -> group` and `group -> card` per share; the card node keeps its whole `cost` and `costs`.

- [ ] **Step 1: write failing tests.** Service: `test_parse_group_by_provider_only_when_allowed`, `test_assign_groups_refuses_provider`, `test_provider_splits_group_items_by_provider_and_keep_the_total` (a card with two providers and an unassigned item), `test_provider_splits_same_name_two_providers_stay_apart`, `test_provider_splits_unreadable_or_deleted_provider_is_other`, `test_provider_splits_single_item_cost_field_counts_only_that_item`. API (`test_reports_cost_provider_group.py`): `test_treemap_group_by_provider_returns_one_entry_per_card_and_provider`, `test_treemap_provider_groups_sum_to_the_ungrouped_total`, `test_treemap_group_by_provider_on_initiative_is_400`, `test_treemap_group_by_provider_with_a_plain_cost_field_is_400`, `test_sankey_group_by_provider_parity_with_the_treemap` (extend the existing parity module's pattern), `test_sankey_provider_group_nodes_are_named_by_provider`, `test_licensing_report_does_not_accept_provider_grouping`, `test_cost_report_still_hides_costs_without_cost_access` (a card the caller cannot cost-view never enters a provider group). Expected: FAIL.
- [ ] **Step 2: implement the parser and `provider_splits`** (reuses `item_costs_by_card` for the year resolution and `cost_providers.provider_names` for names).
- [ ] **Step 3: treemap endpoint.** After `cards_with_cost_for_types` and the cost-access filter, when the grouping is `provider`: call `require_item_grouping` (400 on `ValueError`), build the entries from `provider_splits`, set `groups` and `group_names`; for any other grouping the code path is unchanged. Both endpoints call `parse_group_by(..., allow_provider=True)`; the licensing endpoint keeps the default.
- [ ] **Step 4: Sankey.** In `build_cost_sankey`, when the grouping is `provider`, take the per-card splits from `provider_splits` instead of `assign_groups`: group nodes by provider id, one `group -> card` link per share, `item -> group` flows summed per (item, group). The ungrouped and the other groupings keep their code.
- [ ] **Step 5: run** `pytest tests/services/test_cost_grouping.py tests/services/test_cost_providers.py tests/api/test_reports_cost_provider_group.py tests/api/test_reports_cost_sankey_parity.py tests/api/test_reports_cost_types.py -q`. Expected: PASS.
- [ ] **Step 6: commit** `feat(cost-report): group costs by Provider`.

---

### Task 4: Field and relation filters on the cost endpoints

**Files:**
- Create: `backend/app/services/cost_filters.py`
- Modify: `backend/app/services/cost_report.py`, `backend/app/api/v1/reports.py`, `backend/app/services/portfolio_payload.py`, `backend/app/api/v1/web_portals.py`
- Test: `backend/tests/services/test_cost_filters.py` (new), `backend/tests/api/test_reports_cost_filters.py` (new), `backend/tests/api/test_web_portals*.py` (the existing filter-options test must still pass unchanged)

**Interfaces:**
- Consumes: `portal_card_filters.normalise_card_filters`, `has_active_card_filters`, `preset_conditions(db, card_type, {"card_filters": value})`.
- Produces:
  - `cost_filters.MAX_FILTER_CHARS = 20000`.
  - `cost_filters.parse_card_filters(raw: str | None, type_keys: list[str]) -> dict[str, dict]`: JSON object `{type_key: CardFilterValue}`; a key outside `type_keys` is ignored; a malformed, non-object or oversized value raises `ValueError` (the route answers 400); each value is `normalise_card_filters`'d and dropped when `has_active_card_filters` is false.
  - `async cost_filters.filter_conditions(db, filters) -> dict[str, list[ColumnElement[bool]]]`.
  - `cards_with_cost(..., extra: Sequence[ColumnElement[bool]] = ())`, `_item_cards(..., extra)`, `cards_with_cost_for_types(..., conditions: Mapping[str, Sequence[ColumnElement[bool]]] | None = None)`, `build_cost_sankey(..., conditions=None)`: the clauses are added to the card `select` (item path and the current-year / history paths) beside `read_scope.where`.
  - Both endpoints take `card_filters: str | None = Query(None)`.
  - `portfolio_payload.filter_options_payload(db, user, type_key) -> dict` (the four keys `fields_schema`, `relation_types`, `groupable_types`, `tag_groups`; raises `LookupError` for an unknown or hidden type); `GET /web-portals/filter-options` calls it, behaviour unchanged.
  - `GET /reports/cost-filter-options?type=<key>` gated on `costs.view`, `type` must be Application or ITComponent (400 otherwise), returns the same payload under `CardReadScope`.

- [ ] **Step 1: write failing tests.** Service: `test_parse_ignores_a_type_that_is_not_selected`, `test_parse_drops_an_inactive_filter`, `test_parse_rejects_malformed_json_non_object_and_oversized`, `test_conditions_match_the_portal_evaluator` (attribute, subtype and relation filters give the same card set as `portal_card_filters.preset_conditions`). API: `test_treemap_attribute_filter_narrows_the_cards`, `test_treemap_relation_filter_matches_cards_linked_to_the_provider_not_item_providers`, `test_treemap_filter_applies_per_type_in_the_combined_view`, `test_sankey_and_treemap_see_the_same_filtered_cards`, `test_filter_combines_with_card_scope_and_fiscal_year` (a past year with the filter), `test_filter_cannot_reveal_a_hidden_card` (CardReadScope still wins), `test_bad_card_filters_is_400`, `test_cost_filter_options_requires_costs_view`, `test_cost_filter_options_rejects_a_non_cost_type`, `test_cost_filter_options_hides_cards_the_caller_cannot_read`. Expected: FAIL.
- [ ] **Step 2: implement the parser / conditions module and the `extra` plumbing.** The conditions are computed once per request and passed down; the evaluator is not copied.
- [ ] **Step 3: add the endpoints' parameter and the options endpoint**, extract `filter_options_payload`, switch the portal endpoint to it.
- [ ] **Step 4: run** `pytest tests/services/test_cost_filters.py tests/api/test_reports_cost_filters.py tests/api/test_web_portals.py tests/api/test_reports_cost_types.py -q` (use the real portal test file names from `ls tests/api | grep portal`). Expected: PASS.
- [ ] **Step 5: regenerate the spec**: `python scripts/dump_openapi.py`, commit `docs/api/openapi.json`.
- [ ] **Step 6: commit** `feat(cost-report): field and relation filters on the cost endpoints`.

---

### Task 5: Provider field in the Edit cost item dialog

**Files:**
- Modify: `frontend/src/features/cards/sections/CostItemDialog.tsx`, `frontend/src/types/index.ts` (`CostLine` gets `provider_id?: string | null`, `provider_name?: string | null`), `frontend/src/i18n/locales/en/cards.json` (English only)
- Test: `frontend/src/features/cards/sections/CostItemDialog.test.tsx`, `CostsSection.test.tsx` if it asserts the PUT body

**Interfaces:**
- Consumes: `GET /cards/{id}/cost-providers` -> `{id, name}[]`, `PUT .../items/{key}` body `{amount, renewal_date, provider_id?}`.
- Produces: no new exports.

- [ ] **Step 1: write failing tests.** `lists the candidate providers and a None option`; `shows the stored provider by provider_name even when it is not a candidate`; `omits provider_id from the PUT body when the field was not touched`; `sends provider_id when a provider is picked`; `sends provider_id null when None is picked`; `a 400 invalid_provider shows the error and keeps the dialog open`. Use `vi.mock("@/api/client")`.
- [ ] **Step 2: implement.** A plain MUI `TextField select` below the renewal date; options are the candidates plus the stored provider (by `provider_name`) when it is not among them; a `touched` flag decides whether `provider_id` is added to the PUT body (an untouched field is omitted so a hidden stored provider is never overwritten); the candidates are fetched with `useApiQuery` when the dialog opens. New keys under `costs.dialog.*` (`provider`, `providerNone`, `invalidProvider`).
- [ ] **Step 3: run** `cd frontend && npx vitest run src/features/cards/sections`. Expected: PASS.
- [ ] **Step 4: commit** `feat(costs): choose a Provider in the cost item dialog`.

---

### Task 6: Group by Provider in the report (composite keys)

**Files:**
- Create: `frontend/src/features/reports/costRowKey.ts`
- Modify: `CostReport.tsx`, `costTreemapOption.ts`, `costDrill.ts` (only if it keys on `it.id` for tiles; the card drill keeps filtering by card id on purpose), `CostTrendChart.tsx` (nothing to change unless it sends `group_by`; it only needs the filter parameter in Task 7), `frontend/src/types/index.ts` (`CostTreemapResponse.group_names?`, the item's `group`), `en/reports.json`
- Test: `costRowKey.test.ts` (new), `CostReport.test.tsx`, `costTreemapOption.test.ts`, `costDrill.test.ts`

**Interfaces:**
- Produces: `costRowKey(id: string, group: string | undefined, byProvider: boolean): string` returning `id` when not `byProvider`, else `` `${id}|${group ?? OTHER_GROUP}` ``.

- [ ] **Step 1: write failing tests.** `costRowKey.test.ts`: both branches and the `other` fallback. `CostReport.test.tsx`: `offers Provider in Group by for the Application, IT Component and combined views`; `group_by=provider is sent and tiles are one per card and provider`; `a tile click opens the card and right click drills into the tile's own provider group`; `the group legend names providers from group_names and keeps two same-name providers apart`; `the delta badge uses the baseline of the same card and provider` (the baseline and prior-year fetches carry `group_by=provider`); `the table shows one row per card and provider with the footer equal to the total`; `Sankey: a card hanging under two providers shows one node and two links, and takes the colour of its larger share`. `costTreemapOption.test.ts`: datum `id` is the row key and `cardId` the card id, handlers receive both.
- [ ] **Step 2: implement.** `groupOptions` adds `{ value: "provider", label: t("cost.groupByProvider") }` (all selectable types are item types); `effectiveGroupBy` accepts it; `groupLabel` returns `groupNames[raw]` when grouping by provider; `baselineCosts`, `priorYearCosts`, `colorPlan.cardColors`, table row keys and the treemap datum id use `costRowKey`; click handlers and `openCard`, `breakdown.get`, the card drill and `applyScope` keep using the plain card id; the baseline and prior-year fetches add `group_by`; `sankeyCards` emits one entry per (card, group link) from the links instead of one group per card.
- [ ] **Step 3: grep for every remaining `.id` keyed map in `features/reports/Cost*` and `cost*`** (`grep -n "\.id\b" frontend/src/features/reports/Cost*.tsx frontend/src/features/reports/cost*.ts`) and leave a one-line reason in the PR for each one kept on the card id.
- [ ] **Step 4: run** `npx vitest run src/features/reports` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: commit** `feat(cost-report): group by Provider in treemap, Sankey and table`.

---

### Task 7: Filter groups in the report

**Files:**
- Create: `frontend/src/features/reports/CostFilters.tsx`, `frontend/src/features/reports/costFilters.ts`
- Modify: `CostReport.tsx`, `CostTrendChart.tsx`, `useCostBreakdown.ts`, `en/reports.json`
- Test: `costFilters.test.ts` (new), `CostFilters.test.tsx` (new), `CostReport.test.tsx`, `CostTrendChart.test.tsx`, `useCostBreakdown.test.ts`

**Interfaces:**
- Consumes: `CardFilterSection`, `useCardFilterOptions`, `cardFilters.ts` (`EMPTY_CARD_FILTERS`, `restoreCardFilters`, `hasActiveFilters`), `GET /reports/cost-filter-options?type=`.
- Produces: `costFilters.ts`: `type CostCardFilters = Record<string, CardFilterValue>`; `costCardFiltersParam(filters: CostCardFilters, typeKeys: string[]): string | undefined` (JSON of the active filters of the selected types, `undefined` when none); `CostFilters` props `{ typeKeys: string[]; value: CostCardFilters; onChange(next: CostCardFilters): void; search?: never }` rendering one `CardFilterSection` per selected type, labelled with the type name.

- [ ] **Step 1: write failing tests.** `costFilters.test.ts`: `returns undefined when no filter is active`, `only includes selected types`, `drops include-sub-cards alone`. `CostFilters.test.tsx`: `renders one section per selected type`, `Application only shows no IT Component section`, `shows Provider among the Related by facets`, `changing a filter calls onChange with that type's value`. `CostReport.test.tsx`: `sends card_filters on the treemap, sankey, baseline, prior-year, breakdown and trend requests`, `a filter change resets the drill`, `the filter is saved with the report config and restored`, `toggling a type off stops sending its filter and keeps its stored value`. Expected: FAIL.
- [ ] **Step 2: implement.** State `cardFilters: CostCardFilters` next to `scopeIds`, persisted and restored in the report config (`restoreCardFilters` per type), reset by the page's reset; every call to `/reports/cost-treemap` or `/reports/cost-sankey` in `features/reports` (CostReport x4, `CostTrendChart.tsx:68`, `useCostBreakdown.ts:36`; confirm with `grep -rn "cost-treemap\|cost-sankey" frontend/src`) adds `card_filters` and the fetch keys include it; the drill resets when the filter changes; `CostFilters` goes beside the card-type toggle.
- [ ] **Step 3: run** `npx vitest run src/features/reports` and `npx tsc --noEmit` and `npx biome lint` on the touched files. Expected: PASS.
- [ ] **Step 4: commit** `feat(cost-report): field and relation filters`.

---

### Task 8: Manual, changelog, version, rules

**Files:**
- Modify: `docs/guide/reports.md` (cost report: Provider grouping, filters, legend text deferred from the legend PR), the card page that documents the Costs section (find with `grep -ln "Edit cost item\|cost item" docs/guide`), `scripts/screenshots/pages.ts` only if a new screenshot is added, `CHANGELOG.md`, `VERSION`
- Rules (each only after the user's explicit yes, one file at a time): `.claude/rules/cost-items.md`, `.claude/rules/cost-fiscal-year.md`, `.claude/rules/workspace-transfer.md`

- [ ] **Step 1: English manual text** for the Provider field (candidates, optional, one per item), Group by Provider (items split, "Unspecified"), the filter groups, and the legend behaviour from the previous PR; every screenshot reference is matched in `pages.ts` (docs rule).
- [ ] **Step 2: `VERSION` 2.214.0 (keep CRLF) and a `## [2.214.0] - 2026-11-25` changelog block** (Added: Provider on cost items, Group by Provider, cost report filters; Changed: workspace transfer carries the provider).
- [ ] **Step 3: run `/translate`, then `scripts/docs/docker-docs.sh all`** (the `docs-keeper` agent).
- [ ] **Step 4: after the review chain, the rules diff** is shown file by file for the user's yes.
- [ ] **Step 5: commit** `docs: Provider on cost items, grouping and filters`.

---

## After the tasks (project chain, in order)

`/translate` -> docs check -> tests on the diff only (`pytest` on the touched files and their imports, `vitest --changed main`, `tsc`, `ruff format` + `ruff check`, Biome) -> `code-simplifier` -> `code-reviewer` -> `security-reviewer` (two passes, both snapshots recorded by the main chat) -> rules review -> learnings question -> **`vapt` agent** (this PR adds a route, so `.claude/rules/vapt.md` requires it) -> PR on the fork with the template; the mutation score is read from CI and written in the Test Plan. No local mutation run.

## Agent's calls

- The candidates route is `GET /cards/{id}/cost-providers`, not under `/costs/{fiscal_year}` (avoids a path collision with the year parameter).
- `card_filters` is one query parameter holding JSON `{type_key: CardFilterValue}`; the facet options come from a new `GET /reports/cost-filter-options` gated on `costs.view`, because the portal endpoint needs `web_portals.manage`.
- In the Sankey a card under two providers is one node, coloured like its larger share.
- A tile's right click drills into the tile's own provider group; the card drill (breadcrumb) shows every share of that card.
- `group_by=provider` is refused (400) for any `cost_field` that is neither the item total nor a catalogue item.
- Spec coverage check: every spec section maps to a task (stored field, write semantics, candidates, validation, visibility, events, transfer: 1-2; group by: 3 and 6; filters: 4 and 7; docs, changelog, version: 8).
