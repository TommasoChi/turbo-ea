# Licensing in core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** draft, plan review folded in (decisions of the user and the coordinator recorded at the end).

**Goal:** Licenses of an Application / IT Component become yearly core data (`card_licenses` + `license_types`), with a card section, a `Reports → Licensing` page (trend, Utilisation / By license type / Table), an Excel import, and a migration that moves the `licensing` extension's data into core.

**Architecture:** Every piece that has a cost equivalent reuses or generalises the cost code path. The year logic of `card_costs.py` moves into a shared `services/yearly_rows.py`; the catalogue logic of `cost_item_types.py` into `services/item_catalogue.py`; the per-card permission checks, the event redaction and the History summaries of costs are generalised to take a second domain. The licensing-only parts are the status maths (`services/license_status.py`, the only definition of a status), the report rows (`services/license_report.py`), the import (`services/license_import.py`), the section's two-row bar and the two report chart options. The frontend reuses `ReportShell`, `CardScopeFilter` / `useCardScope`, `costDrill`, `CostDrillBar`, `CostLegend`, `costColors`, `isBuiltInFieldType`, `EChart`, `CardPicker`, `CardDetailSidePanel`, and generalises `costTrendOption`, `ManageCostItemsDialog` and `sectionConfig`.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, PostgreSQL JSONB, openpyxl (already a dependency); React 18, MUI 6, ECharts through `@/components/charts`, Vitest + Testing Library, pytest.

**Spec:** `docs/superpowers/specs/2026-11-05-licensing-core-design.md` (approved; plan-review deviations folded in) and its mockups `docs/superpowers/specs/2026-11-05-licensing-core-design-assets/mockups.html`. Where the mockups and the spec differ, the spec wins.

## Global Constraints

- Plain core code: no extension, no `.teax`, no `window.TurboEA.sdk`, no `ext.*` field type; `SDK_VERSION` 1.5 / `UI_SDK_VERSION` 1.19 untouched. Migration 178 touches nothing of the extension but its schema fields (no `extensions` row update, no installer block).
- User-facing English says **"license"** (as the existing UI and identifiers). Identifiers: `license`.
- IT Component's `licenseType` text field and Application's `numberOfUsers` are not touched.
- Card types: `LICENSE_TYPES = frozenset({"Application", "ITComponent"})` in `backend/app/services/card_licenses.py`, `LICENSE_TYPES` in `frontend/src/lib/licenses.ts`. Platform never holds licenses.
- Metric keys `users` / `installations`; the import also accepts `user` / `installation`.
- Item shape: `card_licenses.items = {metric: {license_type_key: {"licensed": int, "actual": int | null}}}`. `actual: null` is "missing", distinct from `0`. Counts are integers `>= 0`, at most `1_000_000_000`.
- Window: section `current-4 … current+1`; writes `current-5 … current+1` (`FISCAL_YEAR_LOOKBACK` / `FISCAL_YEAR_LOOKAHEAD`). The Forecast year (`current+1`) stores licensed only.
- Year resolution: a year with a row (even empty) is confirmed; only the current year with no row falls back to the latest earlier row (`confirmed=false`), carrying **licensed only**.
- Status: per license type, no compensation; type `over` when actual > licensed; `approaching` when actual >= 80 % of licensed, licensed > 0, not over; licensed 0 and actual 0 = 0 % compliant; licensed 0 and actual > 0 = over ("no license"). Priority `over` > `approaching` > `no_actual_data` > `compliant`. The Forecast year has no status.
- Permissions exactly like costs: view = `licenses.view` OR any stakeholder on the card; edit = `licenses.edit` OR a stakeholder role with `card.edit` on that card; hidden card 404. Defaults: `licenses.view` true for `bpm_admin` and `member`, false for `viewer`; `licenses.edit` admin only. Import needs the global `licenses.edit`.
- Event `card.licenses_updated`: license type keys only, never counts; not rollbackable; redacted with the cost events on every feed.
- Colours: license type hue from `CHART_CATEGORICAL` by catalogue `sort_order` (archived keep theirs), the 9th and later fold into `CHART_OTHER`; status colours from `STATUS_COLORS` (`success`, `warning`, `error`, `neutral`); no raw hex (the `rawColours` baseline must not rise).
- Version 2.190.0 (minor). English only in the implementation session; `/translate` at the end.
- No mutation testing locally.
- Before every commit: `cd backend && ruff format . && ruff check .` (backend tasks); `cd frontend && npx tsc --noEmit && npm run lint` (frontend tasks).
- Every new route registered in `backend/app/api/v1/router.py`, `async def`, permission-checked, `CardReadScope` on every card read, no raw SQL outside Alembic.
- Backend tests use the `conftest.py` fixtures and factories only: `db`, `client`, `app`, `test_engine`, `create_user`, `create_role`, `create_card_type`, `create_card`, `create_relation_type`, `create_relation`, `create_stakeholder_role_def`, `auth_headers`. No fixture named `admin`, `viewer` or `restricted` exists: build users with `create_user(db, role=...)` and a type-deny role with `create_role`.

## Review Focus

1. **An import file a person actually exports from Excel**: header `Licence type` (UK spelling) or different case, numbers stored as text (`"12"`) or as `12.0`, trailing empty rows, extra columns to the right. Expected: accepted; only a fractional number (`12.5`) or a negative is `invalid_number`. Test: Task 9 `test_parse_accepts_uk_spelling_text_numbers_and_trailing_blanks`.
2. **A workspace whose fiscal year starts in April** (`fiscalYearStart=4`): the section window, the import's `Year` check and the report's current year name the same year. Tests: Task 5 `test_window_follows_fiscal_year_start`, Task 9 `test_import_year_uses_fiscal_year_start`, Task 8 `test_fiscal_year_start_april_names_the_current_year`.
3. **An archived license type in a carried-forward current year**: editing its actual works (the cell exists), a new cell on it is refused (409), in the PUT and in the import alike. Tests: Task 5 `test_archived_type_editable_when_present_refused_when_new`, Task 9 reason `archived_license_type`.
4. **A Platform linked to a card through both `relPlatformToApp` and `relPlatformToITC`, or to a hidden, archived or retired card**: the card counts once; hidden and archived cards never; a card retired before the current year not in the current year. Test: Task 8 `test_platform_aggregate_counts_once_and_applies_the_report_rules`.
5. **A card retired during the history window**: absent from the current-year rows and current trend bar, present in the past years where it has a row. Test: Task 8 `test_retired_card_only_in_its_recorded_years`.

The two-session "concurrent first edit" test proposed in the first draft is dropped: `conftest.py`'s `db` runs every test inside one rolled-back transaction, so two real sessions need committed rows in the worker schema and a hand cleanup that no other test in the suite does; the code path (`ON CONFLICT DO NOTHING` + re-select `FOR UPDATE`) is moved verbatim from `card_costs._editable` into `yearly_rows.editable` and stays covered by the cost tests that exercise it.

---

## File map

Backend, new:
- `backend/app/models/license_type.py` (`LicenseType`), `backend/app/models/card_license.py` (`CardLicense`)
- `backend/alembic/versions/177_card_licenses.py`, `backend/alembic/versions/178_licensing_from_extension.py`
- `backend/app/services/yearly_rows.py`, `item_catalogue.py`, `license_status.py`, `license_types.py`, `card_licenses.py`, `licensing_migration.py`, `license_report.py`, `license_import.py`, `seed_demo_licensing.py`
- `backend/app/schemas/licenses.py`
- `backend/app/api/v1/license_types.py`, `backend/app/api/v1/card_licenses.py` (card routes + import)

Backend, modified: `models/__init__.py`, `core/permissions.py`, `services/permission_service.py`, `services/card_costs.py`, `services/cost_item_types.py`, `services/cost_field_filter.py`, `services/cost_event_redaction.py`, `services/audit_labels.py`, `services/rollback_service.py`, `services/extensions/field_contributions.py`, `services/workspace_io/{schema,sections,remap,bundle}.py`, `services/seed.py`, `api/v1/{router,reports,events,cards,saved_reports,file_attachments}.py`, `app/main.py`.

Frontend, new: `src/lib/licenses.ts`, `src/features/cards/sections/{LicensingSection.tsx,LicenseItemDialog.tsx,licensingBarOption.ts}`, `src/features/reports/{LicensingReport.tsx,LicensingTable.tsx,LicensingImportDialog.tsx,licensingUtilisationOption.ts,licensingByTypeOption.ts}` (each with a test beside it).

Frontend, modified: `src/types/index.ts`, `src/features/reports/{costColors,costTrendOption,savedReportStyles}.ts`, `src/features/admin/metamodel/ManageCostItemsDialog.tsx`, `src/features/admin/MetamodelAdmin.tsx`, `src/features/cards/{sectionConfig.ts,dataQualityJump.ts,CardDetailContent.tsx}`, `src/features/admin/CardLayoutEditor.tsx`, `src/App.tsx`, `src/lib/{routePermissions,routePermissions.test,pageTitle}.ts`, `src/layouts/navItems.ts`, `src/i18n/locales/en/{cards,reports,admin,nav}.json`.

## Task list

**1** permissions, models, migration 177 · **2** status maths · **3** license type catalogue · **4** year rows shared with costs (review's 4a) · **5** card licenses service, schemas, routes (4b) · **6** events: redaction on every feed, SSE, History, rollback, top contributors (4c) · **7** migration 178 · **8** report API · **9** import API · **10** workspace transfer · **11** demo seed · **12** frontend types, section, dialogs, catalogue admin · **13** report page: trend, Utilisation, By type (review's 11a) · **14** report page: table, export, saved reports, route, nav (11b) · **15** import dialog · **16** docs, version, changelog, OpenAPI, rules proposal · **17** finish.

---

### Task 1: Permissions, models, tables and role grants

