# Card Cost Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cost of an Application or IT Component a standard card object: a TCO that is the sum of admin-catalogued cost items (amount + renewal date) per fiscal year, shown and edited in a Costs section with a ‹ › year navigator.

**Architecture:** Two new tables: a global catalogue `cost_item_types` (registry, modelled on `card_type_categories`) and `card_costs` (one row per `(card_id, fiscal_year)`, items as JSONB keyed by item key). A service `card_costs.py` is the single place that computes TCO, fallback, confirm, copy-to-forecast. `attributes.costTotalAnnual` stays as a derived, read-only copy written by that service. The cost report reads items for the two types and keeps `card_cost_history` for every other type.

**Tech Stack:** FastAPI, SQLAlchemy async, Alembic (next revision `175`), Pydantic, pytest; React 19, MUI 6, ECharts, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-card-cost-items-design.md` (mockups in `docs/superpowers/specs/2026-11-03-card-cost-items-assets/`). Where plan and spec differ, the spec wins.

## Global Constraints

- Branch `feat/cost-history-in-card`, every change through a PR; never edit `CLAUDE.md`, `.claude/rules/**`, `AGENTS.md`.
- Cost-bearing types: `Application`, `ITComponent` — one constant per side (`backend/app/services/card_costs.py::COST_ITEM_TYPES`, `frontend/src/lib/costItems.ts::COST_ITEM_TYPES`), mirrored like `EOL_TYPES`.
- Amounts are always annual, one currency, no period. Renewal "near" = within 90 days, one constant `RENEWAL_NEAR_DAYS = 90`.
- Catalogue keys are stable; seeded keys keep the old spelling: `softwareLicensingCost`, `applicationManagementServicesCost`, `infrastruttureCost`, plus `other` ("Other costs").
- Archived item: cannot be added; still counts in TCO, in the section and in reports.
- Window: GET/section `current-4 … current+1`; PUT keeps `current-5 … current+1` (`FISCAL_YEAR_LOOKBACK`/`LOOKAHEAD` in `fiscal_year.py`).
- Gates: read = `costs.view` + `CardReadScope` (module mode; hidden card = 404); write = the gate `PUT /cards/{id}/cost-history` uses today; catalogue write = `admin.metamodel`.
- `costTotalAnnual` stays a `cost`-typed read-only field of both types; admin cannot delete/retype it there; `sync_current_fy_history` skips both types.
- SDK constants stay `SDK_VERSION` 1.5 / `UI_SDK_VERSION` 1.19. Do not bump.
- `async def` handlers, ORM only, no raw SQL, route handler delegates to a service, new routes registered in `router.py`, `docs/api/openapi.json` regenerated.
- English only for authored strings (`frontend/src/i18n/locales/en/*.json`, docs without locale suffix); translations come from `/translate` before the PR. Do not open non-English locale files.
- Tests required for every task; mutation score comes from CI only — never run `mutmut`/`stryker` locally. Before each backend commit: `cd backend && ruff format . && ruff check .` (check ruff's own exit code, do not pipe it).
- Version `2.188.0` (minor) + `CHANGELOG.md` entry, written in the last task.

## Review Focus

1. A card with items in FY26 and **no row** in the new FY (first day after rollover): section, report and `costTotalAnnual` show the FY26 items marked not confirmed; an **empty row** does not fall back (Task 3, 5).
2. Fiscal-year start month saved or year rolls over with no card write: the derived `costTotalAnnual` is recomputed (Task 5).
3. Admin archives or renames an item that past years use: every historic TCO and report total is unchanged; archived item still listed as its own report component (Task 3, 6).
4. Migration on every combination: breakdown fields present/absent, calculation present/absent, only `costTotalAnnual`, total below sum of details, history row at `current-5` (Task 2).
5. Caller without `costs.view` or without read scope: no amount, renewal date or item name leaks via the section, the report or the derived copy; hidden card is 404 (Task 4, 6).

---

### Task 1: Models, catalogue service and catalogue API

**Files:**
- Create: `backend/app/models/cost_item_type.py`, `backend/app/models/card_cost.py`, `backend/app/services/cost_item_types.py`, `backend/app/schemas/cost_items.py`
- Modify: `backend/app/models/__init__.py` (import both), `backend/app/api/v1/metamodel.py` (catalogue routes next to the categories routes, ~line 3316+), `backend/app/services/audit_labels.py`
- Create: `backend/alembic/versions/175_card_cost_items.py` (tables only in this task; data steps added in Task 2)
- Test: `backend/tests/services/test_cost_item_types.py`, `backend/tests/api/test_cost_item_types_api.py`

**Interfaces:**
- Produces models: `CostItemType(key: str unique, label: str, sort_order: int, archived: bool, translations: JSONB)` (`UUIDMixin`, `TimestampMixin`); `CardCost(card_id FK cards.id ondelete CASCADE, fiscal_year: int, items: JSONB default {})`, unique `(card_id, fiscal_year)`, index on `card_id`. `items` shape: `{item_key: {"amount": number, "renewal_date": "YYYY-MM-DD" | null}}`.
- Produces service (`cost_item_types.py`): `list_items(db, include_archived=True) -> list[CostItemType]`, `create_item(db, key, label, translations) -> CostItemType`, `update_item(db, key, label=None, translations=None, archived=None, sort_order=None)`, `serialize(row) -> dict`, `class CostItemError(Exception)` with `.code in {"invalid_key","duplicate_key","not_found"}`. Key never changes after create; there is no delete.
- Produces routes (all under metamodel router, `admin.metamodel` for writes, any authenticated user for GET): `GET /metamodel/cost-item-types`, `POST /metamodel/cost-item-types`, `PATCH /metamodel/cost-item-types/{key}`. Key regex `^[A-Za-z][A-Za-z0-9_]{0,63}$`.

- [ ] **Step 1: Write failing tests.** Service: create ok, duplicate key → `CostItemError("duplicate_key")`, key regex rejects `"1x"` and `"a b"`, `update_item(archived=True)` keeps the row and `list_items(include_archived=False)` hides it, key unchanged by update. API: GET 200 for an authenticated user, POST/PATCH 403 without `admin.metamodel`, POST 409 on duplicate, POST 422 on bad key.
- [ ] **Step 2: Run** `cd backend && python -m pytest tests/services/test_cost_item_types.py tests/api/test_cost_item_types_api.py -q`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** models, migration table creation (both `created_at`/`updated_at` columns with `server_default=sa.func.now()`), service, schemas, routes (permission via `require_permission("admin.metamodel")`), `audit_labels` entry modelled on `CardTypeCategory`'s (written for a person: label not key). Models import in `__init__.py`.
- [ ] **Step 4: Run** the same command plus `python -m pytest tests/services/test_route_auth_guard.py tests/services/test_audit_labels*.py -q`. Expected: PASS (if the auth guard lists routes, add none to `PUBLIC`; the routes are authenticated).
- [ ] **Step 5: Commit** `feat(costs): cost item catalogue model, service and API`.

### Task 2: Data migration (fields → items, history → rows)

**Files:**
- Modify: `backend/alembic/versions/175_card_cost_items.py` (add data steps + `downgrade`)
- Create: `backend/app/services/cost_items_migration.py` (pure functions the migration calls, so they are unit-testable without Alembic)
- Test: `backend/tests/services/test_cost_items_migration.py`

**Interfaces:**
- Produces in `cost_items_migration.py`:
  - `build_current_year_items(attributes: dict, item_keys: list[str], total_key="costTotalAnnual") -> dict[str, dict]` — items from the breakdown keys present in `attributes`, residual `other = total − sum(details)` only when positive; when only `costTotalAnnual` exists, whole total goes to `other`; zero/absent amounts produce no item.
  - `build_past_year_items(history: dict[str, float], item_keys: list[str]) -> tuple[dict[str, dict], float, bool]` — `history` maps field key → amount for one year; returns `(items, new_tco, changed)`; `changed=True` when details exceed total or only details exist (feeds the report).
  - `MIGRATED_TYPES = ("Application", "ITComponent")`.
- Migration style: Alembic runs on a sync connection, so follow `168_it_component_cost_parity.py`: local SQLAlchemy Core table definitions and `sqlalchemy.sql.text`/`op`, no `app.models` import, no async helpers. Read `fiscalYearStart` from `app_settings.general_settings` with a sync query and use the pure `fiscal_year._fiscal_year`/`fiscal_year_for` for the arithmetic. The tests call `upgrade()` body through a sync engine fixture (or the pure functions plus one end-to-end test that runs Alembic `upgrade 175` on the test database); state which one in the test file docstring. The per-year report (card id, year, old total, new TCO) is both logged at WARNING and written to a table-less durable place: `app_settings.general_settings["cost_items_migration_report"]` (key-scoped write), so it survives the container log.
- Migration behaviour (spec "What migrates", "The migration confirms the current year"): seed catalogue items (three old keys with clean labels + `other`; plus one item per any other `cost`-typed field found on the two types' `fields_schema` except `costTotalAnnual`); for every card of the two types write a `card_costs` row for the current fiscal year from `attributes` (empty `{}` if no cost); past years and `current+1` from `card_cost_history`, discarding the current-year history row; write `attributes.costTotalAnnual` = current TCO; remove the breakdown fields and the Calculation that sums them from the two types' `fields_schema` (a Calculation is removed only if its formula references only those keys); log a migration report line per changed year (card id, year, old total, new TCO). Idempotent guard: skip if `card_costs` already has rows. `downgrade` drops the two tables and leaves `attributes`/history untouched.

- [ ] **Step 1: Write failing tests** for the two pure functions with these cases: details 100+40+20 and total 200 → `other` 40; total 100 and details sum 120 → no `other`, `changed=True`; only total 90 → `other` 90; nothing → `{}`; history with only details → `new_tco` = sum, `changed=True`; breakdown keys absent but `costTotalAnnual` present (fresh install). Add an API-free migration test using the DB session fixture: seed two cards + a Calculation + fields, run the migration function body, assert rows, derived `costTotalAnnual`, removed fields, that a card with no cost gets an empty current-year row, and that a second run changes nothing.
- [ ] **Step 2: Run** `python -m pytest tests/services/test_cost_items_migration.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the service functions and wire `upgrade()`/`downgrade()` in the revision. Use the fiscal-year helpers in `fiscal_year.py` (`get_fiscal_year_start`, `current_fiscal_year`) via the migration's connection; no raw SQL — use the ORM models with a session bound to the migration connection.
- [ ] **Step 4: Run** the test file, then `python -m pytest tests/ -q -k "migration or alembic"`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(costs): migrate cost fields and history into cost items`.

### Task 3: Card costs service (TCO, fallback, confirm, copy-to-forecast)

**Files:**
- Create: `backend/app/services/card_costs.py`
- Test: `backend/tests/services/test_card_costs.py`

**Interfaces:**
- Consumes: `CardCost`, `CostItemType` (Task 1); `fiscal_year.current_fiscal_year`, `get_fiscal_year_start`.
- Produces:
  - `COST_ITEM_TYPES: frozenset[str] = frozenset({"Application", "ITComponent"})`, `RENEWAL_NEAR_DAYS = 90`.
  - `@dataclass YearCosts(fiscal_year: int, is_current: bool, is_forecast: bool, confirmed: bool, fallback_from: int | None, items: list[CostLine], tco: float)`; `@dataclass CostLine(key, amount, renewal_date: date | None, archived: bool)`.
  - `async def get_year_costs(db, card_id, fiscal_year, start_month) -> YearCosts` — row present (even empty) → `confirmed=True`; no row and `fiscal_year == current` (only the current year, never the Forecast): most recent earlier row's items with renewal dates moved forward by the years skipped, `confirmed=False`, `fallback_from=<year>`; no earlier row → empty; a past year or the Forecast year with no row → empty, never falls back.
  - `async def get_window(db, card_id, start_month) -> list[YearCosts]` (six years `current-4 … current+1`).
  - `async def upsert_item(db, card_id, fiscal_year, key, amount, renewal_date) -> YearCosts` — rejects unknown or archived key for a **new** item (`CostError("archived_item")`, `("unknown_item")`), allows editing an existing archived one's amount; if the year is in fallback, first materialises the fallback set into the row; negative amount → `CostError("invalid_amount")`; PUT window enforced `current-5 … current+1` (`CostError("year_out_of_range")`).
  - `async def delete_item(db, card_id, fiscal_year, key)`, `async def get_year_row(db, card_id, fiscal_year, start_month) -> YearCosts` (any single year, no window limit; backs the readable `current-5` row), `async def confirm_year(db, card_id, fiscal_year) -> YearCosts` (materialise fallback only), `async def copy_to_forecast(db, card_id, from_year, key) -> YearCosts` (overwrites the forecast item; renewal date shifted by `forecast − from_year` years; Feb 29 → Feb 28; an archived item may be copied when it already has an amount in `from_year`, since it is not a new addition).
  - `async def recompute_derived(db, card: Card) -> None` — writes the current-year TCO (fallback included) into `card.attributes["costTotalAnnual"]` (new dict assigned so JSONB change is detected); no commit.
  - `class CostError(Exception)` with `.code`.
- Helper `tco(items) -> float` sums amounts of all lines, archived included.

- [ ] **Step 1: Write failing tests**: sum with an archived item still counted; empty row vs no row (Review Focus 1); Forecast year with no row stays empty even when the current year has items; copy of an archived item that has an amount in the source year succeeds; fallback renewal date moved +1 year (`2026-12-31` → `2027-12-31`) and +2 when two years skipped; past year without row stays empty; first edit in a fallback year materialises the whole set then applies the edit; `confirm_year` stores unchanged amounts; add archived item → `archived_item`; edit existing archived item allowed; `copy_to_forecast` overwrites and shifts; Feb 29 case; window rejects `current-6` and `current+2`; `recompute_derived` equals fallback TCO in a fallback year.
- [ ] **Step 2: Run** `python -m pytest tests/services/test_card_costs.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** `card_costs.py` using ORM only; renewal dates stored as ISO strings in the JSON.
- [ ] **Step 4: Run** the test file. Expected: PASS.
- [ ] **Step 5: Commit** `feat(costs): card costs service`.

### Task 4: Card costs API

**Files:**
- Create: `backend/app/api/v1/card_costs.py` (schemas added to `backend/app/schemas/cost_items.py`)
- Modify: `backend/app/api/v1/router.py` (register), `docs/api/openapi.json` (regenerate with `scripts/dump_openapi.py`)
- Test: `backend/tests/api/test_card_costs_api.py`

**Interfaces:**
- Routes: `GET /cards/{card_id}/costs` → `{years: [YearCostsOut × 6], catalogue: [CostItemTypeOut]}` (needs `costs.view`; 404 when `CardReadScope(mode="module")` hides the card or the type is not in `COST_ITEM_TYPES`); `PUT /cards/{card_id}/costs/{fiscal_year}/items/{key}` body `{amount: float, renewal_date: date | null}`; `DELETE` same path (204); `POST /cards/{card_id}/costs/{fiscal_year}/confirm`; `POST /cards/{card_id}/costs/{fiscal_year}/items/{key}/copy-to-forecast`. Writes use the same gate and loader the old `PUT /cards/{id}/cost-history` uses (`_load_card_for_edit`), plus `costs.view`; every write ends with `recompute_derived`, commits once, and publishes a card event (`event_bus.publish(..., db=db, card_id=...)`, `changes` `{costTotalAnnual: {old,new}}` plus `cost_items: {"old": [keys], "new": [keys]}` — item keys only, never amounts or renewal dates, so history and SSE leak nothing to a caller without `costs.view`) — it moves `cards.updated_at`. `GET /cards/{card_id}/costs/{fiscal_year}` returns one `YearCostsOut` for any year (reads the `current-5` row), same gates.
- `CostError.code` → HTTP: `unknown_item`/`archived_item`/`invalid_amount`/`year_out_of_range` → 422 (409 for `archived_item`), card not cost-bearing → 404.

- [ ] **Step 1: Write failing tests** (use `create_user`, `create_card_type`, `create_card`; seed catalogue rows through the Task 1 service): GET 200 with six years; GET 403 without `costs.view`; GET 404 for a hidden card and for a type outside `COST_ITEM_TYPES`; PUT happy path updates `attributes.costTotalAnnual`; PUT 403 without the edit gate; PUT 422 negative amount; PUT 409 archived new item; DELETE; confirm; copy-to-forecast; a write writes one card event (Review Focus 5: response of a user without `costs.view` contains no amount); the event written by a PUT carries item keys only, and the event history read without `costs.view` shows no amount or date; `GET .../costs/{current-5}` returns the migrated row.
- [ ] **Step 2: Run** `python -m pytest tests/api/test_card_costs_api.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the router as a thin controller over `card_costs.py`; add the router to `router.py`; run `python scripts/dump_openapi.py` (path as in `.claude/rules/api-contracts.md`) and commit the result.
- [ ] **Step 4: Run** the test file + `python -m pytest tests/services/test_route_auth_guard.py tests/services/test_card_read_scope_guard.py tests/api/test_openapi*.py -q`. Expected: PASS (add the new GET to whatever the read-scope guard requires: it takes the scope).
- [ ] **Step 5: Commit** `feat(costs): card costs API`.

### Task 5: Keep the derived `costTotalAnnual` honest

**Files:**
- Modify: `backend/app/api/v1/cost_history.py` (`PUT`/`DELETE /cards/{id}/cost-history…` answer 409 `use_cost_items` for `COST_ITEM_TYPES`; `GET` keeps working, read-only legacy), every direct writer of `card.attributes` outside `card_write_service` (first run `grep -rn "\.attributes = \|attributes\[" backend/app/services backend/app/api` and handle at least `servicenow_service.py` (~832), `survey_apply.py`, `extensions/data_service.py`, `catalogue_common.py`, `workspace_io/applier.py`, and `recalculate_and_rescore`: each calls `recompute_derived` for a `COST_ITEM_TYPES` card, or the task ledger states why not),
- Modify: `backend/app/services/cost_history.py` (`sync_current_fy_history` skips `COST_ITEM_TYPES`), `backend/app/services/card_write_service.py` (~846 create, ~1019 update: call `recompute_derived` after the calculation run, before the history sync), `backend/app/api/v1/metamodel.py` (guard: cannot delete or retype `costTotalAnnual` on the two types; also refuse re-adding the removed breakdown fields? — no, only the guard on `costTotalAnnual`), `backend/app/api/v1/settings.py` (fiscal-year start saved → recompute all cost-bearing cards in `derived_maintenance`), `backend/app/main.py` (daily maintenance loop: new function `_cost_rollover_loop` modelled on `_kpi_snapshot_loop`, runs shortly after 00:00 UTC and recomputes every cost-bearing card whose derived value differs; uses `derived_maintenance(db)` from `services/derived_writes.py`)
- Create helper in `backend/app/services/card_costs.py`: `async def recompute_all(db) -> int` (returns cards changed).
- Test: `backend/tests/services/test_cost_derived_sync.py`, `backend/tests/api/test_cost_derived_api.py`

**Interfaces:** Consumes Task 3 `recompute_derived`. Produces `recompute_all(db) -> int`.

- [ ] **Step 1: Write failing tests**: card PATCH setting `attributes.costTotalAnnual = 999` returns/stores the derived TCO, not 999 (spec: overwritten on the same save); a create with a cost attribute stores 0 / derived; `sync_current_fy_history` writes no `card_cost_history` row for Application but still does for Provider; `recompute_all` after changing the fiscal-year start month moves a fallback card's derived value (Review Focus 2) and returns the changed count; the metamodel PATCH removing `costTotalAnnual` from Application returns 4xx, from Provider is allowed; a derived write inside `derived_maintenance` does not move `updated_at`; `PUT /cost-history` on an Application returns 409 while on a Provider it still works; a ServiceNow-style direct `attributes` assignment followed by the writer's recompute leaves the derived TCO equal to the section's.
- [ ] **Step 2: Run** `python -m pytest tests/services/test_cost_derived_sync.py tests/api/test_cost_derived_api.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the five edits above. Keep edits in shared upstream files to a few lines each (spec: small footprint).
- [ ] **Step 4: Run** the two files + `python -m pytest tests/services tests/core -q -x`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(costs): derived total stays in sync on write, setting change and rollover`.

### Task 6: Cost report reads items

**Files:**
- Modify: `backend/app/services/cost_report.py` (`cards_with_cost`, `build_cost_sankey`), `backend/app/services/cost_components.py` (`cost_components`), `backend/app/api/v1/reports.py` (`/cost`, `/cost-treemap`, `/cost-sankey`, history), `backend/app/services/cost_grouping.py` only if it assumes breakdown fields exist, `mcp-server/turbo_ea_mcp/server.py` only if `get_cost_treemap` names removed fields (verify first)
- Test: `backend/tests/services/test_cost_report_items.py`, `backend/tests/api/test_cost_report_items_api.py`

**Interfaces:** Consumes Task 3 `get_year_costs`. The existing filters stay: the current year still keeps only cards live in it (`is_live_in_fiscal_year`), past years only cards with a non-zero amount; a parity test compares totals before/after the change on the same fixture. The report response also carries the catalogue labels (`item_labels: {key: label}` incl. translations) so the frontend does not need card-type fields to name an item; the Sankey residual `__other__` stays empty for item types (the item `other` is its own component). Frontend: `CostReport.tsx` (`itemLabel`, ~703), the chips and `CostTrendChart.tsx` take labels from `item_labels` first, then from schema fields (Vitest test: an item key absent from the schema renders its catalogue label, not the raw key). Behaviour: for cost field `costTotalAnnual` on `COST_ITEM_TYPES`, the card's amount for `fiscal_year` is `YearCosts.tco` (fallback included) and its components are the catalogue item keys (labels from the catalogue, archived included as their own component); other types keep `card_cost_history`/attributes logic unchanged; a request mixing types uses the shared field only and gives the item breakdown only for item types (intersection rule in `cost_components.py`). Past years for item types come from `card_costs`, not `card_cost_history`. `costs.view` redaction applies as today (`cost_field_filter`).

- [ ] **Step 1: Write failing tests**: totals for current and a past year equal the sum of items; archived item appears as its own component and totals still add up (Review Focus 3); fallback year reported with `fallback_from`; Provider cost unchanged; mixed request Application + Provider returns only totals; user without `costs.view` sees no cost (as today); empty-row card reports 0 while a no-row card falls back.
- [ ] **Step 2: Run** `python -m pytest tests/services/test_cost_report_items.py tests/api/test_cost_report_items_api.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** Prefer one helper in `cost_report.py` — `item_costs_by_card(db, card_ids, fiscal_year, start_month)` — used by all three endpoints; do not duplicate the fallback logic.
- [ ] **Step 4: Run** new files + the existing cost-report tests (`python -m pytest tests -q -k "cost"`). Update fixtures that wrote `costTotalAnnual` for the two types to create items instead (spec open point). Expected: PASS.
- [ ] **Step 5: Commit** `feat(costs): cost report reads cost items`.

### Task 7: Workspace transfer, seeders, other consumers

**Files:**
- Modify: `backend/app/services/workspace_io/schema.py` (+ `applier.py`), seeders `backend/app/services/seed_demo*.py`, `backend/app/services/seed.py` only if it seeds the cost fields on the two types, consumers that read breakdown fields (grep `softwareLicensingCost|infrastruttureCost|applicationManagementServicesCost` across `backend/` and `mcp-server/`; fix each hit)
- Test: `backend/tests/services/test_workspace_io_cost_items.py`, `backend/tests/services/test_seed_demo.py` (extend)

**Interfaces:** Read `.claude/rules/workspace-transfer.md` first and follow its checklist for both tables. Catalogue: a `ConfigSection` in `workspace_io/schema.py` (`model=CostItemType`, `natural_key=("key",)`, columns `key,label,sort_order,archived,translations`, `json_columns={"translations"}`); `CardTypeCategory` has a bespoke applier, so use a plain generic section like the other registries, not that one. `card_costs`: an `EntitySection` in `workspace_io/sections.py` with `card_fk_columns`, a row in `test_workspace_io_roundtrip.py`, and the JSON column `items` added to the allowlist in `test_workspace_io_id_bearing_columns.py` (it holds no ids). Add `CostItemType`/`CardCost` wherever the rule's checklist demands (schema docs, ordering of apply: catalogue before `card_costs`).

- [ ] **Step 1: Read** `.claude/rules/workspace-transfer.md` and write the failing test: export → import round trip keeps the catalogue (including an archived item and translations) and the checklist guard test passes for the new models.
- [ ] **Step 2: Run** `python -m pytest tests/services/test_workspace_io_cost_items.py tests/services -q -k "workspace"`. Expected: FAIL.
- [ ] **Step 3: Implement** schema/applier entries; make demo seeders create catalogue rows and `card_costs` rows (and no longer write `costTotalAnnual` directly for the two types — it is derived); adapt the other consumers found by grep.
- [ ] **Step 4: Run** `python -m pytest tests/services/test_seed_demo.py tests/services/test_seed_demo_security.py tests/services -q -k "seed or workspace"` then the full backend suite `./scripts/test.sh`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(costs): workspace transfer, seeders and remaining consumers`.

### Task 8: Frontend costs section

**Files:**
- Create: `frontend/src/lib/costItems.ts` (`COST_ITEM_TYPES`, `RENEWAL_NEAR_DAYS`, `isRenewalNear(date, today)`), `frontend/src/features/cards/sections/CostsSection.tsx`, `CostItemDialog.tsx`, `costsStackedBarOption.ts` (ECharts option builder, via the shared `EChart` wrapper), tests next to each
- Modify: `frontend/src/types/index.ts` (`CostItemType`, `CostLine`, `YearCosts`, `CardCostsResponse`), `frontend/src/features/cards/CardDetailContent.tsx` (mount the section as built-in key `costs` for `COST_ITEM_TYPES` only), `frontend/src/features/cards/sectionConfig.ts` (add `"costs"` to `DEFAULT_SECTION_ORDER` after `"lifecycle"`; `buildSectionOrder` unchanged for other types), the attribute section so derived `costTotalAnnual` is hidden for those types, `InventoryPage.tsx` and `excelImport.ts` (and the drag-fill / bulk-edit paths): wherever `calculatedFields` decides read-only, `costTotalAnnual` of a `COST_ITEM_TYPES` type counts as calculated (inline edit, drag-fill and import skip it; tests on grid and import), `frontend/src/i18n/locales/en/cards.json` (English keys only)
- Test: `CostsSection.test.tsx`, `CostItemDialog.test.tsx`, `costItems.test.ts`, `costsStackedBarOption.test.ts`, `sectionConfig.test.ts` (extend)

**Interfaces:** Consumes Task 4 routes through `api.get/put/delete/post` and `useApiQuery`. `CostsSection({ cardId, canEdit })`: navigator `‹ FY26 · Current ›` over six years (‹ disabled at first, › at last); TCO large; stacked bar; one tile per line (archived greyed + dashed; renewal orange when `isRenewalNear`); "+ Add item" lists only active catalogue items not set for that year; fallback banner "No amounts entered for FYnn yet. Showing the items of FYmm, not confirmed." with a "Confirm FYnn" button; tile click opens `CostItemDialog` (item fixed, amount, renewal date, delete, "Copy to Forecast (FYnn)" checkbox shown when shown year < forecast year). Section hidden when the API answers 403/404. Layout follows `docs/superpowers/specs/2026-11-03-card-cost-items-assets/costs-section.html` and `edit-dialog.html`. Colours via `frontend/src/theme/tokens.ts`, no hex literals; labels through `useTranslation("cards")`, item labels through the entity-aware label resolver already used for metamodel labels (`.claude/rules/i18n-locales.md`; read it before writing).

- [ ] **Step 1: Write failing tests**: `isRenewalNear` at 89/90/91 days; section renders TCO and one tile per line from a mocked response (`vi.mock("@/api/client")`); › navigates to the next year; archived tile has the archived marker and is counted in the TCO text; fallback banner shows and "Confirm" posts to `/cards/{id}/costs/{fy}/confirm`; add-item list excludes items already set and archived ones; dialog save calls PUT with `{amount, renewal_date}`; "Copy to Forecast" only for years before forecast and calls the copy route; read-only user sees no edit controls; the section is not rendered for a type outside `COST_ITEM_TYPES`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/lib/costItems.test.ts src/features/cards`. Expected: FAIL.
- [ ] **Step 3: Implement** the components, mount point, order entry, attribute hiding and English i18n keys.
- [ ] **Step 4: Run** the same command, then `npm run lint` and `npm run build`. Expected: PASS. Update the raw-colour baseline test only if a new file legitimately needs it (prefer tokens).
- [ ] **Step 5: Commit** `feat(costs): Costs section on the card`.

### Task 9: Frontend catalogue admin

**Files:**
- Create: `frontend/src/features/admin/metamodel/ManageCostItemsDialog.tsx` (+ test), modelled on `ManageCategoriesDialog.tsx`
- Modify: `frontend/src/features/admin/MetamodelAdmin.tsx` (open the dialog from the toolbar next to Categories, line ~461), `frontend/src/types/index.ts`, `frontend/src/i18n/locales/en/admin.json`

**Interfaces:** Lists items (active + archived), create (key + label), rename label, archive/unarchive toggle; no delete; key read-only after create; translations editor the same way fields' translations are edited in the categories dialog. Uses Task 1 routes.

- [ ] **Step 1: Write failing test**: renders items from a mocked GET, create posts `{key,label}`, archive toggle PATCHes `{archived:true}`, key input disabled for existing items, no delete button.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/features/admin/metamodel/ManageCostItemsDialog.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** and wire the toolbar button (permission already gated by the page's route permission).
- [ ] **Step 4: Run** the test, `npm run lint`, `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(costs): cost item catalogue admin dialog`.

### Task 10: Docs, changelog, version, translation, review chain

**Files:**
- Modify: `docs/guide/` page for cards/costs and `docs/admin/` metamodel page (English only), `docs/reference/glossary.md` (cost item), `scripts/screenshots/pages.ts` + doc image references only if screenshots are added (optional: skip screenshots and say so), `CHANGELOG.md` (`## [2.188.0] - 2026-11-03` → Added/Changed), `VERSION` → `2.188.0`
- Test: existing docs/i18n parity tests; `mkdocs build --strict`

- [ ] **Step 1:** write the docs (Costs section, catalogue admin, "an import or sync can no longer set the cost of Application / IT Component", renewal colour, fallback and confirm, archived items still count) and the changelog entry; bump `VERSION`.
- [ ] **Step 2: Run** `mkdocs build --strict`. Expected: success.
- [ ] **Step 3: Run `/translate`** (forks the translator agent). Expected: reports clean; parity tests pass.
- [ ] **Step 4: Run** the full suites: `./scripts/test.sh` and `cd frontend && npm run test:run`. Expected: green except the known Windows-only failures listed in the session notes (`tokens.test.ts` CRLF, `CalculationsAdmin`/`WebPortalsAdmin`/`TurboLensArchitect` timeouts); report any other failure by name.
- [ ] **Step 5: Review chain (fresh agent each, in order):** `simplify` → re-run touched tests → `ponytail-review` → `security-review`; then a VAPT pass (new routes and tables, local instance only, stops at Medium tier; `.claude/rules/vapt.md`). Apply Must/Should findings with tests.
- [ ] **Step 6: Commit** `docs(costs): cost items guide, changelog and version`. Do not push or open the PR until the user asks; the PR body follows `.github/pull_request_template.md` and lists CI mutation scores after CI runs.

---

## Self-review

- **Spec coverage:** decisions 1–8 → Tasks 3, 1/2, 3, 1 (storage), 2, 2/5 (scope), 3, 3/6; Costs section + mockups → 8; catalogue admin → 1, 9; derived `costTotalAnnual` + guard + skip sync → 5; report → 6; workspace transfer, seeders, other consumers → 7; migration combinations and report → 2; docs/changelog/version/translate/VAPT → 10; gates → 4; window → 3, 4. Non-goals not built (notifications, Excel/MCP write).
- **Left to the builder (spec open points) decided here:** names `cost_item_types`/`card_costs`; routes under `/cards/{id}/costs`; no materialised TCO column; downgrade drops tables only; migration does not backfill `card_cost_history`; `CostHistoryEditor.tsx` is an unused orphan and is left untouched.
- **Known risks flagged for the executor:** shared upstream files touched (`card_write_service.py`, `metamodel.py`, `settings.py`, `main.py`, `reports.py`) — keep edits minimal; the MCP `get_cost_treemap` and LeanIX/ServiceNow mappings are only checked by grep in Task 7, not redesigned.

## Agent's calls

Folded in from the fresh-Opus plan review (2026-11-03), all decided without the user:

- **Fallback only for the current year**, never the Forecast (spec decision 7; keeps report totals unchanged on migration day).
- **Migration is sync Core SQL** in the style of `168`, no app models; the per-year migration report is logged and also stored in `app_settings.general_settings["cost_items_migration_report"]`.
- **Old `PUT/DELETE /cost-history`** answers 409 for the two types; `GET` stays (read-only legacy).
- **Direct `attributes` writers** (ServiceNow, survey apply, extension data, catalogue, workspace applier, `recalculate_and_rescore`) call `recompute_derived`; Task 5 starts with a grep to list them.
- **`costTotalAnnual` counts as calculated** in grid, drag-fill and Excel import for the two types.
- **Report keeps** the live-in-year (current) and non-zero (past) filters; catalogue labels travel in the report response; `__other__` stays empty for item types.
- **Events carry item keys only**, no amounts or dates.
- **`GET /cards/{id}/costs/{fiscal_year}`** added so the `current-5` row is readable.
- **Workspace transfer** follows the rule file (`EntitySection` for `card_costs`, generic `ConfigSection` for the catalogue).
- **Copy-to-forecast of an archived item** is allowed when it already has an amount in the source year.
