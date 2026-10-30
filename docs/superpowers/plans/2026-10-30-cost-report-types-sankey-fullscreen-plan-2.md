# Cost report: types, combined view, Sankey parity, full screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Initiative and an "Application + IT Component" option to the cost report, make the Sankey behave like the treemap, show the history chart only on Forecast with its real cost components, and make full screen fill the screen.

**Architecture:** The treemap and Sankey endpoints share three new backend services (`cost_report.py` multi-type, `cost_components.py`, `cost_grouping.py`) so both views count a card's cost once and group it the same way. The frontend `CostReport.tsx` sends the same parameters to both endpoints; the Sankey drawing is the only difference. `FullscreenPanel` hands its children an `isFullscreen` flag so charts fill the screen.

**Tech Stack:** FastAPI, SQLAlchemy async, pytest; React 19, MUI 6, Recharts, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-30-cost-report-types-sankey-fullscreen-design.md` (approved). Earlier, built spec: `2026-10-29-cost-report-fiscal-year-picker-design.md`.

## Global Constraints

- Branch `fix/cost-report`; no push, no merge, no PR. Never branch off another branch.
- English only in code, `en/*.json` and docs; translations are done at the end by `/translate`, never by a task.
- `VERSION` 2.180.0 → **2.181.0** with a `## [2.181.0] - 2026-10-30` heading in `CHANGELOG.md` (done once, in Task 9).
- Backend SDK_VERSION 1.4 and UI_SDK_VERSION 1.18 are frozen: never touch them.
- Ruff (line length 100): `cd backend && ruff format . && ruff check .` before each backend commit.
- One pytest process at a time (shared test DB on port 5433). Mutation testing runs only in CI; never run it locally.
- A card's cost appears once in every total. A card with no group value goes to the group `__other__` (the page translates it). Archived cards never appear.
- `CardReadScope` (`mode="module"`) applies to every card read, for every type in a list.
- Fiscal-year names unchanged: `FY26 - Current`, `FY27 - Forecast`, `FY25`…

## Review Focus

- A user whose role hides one of the two types asks for the combined view: the hidden type's cards must not appear and the request must not fail.
- `type=Application,ITComponent,Bogus` or an empty entry (`type=Application,`): 400, no partial answer.
- A card linked to two group cards through an `n:m` relation: the relation is refused as a group (400), never silently picking one.
- A saved report with `groupBy: "businessCriticality"` (a bare field key) still loads, grouped by that field.
- The scope filter set on the Sankey hides those cards' nodes and leaves no dangling cost-item or group node.
- A saved report whose `groupBy` holds an old linked-type key (for example `BusinessCapability`): the page loads ungrouped, no error.
- An IT Component used by three applications in the combined Sankey: its cost appears once in the total.
- Forecast selected, then Card type switched: the history chart reloads with the new type's components.

---

### Task 1: Multi-type card selection with cost

**Files:**
- Modify: `backend/app/services/cost_report.py`
- Test: `backend/tests/services/test_cost_report.py`

**Interfaces:**
- Produces: `async def cards_with_cost_for_types(db, read_scope, type_keys: list[str], cost_field: str, target_fy: int, current_fy: int, fy_start: int) -> list[tuple[Card, float]]` — concatenates `cards_with_cost` per type, each card once, order by type list then as returned.
- Produces: `def parse_type_keys(raw: str) -> list[str]` — splits on commas, strips, rejects empty entries and duplicates with `ValueError`.

- [ ] **Step 1: Write failing tests** `test_cards_with_cost_for_types_joins_two_types` (one Application and one ITComponent card with costs → both returned, each once), `test_parse_type_keys_rejects_empty_entry` (`"Application,"` and `""` raise `ValueError`), `test_parse_type_keys_rejects_duplicate` (`"Application,Application"`), `test_hidden_type_is_omitted` (read scope hiding ITComponent → only the Application card).
- [ ] **Step 2:** Run `cd backend && python -m pytest tests/services/test_cost_report.py -q`. Expected: the four new tests FAIL (names not defined).
- [ ] **Step 3:** Implement both functions in `cost_report.py`; the second calls `cards_with_cost` per type, so the read scope and year rules are reused unchanged.
- [ ] **Step 4:** Same command. Expected: all pass.
- [ ] **Step 5:** Commit `feat(reports): cost report selects cards across several types`.

### Task 2: Cost components of a total

**Files:**
- Create: `backend/app/services/cost_components.py`
- Test: `backend/tests/services/test_cost_components.py`

**Interfaces:**
- Produces: `async def cost_components(db, type_keys: list[str], cost_field: str) -> list[str]` — the cost field keys that concur to `cost_field`. For each type: if an **active** `Calculation` has `target_type_key == type` and `target_field_key == cost_field`, the keys referenced as `data.<key>` in its `formula` that are `cost`-typed fields of the type; otherwise `[cost_field]` itself. For several types: the intersection, order of the first type; empty list if none shared.
- Produces: `def formula_field_refs(formula: str) -> list[str]` — pure; every `data.<key>` token in order of first appearance, no duplicates.

- [ ] **Step 1: Write failing tests**: `test_formula_field_refs_plain_sum` (`"present = data.a + data.b + data.c"` → `["a","b","c"]`), `test_formula_field_refs_ignores_non_data_names_and_duplicates`, `test_components_from_active_calculation`, `test_inactive_calculation_is_ignored_returns_field_itself`, `test_non_cost_field_in_formula_is_dropped`, `test_combined_types_intersect` (Application components `[a,b,c]`, ITComponent `[b,c,d]` → `[b,c]`), `test_formula_with_multiplication_still_lists_referenced_fields`.
- [ ] **Step 2:** Run `python -m pytest tests/services/test_cost_components.py -q`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement. Use a regex over `data\.([A-Za-z_]\w*)`; **write it with the Write/Edit tool, never through a Python string escape**. The cost-typed fields of a type come from `CardType.fields_schema` sections (`field["type"] == "cost"`).
- [ ] **Step 4:** Run again. Expected: pass.
- [ ] **Step 5:** Commit `feat(reports): read the cost fields that concur to a total from its calculation`.

### Task 3: Grouping rule

**Files:**
- Create: `backend/app/services/cost_grouping.py`
- Test: `backend/tests/services/test_cost_grouping.py`

**Interfaces:**
- Produces: `OTHER_GROUP = "__other__"`. The group value returned is **raw**: the option value for a select, `"true"`/`"false"` for a yes/no field, the linked card's name for a relation; the page translates labels.
- Produces: `class GroupBy` (frozen dataclass): `kind: Literal["field","relation"]`, `key: str`. `def parse_group_by(raw: str | None, field_keys: set[str]) -> GroupBy | None` — `field:<key>` or `rel:<relationTypeKey>`; a bare string that is one of `field_keys` (a saved report's old table grouping) is read as `field:<it>`; `None`/empty → `None`; anything else (an old linked-type key such as `BusinessCapability`) → `None` (graceful, per Review Focus).
- Produces: `async def assign_groups(db, read_scope, cards: list[Card], group_by: GroupBy | None) -> dict[uuid.UUID, str]` — group name per card id. `field`: `str(value)` of the card's attribute, missing/empty → `OTHER_GROUP`. `relation`: the name of the linked card (readable per `read_scope`); no link → `OTHER_GROUP`. Raises `ValueError` when the field is not a single-valued field of every card type present (multi-select, unknown key) or when the cards are not on the at-most-one end of the relation type. Read the way the relation guard reads it (`relations.py::_require_cardinality_room`, `AddRelationsDialog.tsx` `allowsMany`): `1:1` both ends qualify, `1:n` only the **source** end (each source has at most one target), `n:m` neither.
- Consumes: `Relation` rows, `RelationType.cardinality`, `CardType.fields_schema`.

- [ ] **Step 1: Write failing tests**: `test_field_group_returns_raw_option_value`, `test_missing_value_goes_to_other`, `test_multi_select_field_is_refused`, `test_relation_1n_groups_by_linked_card_name` (cards are the source end), `test_relation_1n_refused_from_the_target_end`, `test_relation_nm_refused`, `test_relation_without_link_goes_to_other`, `test_hidden_linked_card_counts_as_no_link` (read scope hides the group card → `Other`), `test_old_linked_type_key_parses_to_none`, `test_bare_field_key_parses_as_field`, `test_costs_never_duplicated` (every card id appears exactly once in the result).
- [ ] **Step 2:** Run `python -m pytest tests/services/test_cost_grouping.py -q`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement per the Interfaces block. A card linked twice through a `1:1`/`1:n`-compliant relation cannot occur by definition; if bad data does, take the first by link id and do not duplicate.
- [ ] **Step 4:** Run again. Expected: pass.
- [ ] **Step 5:** Commit `feat(reports): group cost by a card field or an at-most-one linked card`.

### Task 4: Treemap endpoint — several types, new grouping, components

**Files:**
- Modify: `backend/app/api/v1/reports.py` (`cost_treemap`, lines ~1418–1516)
- Test: `backend/tests/api/test_reports_cost_types.py` (new), update `backend/tests/api/test_reports_extended.py` where it asserts the old linked-type `group_by`
- Regenerate: `docs/api/openapi.json` via `python scripts/dump_openapi.py`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `GET /reports/cost-treemap?type=<a[,b]>&cost_field=&group_by=<field:k|rel:k>&fiscal_year=`; each item gains `"type"`; response gains `"components": list[str]` (Task 2) and keeps `groups`, `fiscal_year`, `current_fiscal_year`, `fiscal_year_start`. `group_by` items carry `"group"`; every item has a group (`Other` as needed). 400 on a bad `type` list, a type without cost fields, or a refused `group_by`.

- [ ] **Step 1: Write failing API tests**: `test_two_types_return_both_with_type`, `test_single_type_unchanged`, `test_bad_type_list_is_400` (`Application,`, `Application,Bogus`), `test_hidden_type_cards_omitted_for_restricted_reader` (403/404 not raised; ITComponent card absent), `test_group_by_field_other_bucket` (`__other__`), `test_group_by_nm_relation_is_400`, `test_group_by_old_type_key_is_ignored`, `test_initiative_type_accepted_with_cost_budget`, `test_components_follow_active_calculation`, `test_no_cost_permission_is_403`.
- [ ] **Step 2:** Run `python -m pytest tests/api/test_reports_cost_types.py -q`. Expected: FAIL.
- [ ] **Step 3:** Rewire the handler: parse `type` with `parse_type_keys`, call `cards_with_cost_for_types`, then `parse_group_by` + `assign_groups`, then `cost_components`. Remove the old linked-type block. Update `backend/tests/api/test_reports_extended.py` (it asserts `"Ungrouped"`, now `__other__`) and the MCP tool `get_cost_treemap` (`mcp-server/turbo_ea_mcp/server.py` ~574–606: describe `group_by` as `field:<key>` / `rel:<key>`; fix `mcp-server/tests/test_server.py` ~334–341 and the MCP docs under `docs/admin/mcp*.md`). Update the docstring (the project documents the parameter there).
- [ ] **Step 4:** Run the new file, `tests/api/test_reports_extended.py`, `tests/api/test_reports_cost_fiscal_year.py`, then `python scripts/dump_openapi.py` and `git diff --stat docs/api/openapi.json`. Expected: all pass; spec changed.
- [ ] **Step 5:** `ruff format . && ruff check .`; commit `feat(reports): cost treemap spans types and groups by a field or a linked card`.

### Task 5: Sankey endpoint like the treemap

**Files:**
- Modify: `backend/app/api/v1/reports.py` (`cost_sankey`, lines ~1519–1645)
- Test: `backend/tests/api/test_reports_cost_sankey_parity.py` (new), rewrite `backend/tests/api/test_reports_cost_sankey.py` (12 calls, all on the Application→ITComponent model)
- Regenerate: `docs/api/openapi.json`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `GET /reports/cost-sankey` takes the **same parameters as the treemap** (`type`, `cost_field`, `group_by`, `fiscal_year`). Nodes `{id, name, type}` where `type` is a card type key, `"CostItem"` for a cost-item node, or `"Group"`. Links: without a Group by, cost item → card (value = that field's cost on that card). With a Group by the group nodes sit **in the middle**: cost item → group (value = the sum of that item over the group's cards) and group → card (value = the card's total over the items); every card is in exactly one group, `__other__` included. The cost items are `cost_components(...)` of `cost_field` (a single node `cost_field` when it has no components); a card's items come from `cards_with_cost_for_types` run once per component field. Response keeps `total` (sum of item→card links, equal to the treemap total for the same parameters when the card totals equal the sum of their items), `fiscal_year`, `current_fiscal_year`, `fiscal_year_start`.
- There is no Application↔ITComponent flow and no `app_to_itc` read any more.

- [ ] **Step 1: Write failing tests**: `test_same_cards_as_treemap` (same parameters → the set of card nodes equals the treemap item ids), `test_total_equals_treemap_total_for_a_plain_sum`, `test_itcomponent_used_by_three_apps_counted_once`, `test_single_field_shows_one_cost_item`, `test_total_field_shows_each_component_as_item`, `test_grouped_puts_group_nodes_between_items_and_cards` (no link goes card → group; every item→group value equals the sum of its group→card shares), `test_grouped_other_bucket`, `test_year_and_forecast_use_history`, `test_bad_group_by_is_400`.
- [ ] **Step 2:** Run `python -m pytest tests/api/test_reports_cost_sankey_parity.py -q`. Expected: FAIL.
- [ ] **Step 3:** Rewrite the handler as a thin controller over a new function `build_cost_sankey(...)` placed in `backend/app/services/cost_report.py` (business logic stays out of the route). Delete the old two/three-level code and its docstring.
- [ ] **Step 4:** Run the new file plus `python -m pytest tests/api -q -k "cost or sankey"`, regenerate OpenAPI. Expected: pass.
- [ ] **Step 5:** `ruff format . && ruff check .`; commit `feat(reports): cost Sankey takes the treemap's parameters and counts each cost once`.

### Task 6: Frontend selectors — types, combined option, group by

**Files:**
- Modify: `frontend/src/features/reports/CostReport.tsx`
- Create: `frontend/src/features/reports/costReportOptions.ts` (pure helpers) + `costReportOptions.test.ts`
- Modify: `frontend/src/types/index.ts` only if a type is needed; `frontend/src/i18n/locales/en/reports.json`
- Test: `CostReport.test.tsx`, `CostReport.branches.test.tsx` (adjust the Sankey-toolbar expectations)

**Interfaces:**
- Produces in `costReportOptions.ts`: (schemas are `{fields: FieldDef[]}[][]`, one schema per type, as `pickGroupableFields` takes) `COMBINED_KEY = "Application+ITComponent"`; `typeKeysOf(selection: string): string[]` (splits on `+`); `typeParam(selection): string` (joins with `,`); `commonCostFields(schemas: FieldDef[][]): FieldDef[]` (cost-typed fields whose key exists in every schema); `commonGroupableFields(schemas)` (single-valued fields with the same key in every schema, using the existing `pickGroupableFields`); `relationGroupOptions(relationTypes: RelationType[], typeKeys: string[], label)` → `{value: "rel:<key>", label}[]`, only for a **single** type (empty for the combined option), for relations with the card on the at-most-one end (`1:1` either end, `1:n` the **source** end).
- The Card type selector offers: Application, IT Component, Application + IT Component, Initiative (only those the user may read; the combined option only when both are readable).
- Cost field selector is shown in table, treemap **and** Sankey, listing `commonCostFields`; resets to the first option when the list changes (existing behaviour).
- Group by selector is shown in all three views, built from `commonGroupableFields` (value `field:<key>`) plus `relationGroupOptions`; disabled with a short helper text when the list is empty. A saved `groupBy` that is a bare field key becomes `field:<key>`; one not in the list is dropped.
- The combined option has no `typeDef`: `costFields`/`groupableFields` come from the helpers over both schemas; the card scope filter and the custom table columns are hidden for it (`useCardScope` takes one type); `extraColumns` stay empty.
- **All four fetches** (main, Sankey, baseline ~line 515, prior year ~line 551) send `type=<typeParam>`.
- Group labels: the server value is translated by the page — option label via `optLabel`, `true`/`false` via `common:labels.yes/no`, `__other__` via `t("cost.unspecified")`, a linked card name as is.
- The treemap with a Group by draws groups as parent nodes containing their cards (Recharts hierarchical `children`).
- The card scope filter on the Sankey is applied client-side: filtered cards' nodes are removed together with the links and cost-item/group nodes left without any card.
- Both fetches send `type=<typeParam>`, `cost_field`, `group_by`, `fiscal_year`; the table groups by the server `group` field (the old client-side attribute grouping is removed so the three views agree). Also tests: `group labels are translated`, `treemap draws groups`, `sankey scope filter removes dangling nodes`, `combined hides scope filter and extra columns`, `all four requests carry type=Application,ITComponent`.

- [ ] **Step 1: Write failing tests** for the pure helpers (`commonCostFields` keeps only shared keys; `relationGroupOptions` refuses `n:m`, accepts `1:n` target side and `1:1`, requires the relation for every type) and component tests: `offers initiative and combined option`, `sankey shows the same toolbar as the treemap`, `group by is disabled with no common option`, `group by sends field: prefix`, `a saved groupBy that is not offered is dropped`, `combined option sends type=Application,ITComponent`.
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/features/reports/costReportOptions.test.ts src/features/reports/CostReport.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement; labels through `useTypeLabel`/`useFieldLabel`/`useRelationLabel` (never `.key` fallbacks); new strings in `en/reports.json` only (`cost.combinedType`, `cost.groupByNone`, `cost.groupByUnavailable`). Remove `view !== "sankey"` guards on Card type, scope and Cost field; keep the existing print-parameters line in step.
- [ ] **Step 4:** Run the whole `src/features/reports` folder with `npx vitest run src/features/reports`. Expected: pass.
- [ ] **Step 5:** `npm run lint`; commit `feat(reports): cost report offers Initiative, a combined type and one set of filters`.

### Task 7: Sankey drawing for the new payload

**Files:**
- Modify: `frontend/src/features/reports/CostReport.tsx` (create a custom Sankey node renderer — today `<Sankey>` uses Recharts' default node — coloured by `type`, with the group column in the middle)
- Test: `CostReport.test.tsx`

- [ ] **Step 1: Write failing test** `renders cost item, group and card nodes from the payload, groups between` (mock `/reports/cost-sankey` with the Task 5 shape; assert node names are present and an empty payload shows `cost.noCostData`).
- [ ] **Step 2:** Run the file. Expected: FAIL.
- [ ] **Step 3:** Write the custom node renderer (new) to colour `CostItem`, `Group` and card nodes distinctly with tokens from `frontend/src/theme/tokens.ts`; no hex codes.
- [ ] **Step 4:** Run `npx vitest run src/features/reports`. Expected: pass.
- [ ] **Step 5:** Commit `feat(reports): draw cost items, cards and groups in the Sankey`.

### Task 8: History chart on Forecast only, with real components; full screen

**Files:**
- Modify: `frontend/src/features/reports/CostTrendChart.tsx`, `CostReport.tsx`, `FullscreenPanel.tsx`
- Test: `CostTrendChart.test.tsx`, `FullscreenPanel.test.tsx`, `CostReport.test.tsx`, `CostReport.mutation.test.tsx`, `CostReport.fixes.test.tsx` (stale expectations)

**Interfaces:**
- `CostTrendChart` props: `{ typeParam: string; costField: string; components: string[]; years: number[]; currentFiscalYear: number }`; one request per year per component (`/reports/cost-treemap?type=…&cost_field=<component>&fiscal_year=<y>`); one stacked `Bar` per component, `dataKey` = the technical field key, legend and tooltip show that key; colours from a token palette cycled by index.
- `CostReport` shows the chart only while `showForecast` (Forecast selected) and `components.length > 0`; `components` come from the treemap response (`r.components`) stored beside `rawItems`.
- `FullscreenPanel` children become `ReactNode | ((isFullscreen: boolean) => ReactNode)`. In full screen the panel is `height: 100vh`, `display: flex`, `bgcolor: background.default`, padding 2; the chart wrapper is `flex: 1, minHeight: 0` and the `ResponsiveContainer` height is `"100%"`; outside full screen the height stays 450. Applies to treemap and Sankey.

- [ ] **Step 1: Write failing tests**: `chart hidden on Current and on a past year`, `chart shown on Forecast with one bar per component and key legend`, `chart refetches when the card type changes`, `fullscreen panel passes isFullscreen to a function child` (dispatch `fullscreenchange` with a mocked `document.fullscreenElement`), `treemap container is 100% high in fullscreen and 450 otherwise`.
- [ ] **Step 2:** Run `npx vitest run src/features/reports`. Expected: FAIL.
- [ ] **Step 3:** Implement; update the stale expectations in `CostReport.mutation.test.tsx` and `CostReport.fixes.test.tsx` that assume the chart on every non-Current year.
- [ ] **Step 4:** Run `npx vitest run src/features/reports`, then `npm run lint && npm run build`. Expected: pass, build clean.
- [ ] **Step 5:** Commit `feat(reports): history chart on Forecast with real cost components; full screen fills`.

### Task 9: Docs, version, rules, final suite

**Files:**
- Modify: `docs/guide/reports.md`, `.claude/rules/card-flags-cost-eol.md`, `CHANGELOG.md`, `VERSION`, `scripts/screenshots/pages.ts` only if a cost-report screenshot entry exists (then also its doc reference)
- Modify: `docs/superpowers/specs/2026-10-30-cost-report-types-sankey-fullscreen-design.md` (add `**Shipped:**` only after merge — not now)

- [ ] **Step 1:** Update the cost-report section of `docs/guide/reports.md` (English only): Initiative, combined option, group by rules, Sankey parity, history on Forecast, full screen. Update the rule file's cost paragraph (new endpoint parameters, `components`, grouping service names).
- [ ] **Step 2:** Bump `VERSION` to `2.181.0`; add the `## [2.181.0] - 2026-10-30` changelog heading with **Added** (Initiative, combined view, group by on all views) and **Changed** (Sankey like the treemap, history chart on Forecast with its components, full screen) — single-line user-facing entries.
- [ ] **Step 3:** Run `/graphify . --update --mode deep` only after asking the user (repo rule: before the full suite; the user is asked, never skipped). Then `./scripts/test.sh` and `cd frontend && npm run test:run`. Expected: green.
- [ ] **Step 4:** Commit `docs: cost-report types, Sankey parity and full screen, version 2.181.0`.
- [ ] **Step 5:** Then, in order, with fresh agents: `ponytail-review`, `security-review`, `/translate`. Fix Must/Should findings, rerun the suites, commit.