**Files:**
- Modify: `backend/app/core/permissions.py` (new group after `costs`; defaults in `BPM_ADMIN_PERMISSIONS` / `MEMBER_PERMISSIONS` / `VIEWER_PERMISSIONS`)
- Modify: `frontend/src/lib/routePermissions.test.ts` (`KNOWN_PERMISSIONS`, the hand-kept mirror near line 29: add `"licenses.edit"`, `"licenses.view"`)
- Create: `backend/app/models/license_type.py`, `backend/app/models/card_license.py`; Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/177_card_licenses.py`
- Modify: `backend/app/services/permission_service.py`
- Test: `backend/tests/services/test_alembic_177_card_licenses.py`, `backend/tests/services/test_permission_service_licenses.py`

**Interfaces:**
- Produces: `LicenseType` (table `license_types`: `key` String(64) unique, `label` String(100), `sort_order` int, `archived` bool, `translations` JSONB; `UUIDMixin`, `TimestampMixin`), `CardLicense` (table `card_licenses`: `card_id` FK `cards.id` ON DELETE CASCADE, `fiscal_year` int, `items` JSONB default `{}`, `UniqueConstraint("card_id","fiscal_year", name="uq_card_licenses_card_year")`, `Index("ix_card_licenses_card_id")`). Same columns as `CostItemType` / `CardCost`.
- Produces: `PermissionService.can_view_licenses(db, user, card_id) -> bool`, `can_edit_licenses(db, user, card_id) -> bool`, `card_ids_with_license_access(db, user, ids) -> set[UUID]`.
- Produces: migration functions `plan_defaults(role_key: str, perms: dict | None) -> dict | None`, `plan_copy(perms: dict | None) -> dict | None`.

- [ ] **Step 1: Write the failing tests**

`test_alembic_177_card_licenses.py` (module loaded by path like `test_alembic_176_costs_edit.py`):
```python
def test_defaults_added_for_builtin_roles():
    assert mig.plan_defaults("member", {"costs.view": True}) == {"costs.view": True, "licenses.view": True, "licenses.edit": False}
    assert mig.plan_defaults("bpm_admin", {}) == {"licenses.view": True, "licenses.edit": False}
    assert mig.plan_defaults("viewer", {}) == {"licenses.view": False, "licenses.edit": False}

def test_defaults_skip_wildcard_custom_and_present_keys():
    assert mig.plan_defaults("admin", {"*": True}) is None
    assert mig.plan_defaults("auditor", {"inventory.view": True}) is None
    assert mig.plan_defaults("member", {"licenses.view": False, "licenses.edit": True}) is None

def test_copy_only_true_extension_grants_after_defaults():
    assert mig.plan_copy({"ext.licensing.view": True, "licenses.view": False}) == {"ext.licensing.view": True, "licenses.view": True}
    assert mig.plan_copy({"ext.licensing.manage": True, "licenses.edit": False})["licenses.edit"] is True
    assert mig.plan_copy({"ext.licensing.view": False, "licenses.view": True}) is None
    assert mig.plan_copy({"*": True, "ext.licensing.view": True}) is None

def test_code_defaults_match_the_migration():
    assert MEMBER_PERMISSIONS["licenses.view"] is True and BPM_ADMIN_PERMISSIONS["licenses.view"] is True
    assert VIEWER_PERMISSIONS["licenses.view"] is False
    for p in (MEMBER_PERMISSIONS, BPM_ADMIN_PERMISSIONS, VIEWER_PERMISSIONS):
        assert p["licenses.edit"] is False
```
(Timestamp server defaults are already pinned for every migration by `tests/services/test_alembic_timestamp_defaults.py`.)
`test_permission_service_licenses.py`: `test_view_by_permission_or_any_stakeholder` (a `viewer` user from `create_user` + an Observer stakeholder on card A → True on A, False on B), `test_edit_needs_licenses_edit_or_card_edit_stakeholder` (`member` with `inventory.edit` only → False; stakeholder role with `card.edit` → True on that card only), `test_bulk_access_matches_single` (`card_ids_with_license_access` equals the per-card answers over 3 cards).

- [ ] **Step 2: Run, verify they fail**: `cd backend && python -m pytest tests/services/test_alembic_177_card_licenses.py -q` → FAIL (module not found); `./scripts/test.sh tests/services/test_permission_service_licenses.py` → FAIL.
- [ ] **Step 3: Implement**
  - `core/permissions.py`: `"licenses": {"label": "Licensing", "permissions": {"licenses.view": "View license counts on cards and the Licensing report (stakeholders see their own cards' licenses regardless)", "licenses.edit": "Edit and import the licenses of any card (stakeholders whose role can edit a card edit that card's licenses regardless)"}}`; defaults as above. Add both keys to `KNOWN_PERMISSIONS` in `routePermissions.test.ts`.
  - `permission_service.py`: generalise the three cost methods into private `_can_view_domain(db, user, card_id, perm)`, `_can_edit_domain(db, user, card_id, perm)`, `_card_ids_with_domain_access(db, user, ids, perm)`; the cost and the license methods become one-line calls. Existing cost tests pass unchanged.
  - `177_card_licenses.py` (`revision="177"`, `down_revision="176"`): `create_table` both tables like 175 (`_stamps()`), then per role row `plan_defaults` (built-in `bpm_admin` / `member` / `viewer`, absent keys only) and then `plan_copy` on the result (every role, `true` values only, wildcard skipped); raw `text()` UPDATEs as in 176. `downgrade`: drop index + tables, `permissions - 'licenses.view' - 'licenses.edit'` on every role.
- [ ] **Step 4: Run**: `./scripts/test.sh tests/services/test_alembic_177_card_licenses.py tests/services/test_permission_service_licenses.py tests/services/test_permission_service_costs.py tests/services/test_alembic_timestamp_defaults.py` and `cd frontend && npx vitest run src/lib/routePermissions.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(licensing): permissions, tables and role grants`.

---

### Task 2: Status maths (pure)

**Files:** Create `backend/app/services/license_status.py`; Test `backend/tests/services/test_license_status.py`

**Interfaces:**
- Produces:
```python
METRICS: tuple[str, ...] = ("users", "installations")
APPROACHING = 0.8
TypeStatus = Literal["over", "approaching", "compliant", "no_data"]
MetricStatus = Literal["over", "approaching", "no_actual_data", "compliant"]

@dataclass(frozen=True)
class TypeResult:
    key: str
    licensed: int
    actual: int | None
    pct: float | None        # actual / licensed * 100, one decimal; None when actual is None or licensed == 0 < actual
    no_licence: bool         # licensed == 0 and actual > 0
    status: TypeStatus

@dataclass(frozen=True)
class MetricResult:
    metric: str
    types: list[TypeResult]  # catalogue order, then unknown keys sorted
    has_actual: bool
    status: MetricStatus
    worst_pct: float | None
    worst_no_licence: bool
    licensed_total: int
    actual_total: int | None # None when no type has actual

def type_result(key: str, cell: dict | None) -> TypeResult
def metric_result(metric: str, cells: dict[str, dict], order: list[str]) -> MetricResult
def card_status(metrics: list[MetricResult]) -> MetricStatus
def worst_of(results: list[MetricResult]) -> tuple[float | None, bool]   # max worst_pct, OR of worst_no_licence
```

- [ ] **Step 1: Write the failing tests** (no DB)
```python
def test_over_when_actual_above_licensed(): assert type_result("a", {"licensed": 10, "actual": 12}).status == "over"
def test_approaching_at_80_and_at_100(): assert [type_result("a", {"licensed": 10, "actual": v}).status for v in (8, 10, 7)] == ["approaching", "approaching", "compliant"]
def test_zero_licensed_zero_actual_is_compliant_zero_pct():
    r = type_result("a", {"licensed": 0, "actual": 0}); assert (r.status, r.pct, r.no_licence) == ("compliant", 0.0, False)
def test_zero_licensed_positive_actual_is_over_no_licence():
    r = type_result("a", {"licensed": 0, "actual": 1}); assert (r.status, r.pct, r.no_licence) == ("over", None, True)
def test_missing_licensed_counts_as_zero(): assert type_result("a", {"actual": 3}).status == "over"
def test_missing_actual_is_no_data_not_zero(): r = type_result("a", {"licensed": 20, "actual": None}); assert (r.status, r.pct) == ("no_data", None)
def test_no_compensation_between_types():
    m = metric_result("users", {"a": {"licensed": 10, "actual": 12}, "b": {"licensed": 200, "actual": 150}}, ["a", "b"])
    assert m.status == "over" and m.licensed_total == 210 and m.actual_total == 162
def test_metric_without_any_actual_is_no_actual_data():
    assert metric_result("users", {"a": {"licensed": 5, "actual": None}}, ["a"]).status == "no_actual_data"
def test_no_data_type_never_changes_metric_status():
    assert metric_result("users", {"a": {"licensed": 10, "actual": 5}, "b": {"licensed": 20, "actual": None}}, ["a", "b"]).status == "compliant"
def test_priority_over_approaching_no_data_compliant():
    assert card_status([_m("compliant"), _m("no_actual_data"), _m("approaching")]) == "approaching"
    assert card_status([_m("approaching"), _m("over")]) == "over"
    assert card_status([_m("compliant"), _m("no_actual_data")]) == "no_actual_data"
def test_worst_pct_is_the_highest_type_pct_and_no_licence_wins():
    m = metric_result("users", {"a": {"licensed": 10, "actual": 12}, "b": {"licensed": 10, "actual": 5}}, ["a", "b"])
    assert m.worst_pct == 120.0 and not m.worst_no_licence
    assert metric_result("users", {"a": {"licensed": 0, "actual": 2}}, ["a"]).worst_no_licence is True
def test_order_follows_catalogue_then_unknown_keys_sorted():
    assert [t.key for t in metric_result("users", {"z": {}, "b": {}, "a": {}}, ["b", "a"]).types] == ["b", "a", "z"]
```
- [ ] **Step 2: Run** `cd backend && python -m pytest tests/services/test_license_status.py -q` → FAIL.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(licensing): status maths`.

---

### Task 3: License type catalogue (shared with cost items)

**Files:**
- Create: `backend/app/services/item_catalogue.py`, `backend/app/services/license_types.py`, `backend/app/schemas/licenses.py` (catalogue part), `backend/app/api/v1/license_types.py`
- Modify: `backend/app/services/cost_item_types.py` (delegate), `backend/app/services/card_costs.py` (`archived_keys` delegates), `backend/app/api/v1/router.py`, `frontend/src/i18n/locales/en/admin.json` (`securityLog.actionLabels.admin_metamodel_license_type_created` / `_updated`)
- Test: `backend/tests/services/test_item_catalogue.py`, `backend/tests/api/test_license_types_api.py`

**Interfaces:**
- Produces (`item_catalogue.py`, generic over a model with the catalogue columns):
```python
KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
class CatalogueError(Exception): code: str  # invalid_key, reserved_key, duplicate_key, not_found
def serialize(row) -> dict
async def get_item(db, model, key: str)
async def list_items(db, model, include_archived: bool = True) -> list
async def create_item(db, model, key, label, translations=None, *, noun: str,
                      reserved: Callable[[AsyncSession], Awaitable[set[str]]] | None = None)
async def update_item(db, model, key, label=None, translations=None, archived=None, sort_order=None, *, noun: str)
async def archived_keys(db, model) -> dict[str, bool]
```
  Messages use `noun` verbatim: `f"Invalid {noun.lower()} key '{key}'"`, `f"{noun} '{key}' already exists"`, `f"{noun} '{key}' not found"`, so `cost_item_types` (noun `"Cost item"`) keeps `"Invalid cost item key '1x'"`, `"Cost item 'lic' already exists"`, `"Cost item 'nope' not found"` (`tests/services/test_cost_item_types.py:137,155` unchanged). `reserved=None` means no reserved-key check.
- `cost_item_types.py` keeps every public name: `CostItemError = CatalogueError`, `serialize`, `get_item(db, key)`, `list_items(db, include_archived=True)`, `create_item(db, key, label, translations)` (passes `noun="Cost item"`, `reserved=_cost_reserved` = today's card columns + every field key + `"cost_items"`, so `"'description' is a card column or field key"` stays), `update_item(...)`, `seed_default_items`. No caller or test changes.
- `archived_keys`: stays defined in `card_costs.py` (line 110) with the same signature `archived_keys(db) -> dict[str, bool]`, its body becoming `return await item_catalogue.archived_keys(db, CostItemType)`. Callers unchanged: `card_costs.get_year_row`, `card_costs.upsert_item`, `cost_report.item_costs_by_card` (imports it from `card_costs`, `cost_report.py:25`). The "Cost item 'old' is archived" message stays in `card_costs.upsert_item` (`test_card_costs.py:432` unchanged).
- `license_types.py`: `get_item(db, key)`, `list_items(db, include_archived=True)`, `create_item(db, key, label, translations)`, `update_item(...)`, `archived_keys(db)`, bound to `LicenseType`, `noun="License type"`, **no reserved keys** (license type keys travel inside a list value of the event, never as a diff key, so they cannot hide a diff).
- Schemas: `LicenseTypeCreate`, `LicenseTypeUpdate`, `LicenseTypeOut` — same fields and limits as the `CostItemType*` schemas (reuse `KEY_PATTERN`).
- Routes (prefix `/metamodel`): `GET /license-types` (any signed-in user, archived included — like the cost catalogue; stated deviation, spec updated), `POST /license-types` (201, `admin.metamodel`, 409 `duplicate_key`, 422 other codes), `PATCH /license-types/{key}` (`admin.metamodel`, 404). Audit `admin.metamodel.license_type.created` / `.updated`, target `("license_type", key, label)`, same scalar diff and `_label_translation_items` as cost items. No DELETE route.

- [ ] **Step 1: Write the failing tests**
`test_item_catalogue.py`: `test_create_appends_sort_order_and_refuses_duplicate` (orders 0, 1; same key → `duplicate_key`, message `"License type 'a' already exists"`), `test_license_type_has_no_reserved_keys` (`license_types.create_item(db, "name", "Name")` succeeds), `test_license_and_cost_catalogues_are_independent` (`admin` in both tables), `test_archived_keys_maps_key_to_flag`, `test_update_unknown_uses_the_noun` (`"License type 'nope' not found"`).
`test_license_types_api.py`: `test_list_open_to_any_signed_in_user` (a `viewer` from `create_user` → 200), `test_create_requires_admin_metamodel` (viewer 403), `test_create_rejects_invalid_key` (`"1abc"` → 422), `test_patch_archives_and_audits` (one audit row `admin.metamodel.license_type.updated` with `archived` in `changes`), `test_patch_unknown_key_404`, `test_no_delete_route` (405).
- [ ] **Step 2: Run** `./scripts/test.sh tests/services/test_item_catalogue.py tests/api/test_license_types_api.py` → FAIL.
- [ ] **Step 3: Implement**; register `license_types.router` beside `cost_item_types.router`; add the two English action labels.
- [ ] **Step 4: Run** the two new files plus `tests/services/test_cost_item_types.py tests/api/test_cost_item_types_api.py tests/services/test_card_costs.py tests/services/test_cost_report.py` → PASS.
- [ ] **Step 5: Commit** `feat(licensing): license type catalogue (shared with cost items)`.

---

### Task 4: Year rows shared with costs

**Files:** Create `backend/app/services/yearly_rows.py`; Modify `backend/app/services/card_costs.py`; Test `backend/tests/services/test_yearly_rows.py`

**Interfaces:**
- Produces (moved from `card_costs.py`, generic over a model with `card_id`, `fiscal_year`, `items`):
```python
async def row(db, model, card_id, fy, lock: bool = False)
async def fallback_row(db, model, card_id, fy)
def resolve_year(row_items: dict | None, prev: tuple[int, dict] | None, fy: int, cur: int,
                 carry: Callable[[dict, int], dict]) -> tuple[dict, bool, int | None]
async def resolve(db, model, card_id, fy, start_month, carry) -> tuple[dict, bool, int | None]
def in_window(fy: int, start_month: int) -> bool          # cur-5 .. cur+1
async def editable(db, model, card_id, fy, start_month, carry)   # ON CONFLICT DO NOTHING + re-select FOR UPDATE
def window_years(cur: int) -> range                        # cur-4 .. cur+1
```
- `card_costs.py` keeps every public and private name its tests use (`resolve_year(row_items, prev, fy, cur)`, `_row`, `_resolve`, `_editable`, `_check_window`, `get_window`, …) as thin calls into `yearly_rows` with `model=CardCost` and `carry=lambda items, years: _shifted(items, years)`; `_check_window` raises `CostError("year_out_of_range", …)` when `not in_window(...)`.

- [ ] **Step 1: Write the failing tests**: `test_row_present_is_confirmed_even_empty`, `test_only_current_year_falls_back_with_carry` (fy=cur, prev=(cur-2, X) → `carry(X, 2)`, `False`, `cur-2`; fy=cur+1 and cur-1 → `({}, False, None)`), `test_in_window_bounds` (cur-5 and cur+1 True, cur-6 and cur+2 False), `test_editable_materialises_the_carried_set` (DB, `CardCost`).
- [ ] **Step 2: Run** `./scripts/test.sh tests/services/test_yearly_rows.py` → FAIL.
- [ ] **Step 3: Implement** the move; no behaviour change for costs.
- [ ] **Step 4: Run** `./scripts/test.sh tests/services/test_yearly_rows.py tests/services/test_card_costs.py tests/api/test_card_costs_api.py tests/services/test_cost_report.py tests/services/test_cost_rollover_loop.py tests/services/test_cost_derived_sync.py tests/api/test_cost_report_items_api.py` → PASS. This gate decides whether the task is done.
- [ ] **Step 5: Commit** `refactor(costs): shared fiscal-year row logic`.

---

### Task 5: Card licenses service, schemas and routes

**Files:** Create `backend/app/services/card_licenses.py`, `backend/app/api/v1/card_licenses.py`; extend `backend/app/schemas/licenses.py`; Modify `backend/app/api/v1/router.py`; Test `backend/tests/services/test_card_licenses.py`, `backend/tests/api/test_card_licenses_api.py`

**Interfaces:**
- Consumes: Task 1 models and permission methods; Task 2 `metric_result`, `card_status`; Task 3 `license_types.archived_keys`, `list_items`; Task 4 `yearly_rows`.
- Produces (`card_licenses.py`):
```python
LICENSE_TYPES = frozenset({"Application", "ITComponent"})
LICENSE_EVENT = "card.licenses_updated"
LEGACY_KEYS = ("licensedUsers", "licensedInstallations", "actualUsers", "actualInstallations")
LIST_KEY = "license_types"          # the event's changes key
UNSET: Final = object()             # "leave this value as it is"
class LicenseError(Exception): code  # unknown_type, archived_type, invalid_metric, invalid_count, forecast_actual, year_out_of_range
def licensed_only(items: dict, years: int = 0) -> dict   # the carry: every cell -> {"licensed": n, "actual": None}
@dataclass class YearLicenses: fiscal_year, is_current, is_forecast, confirmed, fallback_from, metrics: list[MetricResult], status: MetricStatus | None
def year_licenses(items, confirmed, fallback_from, fy, cur, model: list[str], order: list[str]) -> YearLicenses
async def get_year(db, card, fiscal_year, start_month) -> YearLicenses   # metrics = licensingModel ∩ METRICS
async def get_window(db, card, start_month) -> list[YearLicenses]
async def merge_cell(db, card_id, fiscal_year, metric, key, *, licensed=UNSET, actual=UNSET,
                     archived: dict[str, bool] | None = None, start_month: int | None = None) -> None
async def delete_cell(db, card_id, fiscal_year, metric, key) -> bool     # False = no-op
async def confirm_year(db, card_id, fiscal_year) -> None
async def copy_to_forecast(db, card_id, from_year, metric, key) -> None  # licensed only, through merge_cell
async def publish_change(db, card, user_id, fiscal_year, old: YearLicenses) -> YearLicenses   # reads the new year, publishes LICENSE_EVENT; flush only
async def apply_write(db, card, user_id, fiscal_year, op) -> YearLicenses   # old = get_year; if await op() is False: return old; return publish_change(...)
```
  `merge_cell` is the **one** write rule, used by the PUT, copy-to-forecast and the import (Task 9): year window (`year_out_of_range`), metric in `METRICS` (`invalid_metric`), key in the catalogue (`unknown_type`), archived key only when the cell already exists in the resolved year (`archived_type`), integers `0 … 1_000_000_000` and not `bool` (`invalid_count`), `actual` not `UNSET`/`None` on the Forecast year (`forecast_actual`); then `yearly_rows.editable(..., carry=licensed_only)` and merge: a missing cell starts `{"licensed": 0, "actual": None}`, `UNSET` leaves a value, `None` clears `actual`. `archived` and `start_month` may be passed in by a caller that already holds them (the import), else they are read.
- Schemas: `LicenseCellWrite {licensed: StrictInt = Field(ge=0, le=1_000_000_000), actual: StrictInt | None = Field(None, ge=0, le=1_000_000_000)}`, `LicenseTypeResultOut`, `MetricResultOut`, `YearLicensesOut`, `YearLicensesDetailOut(+can_edit)`, `CardLicensesOut {can_edit, licensing_model: list[str], years, catalogue: list[LicenseTypeOut]}`.
- Routes (`card_licenses.py`, tag `card-licenses`), copying `card_costs.py`'s `_load_for_read` / `_load_for_edit` / `_write` shape with `can_view_licenses` / `can_edit_licenses` and `LICENSE_TYPES`:
  - `GET /cards/{card_id}/licenses` → `CardLicensesOut`
  - `GET /cards/{card_id}/licenses/{fiscal_year}` → `YearLicensesDetailOut`
  - `PUT /cards/{card_id}/licenses/{fiscal_year}/items/{metric}/{key}` body `LicenseCellWrite` → `merge_cell(licensed=body.licensed, actual=body.actual)` → `YearLicensesOut`
  - `DELETE` same path → 204, idempotent
  - `POST /cards/{card_id}/licenses/{fiscal_year}/confirm` → `YearLicensesOut`
  - `POST /cards/{card_id}/licenses/{fiscal_year}/items/{metric}/{key}/copy-to-forecast` → `YearLicensesOut` (event diffs the Forecast year)
  - Error map: `archived_type` 409, else 422; `metric` path param `pattern="^(users|installations)$"`.
- Event payload: `{"id", "source": "card_licenses", "fiscal_year": fy, "changes": {"license_types": {"old": [sorted type keys present in any metric], "new": [...]}}}`.

- [ ] **Step 1: Write the failing tests**
`test_card_licenses.py`:
```python
async def test_carry_forward_is_licensed_only(db)    # FY cur-1 {"users":{"admin":{"licensed":10,"actual":9}}} -> current licensed 10, actual None, confirmed False, "no_actual_data"
async def test_confirm_materialises_licensed_only(db)
async def test_merge_unset_keeps_and_none_clears(db)  # licensed=UNSET keeps 10; actual=None clears; actual=UNSET keeps
async def test_forecast_rejects_actual(db)            # LicenseError("forecast_actual")
async def test_archived_type_editable_when_present_refused_when_new(db)   # Review Focus 3
async def test_unknown_type_bad_metric_and_bool_count_refused(db)
async def test_copy_to_forecast_copies_licensed_only(db)
async def test_delete_absent_cell_is_noop_without_event(db)
async def test_untracked_metric_stored_but_not_reported(db)   # licensingModel ["users"] -> get_year metrics == ["users"]
async def test_window_follows_fiscal_year_start(db)           # Review Focus 2: fiscalYearStart=4
async def test_event_carries_type_keys_only(db)               # json.dumps(payload) contains no "licensed"/"actual"
```
`test_card_licenses_api.py` (users from `create_user`, a type-deny role from `create_role`): `test_get_window_and_can_edit_for_admin` (6 years), `test_viewer_without_permission_403`, `test_stakeholder_viewer_reads_own_card`, `test_hidden_card_404`, `test_platform_card_404`, `test_put_success_and_event_stored`, `test_put_rejects_unknown_type_422`, `test_put_rejects_forecast_actual_422`, `test_put_rejects_bad_year_422` (`cur+2`), `test_put_rejects_fractional_count_422`, `test_member_without_card_edit_stakeholder_403`.
- [ ] **Step 2: Run** `./scripts/test.sh tests/services/test_card_licenses.py tests/api/test_card_licenses_api.py` → FAIL.
- [ ] **Step 3: Implement**; register the router.
- [ ] **Step 4: Run** same plus `tests/services/test_card_read_scope_guard.py tests/services/test_updated_at_invariant.py` → PASS.
- [ ] **Step 5: Commit** `feat(licensing): card licenses per fiscal year`.

---

### Task 6: Events — redaction on every feed, SSE, History, rollback, top contributors

**Files:**
- Modify: `backend/app/services/cost_field_filter.py`, `backend/app/services/cost_event_redaction.py`, `backend/app/services/audit_labels.py`, `backend/app/services/rollback_service.py`, `backend/app/api/v1/events.py`, `backend/app/api/v1/cards.py`, `backend/app/api/v1/reports.py`
- Test: `backend/tests/services/test_license_event_redaction.py`, `backend/tests/api/test_license_event_feeds.py`

**Interfaces:**
- `cost_field_filter.strip_change_keys(data: dict | None, drop: frozenset[str]) -> dict | None` (today's body of `redact_event_costs`); `redact_event_costs(data, cost_keys)` = `strip_change_keys(data, cost_keys | {COST_ITEMS_KEY})`, signature unchanged.
- `cost_event_redaction.LICENSE_KEYS = frozenset({*LEGACY_KEYS, LIST_KEY})`; `redact_cost_events(db, user, events, payloads)` (name and six call sites unchanged: `cards.py` History, `events.py` ×2, `mutation_batches.py`, `reports.py` ×2): one access query per domain (`card_ids_with_cost_access`, `card_ids_with_license_access`), per event drop `all_cost_keys ∪ {cost_items}` without cost access and `LICENSE_KEYS` without license access.
- `events.py` SSE: drop set = cost keys unless `costs.view`, ∪ `LICENSE_KEYS` unless `licenses.view`, both read before the session closes.
- `audit_labels.license_type_labels(db, keys) -> dict[str, str]`, `license_event_summaries(db, card_name, payloads) -> list[str]` ("Licensing of <card> changed (FY<yy>; license types: <labels>)", types part dropped when redacted); `cost_event_redaction.add_cost_summaries` annotates both `COST_EVENT` and `LICENSE_EVENT`; `cards.py` History calls it when either is present.
- `rollback_service._DECLINED["card.licenses_updated"] = "Licensing changes cannot be rolled back; edit the licenses instead."`; `reports.py` top contributors adds `LICENSE_EVENT` beside `COST_EVENT`.

- [ ] **Step 1: Write the failing tests**
`test_license_event_redaction.py` (service level): `test_legacy_diff_of_old_keys_redacted_without_license_access`, `test_license_types_list_redacted_without_access`, `test_summary_names_year_and_labels`, `test_rollback_declines_license_event`.
`test_license_event_feeds.py` — for **each** feed, two users built with `create_user` / `create_role`: one with **only cost access** (`costs.view`, no `licenses.view`) and one with **only license access**; seed one `card.costs_updated`, one `card.licenses_updated` and one legacy `card.updated` diff of `licensedUsers` + `costTotalAnnual`; assert the first user sees cost values and no license keys, the second the reverse:
  - `test_card_history_feed_only_cost_access` / `_only_license_access` (`GET /cards/{id}/history`)
  - `test_my_cards_feed_only_cost_access` / `_only_license_access` (`GET /events/my-cards`)
  - `test_admin_events_feed_only_cost_access` / `_only_license_access` (`GET /events`, roles also hold `admin.events`)
  - `test_mutation_batch_events_only_cost_access` / `_only_license_access`
  - `test_dashboard_recent_activity_only_cost_access` / `_only_license_access` and `test_admin_dashboard_feed_only_cost_access` / `_only_license_access` (the two `reports.py` feeds)
  - `test_sse_drop_set_only_cost_access` / `_only_license_access` (the drop set computed by `event_stream`'s auth block, asserted through the helper it calls, as `tests/api/test_events.py` does)
- [ ] **Step 2: Run** `./scripts/test.sh tests/services/test_license_event_redaction.py tests/api/test_license_event_feeds.py` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** same plus `./scripts/test.sh tests/services/test_cost_event_redaction.py tests/api/test_events.py tests/api/test_cost_history_api.py tests/services/test_rollback*.py` → PASS.
- [ ] **Step 5: Commit** `feat(licensing): license events redacted on every feed`.

---

### Task 7: Migration 178 from the extension, `licensingModel` built in

**Files:**
- Create: `backend/app/services/licensing_migration.py`, `backend/alembic/versions/178_licensing_from_extension.py`
- Modify: `backend/app/services/extensions/field_contributions.py` (extract the pure strip), `backend/app/services/seed.py` (import the field definition), `backend/app/main.py` (`_DQ_RESCORE_FLAG = "dataQualityCanonicalRescoreDoneV4"`)
- Test: `backend/tests/services/test_licensing_migration.py`, `backend/tests/services/test_extension_field_contributions.py` (existing + one case), `backend/tests/services/test_dq_rescore_once.py` (existing)

**Interfaces:**
- Produces (`licensing_migration.py`, no DB, no app models, so the migration, `seed.py` and the tests can import it):
```python
EXT_KEY = "licensing"
MODEL_KEY = "licensingModel"
GENERAL_SECTION = {"Application": "Application Information", "ITComponent": "Component Information"}
LICENSING_MODEL_FIELD: dict   # THE one definition: {"key": "licensingModel", "label": "Licensing Model", "type": "multiple_select", "weight": 0,
                              #   "options": [{"key": "users", "label": "Users", "translations": {}}, {"key": "installations", "label": "Installations", "translations": {}}],
                              #   "translations": {}}   -- the nine locales are filled by /translate here
def slug(name: str) -> str | None
def assign_keys(names: Iterable[str]) -> dict[str, tuple[str, str]]   # casefolded name -> (key, first-seen label); type_<n> fallback; collisions _2, _3
def build_items(attrs: dict, keys: dict) -> tuple[dict, list[dict]]   # items, problems [{field, category, value, reason: "not_numeric"|"negative"|"rounded"}]
def move_model_field(type_key: str, schema: list) -> list | None      # None = no change
def citing_calculations(rows: list[tuple[str, str, str]]) -> list[dict]
```
  `slug`: lower-case, runs outside `[a-z0-9]` → `_`, trimmed, max 64; `None` when empty or not starting with a letter. Any slug matching `^[A-Za-z][A-Za-z0-9_]{0,63}$` is inserted (no reserved list for license types, Task 3).
- `seed.py`: the Application "Application Information" and IT Component "Component Information" sections append `copy.deepcopy(LICENSING_MODEL_FIELD)`. **`/translate` (Task 17) fills `LICENSING_MODEL_FIELD["translations"]` and both options' `translations` in `backend/app/services/licensing_migration.py`; `tests/services/test_i18n_seed.py` fails until then.**
- Produces (`field_contributions.py`): `strip_ext_fields(schema: list, section_config: dict | None, ext_key: str) -> tuple[list, dict | None, int]` — the pure body of `remove_field_contributions` (field filter, empty contributed section dropped, `custom:<i>` order re-indexed); `remove_field_contributions` calls it per type.
- Migration 178 (`revision="178"`, `down_revision="177"`), `_data_body(conn)` sync, testable through `run_sync` like 175:
  1. `fiscalYearStart` as 175 reads it; `current = current_fiscal_year(start)`.
  2. If `card_licenses` has rows, skip steps 3–5 (re-run is a no-op).
  3. Category names from the four keys over Application / IT Component cards → `assign_keys` → insert `license_types` (first-seen order, `ON CONFLICT (key) DO NOTHING`).
  4. Per card holding any of the four keys: `build_items`; insert the `current` row when items are non-empty; strip the four keys from `attributes` whatever the outcome.
  5. Report entries per card (cells moved, problems).
  6. Per type: `strip_ext_fields(schema, section_config, "licensing")` then `move_model_field`; write `fields_schema` / `section_config` when changed. Runs on instances without the extension too (adds the field). `licenseType` and `numberOfUsers` are never touched.
  7. **Nothing else of the extension**: no `extensions` row update.
  8. `licensing_migration_report` in `general_settings` (key-scoped `||`), only when non-empty: `{"total", "entries": [...200], "license_types": [{key, label}], "calculations": citing_calculations(...), "saved_reports": [{"id", "name", "report_type"} for report_type LIKE 'ext:licensing:%']}` (listed, left as they are).
  Scores refresh through the startup one-shot (flag V4), migration 137's pattern. `downgrade`: data one-way (docstring, as 175).

- [ ] **Step 1: Write the failing tests** (`test_licensing_migration.py`)
```python
def test_slug_and_type_fallback():
    assert slug("End User") == "end_user" and slug("  Prod-1 ") == "prod_1" and slug("123") is None and slug("—") is None
def test_assign_keys_merges_case_and_falls_back():
    k = assign_keys(["Prod", "prod", "123", "End User"])
    assert k["prod"] == ("prod", "Prod") and k["123"][0] == "type_1" and k["end user"][0] == "end_user"
def test_assign_keys_suffixes_slug_collisions(): assert {v[0] for v in assign_keys(["a b", "a-b"]).values()} == {"a_b", "a_b_2"}
def test_build_items_sums_duplicates_and_reports_bad_values():
    items, problems = build_items({"licensedUsers": [{"category": "Admin", "value": 2}, {"category": "admin", "value": 3}],
                                   "actualUsers": [{"category": "Admin", "value": "x"}, {"category": "Dev", "value": -1}, {"category": "Admin", "value": 1.6}]}, keys)
    assert items == {"users": {"admin": {"licensed": 5, "actual": 2}}}
    assert {p["reason"] for p in problems} == {"not_numeric", "negative", "rounded"}
def test_actual_without_licensed_gets_licensed_zero()
def test_move_model_field_into_general_section_and_drop_ext_section()
def test_move_model_field_adds_on_instance_without_extension()
def test_move_model_field_keeps_an_admin_field_with_the_same_key()   # -> None
def test_seed_uses_the_one_field_definition()   # the seed's Application field == LICENSING_MODEL_FIELD
def test_citing_calculations_lists_formulas_naming_old_keys()
async def test_migration_moves_values_strips_keys_and_leaves_the_extension_row(db)   # extensions.enabled unchanged
async def test_migration_lists_ext_saved_reports_and_leaves_them(db)
async def test_migration_leaves_license_type_and_number_of_users_fields(db)
async def test_second_run_changes_nothing(db)
async def test_report_is_capped_at_200(db)
```
`test_extension_field_contributions.py`: `test_strip_ext_fields_matches_remove_field_contributions` (same schema and `section_config` in, same out).
- [ ] **Step 2: Run** `./scripts/test.sh tests/services/test_licensing_migration.py tests/services/test_extension_field_contributions.py` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `./scripts/test.sh tests/services/test_licensing_migration.py tests/services/test_extension_field_contributions.py tests/services/test_dq_rescore_once.py tests/services/test_alembic_timestamp_defaults.py tests/services/test_seed_demo.py` → PASS. Also run `tests/services/test_i18n_seed.py`: it **fails** on the new field's missing translations until `/translate` runs in Task 17; record that in the task's report, do not fill the locales here.
- [ ] **Step 5: Commit** `feat(licensing): migrate the extension's data into core`.

---

### Task 8: Report API and saved report type

**Files:**
- Create: `backend/app/services/license_report.py`; extend `backend/app/schemas/licenses.py`
- Modify: `backend/app/api/v1/reports.py` (new route), `backend/app/api/v1/saved_reports.py` (`"licensing"` in `VALID_REPORT_TYPES`)
- Test: `backend/tests/services/test_license_report.py`, `backend/tests/api/test_reports_licensing.py`, `backend/tests/api/test_saved_reports.py` (one case)

**Interfaces:**
- Consumes: `yearly_rows.resolve_year`, `card_licenses.licensed_only`, `license_status.metric_result`, `cost_grouping.parse_group_by` / `assign_groups`, `lifecycle.is_live_in_fiscal_year`, `CardReadScope`.
- Produces (`license_report.py`):
```python
PLATFORM_RELATIONS = ("relPlatformToApp", "relPlatformToITC")
async def items_by_card(db, card_ids, years: list[int], start_month) -> dict[UUID, dict[int, tuple[dict, bool, int | None]]]   # one query, resolve_year per (card, year)
def counts_in_year(card: Card, has_row: bool, fy: int, cur: int, start_month: int) -> bool
    # fy == cur: is_live_in_fiscal_year(card.lifecycle, cur, start_month); other years (Forecast included): has_row
async def candidate_cards(db, read_scope, metric, *, type_key: str | None = None, platform_id: UUID | None = None, card_id: UUID | None = None) -> list[Card]
    # ACTIVE, readable (mode="module"), licensingModel contains metric; by type, by the Platform's direct links (either direction, deduped), or the one card
async def build_report(db, read_scope, *, type_key, metric, fy, group_by: GroupBy | None, card_id: UUID | None) -> dict
```
  The rows of a year and every trend bar use `candidate_cards` filtered by `counts_in_year`, for the type, the Platform aggregate and the single picked card alike (one rule, so the Platform aggregate gets the lifecycle gate and the stored-row rule too).
- Route: `GET /reports/licensing` — `type` (`Application` | `ITComponent`, else 400), `metric` (`users` | `installations`, else 400), `fiscal_year` (optional, `cur-4 … cur`; the Forecast year 400 `forecast_not_selectable`), `group_by` (as cost), `card_id` (optional UUID of an Application / IT Component / Platform; hidden → 404, other type → 400). Gate `licenses.view`. With a Platform `card_id`, `type` and `group_by` are ignored.
- Response:
```json
{
  "fiscal_year": 2026, "current_fiscal_year": 2026, "fiscal_year_start": 1, "metric": "users",
  "years": [2022, 2023, 2024, 2025, 2026, 2027],
  "license_types": [{"key", "label", "translations", "archived", "sort_order"}],
  "aggregate": null | {"id", "name", "type": "Platform"},
  "rows": [{"id", "name", "type", "attributes", "group"?, "status", "worst_pct", "worst_no_licence",
            "licensed_total", "actual_total",
            "by_type": {"<key>": {"licensed", "actual", "pct", "no_licence", "status"}}}],
  "trend": [{"fiscal_year": 2026, "cards": {"<card id>": {"<key>": {"licensed": 1, "actual": null}}}}]
}
```
`status` is `null` on every row when `aggregate` is set.

- [ ] **Step 1: Write the failing tests**
`test_license_report.py`: `test_current_year_applies_lifecycle_gate_and_archived_excluded`, `test_past_year_lists_cards_with_a_row_only`, `test_cards_without_metric_in_model_are_left_out`, `test_current_year_carry_forward_reads_licensed_only`, `test_trend_has_six_years_and_forecast_licensed_only`, `test_group_by_field_assigns_raw_values`, `test_retired_card_only_in_its_recorded_years` (Review Focus 5).
`test_reports_licensing.py` (users via `create_user` / `create_role`):
```python
async def test_requires_licenses_view(client, db)            # viewer -> 403
async def test_rows_statuses_and_trend(client, db)           # one over, one approaching, one no-data card
async def test_forecast_year_refused(client, db)             # 400
async def test_bad_metric_and_type_refused(client, db)       # 400 each
async def test_hidden_card_omitted_from_rows_and_trend(client, db)
async def test_card_id_hidden_is_404(client, db)
async def test_platform_aggregate_counts_once_and_applies_the_report_rules(client, db)  # Review Focus 4: double link counted once; hidden, archived, retired-before-current left out of the current year
async def test_platform_aggregate_past_year_needs_a_stored_row(client, db)
async def test_platform_aggregate_has_no_status(client, db)
async def test_fiscal_year_start_april_names_the_current_year(client, db)   # Review Focus 2
```
`test_saved_reports.py`: `test_licensing_report_type_accepted`.
- [ ] **Step 2: Run** `./scripts/test.sh tests/services/test_license_report.py tests/api/test_reports_licensing.py tests/api/test_saved_reports.py` → FAIL.
- [ ] **Step 3: Implement** (two queries for the cards and their rows over all six years; no per-card query).
- [ ] **Step 4: Run** same plus `tests/services/test_card_read_scope_guard.py tests/api/test_read_scope_sentinel_sweep.py` → PASS.
- [ ] **Step 5: Commit** `feat(licensing): Licensing report API`.

---

### Task 9: Import API

**Files:**
- Create: `backend/app/services/license_import.py`
- Modify: `backend/app/api/v1/card_licenses.py` (route), `backend/app/api/v1/file_attachments.py` (rename `_read_validated_upload` to `read_validated_upload`, callers updated, no behaviour change), `backend/app/services/workspace_io/bundle.py` (`_check_declared_sizes(zf, *, max_member=MAX_ASSET_BYTES, max_total=MAX_BUNDLE_UNCOMPRESSED_BYTES, error=BundleFormatError)`, defaults keep today's behaviour)
- Test: `backend/tests/services/test_license_import.py`, `backend/tests/api/test_license_import_api.py`

**Interfaces:**
- Consumes: Task 5 `merge_cell`, `publish_change`, `get_year`; Task 3 `license_types.list_items`, `archived_keys`; `read_validated_upload`; `bundle._check_declared_sizes`.
- Produces:
```python
HEADERS = ("component", "metric", "license type", "year", "licensed", "actual")   # compared lower-cased; "licence type" also accepted
METRIC_ALIASES = {"users": "users", "user": "users", "installations": "installations", "installation": "installations"}
MAX_XLSX_MEMBER_BYTES = 50 * 1024 * 1024
MAX_XLSX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
class ImportFileError(ValueError)        # unreadable, oversized when inflated, empty, wrong headers -> 400
@dataclass class ImportRow: row: int, component: str, metric: str, license_type: str, year: object, licensed: object, actual: object
@dataclass class RowIssue: row: int, component: str, reason: str, detail: str = ""
@dataclass class ImportPlan: cells: dict[tuple[UUID, int], list[tuple[str, str, object, object]]], matched: int, skipped: list[RowIssue], flagged: list[RowIssue]
def parse_workbook(data: bytes) -> list[ImportRow]   # zipfile.ZipFile on the bytes -> _check_declared_sizes(limits above, error=ImportFileError) -> openpyxl read_only, first sheet
async def plan_import(db, user, rows: list[ImportRow]) -> ImportPlan
async def apply_import(db, user_id, plan: ImportPlan) -> int   # per card-year: old = get_year; merge_cell per cell (empty cell = UNSET); publish_change once
```
  Skip reasons (codes the page translates): `card_not_found`, `ambiguous_card`, `unknown_license_type`, `ambiguous_license_type`, `archived_license_type`, `invalid_metric`, `invalid_year` (not an integer or outside `current-5 … current+1`), `invalid_number` (not an integer `>= 0`; `"12"` and `12.0` accepted), `forecast_actual`, `duplicate_cell` (every row of a duplicated `(card, year, metric, type)`), `nothing_to_write` (both empty). Flag (applied, listed): `metric_not_tracked`. The year/metric/type/archived/Forecast checks in `plan_import` call the same predicates `merge_cell` raises on (a dry run reports exactly what an apply would refuse); `apply_import` still goes through `merge_cell`. Card match: `name.strip().casefold()` among readable (mode `"module"`), ACTIVE Application / IT Component cards; a hidden card is `card_not_found`. Type match: casefolded key or English label.
- Route `POST /licenses/import?dry_run=true|false` (multipart `file`), `require_permission("licenses.edit")`: permission → `read_validated_upload(file)` (only `.xlsx`, else 400) → `await db.commit()` (connection back to the pool) → `rows = await run_in_threadpool(parse_workbook, data)` (`ImportFileError` → 400) → `plan_import` → unless dry run `apply_import` + commit. Response `{"matched", "applied", "skipped": [RowIssue], "flagged": [RowIssue]}`. The import never touches `licensingModel`.

- [ ] **Step 1: Write the failing tests**
`test_license_import.py` (workbooks built with openpyxl in the test):
```python
def test_parse_accepts_uk_spelling_text_numbers_and_trailing_blanks()   # Review Focus 1
def test_parse_rejects_wrong_headers_and_non_xlsx_bytes()
def test_parse_refuses_a_zip_bomb()   # a zip whose central directory declares a 200 MB member -> ImportFileError before openpyxl opens it
async def test_plan_matches_case_insensitive_and_flags_untracked_metric(db)
async def test_plan_skips_every_reason(db)   # one row per code; set of reasons == the documented set
async def test_duplicate_cells_are_all_skipped(db)
async def test_empty_cell_leaves_stored_value(db)        # stored actual 5; row Actual empty, Licensed 10 -> licensed 10, actual 5
async def test_dry_run_and_apply_agree(db)               # every row skipped by the plan is also refused by merge_cell
async def test_apply_one_event_per_card_year(db)
async def test_import_year_uses_fiscal_year_start(db)    # Review Focus 2
```
`test_license_import_api.py`: `test_requires_licenses_edit` (member 403), `test_stakeholder_editor_still_403`, `test_dry_run_writes_nothing`, `test_apply_writes_and_returns_counts`, `test_renamed_executable_refused_400`, `test_over_20mb_refused_400`, `test_zip_bomb_refused_400`, `test_hidden_card_reads_as_not_found`.
`tests/services/test_workspace_io_unit.py` stays green with the new keyword defaults.
- [ ] **Step 2: Run** `./scripts/test.sh tests/services/test_license_import.py tests/api/test_license_import_api.py` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** same plus `tests/api/test_file_attachments*.py tests/services/test_db_session_holding.py tests/services/test_workspace_io_unit.py tests/api/test_workspace_transfer_upload.py` → PASS.
- [ ] **Step 5: Commit** `feat(licensing): Excel import with preview`.

---

### Task 10: Workspace transfer

**Files:**
- Modify: `backend/app/services/workspace_io/schema.py` (`SHEET_LICENSE_TYPES = "LicenseTypes"`, `ConfigSection` after `CostItemTypes`, columns `("key", "label", "sort_order", "archived", "translations")`, `json_columns={"translations"}`), `sections.py` (`EntitySection("CardLicenses", CardLicense, card_fk_columns=("card_id",), natural_key=("card_id", "fiscal_year"))` after `CardCosts`), `remap.py` (`REPORT_CARD_ID_KEYS = ("center", "pickedCardId")`)
- **Not** modified: `applier.py`'s card-finalising sheet set (stated deviation: licenses change no card attribute; spec updated)
- Test: `backend/tests/services/test_workspace_io_licenses.py`; `test_workspace_io_id_bearing_columns.py` allowlist `("CardLicenses", "items"): "license counts keyed by metric and license type key, no ids"`; `test_workspace_io_remap.py` (one case)

- [ ] **Step 1: Write the failing tests** (mirror `test_workspace_io_cost_items.py`): `test_round_trip_carries_types_and_card_licenses` (export → wipe inventory → import: same type keys, same items per `(card, year)` on the new card ids), `test_reimport_is_all_skip`, `test_selected_sheet_card_licenses_applies` (`sheets={"CardLicenses"}`), `test_saved_report_picked_card_id_is_remapped`.
- [ ] **Step 2: Run** `./scripts/test.sh tests/services/test_workspace_io_licenses.py tests/services/test_workspace_io_id_bearing_columns.py tests/services/test_workspace_io_remap.py` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** same plus `tests/services/test_workspace_io_roundtrip.py tests/services/test_workspace_io_cost_items.py` → PASS.
- [ ] **Step 5: Commit** `feat(licensing): workspace transfer of license types and card licenses`.

---

### Task 11: Demo seed

**Files:** Create `backend/app/services/seed_demo_licensing.py` (`SEEDER_KEY = "licensing"`); Modify `backend/app/main.py` (under `settings.SEED_DEMO`, after the base demo seeder, like `seed_demo_extras`); Test `backend/tests/services/test_seed_demo_licensing.py`

**Interfaces:** `async def seed_licensing_demo_data(db) -> dict` — skipped when `demo_seed_completed(db, "licensing")`; else creates `admin` "Admin", `end_user` "End User", `dev` "Dev" if absent, sets `licensingModel` on 4 Applications and 2 IT Components of the demo (by name), writes rows for `current-2 … current+1` (Forecast licensed only) with at least one card per status, marks the seeder, flushes.

- [ ] **Step 1: Write the failing tests**: `test_seeds_once_by_marker`, `test_marker_holds_after_data_deleted`, `test_every_status_is_present_in_current_year`, `test_forecast_rows_have_no_actual`, `test_skips_without_demo_cards`.
- [ ] **Step 2: Run** `./scripts/test.sh tests/services/test_seed_demo_licensing.py` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** same plus `tests/services/test_seed_markers.py tests/services/test_seed_demo.py` → PASS.
- [ ] **Step 5: Commit** `feat(licensing): demo data`.

---

### Task 12: Frontend types, helpers, card section, dialogs, catalogue admin

**Files:**
- Modify: `frontend/src/types/index.ts`, `frontend/src/features/reports/costColors.ts`, `frontend/src/features/admin/metamodel/ManageCostItemsDialog.tsx`, `frontend/src/features/admin/MetamodelAdmin.tsx`, `frontend/src/features/cards/sectionConfig.ts`, `dataQualityJump.ts`, `CardDetailContent.tsx`, `frontend/src/features/admin/CardLayoutEditor.tsx`, `frontend/src/i18n/locales/en/{cards,admin}.json`
- Create: `frontend/src/lib/licenses.ts`, `frontend/src/features/cards/sections/LicensingSection.tsx`, `LicenseItemDialog.tsx`, `licensingBarOption.ts`
- Test: `lib/licenses.test.ts`, `costColors.test.ts` (extend), `licensingBarOption.test.ts`, `ManageCostItemsDialog.test.tsx` (extend), `sectionConfig.test.ts` (extend), `LicensingSection.test.tsx`, `LicenseItemDialog.test.tsx`

**Interfaces:**
- Consumes: Task 5 response shapes; Task 3 `/metamodel/license-types`.
- Produces (types): `LicenseType = CostItemType`, `LicenseMetric = "users" | "installations"`, `LicenseTypeStatus`, `LicenseStatus`, `LicenseTypeResult`, `LicenseMetricResult`, `YearLicenses`, `CardLicensesResponse` (field names exactly the backend schemas').
- Produces (`lib/licenses.ts`):
```ts
export const LICENSE_TYPES: readonly string[] = ["Application", "ITComponent"];
export const LICENSE_METRICS: readonly LicenseMetric[] = ["users", "installations"];
export const isLicenseType = (typeKey: string): boolean
export function statusColor(s: LicenseStatus | LicenseTypeStatus): string   // STATUS_COLORS.error / warning / success / neutral
export const STATUS_ORDER: readonly LicenseStatus[] = ["over", "approaching", "no_actual_data", "compliant"]
export function formatPct(pct: number | null, noLicence: boolean, t: TFunction): string   // "120 %", t("licensing.noLicense"), "—"
```
- Produces (`costColors.ts`): `catalogueHues(keysInSortOrder: string[], categorical: readonly string[], other: string): Map<string, string>`.
- Produces (`licensingBarOption.ts`, own builder — simpler than overloading `costsStackedBarOption`, which stays untouched): `buildLicensingBarOption(segments: {key: string; label: string; licensed: number; actual: number | null; color: string}[], o: {chrome; isRtl; licensedLabel: string; actualLabel: string}): EChartsCoreOption` — two category rows (Licensed, Actual), one stacked series per type with `data: [licensed, actual ?? 0]`, licensed bar `opacity: 0.35`, a type with licensed 0 kept (zero-width), `null` actual drawn as 0.
- Produces (`ManageCostItemsDialog.tsx`): props `path?: string` (default `/metamodel/cost-item-types`), `textKey?: "costItems" | "licenseTypes"` (default `"costItems"`), i18n keys `admin:metamodel.${textKey}.*`. **Accepted cost:** about 20 keys become dynamic and leave the static check of `src/i18n/translationKeys.test.ts`; covered instead by `ManageCostItemsDialog.test.tsx` `it("every text key exists for both catalogues")`, which resolves each key used by the dialog against `en/admin.json` for both `textKey` values.
- Produces (`sectionConfig.ts`): `"licensing"` in `DEFAULT_SECTION_ORDER` after `"costs"`; `buildSectionOrder(..., has: {...; licensing?: boolean})` splices it after `costs` (else after `lifecycle`) and drops it for other types; `BuiltInSectionKey` gains `"licensing"`; `CardLayoutEditor` lists it (`icon: "badge"`, `onlyIf: isLicenseType`).
- `LicensingSection` props `{ cardId; initialExpanded?; expandOn?; onEditModel?: () => void }`, copying `CostsSection`'s structure: `useApiQuery<CardLicensesResponse>`, null on 403/404, year navigator (`costFiscalYearName`), fallback banner + Confirm, `licensingModel` read-only chips with an Edit link (`onEditModel`; `CardDetailContent` jumps to the section holding the field via `customSectionAnchor`), one block per tracked metric: headline, `buildLicensingBarOption`, one tile per type (label, status pill, `actual / licensed`, pct, meter), Forecast "licensed only". Empty model: hint + edit link. Add button / tile click open `LicenseItemDialog` when `can_edit`.
- `LicenseItemDialog` props `{ cardId; fiscalYear; forecastYear; metrics; cell: {metric, key, licensed, actual} | null; options: LicenseType[]; labelOf; onClose; onChanged }`: metric + type selects (add mode), integer Licensed and Actual (Actual disabled on the Forecast year), Save → PUT, Remove → DELETE, "Copy licensed to Forecast" (not on the Forecast year); error codes → `cards:licensing.errors.<code>`.

- [ ] **Step 1: Write the failing tests**
```ts
it("maps each status to its semantic token")                         // licenses.test.ts
it("formats pct, no license and missing")
it("catalogueHues: sort order, 9th folds to other")                  // costColors.test.ts
it("two rows, licensed faded, zero-licensed type kept, null actual as 0")   // licensingBarOption.test.ts
it("uses the license types path and texts")                          // ManageCostItemsDialog.test.tsx
it("every text key exists for both catalogues")
it("splices licensing after costs into an older stored order"); it("drops licensing for other types")   // sectionConfig.test.ts
it("renders nothing on 403 and on 404")                               // LicensingSection.test.tsx
it("one block per tracked metric with type tiles and status pills")
it("carried-forward banner with Confirm only when can_edit")
it("Forecast tiles say licensed only")
it("empty model shows the hint and calls onEditModel")
it("PUTs integers to the cell path"); it("sends actual null when Actual is cleared")   // LicenseItemDialog.test.tsx
it("shows the server error for archived_type"); it("hides copy-to-forecast in the Forecast year")
```
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/lib/licenses.test.ts src/features/reports/costColors.test.ts src/features/cards/sections src/features/admin/metamodel/ManageCostItemsDialog.test.tsx src/features/cards/sectionConfig.test.ts` → FAIL.
- [ ] **Step 3: Implement**; English keys only under `cards:licensing.*` and `admin:metamodel.licenseTypes.*` (same names as `costItems.*`).
- [ ] **Step 4: Run** same plus `npx vitest run src/theme/rawColours.sourceScan.test.ts src/theme/staticLabels.test.tsx src/i18n/translationKeys.test.ts src/features/cards/sections/CostsSection.test.tsx` → PASS; tsc + lint clean.
- [ ] **Step 5: Commit** `feat(licensing): card section and license type admin`.

---

### Task 13: Report page — trend, Utilisation, By license type

**Files:**
- Create: `frontend/src/features/reports/LicensingReport.tsx`, `licensingUtilisationOption.ts`, `licensingByTypeOption.ts`
- Modify: `frontend/src/features/reports/costTrendOption.ts`, `frontend/src/i18n/locales/en/reports.json`
- Test: `LicensingReport.test.tsx`, `licensingUtilisationOption.test.ts`, `licensingByTypeOption.test.ts`, `costTrendOption.test.ts` (extend)

**Interfaces:**
- Consumes: Task 8 response; Task 12 `lib/licenses.ts`, `catalogueHues`; `ReportShell`, `CardScopeFilter`, `useCardScope`, `MetricCard`, `FullscreenPanel`, `CostDrillBar`, `costDrill` (`Drill`, `crumbsOf`, `applyDrill`), `CostLegend`, `costFiscalYearName`, `CardPicker`, `CardDetailSidePanel`, `useApiQuery`, `commonGroupableFields`, `relationGroupOptions`.
- Produces (`costTrendOption.ts`): `CostTrendOptions` gains `colorOf?: (component: string, i: number) => string` and `extraSeries?: object[]` (appended); defaults unchanged. Licensing passes `colorOf` from `catalogueHues`, `format: String` and one `scatter` series "Licensed" (`symbol: "rect"`, `symbolSize: [32, 3]`, colour `chrome.text`).
- Produces:
```ts
export interface UtilisationBar { id: string; name: string; pct: number | null; noLicence: boolean; status: LicenseStatus; typeLabel?: string }
export function buildUtilisationOption(bars: UtilisationBar[], o: { chrome; isRtl; noData: string; noLicense: string }): EChartsCoreOption
// sorted pct desc (no-license first, no-data last); colour statusColor; markLine 80 and 100; markArea 0-80 / 80-100 / 100-max
// (STATUS_COLORS, low opacity); x max = max(120, highest pct + 10); no-license bar at x max; no-data bar 0 labelled; height grows with rows
export interface ByTypeBar { key: string; label: string; licensed: number; actual: number | null; color: string }
export function buildByTypeOption(bars: ByTypeBar[], o: { chrome; isRtl; licensedLabel: string; actualLabel: string }): EChartsCoreOption
```
- `LicensingReport` state (saved-config keys exactly): `cardTypeKey`, `metric`, `licenseType` (`""` = All), `groupBy`, `view` (`"chart"` Utilisation, `"bytype"`, `"table"`), `scopeIds`, `fiscalYearParam` (`null` = current; `cur … cur-4`, no Forecast), `pickedCardId`, `extraColumns`, `sortK`, `sortD`. One `useApiQuery` on `/reports/licensing?type&metric&fiscal_year&group_by&card_id`; `licenseType`, scope, drill and view never refetch. `ReportShell` with `view`, `onViewChange`, `chartViewLabel` (Utilisation), `extraViews=[{value: "bytype", icon: "bar_chart", label}]`, `chartRef`, toolbar (type, metric, license type, group-by, `CardScopeFilter`, year select + chip; `CardPicker types={["Application","ITComponent","Platform"]}` in the By-type view). Metric cards from row statuses (or `by_type[licenseType].status`, `no_data` counted as No actual data), hidden with `aggregate`. Trend above every view, always shown, summed over scope (`scope.closure`), drill and pick. Utilisation: left click side panel, right click drills, `CostDrillBar`, hint; drill resets on type, metric, group-by, year, pick. By type: no drill. `CostLegend` for license types. The Table view and the Import button come in Tasks 14 and 15 (placeholder branch `view === "table"` renders nothing until then).

- [ ] **Step 1: Write the failing tests**
```ts
it("sorts by pct desc, no-license first, no-data last"); it("colours by status token, markLine 80 and 100"); it("no-license bar at the axis max")
it("one licensed and one actual series per type, licensed faded"); it("missing actual shows a dash label")
it("uses colorOf when given and appends extraSeries"); it("cost defaults unchanged")
it("requests /reports/licensing with type, metric and no fiscal_year by default")
it("metric cards count statuses and follow the license type filter")
it("does not offer the Forecast year")
it("picking a Platform sends card_id, hides metric cards and resets the drill")
it("scope and drill re-sum the trend without a new request")
it("right click drills and Back climbs; left click opens the side panel")
```
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/features/reports/licensing src/features/reports/LicensingReport.test.tsx src/features/reports/costTrendOption.test.ts` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** same plus `npx vitest run src/features/reports/Cost src/features/reports/cost src/theme/rawColours.sourceScan.test.ts` → PASS; tsc + lint clean.
- [ ] **Step 5: Commit** `feat(licensing): report page charts`.

---

### Task 14: Report page — table, columns, export, saved reports, route, nav

**Files:**
- Create: `frontend/src/features/reports/LicensingTable.tsx`
- Modify: `LicensingReport.tsx`, `savedReportStyles.ts`, `frontend/src/App.tsx`, `frontend/src/lib/routePermissions.ts`, `frontend/src/lib/pageTitle.ts`, `frontend/src/layouts/navItems.ts`, `en/{reports,nav}.json`
- Test: `LicensingTable.test.tsx`, `LicensingReport.test.tsx` (extend), `routePermissions.test.ts` (existing)

**Interfaces:**
- `LicensingTable` props `{ rows; types: LicenseType[]; labelOf; groups?; extraColumns; fields; sortK; sortD; onSort; onOpen; onDrill }`: one header row (`<label> lic.`, `<label> act.`, `<label> %` per type, `Total lic.`, `Total act.`, `Status`, extra columns from `isBuiltInFieldType` fields), group header rows, total row without %, plain-text cells so `extractSheetsFromDOM` exports them.
- Export: `ReportShell`'s defaults already give what the spec asks — with `hasTableToggle` true, `showPptxItem = exportEnabled && view !== "table"` and `showXlsxItem` in the table view only (`ReportShell.tsx` ~lines 73–82); `LicensingReport` passes `chartRef` and no `buildExportData` / `disableExport`. Print through `printParams` (type, metric, license type, year).
- Saved reports: `useSavedReport("licensing")`, `useThumbnailCapture`, `SaveReportDialog reportType="licensing"`, `getConfig()` with the keys of Task 13, restore on `saved.loadedConfig`, reset to defaults.
- Route `/reports/licensing` (lazy) in `App.tsx`; `ROUTE_PERMISSIONS` `{ path: "/reports/licensing", permission: "licenses.view" }`; `navItems.ts` `{ labelKey: "reports.licensing", icon: "badge", path: "/reports/licensing" }` after cost; `pageTitle.ts`; `savedReportStyles.ts` `licensing: { icon: "badge", color: <a theme token, no hex>, path: "/reports/licensing" }` and its label.

- [ ] **Step 1: Write the failing tests**
```ts
it("one header row with lic./act./% per type and no total %")      // LicensingTable.test.tsx
it("sorts by a type column"); it("right click drills, click opens"); it("group header rows when grouped")
it("Columns menu lists only built-in field types")                  // LicensingReport.test.tsx
it("offers XLSX and not PPTX in the table view, PPTX in the chart views")   // open ReportShell's menu, assert the items
it("persists and restores pickedCardId and the view through the saved config")
// routePermissions.test.ts parity passes with the new route and the Task 1 KNOWN_PERMISSIONS entries
```
- [ ] **Step 2: Run** `npx vitest run src/features/reports/LicensingTable.test.tsx src/features/reports/LicensingReport.test.tsx src/lib/routePermissions.test.ts` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** same plus `npx vitest run src/lazyRoutes.sourceScan.test.tsx src/theme/rawColours.sourceScan.test.ts src/features/reports/ReportShell` → PASS; tsc + lint clean.
- [ ] **Step 5: Commit** `feat(licensing): report table, saved reports and navigation`.

---

### Task 15: Import dialog

**Files:** Create `frontend/src/features/reports/LicensingImportDialog.tsx`; Modify `LicensingReport.tsx` (`ReportShell.actions`: Import button with `licenses.edit` or `*`), `en/reports.json`; Test `LicensingImportDialog.test.tsx`, `LicensingReport.test.tsx` (extend)

**Interfaces:** `LicensingImportDialog({ open, onClose, onApplied })` — `accept=".xlsx"`, column hint, `api.upload("/licenses/import?dry_run=true", file)` → matched / skipped pills, table of skipped and flagged rows (row, component, `reports:licensing.import.reasons.<code>`), Apply (`dry_run=false`, same file) "Apply N rows", disabled at 0; `onApplied()` bumps the report's `refetchKey`. Pre-upload size check with `MAX_ATTACHMENT_BYTES` (`lib/attachmentFormats.ts`).

- [ ] **Step 1: Write the failing tests**: `it("previews with dry_run=true and lists skipped rows with their reason")`, `it("applies with dry_run=false and calls onApplied")`, `it("disables Apply when nothing matched")`, `it("refuses a file over the size cap before uploading")`, `it("shows the server message on a 400")`, `it("has a translation key for every backend reason code")` (codes of Task 9 listed in the test), and in `LicensingReport.test.tsx` `it("shows Import only with licenses.edit")`.
- [ ] **Step 2: Run** `npx vitest run src/features/reports/LicensingImportDialog.test.tsx src/features/reports/LicensingReport.test.tsx` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** → PASS; tsc + lint clean.
- [ ] **Step 5: Commit** `feat(licensing): import dialog`.

---

### Task 16: Docs, version, changelog, OpenAPI, rules proposal

**Files:** `docs/guide/reports.md` ("## Licensing Report" after Cost Report), `docs/guide/card-details.md` (Licensing section), `docs/admin/metamodel.md` ("## License types" after "## Cost items"), `docs/admin/workspace-transfer.md` (two sheets), `docs/reference/glossary.md` (License type, Utilisation), `scripts/screenshots/pages.ts` (`103_report_licensing` route `/reports/licensing`; `104_card_licensing` on a demo Application scrolled to the section; `filenames` for the 8 named locales), `VERSION`, `CHANGELOG.md`, `docs/api/openapi.json`; proposal only: `.claude/rules/licensing-items.md`.

- [ ] **Step 1: Docs** in English only, image references to `../assets/img/en/103_report_licensing.png` and `104_card_licensing.png`; `mkdocs build --strict` → no error.
- [ ] **Step 2: Version and changelog**: `VERSION` → `2.190.0`; `## [2.190.0] - <date>`: **Added** (Licensing section on Application and IT Component cards; Licensing report with Utilisation, By license type and Table views; Excel import of license counts; License types catalogue), **Changed** (the Licensing Analysis extension's data moves into core: uninstall the extension after upgrading; new `licenses.view` / `licenses.edit` permissions, copied from the extension's grants).
- [ ] **Step 3: OpenAPI**: from the repo root `python scripts/dump_openapi.py`; `git diff docs/api/openapi.json` shows only `/cards/{card_id}/licenses…`, `/metamodel/license-types…`, `/reports/licensing`, `/licenses/import` and their schemas.
- [ ] **Step 4: Rules file proposal** — prepare, do not write, `.claude/rules/licensing-items.md` (frontmatter `paths:` = the licensing services, routes, models, migrations 177/178, `LicensingSection*`, `LicensingReport*`, `licensing*Option.ts`, `lib/licenses.ts`), mirroring `cost-items.md`: data shape, the one status definition (`license_status.py`), year resolution and licensed-only carry, `merge_cell` as the one write rule, permissions, event + redaction on every feed, migration 178 report key, import rules, guard tests. Show the exact lines to the user and ask for a yes.
- [ ] **Step 5: Commit** `docs(licensing): guide, admin page, changelog, OpenAPI` (with the version bump).

---

### Task 17: Finish

- [ ] **Step 1: Migration numbers**: `git fetch upstream && git ls-tree --name-only upstream/main backend/alembic/versions/ | grep -E '^backend/alembic/versions/17[78]_'`. If upstream already holds a 177 or 178, renumber ours (files, `revision`, `down_revision`, the test module paths) on top of upstream's head and re-run Tasks 1 and 7's tests.
- [ ] **Step 2: Graph and full suites**: `/graphify . --update --mode deep`; `./scripts/test.sh` and `cd frontend && npm run test:run`. Expected red before `/translate`: `tests/services/test_i18n_seed.py` (the `licensingModel` field).
- [ ] **Step 3: `/translate`**: nine locales for the new UI keys, `LICENSING_MODEL_FIELD["translations"]` and its two options' `translations` in `backend/app/services/licensing_migration.py` (the one definition `seed.py` and migration 178 share), the doc siblings and screenshot filenames; then `test_i18n_seed.py` and the locale parity tests green.
- [ ] **Step 4: Review chain**, each by a fresh agent, in order: `simplify` → re-run the tests of the files it touched → `ponytail-review` (whole branch; every Must/Should fixed with its test, suites re-run) → `security-review`. VAPT pass (new routes and tables; Medium tier, DB backup first).
- [ ] **Step 5: Render check** in the browser pane against the local deploy (`turbo-ea-conf`, images built per CLAUDE.md, DB backup first): card section (current, carried-forward, Forecast), the report's three views in light and dark, a Platform pick, the import preview, the license types dialog, `ar` once.
- [ ] **Step 6: PR** from the template; push; read the mutation jobs and report survivors to the user. No comments on the PR.

---

## Where the spec contradicts the code, or was ambiguous

Status after the plan review. **Resolved** = decided by the user or the coordinator, or settled by a stated deviation written into the spec.

1. **Trend visibility** — the cost report shows its trend only with the Forecast year selected (`showForecast`), and the licensing year select cannot offer the Forecast year. *Plan: always shown.* Open for the user's confirmation.
2. **`GET /license-types` gate** — **resolved** (coordinator): open to any signed-in user, writes gated by `admin.metamodel`, like the cost catalogue; deviation written into the spec.
3. **Spelling** — **resolved** (coordinator): user-facing English says "license"; note added to the spec. The import also accepts the header `Licence type`.
4. **ITComponent `licenseType` text field** — **resolved** (user): it and Application's `numberOfUsers` stay untouched.
5. **"The general-fields section"** — *Plan: "Application Information" / "Component Information".* Open (minor).
6. **`remove_field_contributions` in a migration** — **resolved**: its pure body `strip_ext_fields` is extracted and called from 178.
7. **Disabling the extension** — **resolved** (user): the extension row is not touched and the installer does not block the key; if re-enabled, the empty fields come back and are removed by hand. Spec bullet rewritten.
8. **Data-quality recompute "for the two types"** — *Plan: `_DQ_RESCORE_FLAG` V4, a whole-instance one-shot at startup (migration 137's pattern).* Open (minor).
9. **Extension saved reports (`ext:licensing:*`)** — **resolved** (coordinator): listed in the migration report, left as they are.
10. **Who filters the trend by scope and drill** — *Plan: per-card trend values in the response, summed by the page.* Open (minor).
11. **Section with an empty `licensingModel`** — *Plan: hint + edit link.* Open (minor).
12. **Archived license type colours vs the Costs section** — *Plan: follows the spec (sort-order hue); costs untouched.* Open (minor).
13. **License type filter and statuses** — *Plan: metric cards and table status follow the picked type; `no_data` counts as No actual data.* Open (minor).
14. **`fiscal_year` in the event payload** — *Plan: added (not sensitive).* Open (minor).
15. **`CardLicenses` among the card-finalising sheets** — **resolved** (coordinator): not added; deviation written into the spec.
16. **Empty and fractional import values** — *Plan: `nothing_to_write`, `invalid_number`.* Open (minor).
17. **Upload helper** — *Plan: `_read_validated_upload` made public and reused.* Open (minor).
18. **Reserved keys for license types** — **resolved** (coordinator): none; `item_catalogue` takes a `reserved` parameter, cost items keep theirs.
19. **Zip-bomb guard on the import** — **resolved** (coordinator): `_check_declared_sizes` from `workspace_io/bundle.py` takes limits and is reused (50 MB member, 100 MB total).
20. **Concurrent first edit** — **resolved** (coordinator's option): the two-session test is dropped, reason under Review Focus.
