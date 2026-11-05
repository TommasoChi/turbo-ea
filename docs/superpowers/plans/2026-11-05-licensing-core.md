# Licensing in core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** draft (not yet read by the fresh plan reviewer, `.claude/rules/spec-and-plan-review.md`).

**Goal:** Licences of an Application / IT Component become yearly core data (`card_licenses` + `license_types`), with a card section, a `Reports → Licensing` page (trend, Utilisation / By licence type / Table), an Excel import, and a migration that retires the `licensing` extension.

**Architecture:** Every piece that has a cost equivalent reuses or generalises the cost code path. The year logic of `card_costs.py` moves into a shared `services/yearly_rows.py`; the catalogue logic of `cost_item_types.py` into `services/item_catalogue.py`; the per-card permission checks, the event redaction and the History summaries of costs are generalised to take a second domain. The licensing-only parts are the status maths (`services/license_status.py`, pure, the only definition of a status), the report rows (`services/license_report.py`) and the import parser (`services/license_import.py`). The frontend reuses `ReportShell`, `CardScopeFilter` / `useCardScope`, `costDrill`, `CostDrillBar`, `CostLegend`, `costColors`, `isBuiltInFieldType`, `EChart`, `CardPicker`, `CardDetailSidePanel`, and generalises `costTrendOption`, `costsStackedBarOption`, `ManageCostItemsDialog` and `sectionConfig`.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, PostgreSQL JSONB, openpyxl (already a dependency); React 18, MUI 6, ECharts through `@/components/charts`, Vitest + Testing Library, pytest.

**Spec:** `docs/superpowers/specs/2026-11-05-licensing-core-design.md` (approved) and its mockups `docs/superpowers/specs/2026-11-05-licensing-core-design-assets/mockups.html`. Where the mockups and the spec differ, the spec wins.

## Global Constraints

- Plain core code: no extension, no `.teax`, no `window.TurboEA.sdk`, no `ext.*` field type; `SDK_VERSION` 1.5 / `UI_SDK_VERSION` 1.19 untouched.
- Card types: `LICENSE_TYPES = ("Application", "ITComponent")` in `backend/app/services/card_licenses.py`, `LICENSE_TYPES` in `frontend/src/lib/licenses.ts`. Platform never holds licences.
- Metric keys `users` / `installations`; the import also accepts `user` / `installation`.
- Item shape: `card_licenses.items = {metric: {license_type_key: {"licensed": int, "actual": int | null}}}`. `actual: null` is "missing", distinct from `0`. Counts are integers `>= 0`.
- Window: section `current-4 … current+1`; writes `current-5 … current+1` (`FISCAL_YEAR_LOOKBACK` / `FISCAL_YEAR_LOOKAHEAD` from `services/fiscal_year.py`). The Forecast year (`current+1`) stores licensed only.
- Year resolution: a year with a row (even empty) is confirmed; only the current year with no row falls back to the latest earlier row (`confirmed=false`), carrying **licensed only**.
- Status: per licence type, no compensation; type `over` when actual > licensed; `approaching` when actual >= 80 % of licensed, licensed > 0, not over; licensed 0 and actual 0 = 0 % compliant; licensed 0 and actual > 0 = over ("no licence"). Priority `over` > `approaching` > `no_actual_data` > `compliant`. The Forecast year has no status.
- Permissions exactly like costs: view = `licenses.view` OR any stakeholder on the card; edit = `licenses.edit` OR a stakeholder role with `card.edit` on that card; hidden card 404. Defaults: `licenses.view` true for `bpm_admin` and `member`, false for `viewer`; `licenses.edit` admin only. Import needs the global `licenses.edit`.
- Event `card.licenses_updated`: licence type keys only, never counts; not rollbackable; redacted with the cost events.
- Colours: licence type hue from `CHART_CATEGORICAL` by catalogue `sort_order` (archived keep theirs), the 9th and later fold into `CHART_OTHER`; status colours from `STATUS_COLORS` (`success`, `warning`, `error`, `neutral`); no raw hex anywhere (the `rawColours` baseline must not rise).
- Version 2.190.0 (minor). English only in the implementation session; `/translate` at the end.
- No mutation testing locally (`make mutation-*`, `mutmut`, `stryker` are CI's).
- Before every commit: `cd backend && ruff format . && ruff check .` (backend tasks); `cd frontend && npx tsc --noEmit && npm run lint` (frontend tasks).
- Every new route registered in `backend/app/api/v1/router.py`, `async def`, permission-checked, `CardReadScope` on every card read, no raw SQL outside Alembic.

## Review Focus

1. **An import file a person actually exports from Excel**: header `License type` (US spelling) or different case, numbers stored as text (`"12"`) or as `12.0`, trailing empty rows, extra columns to the right. Expected: accepted; only a fractional number (`12.5`) or a negative is `invalid_number`. Test: Task 8 `test_parse_accepts_us_spelling_text_numbers_and_trailing_blanks`.
2. **A workspace whose fiscal year starts in April** (`fiscalYearStart=4`): the section window, the import's `Year` check and the report's current year must all name the same year. Test: Task 4 `test_window_follows_fiscal_year_start`, Task 8 `test_import_year_uses_fiscal_year_start`.
3. **An archived licence type in a carried-forward current year**: editing its actual must work (the cell exists), a new cell on it must be refused (409). Test: Task 4 `test_archived_type_editable_when_present_refused_when_new`.
4. **A Platform linked to a card through both `relPlatformToApp` and `relPlatformToITC`, or to a card the caller cannot read, or to an archived card**: the card counts once, hidden and archived cards never. Test: Task 7 `test_platform_aggregate_counts_once_and_omits_hidden_and_archived`.
5. **Two people saving the first edit of a carried-forward year at once**: both land, no unique-constraint 500. Test: Task 4 `test_concurrent_first_edit_does_not_fail` (same `ON CONFLICT DO NOTHING` + re-select path as costs).

---

## File map

Backend, new:
- `backend/app/models/license_type.py` (`LicenseType`), `backend/app/models/card_license.py` (`CardLicense`)
- `backend/alembic/versions/177_card_licenses.py` (tables, permissions, role-grant copy)
- `backend/alembic/versions/178_licensing_from_extension.py` (data move, schema, extension off)
- `backend/app/services/yearly_rows.py` (year logic shared with costs)
- `backend/app/services/item_catalogue.py` (catalogue logic shared with cost items)
- `backend/app/services/license_status.py` (pure status maths)
- `backend/app/services/license_types.py` (catalogue service, thin over `item_catalogue`)
- `backend/app/services/card_licenses.py` (card licences service)
- `backend/app/services/licensing_migration.py` (pure helpers for 178)
- `backend/app/services/license_report.py` (report rows, trend, Platform aggregate)
- `backend/app/services/license_import.py` (parse, match, preview, apply)
- `backend/app/services/seed_demo_licensing.py`
- `backend/app/schemas/licenses.py`
- `backend/app/api/v1/license_types.py`, `backend/app/api/v1/card_licenses.py` (card routes + import)

Backend, modified: `models/__init__.py`, `core/permissions.py`, `services/permission_service.py`, `services/card_costs.py`, `services/cost_item_types.py`, `services/cost_report.py` (imports only), `services/cost_field_filter.py`, `services/cost_event_redaction.py`, `services/audit_labels.py`, `services/rollback_service.py`, `services/extensions/field_contributions.py`, `services/workspace_io/{schema,sections,applier,remap}.py`, `services/seed.py`, `api/v1/{router,reports,events,cards,saved_reports,file_attachments}.py`, `app/main.py`.

Frontend, new: `src/lib/licenses.ts`, `src/features/cards/sections/LicensingSection.tsx`, `src/features/cards/sections/LicenseItemDialog.tsx`, `src/features/reports/LicensingReport.tsx`, `src/features/reports/LicensingTable.tsx`, `src/features/reports/LicensingImportDialog.tsx`, `src/features/reports/licensingUtilisationOption.ts`, `src/features/reports/licensingByTypeOption.ts` (each with a `.test.ts(x)` beside it).

Frontend, modified: `src/types/index.ts`, `src/features/reports/{costColors,costTrendOption,savedReportStyles}.ts`, `src/features/cards/sections/costsStackedBarOption.ts`, `src/features/admin/metamodel/ManageCostItemsDialog.tsx`, `src/features/admin/MetamodelAdmin.tsx`, `src/features/cards/{sectionConfig.ts,dataQualityJump.ts,CardDetailContent.tsx}`, `src/features/admin/CardLayoutEditor.tsx`, `src/App.tsx`, `src/lib/{routePermissions,pageTitle}.ts`, `src/layouts/navItems.ts`, `src/i18n/locales/en/{cards,reports,admin,nav}.json`.

---

### Task 1: Permissions, models, tables and role grants

**Files:**
- Modify: `backend/app/core/permissions.py` (new group after `costs`, defaults in the three role dicts near lines 705 / 789 / 873)
- Create: `backend/app/models/license_type.py`, `backend/app/models/card_license.py`; Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/177_card_licenses.py`
- Modify: `backend/app/services/permission_service.py`
- Test: `backend/tests/services/test_alembic_177_card_licenses.py`, `backend/tests/services/test_permission_service_licenses.py`

**Interfaces:**
- Produces: `LicenseType` (table `license_types`: `key` String(64) unique, `label` String(100), `sort_order` int, `archived` bool, `translations` JSONB; `UUIDMixin`, `TimestampMixin`), `CardLicense` (table `card_licenses`: `card_id` FK `cards.id` ON DELETE CASCADE, `fiscal_year` int, `items` JSONB default `{}`, `UniqueConstraint("card_id","fiscal_year", name="uq_card_licenses_card_year")`, `Index("ix_card_licenses_card_id")`). Same columns as `CostItemType` / `CardCost`.
- Produces: `PermissionService.can_view_licenses(db, user, card_id) -> bool`, `can_edit_licenses(db, user, card_id) -> bool`, `card_ids_with_license_access(db, user, ids) -> set[UUID]`.
- Produces: migration module functions `plan_defaults(role_key: str, perms: dict | None) -> dict | None` and `plan_copy(perms: dict | None) -> dict | None`.

- [ ] **Step 1: Write the failing tests**

`test_alembic_177_card_licenses.py` (load the module by path like `test_alembic_176_costs_edit.py`):
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

def test_upgrade_creates_tables_with_timestamp_defaults():
    # source scan: both create_table calls declare created_at/updated_at with server_default (also covered by test_alembic_timestamp_defaults)
```
`test_permission_service_licenses.py` (DB, factories from `conftest.py`): `test_view_by_permission_or_any_stakeholder` (viewer without `licenses.view` + Observer stakeholder on card A → True on A, False on B), `test_edit_needs_licenses_edit_or_card_edit_stakeholder` (member with `inventory.edit` only → False; stakeholder role with `card.edit` → True on that card only), `test_bulk_access_matches_single` (`card_ids_with_license_access` equals the per-card answers over 3 cards).

- [ ] **Step 2: Run, verify they fail**
Run: `cd backend && python -m pytest tests/services/test_alembic_177_card_licenses.py -q` → FAIL (module not found). The permission tests need Postgres: `./scripts/test.sh tests/services/test_permission_service_licenses.py`.

- [ ] **Step 3: Implement**
- `core/permissions.py`: group `"licenses": {"label": "Licensing", "permissions": {"licenses.view": "View licence counts on cards and the Licensing report (stakeholders see their own cards' licences regardless)", "licenses.edit": "Edit and import the licences of any card (stakeholders whose role can edit a card edit that card's licences regardless)"}}`; defaults `licenses.view` True/True/False and `licenses.edit` False in `BPM_ADMIN_PERMISSIONS` / `MEMBER_PERMISSIONS` / `VIEWER_PERMISSIONS`.
- `permission_service.py`: generalise the three cost methods into private `_can_view_domain(db, user, card_id, perm)`, `_can_edit_domain(db, user, card_id, perm)`, `_card_ids_with_domain_access(db, user, ids, perm)`; the cost methods and the three licence methods become one-line calls with `"costs.view"`/`"costs.edit"` and `"licenses.view"`/`"licenses.edit"`. Existing cost tests must pass unchanged.
- `177_card_licenses.py` (`revision="177"`, `down_revision="176"`): `create_table` both tables exactly like 175's `_stamps()` / columns; then for every role row: `plan_defaults(key, perms)` (built-in `bpm_admin` / `member` / `viewer` only, keys absent only), write; then `plan_copy` on the result (all roles, `true` values only, wildcard skipped), write. Raw `text()` UPDATEs as in 176. `downgrade`: drop index + tables, `permissions - 'licenses.view' - 'licenses.edit'` on every role.
- Models registered in `models/__init__.py`.

- [ ] **Step 4: Run tests, verify pass**
Run: `./scripts/test.sh tests/services/test_alembic_177_card_licenses.py tests/services/test_permission_service_licenses.py tests/services/test_permission_service_costs.py tests/services/test_alembic_timestamp_defaults.py` → PASS.

- [ ] **Step 5: Commit**
```bash
git add backend/app/core/permissions.py backend/app/models backend/alembic/versions/177_card_licenses.py backend/app/services/permission_service.py backend/tests/services/test_alembic_177_card_licenses.py backend/tests/services/test_permission_service_licenses.py
git commit -m "feat(licensing): permissions, tables and role grants"
```

---

### Task 2: Status maths (pure)

**Files:**
- Create: `backend/app/services/license_status.py`
- Test: `backend/tests/services/test_license_status.py`

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
    pct: float | None        # actual / licensed * 100; None when actual is None or licensed == 0 < actual
    no_licence: bool         # licensed == 0 and actual > 0
    status: TypeStatus

@dataclass(frozen=True)
class MetricResult:
    metric: str
    types: list[TypeResult]  # catalogue order of the keys present
    has_actual: bool
    status: MetricStatus
    worst_pct: float | None
    worst_no_licence: bool
    licensed_total: int
    actual_total: int | None # None when no type has actual

def type_result(key: str, cell: dict | None) -> TypeResult
def metric_result(metric: str, cells: dict[str, dict], order: list[str]) -> MetricResult
def card_status(metrics: list[MetricResult]) -> MetricStatus      # the card's overall badge
def worst_of(results: list[MetricResult]) -> tuple[float | None, bool]  # group worst
```

- [ ] **Step 1: Write the failing tests** (`test_license_status.py`, no DB)
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
    m = metric_result("users", {"a": {"licensed": 10, "actual": 5}, "b": {"licensed": 20, "actual": None}}, ["a", "b"])
    assert m.status == "compliant"
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
- [ ] **Step 3: Implement** the signatures above. `pct` rounded to one decimal. `worst_of` takes the max `worst_pct` of the inputs and ORs `worst_no_licence` (used for group-by rows).
- [ ] **Step 4: Run** same command → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(licensing): status maths"` (ruff first).

---

### Task 3: Licence type catalogue service and API (generalising cost items)

**Files:**
- Create: `backend/app/services/item_catalogue.py`, `backend/app/services/license_types.py`, `backend/app/schemas/licenses.py` (catalogue part), `backend/app/api/v1/license_types.py`
- Modify: `backend/app/services/cost_item_types.py` (delegate to `item_catalogue`), `backend/app/api/v1/router.py`, `frontend/src/i18n/locales/en/admin.json` (two `securityLog.actionLabels.admin_metamodel_license_type_*` keys)
- Test: `backend/tests/services/test_item_catalogue.py`, `backend/tests/api/test_license_types_api.py`

**Interfaces:**
- Produces (`item_catalogue.py`, generic over a model with the catalogue columns):
```python
KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
class CatalogueError(Exception): code: str  # invalid_key, reserved_key, duplicate_key, not_found
def serialize(row) -> dict
async def get_item(db, model, key: str)
async def list_items(db, model, include_archived: bool = True) -> list
async def create_item(db, model, key: str, label: str, translations: dict | None = None, *, reserved_extra: frozenset[str] = frozenset())
async def update_item(db, model, key: str, label=None, translations=None, archived=None, sort_order=None)
async def archived_keys(db, model) -> dict[str, bool]
```
- `cost_item_types.py` keeps its public names (`CostItemError = CatalogueError`, `create_item(db, key, label, translations)` → `item_catalogue.create_item(db, CostItemType, ..., reserved_extra=frozenset({"cost_items"}))`, etc.) so no caller and no test changes.
- `license_types.py`: the same five functions bound to `LicenseType` (reserved extra: `{"license_types"}`).
- Schemas (`schemas/licenses.py`): `LicenseTypeCreate`, `LicenseTypeUpdate`, `LicenseTypeOut` — same fields and limits as the `CostItemType*` schemas (reuse `KEY_PATTERN` from `schemas/cost_items.py`).
- Routes (prefix `/metamodel`): `GET /license-types` (any signed-in user, archived included — mirrors costs), `POST /license-types` (201, `admin.metamodel`, 409 `duplicate_key`, 422 other codes), `PATCH /license-types/{key}` (`admin.metamodel`, 404). Audit actions `admin.metamodel.license_type.created` / `.updated`, target `("license_type", key, label)`, same `_COST_ITEM_AUDIT_SCALARS` diff and `_label_translation_items` as cost items. No DELETE route.

- [ ] **Step 1: Write the failing tests**
`test_item_catalogue.py`: `test_create_appends_sort_order_and_refuses_duplicate` (two creates → orders 0,1; same key → `duplicate_key`), `test_reserved_key_refused_for_card_columns_and_field_keys` (key `"name"` and a field key of a seeded type → `reserved_key`), `test_license_and_cost_catalogues_are_independent` (key `admin` in `LicenseType` does not block `admin` in `CostItemType`), `test_archived_keys_maps_key_to_flag`.
`test_license_types_api.py`: `test_list_open_to_any_signed_in_user`, `test_create_requires_admin_metamodel` (viewer 403), `test_create_rejects_invalid_key` (`"1abc"` → 422), `test_patch_archives_and_audits` (archived true → response `archived: true`, one audit row `admin.metamodel.license_type.updated` whose changes carry `archived`), `test_patch_unknown_key_404`, `test_no_delete_route` (DELETE → 405).
- [ ] **Step 2: Run** `./scripts/test.sh tests/services/test_item_catalogue.py tests/api/test_license_types_api.py` → FAIL.
- [ ] **Step 3: Implement** as above; register `license_types.router` in `router.py` beside `cost_item_types.router`. Add the two English security-log action labels.
- [ ] **Step 4: Run** the two new files plus `tests/services/test_cost_item_types.py tests/api/test_cost_item_types_api.py` → PASS (cost behaviour unchanged).
- [ ] **Step 5: Commit** `feat(licensing): licence type catalogue (shared with cost items)`.

---

### Task 4: Card licences service and API

**Files:**
- Create: `backend/app/services/yearly_rows.py`, `backend/app/services/card_licenses.py`, `backend/app/api/v1/card_licenses.py`; extend `backend/app/schemas/licenses.py`
- Modify: `backend/app/services/card_costs.py` (delegate year logic to `yearly_rows`), `backend/app/services/cost_field_filter.py`, `backend/app/services/cost_event_redaction.py`, `backend/app/services/audit_labels.py`, `backend/app/services/rollback_service.py`, `backend/app/api/v1/events.py` (SSE), `backend/app/api/v1/cards.py` (History summaries), `backend/app/api/v1/reports.py` (top contributors list), `backend/app/api/v1/router.py`
- Test: `backend/tests/services/test_yearly_rows.py`, `backend/tests/services/test_card_licenses.py`, `backend/tests/api/test_card_licenses_api.py`, `backend/tests/services/test_license_event_redaction.py`

**Interfaces:**
- Consumes: Task 1 models and permission methods; Task 2 `metric_result`, `card_status`; Task 3 `license_types.archived_keys`, `list_items`.
- Produces (`yearly_rows.py`, extracted from `card_costs.py`, generic over a model with `card_id`, `fiscal_year`, `items`):
```python
async def row(db, model, card_id, fy, lock: bool = False)
async def fallback_row(db, model, card_id, fy)
def resolve_year(row_items: dict | None, prev: tuple[int, dict] | None, fy: int, cur: int,
                 carry: Callable[[dict, int], dict]) -> tuple[dict, bool, int | None]
async def resolve(db, model, card_id, fy, start_month, carry) -> tuple[dict, bool, int | None]
def check_window(fy: int, start_month: int, error: Callable[[str, str], Exception]) -> None
async def editable(db, model, card_id, fy, start_month, carry)   # ON CONFLICT DO NOTHING + re-select FOR UPDATE
def window_years(cur: int) -> range                                # cur-4 .. cur+1
```
`card_costs.resolve_year(row_items, prev, fy, cur)` keeps its signature and passes `carry=lambda items, years: _shifted(items, years)`; `cost_report.item_costs_by_card` keeps calling it; cost tests unchanged.
- Produces (`card_licenses.py`):
```python
LICENSE_TYPES = frozenset({"Application", "ITComponent"})
LICENSE_EVENT = "card.licenses_updated"
LEGACY_KEYS = ("licensedUsers", "licensedInstallations", "actualUsers", "actualInstallations")
LIST_KEY = "license_types"     # the event's changes key
class LicenseError(Exception): code  # unknown_type, archived_type, invalid_metric, invalid_count, forecast_actual, year_out_of_range
def licensed_only(items: dict, years: int = 0) -> dict    # the carry: every cell -> {"licensed": n, "actual": None}
@dataclass class YearLicenses: fiscal_year, is_current, is_forecast, confirmed, fallback_from, metrics: list[MetricResult], status: MetricStatus | None
def year_licenses(items, confirmed, fallback_from, fy, cur, model: list[str], order: list[str]) -> YearLicenses
async def get_year(db, card, fiscal_year, start_month) -> YearLicenses       # metrics = licensingModel ∩ METRICS
async def get_window(db, card, start_month) -> list[YearLicenses]
async def upsert_cell(db, card_id, fiscal_year, metric, key, licensed: int, actual: int | None) -> None
async def delete_cell(db, card_id, fiscal_year, metric, key) -> bool         # False = no-op
async def confirm_year(db, card_id, fiscal_year) -> None
async def copy_to_forecast(db, card_id, from_year, metric, key) -> None     # licensed only
async def apply_write(db, card, user_id, fiscal_year, op) -> YearLicenses   # flush only, publishes LICENSE_EVENT
```
Forecast-year status is `None` and every `MetricResult.status` there is ignored by the API (`status: null`).
- Schemas: `LicenseCellWrite {licensed: int = Field(ge=0, le=1_000_000_000), actual: int | None = Field(None, ge=0, le=1_000_000_000)}` (strict ints: `StrictInt`, so `1.5` is 422), `LicenseTypeResultOut`, `MetricResultOut`, `YearLicensesOut`, `YearLicensesDetailOut(+can_edit)`, `CardLicensesOut {can_edit, licensing_model: list[str], years, catalogue: list[LicenseTypeOut]}`.
- Routes (`card_licenses.py`, tag `card-licenses`), copying `card_costs.py`'s `_load_for_read` / `_load_for_edit` / `_write` shape with `can_view_licenses` / `can_edit_licenses` and `LICENSE_TYPES`:
  - `GET /cards/{card_id}/licenses` → `CardLicensesOut`
  - `GET /cards/{card_id}/licenses/{fiscal_year}` → `YearLicensesDetailOut`
  - `PUT /cards/{card_id}/licenses/{fiscal_year}/items/{metric}/{key}` body `LicenseCellWrite` → `YearLicensesOut`
  - `DELETE` same path → 204, idempotent
  - `POST /cards/{card_id}/licenses/{fiscal_year}/confirm` → `YearLicensesOut`
  - `POST /cards/{card_id}/licenses/{fiscal_year}/items/{metric}/{key}/copy-to-forecast` → `YearLicensesOut` (event diffs the Forecast year)
  - Error map: `archived_type` 409, everything else 422; `metric` path param `pattern="^(users|installations)$"`.
- Event payload: `{"id", "source": "card_licenses", "fiscal_year": fy, "changes": {"license_types": {"old": [sorted type keys present in any metric], "new": [...]}}}`.
- Redaction (generalised, one path for both domains):
  - `cost_field_filter.py`: add `strip_change_keys(data, drop: frozenset[str]) -> dict | None` (today's body of `redact_event_costs`); `redact_event_costs(data, cost_keys)` becomes `strip_change_keys(data, cost_keys | {COST_ITEMS_KEY})`.
  - `cost_event_redaction.redact_cost_events` (name kept, six call sites unchanged): one access query per domain (`card_ids_with_cost_access`, `card_ids_with_license_access`); per event drop `all_cost_keys ∪ {cost_items}` when the card lacks cost access and `LICENSE_KEYS = frozenset({*LEGACY_KEYS, LIST_KEY})` when it lacks licence access.
  - `events.py` SSE: drop set = cost keys unless `costs.view`, ∪ `LICENSE_KEYS` unless `licenses.view`.
- History: `audit_labels.py` gains `license_type_labels(db, keys)` and `license_event_summaries(db, card_name, payloads) -> list[str]` ("Licensing of <card> changed (FY<yy>; licence types: <labels>)", the types part dropped when redacted); `cost_event_redaction.add_cost_summaries` is generalised to annotate both `COST_EVENT` and `LICENSE_EVENT`; `cards.py` History calls it when either event type is present.
- `rollback_service._DECLINED["card.licenses_updated"] = "Licensing changes cannot be rolled back; edit the licences instead."`; `reports.py` top contributors adds `LICENSE_EVENT` beside `COST_EVENT`.

- [ ] **Step 1: Write the failing tests**
`test_yearly_rows.py` (pure + DB): `test_row_present_is_confirmed_even_empty`, `test_only_current_year_falls_back_with_carry` (fy=cur, prev=(cur-2, X) → `carry(X, 2)`, confirmed False, fallback_from cur-2; fy=cur+1 and fy=cur-1 → `({}, False, None)`), `test_check_window_bounds` (cur-5 and cur+1 ok, cur-6 and cur+2 raise), `test_editable_materialises_the_carried_set`.
`test_card_licenses.py`:
```python
async def test_carry_forward_is_licensed_only(db):   # FY cur-1 {"users":{"admin":{"licensed":10,"actual":9}}} -> current shows licensed 10, actual None, confirmed False, metric status "no_actual_data"
async def test_confirm_materialises_licensed_only(db): # row items == {"users":{"admin":{"licensed":10,"actual":None}}}
async def test_put_null_actual_clears_it(db)
async def test_forecast_rejects_actual(db):           # LicenseError("forecast_actual")
async def test_archived_type_editable_when_present_refused_when_new(db)   # Review Focus 3
async def test_unknown_type_and_bad_metric_refused(db)
async def test_copy_to_forecast_copies_licensed_only(db)
async def test_delete_absent_cell_is_noop_without_event(db)
async def test_untracked_metric_stored_but_not_reported(db)  # licensingModel ["users"], installations cells stored -> get_year metrics == ["users"]
async def test_window_follows_fiscal_year_start(db)    # Review Focus 2: fiscalYearStart=4 -> years == range(cur-4, cur+2) of current_fiscal_year(4)
async def test_concurrent_first_edit_does_not_fail(db_engine)  # Review Focus 5: two sessions upsert different cells of a carried year -> both cells present
async def test_event_carries_type_keys_only(db):       # payload has no "licensed"/"actual" anywhere (json.dumps scan)
```
`test_card_licenses_api.py`: `test_get_window_and_can_edit_for_admin` (6 years, `can_edit` true), `test_viewer_without_permission_403`, `test_stakeholder_viewer_reads_own_card`, `test_hidden_card_404` (type View deny), `test_platform_card_404` (not a licence type), `test_put_success_and_event_in_history` (History row with summary `Licensing of … changed`), `test_put_rejects_unknown_type_422`, `test_put_rejects_forecast_actual_422`, `test_put_rejects_bad_year_422` (`fiscal_year=cur+2`), `test_put_rejects_fractional_count_422`, `test_member_without_card_edit_stakeholder_403` (member has `inventory.edit`, not `licenses.edit`), `test_rollback_declines_license_event`.
`test_license_event_redaction.py`: `test_legacy_card_updated_diff_of_old_keys_redacted_without_licence_access` (a `card.updated` with `changes.attributes.old.licensedUsers` → gone for a viewer, kept for a `licenses.view` holder), `test_license_types_list_redacted_without_access`, `test_cost_and_licence_access_are_independent` (cost access without licence access keeps cost values, drops licence keys), `test_sse_drop_set_includes_license_keys_without_licenses_view`.
- [ ] **Step 2: Run** `./scripts/test.sh tests/services/test_yearly_rows.py tests/services/test_card_licenses.py tests/api/test_card_licenses_api.py tests/services/test_license_event_redaction.py` → FAIL.
- [ ] **Step 3: Implement** in this order: `yearly_rows.py` + `card_costs.py` delegation (run `tests/services/test_card_costs.py tests/api/test_card_costs_api.py tests/services/test_cost_rollover_loop.py` green before going on), then `card_licenses.py`, schemas, routes (register in `router.py`), redaction, summaries, rollback entry, top contributors.
- [ ] **Step 4: Run** the new files plus every existing cost test (`./scripts/test.sh tests/ -k "cost"`) and `tests/services/test_card_read_scope_guard.py tests/services/test_updated_at_invariant.py` → PASS.
- [ ] **Step 5: Commit** `feat(licensing): card licences per fiscal year`.

---

### Task 5: Migration from the extension, `licensingModel` built in

**Files:**
- Create: `backend/app/services/licensing_migration.py`, `backend/alembic/versions/178_licensing_from_extension.py`
- Modify: `backend/app/services/extensions/field_contributions.py` (extract the pure strip), `backend/app/services/seed.py` (Application "Application Information", ITComponent "Component Information"), `backend/app/main.py` (`_DQ_RESCORE_FLAG = "dataQualityCanonicalRescoreDoneV4"`)
- Test: `backend/tests/services/test_licensing_migration.py`, `backend/tests/services/test_field_contributions.py` (existing, must stay green)

**Interfaces:**
- Produces (`licensing_migration.py`, no DB, no models):
```python
EXT_KEY = "licensing"
MODEL_KEY = "licensingModel"
GENERAL_SECTION = {"Application": "Application Information", "ITComponent": "Component Information"}
MODEL_FIELD: dict          # {"key": "licensingModel", "label": "Licensing Model", "type": "multiple_select", "weight": 0,
                           #  "options": [{"key": "users", "label": "Users"}, {"key": "installations", "label": "Installations"}]}
SOURCE = {("users", "licensed"): "licensedUsers", ("users", "actual"): "actualUsers",
          ("installations", "licensed"): "licensedInstallations", ("installations", "actual"): "actualInstallations"}
def slug(name: str) -> str | None                        # lower, runs of non [a-z0-9] -> "_", trimmed, 64 max; None if empty or not starting with a letter
def assign_keys(names: Iterable[str]) -> dict[str, tuple[str, str]]   # casefolded name -> (key, label as first seen); type_<n> fallback; collision -> _2, _3
def build_items(attrs: dict, keys: dict) -> tuple[dict, list[dict]]   # items, problems [{field, category, value, reason: "not_numeric"|"negative"|"rounded"}]
def move_model_field(type_key: str, schema: list) -> list | None      # None = no change
def citing_calculations(rows: list[tuple[str, str, str]]) -> list[dict]  # (id, target_type_key, formula) citing any of the four keys
```
- Produces (`field_contributions.py`): `strip_ext_fields(schema: list, section_config: dict | None, ext_key: str) -> tuple[list, dict | None, int]` — the pure body of `remove_field_contributions` (field filter, empty contributed section dropped, `custom:<i>` order re-indexed); `remove_field_contributions` calls it per type. Existing tests unchanged.
- Migration 178 `_data_body(conn)` (sync, testable through `run_sync` like 175), in order:
  1. Read `fiscalYearStart` as 175 does; `current = current_fiscal_year(start)`.
  2. If `card_licenses` already has rows, skip the data steps 3–5 (idempotent re-run).
  3. Collect every category name from the four keys over `cards` of the two types; `assign_keys`; insert `license_types` rows (sort order = first-seen order, `ON CONFLICT (key) DO NOTHING`).
  4. Per card with any of the four keys: `build_items`; insert one `card_licenses` row for `current` when items are non-empty; strip the four keys from `attributes` (`attributes - CAST(:keys AS text[])`) whatever the outcome.
  5. Report entries per card (moved cells and problems).
  6. Per type: `strip_ext_fields(schema, section_config, "licensing")`, then `move_model_field`; write `fields_schema` / `section_config` when changed. Runs on instances without the extension too (adds the field).
  7. `UPDATE extensions SET enabled = false WHERE key = 'licensing'`.
  8. `licensing_migration_report` in `general_settings` (key-scoped `||`): `{"total": n, "entries": [...200], "license_types": [{key, label}], "calculations": citing_calculations(...)}`; only when there is something to report.
  Data-quality scores refresh through the startup one-shot (flag bumped to V4), as migration 137 does. `downgrade`: no-op for data (docstring says one-way, like 175).
- `seed.py`: `MODEL_FIELD` (English label, options without colours, `translations` left for `/translate`) appended to the two general sections.

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
def test_move_model_field_into_general_section_and_drop_ext_section():
    # input: Application schema with an ext-stamped "Licensing" section holding the five fields
    # output: section gone, "licensingModel" (no "ext" key) last in "Application Information"
def test_move_model_field_adds_on_instance_without_extension()
def test_move_model_field_keeps_an_admin_field_with_the_same_key()   # -> None
def test_citing_calculations_lists_formulas_naming_old_keys()
async def test_migration_moves_values_strips_keys_disables_extension(db)   # run _data_body via run_sync
async def test_second_run_changes_nothing(db)
async def test_report_is_capped_at_200(db)
def test_strip_ext_fields_matches_remove_field_contributions()   # in test_field_contributions.py: same schema in, same schema out
```
- [ ] **Step 2: Run** `./scripts/test.sh tests/services/test_licensing_migration.py tests/services/test_field_contributions.py` → FAIL.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Run** the two files plus `tests/services/test_dq_rescore_once.py tests/services/test_alembic_timestamp_defaults.py tests/services/test_seed*.py` → PASS.
- [ ] **Step 5: Commit** `feat(licensing): migrate the extension's data into core`.

---

### Task 6: Workspace transfer

**Files:**
- Modify: `backend/app/services/workspace_io/schema.py` (`SHEET_LICENSE_TYPES = "LicenseTypes"`, a `ConfigSection` after `CostItemTypes`, columns `("key", "label", "sort_order", "archived", "translations")`, `json_columns={"translations"}`), `sections.py` (`EntitySection("CardLicenses", CardLicense, card_fk_columns=("card_id",), natural_key=("card_id", "fiscal_year"))` right after `CardCosts`), `applier.py` (`"CardLicenses"` in the set that triggers `_finalize_cards`), `remap.py` (`REPORT_CARD_ID_KEYS = ("center", "pickedCardId")`)
- Test: `backend/tests/services/test_workspace_io_licenses.py`; modify `backend/tests/services/test_workspace_io_id_bearing_columns.py` allowlist (`("CardLicenses", "items"): "licence counts keyed by metric and licence type key, no ids"`)

**Interfaces:**
- Consumes: Task 1 models.
- Produces: sheet names `LicenseTypes`, `CardLicenses`; saved-report key `pickedCardId` (used by Task 11).

- [ ] **Step 1: Write the failing tests** (mirror `test_workspace_io_cost_items.py`): `test_round_trip_carries_types_and_card_licenses` (export → wipe inventory → import: same type keys, same items per `(card, year)` on the new card ids), `test_reimport_is_all_skip` (`CardLicenses` created == 0 on the second apply), `test_selected_sheet_card_licenses_applies` (`sheets={"CardLicenses"}`), `test_saved_report_picked_card_id_is_remapped` (in `test_workspace_io_remap.py`: `rewrite_saved_report_config({"pickedCardId": old}, ids, tally)` → new id, tally counts it).
- [ ] **Step 2: Run** `./scripts/test.sh tests/services/test_workspace_io_licenses.py tests/services/test_workspace_io_id_bearing_columns.py tests/services/test_workspace_io_remap.py` → FAIL.
- [ ] **Step 3: Implement** the four edits above.
- [ ] **Step 4: Run** same plus `tests/services/test_workspace_io_roundtrip.py tests/services/test_workspace_io_cost_items.py` → PASS.
- [ ] **Step 5: Commit** `feat(licensing): workspace transfer of licence types and card licences`.

---

### Task 7: Report API and saved report type

**Files:**
- Create: `backend/app/services/license_report.py`; extend `backend/app/schemas/licenses.py`
- Modify: `backend/app/api/v1/reports.py` (new route), `backend/app/api/v1/saved_reports.py` (`"licensing"` in `VALID_REPORT_TYPES`)
- Test: `backend/tests/services/test_license_report.py`, `backend/tests/api/test_reports_licensing.py`, `backend/tests/api/test_saved_reports.py` (one case)

**Interfaces:**
- Consumes: `yearly_rows.resolve_year`, `card_licenses.licensed_only`, `license_status.metric_result`, `cost_grouping.parse_group_by` / `assign_groups`, `lifecycle.is_live_in_fiscal_year`, `CardReadScope`.
- Produces (`license_report.py`):
```python
PLATFORM_RELATIONS = ("relPlatformToApp", "relPlatformToITC")
async def items_by_card(db, card_ids, years: list[int], start_month) -> dict[UUID, dict[int, tuple[dict, bool, int | None]]]   # one query for all years, resolve_year per (card, year)
async def report_cards(db, read_scope, type_key, metric, fy, cur, start_month) -> list[Card]
    # ACTIVE, readable (mode="module"), licensingModel contains metric;
    # fy == cur: is_live_in_fiscal_year; other years: cards with a stored row for fy
async def platform_cards(db, read_scope, platform_id, metric) -> list[Card]
    # direct links through PLATFORM_RELATIONS (either direction), readable, ACTIVE, licensingModel has metric, deduped by id
async def build_report(db, read_scope, *, type_key, metric, fy, group_by: GroupBy | None, card_id: UUID | None) -> dict
```
- Route: `GET /reports/licensing` — query `type` (`Application` | `ITComponent`, else 400), `metric` (`users` | `installations`, else 400), `fiscal_year` (optional; `cur-4 … cur`, the Forecast year is 400 `forecast_not_selectable`), `group_by` (optional, as cost), `card_id` (optional UUID: Application / IT Component / Platform; hidden → 404, other type → 400). Gate `licenses.view` (`require_permission`). With a Platform `card_id`, `type` and `group_by` are ignored.
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
Rows are the selected year's cards (or the Platform's linked cards, or the single picked card). `trend` covers every year of `years`, each year with its own card set by the same rule as `report_cards` (Forecast: cards with a stored row, licensed only), restricted to the same population when `card_id` is set; the page sums it over its scope and drill. `status` is omitted (`null`) on every row when `aggregate` is set.

- [ ] **Step 1: Write the failing tests**
`test_license_report.py`: `test_current_year_applies_lifecycle_gate_and_archived_excluded`, `test_past_year_lists_cards_with_a_row_only`, `test_cards_without_metric_in_model_are_left_out`, `test_current_year_carry_forward_reads_licensed_only`, `test_trend_has_six_years_and_forecast_licensed_only`, `test_group_by_field_assigns_raw_values`.
`test_reports_licensing.py`:
```python
async def test_requires_licenses_view(client, viewer): assert (await client.get("/api/v1/reports/licensing?type=Application&metric=users")).status_code == 403
async def test_rows_statuses_and_trend(client, admin)          # one over card, one approaching, one no data: statuses match, trend years == cur-4..cur+1
async def test_forecast_year_refused(client, admin)            # 400
async def test_bad_metric_and_type_refused(client, admin)      # 400 each
async def test_hidden_card_omitted_from_rows_and_trend(client, restricted)
async def test_card_id_hidden_is_404(client, restricted)
async def test_platform_aggregate_counts_once_and_omits_hidden_and_archived(client, ...)  # Review Focus 4
async def test_platform_aggregate_has_no_status(client, admin)
async def test_fiscal_year_start_april_names_the_current_year(client, admin)  # Review Focus 2
```
`test_saved_reports.py`: `test_licensing_report_type_accepted`.
- [ ] **Step 2: Run** `./scripts/test.sh tests/services/test_license_report.py tests/api/test_reports_licensing.py tests/api/test_saved_reports.py` → FAIL.
- [ ] **Step 3: Implement** the service and route; query in two round trips for rows and for the trend (no per-card query; `shortcut:` comment if a per-card loop survives anywhere).
- [ ] **Step 4: Run** same plus `tests/services/test_card_read_scope_guard.py tests/api/test_read_scope_sentinel_sweep.py` → PASS.
- [ ] **Step 5: Commit** `feat(licensing): Licensing report API`.

---

### Task 8: Import API

**Files:**
- Create: `backend/app/services/license_import.py`
- Modify: `backend/app/api/v1/card_licenses.py` (route), `backend/app/api/v1/file_attachments.py` (rename `_read_validated_upload` to `read_validated_upload`, callers updated; no behaviour change)
- Test: `backend/tests/services/test_license_import.py`, `backend/tests/api/test_license_import_api.py`

**Interfaces:**
- Consumes: Task 4 `card_licenses` write internals (`yearly_rows.editable`, `licensed_only`, `LICENSE_EVENT` publish), Task 3 `license_types.list_items`, `attachment_validation` through `read_validated_upload`.
- Produces:
```python
HEADERS = ("component", "metric", "licence type", "year", "licensed", "actual")   # compared lower-cased, "license type" accepted
METRIC_ALIASES = {"users": "users", "user": "users", "installations": "installations", "installation": "installations"}
class ImportFileError(ValueError)                    # unreadable workbook, empty, wrong headers -> 400
@dataclass class ImportRow: row: int, component: str, metric: str, license_type: str, year: object, licensed: object, actual: object
@dataclass class RowIssue: row: int, component: str, reason: str, detail: str = ""
@dataclass class ImportPlan: cells: dict[tuple[UUID, int], dict[str, dict[str, dict]]], matched: int, skipped: list[RowIssue], flagged: list[RowIssue]
def parse_workbook(data: bytes) -> list[ImportRow]    # pure, read_only openpyxl, first sheet, blank rows dropped
async def plan_import(db, user, rows: list[ImportRow]) -> ImportPlan
async def apply_import(db, user_id, plan: ImportPlan) -> int   # card-years written; one LICENSE_EVENT per card-year
```
Skip reasons (exact codes, the page translates them): `card_not_found`, `ambiguous_card`, `unknown_license_type`, `ambiguous_license_type`, `archived_license_type` (new cell on an archived type), `invalid_metric`, `invalid_year` (not an integer or outside `current-5 … current+1`), `invalid_number` (not an integer `>= 0`; `"12"` and `12.0` accepted), `forecast_actual`, `duplicate_cell` (every row of a duplicated `(card, year, metric, type)` is skipped), `nothing_to_write` (both Licensed and Actual empty). Flag (applied, listed): `metric_not_tracked`. Card match: `name.strip().casefold()` among readable (`CardReadScope`, mode `"module"`), ACTIVE Application / IT Component cards. Licence type match: casefolded key or English label.
- Route: `POST /licenses/import?dry_run=true|false` (multipart `file`), `require_permission("licenses.edit")`. Steps: permission → `read_validated_upload(file)` (refuse anything but `.xlsx`: 400) → `await db.commit()` (return the connection to the pool) → `rows = await run_in_threadpool(parse_workbook, data)` → `plan_import` → if not dry run `apply_import` + commit. Response `{"matched", "applied", "skipped": [RowIssue], "flagged": [RowIssue]}` (`applied` = 0 on dry run). The import never touches `licensingModel`.

- [ ] **Step 1: Write the failing tests**
`test_license_import.py` (workbooks built with openpyxl in the test):
```python
def test_parse_accepts_us_spelling_text_numbers_and_trailing_blanks()   # Review Focus 1
def test_parse_rejects_wrong_headers_and_non_xlsx_bytes()             # ImportFileError
async def test_plan_matches_case_insensitive_and_flags_untracked_metric(db)
async def test_plan_skips_every_reason(db)   # one row per reason code above; assert the set of reasons == the documented set
async def test_duplicate_cells_are_all_skipped(db)
async def test_empty_cell_leaves_stored_value(db)        # stored actual 5, row Actual empty, Licensed 10 -> licensed 10, actual 5
async def test_apply_one_event_per_card_year(db)
async def test_import_year_uses_fiscal_year_start(db)    # Review Focus 2
```
`test_license_import_api.py`: `test_requires_licenses_edit` (member 403), `test_stakeholder_editor_still_403` (global permission only), `test_dry_run_writes_nothing`, `test_apply_writes_and_returns_counts`, `test_renamed_executable_refused_400` (`.xlsx` name, non-zip bytes), `test_over_20mb_refused_400`, `test_hidden_card_reads_as_not_found` (row naming a hidden card → `card_not_found`, never `ambiguous_card`).
- [ ] **Step 2: Run** `./scripts/test.sh tests/services/test_license_import.py tests/api/test_license_import_api.py` → FAIL.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Run** same plus `tests/api/test_file_attachments*.py tests/services/test_db_session_holding.py` → PASS.
- [ ] **Step 5: Commit** `feat(licensing): Excel import with preview`.

---

### Task 9: Demo seed

**Files:**
- Create: `backend/app/services/seed_demo_licensing.py` (`SEEDER_KEY = "licensing"`)
- Modify: `backend/app/main.py` (call it under `settings.SEED_DEMO`, after the base demo seeder, like `seed_demo_extras`)
- Test: `backend/tests/services/test_seed_demo_licensing.py`

**Interfaces:**
- Produces: `async def seed_licensing_demo_data(db) -> dict` — returns `{"skipped": True, ...}` when `demo_seed_completed(db, "licensing")`; otherwise creates three licence types (`admin` "Admin", `end_user` "End User", `dev` "Dev") if absent, sets `licensingModel` on 4 Applications and 2 IT Components of the demo (looked up by name), writes rows for `current-2 … current+1` (Forecast licensed only) giving at least one card in each status, marks the seeder, flushes (caller commits).

- [ ] **Step 1: Write the failing tests**: `test_seeds_once_by_marker` (second call skipped, row count unchanged), `test_marker_holds_after_data_deleted` (delete all `card_licenses`, call again → skipped), `test_every_status_is_present_in_current_year` (through `license_status`: over, approaching, compliant, no_actual_data each at least once), `test_forecast_rows_have_no_actual`, `test_skips_without_demo_cards` (empty inventory → nothing written, marker set).
- [ ] **Step 2: Run** `./scripts/test.sh tests/services/test_seed_demo_licensing.py` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** same plus `tests/services/test_seed_markers.py tests/services/test_seed_demo.py` → PASS.
- [ ] **Step 5: Commit** `feat(licensing): demo data`.

---

### Task 10: Frontend types, helpers, card section, dialogs, catalogue admin

**Files:**
- Modify: `frontend/src/types/index.ts`, `frontend/src/features/reports/costColors.ts`, `frontend/src/features/cards/sections/costsStackedBarOption.ts`, `frontend/src/features/admin/metamodel/ManageCostItemsDialog.tsx`, `frontend/src/features/admin/MetamodelAdmin.tsx`, `frontend/src/features/cards/sectionConfig.ts`, `frontend/src/features/cards/dataQualityJump.ts`, `frontend/src/features/cards/CardDetailContent.tsx`, `frontend/src/features/admin/CardLayoutEditor.tsx`, `frontend/src/i18n/locales/en/{cards,admin}.json`
- Create: `frontend/src/lib/licenses.ts`, `frontend/src/features/cards/sections/LicensingSection.tsx`, `frontend/src/features/cards/sections/LicenseItemDialog.tsx`
- Test: `lib/licenses.test.ts`, `costColors.test.ts` (extend), `costsStackedBarOption.test.ts` (extend), `ManageCostItemsDialog.test.tsx` (extend), `sectionConfig.test.ts` (extend), `LicensingSection.test.tsx`, `LicenseItemDialog.test.tsx`

**Interfaces:**
- Consumes: Task 4 response shapes, Task 3 `/metamodel/license-types`.
- Produces (types): `LicenseType` (= `CostItemType` shape; `export type LicenseType = CostItemType`), `LicenseMetric = "users" | "installations"`, `LicenseTypeStatus = "over" | "approaching" | "compliant" | "no_data"`, `LicenseStatus = "over" | "approaching" | "no_actual_data" | "compliant"`, `LicenseTypeResult`, `LicenseMetricResult`, `YearLicenses`, `CardLicensesResponse` (field names exactly the backend schemas').
- Produces (`lib/licenses.ts`):
```ts
export const LICENSE_TYPES: readonly string[] = ["Application", "ITComponent"];
export const LICENSE_METRICS: readonly LicenseMetric[] = ["users", "installations"];
export const isLicenseType = (typeKey: string): boolean
export function statusColor(s: LicenseStatus | LicenseTypeStatus): string   // STATUS_COLORS.error / warning / success / neutral
export const STATUS_ORDER: readonly LicenseStatus[] = ["over", "approaching", "no_actual_data", "compliant"]
export function formatPct(pct: number | null, noLicence: boolean, t: TFunction): string   // "120 %", "no licence", "—"
```
- Produces (`costColors.ts`, generalised): `catalogueHues(keysInSortOrder: string[], categorical: readonly string[], other: string): Map<string, string>` — first `MAX_GROUP_HUES` keys take `categorical[i]`, the rest `other`. Used by the licensing section and report; `CostsSection` is left as it is.
- Produces (`costsStackedBarOption.ts`, generalised): `CostBarSegment` gains optional `row?: number` and `opacity?: number`; `buildCostsStackedBarOption(segments, o)` with `o.rows?: string[]` draws one stacked bar per row (cost callers pass neither: output unchanged). `format` stays the value formatter (licensing passes `String`).
- Produces (`ManageCostItemsDialog.tsx`, generalised): props `path?: string` (default `/metamodel/cost-item-types`) and `textKey?: "costItems" | "licenseTypes"` (default `"costItems"`), every i18n key built from `admin:metamodel.${textKey}.*`; `MetamodelAdmin` opens a second instance from a "Licence types" button beside "Cost items".
- Produces (`sectionConfig.ts`): `"licensing"` in `DEFAULT_SECTION_ORDER` after `"costs"`; `buildSectionOrder(..., has: {...; licensing?: boolean})` splices `licensing` after `costs` (or after `lifecycle`) when a stored order predates it and drops it for other types; `BuiltInSectionKey` gains `"licensing"`; `CardLayoutEditor` lists it (`icon: "badge"`, `onlyIf: isLicenseType`).
- `LicensingSection` props `{ cardId; initialExpanded?; expandOn?; onEditModel?: () => void }`, structure copied from `CostsSection`: `useApiQuery<CardLicensesResponse>(`/cards/${cardId}/licenses`)`, null on 403/404, year navigator with `costFiscalYearName`, fallback banner + Confirm, the `licensingModel` shown read-only as chips with an "Edit" link calling `onEditModel` (CardDetailContent scrolls to and opens the section holding the field via `customSectionAnchor`), one block per tracked metric: headline "N licence types, M over the contract", the two-row stacked bar (licensed pale `opacity: 0.35`, actual solid), one tile per type (label, status pill, `actual / licensed`, pct, meter), Forecast tiles "licensed only". Empty model: an info line "Choose metrics in Licensing Model to track licences" and the edit link. Add button and tile click open `LicenseItemDialog` when `can_edit`.
- `LicenseItemDialog` props `{ cardId; fiscalYear; forecastYear; metrics: LicenseMetric[]; cell: {metric, key, licensed, actual} | null; options: LicenseType[]; labelOf; onClose; onChanged }`: metric + licence type selects (add mode only), Licensed and Actual integer fields (Actual disabled in the Forecast year), Save → PUT, Remove → DELETE, "Copy licensed to Forecast" → POST copy-to-forecast (not in the Forecast year); server error codes mapped to `cards:licensing.errors.<code>`.

- [ ] **Step 1: Write the failing tests**
```ts
// lib/licenses.test.ts
it("maps each status to its semantic token", () => { expect(statusColor("over")).toBe(STATUS_COLORS.error); expect(statusColor("no_data")).toBe(STATUS_COLORS.neutral); });
it("formats pct, no licence and missing", () => { expect(formatPct(120, false, t)).toBe("120 %"); expect(formatPct(null, true, t)).toBe("licensing.noLicence"); expect(formatPct(null, false, t)).toBe("—"); });
// costColors.test.ts
it("catalogueHues: sort order, 9th folds to other", () => { const m = catalogueHues(keys9, CAT, OTHER); expect(m.get(keys9[0])).toBe(CAT[0]); expect(m.get(keys9[8])).toBe(OTHER); });
// costsStackedBarOption.test.ts
it("draws one bar per row with the segment opacity", () => { const o = buildCostsStackedBarOption(segs, { ...opts, rows: ["L", "A"] }); expect(o.yAxis.data).toEqual(["L", "A"]); expect(o.series[0].itemStyle.opacity).toBe(0.35); });
it("cost callers unchanged", ...) // existing snapshot-free assertions still pass
// ManageCostItemsDialog.test.tsx
it("uses the licence types path and texts", () => { render(<ManageCostItemsDialog open path="/metamodel/license-types" textKey="licenseTypes" .../>); expect(api.get).toHaveBeenCalledWith("/metamodel/license-types", expect.anything()); });
// sectionConfig.test.ts
it("splices licensing after costs into an older stored order", ...); it("drops licensing for other types", ...);
// LicensingSection.test.tsx
it("renders nothing on 403 and on 404"); it("shows one block per tracked metric with type tiles and status pills");
it("shows the carried-forward banner with Confirm only when can_edit"); it("Forecast year tiles say licensed only and the dialog disables Actual");
it("shows the empty-model hint and calls onEditModel from the link");
// LicenseItemDialog.test.tsx
it("PUTs integers to the cell path"); it("sends actual null when Actual is cleared"); it("shows the server error for archived_type");
it("hides copy-to-forecast in the Forecast year");
```
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/lib/licenses.test.ts src/features/reports/costColors.test.ts src/features/cards/sections src/features/admin/metamodel/ManageCostItemsDialog.test.tsx src/features/cards/sectionConfig.test.ts` → FAIL.
- [ ] **Step 3: Implement**; English keys only under `cards:licensing.*` and `admin:metamodel.licenseTypes.*` (same key names as `costItems.*`).
- [ ] **Step 4: Run** same command plus `npx vitest run src/theme/rawColours.sourceScan.test.ts src/staticLabels.test.tsx src/features/cards/sections/CostsSection.test.tsx` → PASS; `npx tsc --noEmit && npm run lint` clean.
- [ ] **Step 5: Commit** `feat(licensing): card section and licence type admin`.

---

### Task 11: Licensing report page

**Files:**
- Create: `frontend/src/features/reports/LicensingReport.tsx`, `LicensingTable.tsx`, `licensingUtilisationOption.ts`, `licensingByTypeOption.ts`
- Modify: `frontend/src/features/reports/costTrendOption.ts`, `savedReportStyles.ts`, `frontend/src/App.tsx`, `frontend/src/lib/routePermissions.ts`, `frontend/src/lib/pageTitle.ts`, `frontend/src/layouts/navItems.ts`, `frontend/src/i18n/locales/en/{reports,nav}.json`
- Test: `LicensingReport.test.tsx`, `LicensingTable.test.tsx`, `licensingUtilisationOption.test.ts`, `licensingByTypeOption.test.ts`, `costTrendOption.test.ts` (extend), `routePermissions.test.ts` (parity, existing)

**Interfaces:**
- Consumes: Task 7 response; Task 10 `lib/licenses.ts`, `catalogueHues`; existing `ReportShell`, `CardScopeFilter`, `useCardScope` / `applyScope`, `useSavedReport("licensing")`, `useThumbnailCapture`, `SaveReportDialog`, `MetricCard`, `FullscreenPanel`, `CostDrillBar`, `costDrill` (`Drill`, `crumbsOf`, `applyDrill`), `CostLegend`, `isBuiltInFieldType`, `costFiscalYearName`, `CardPicker`, `CardDetailSidePanel`, `useApiQuery`.
- Produces (`costTrendOption.ts`, generalised): `CostTrendOptions` gains optional `colorOf?: (component: string, i: number) => string` and `extraSeries?: object[]` (appended after the stacked bars). Licensing passes `colorOf` from `catalogueHues`, `format: String`, and one `extraSeries` entry: a `scatter` series named "Licensed" with `symbol: "rect"`, `symbolSize: [32, 3]`, colour `chrome.text` (the licensed tick of the mockup), and the Forecast year drawn licensed-only (its actual stack is empty).
- Produces:
```ts
// licensingUtilisationOption.ts
export interface UtilisationBar { id: string; name: string; pct: number | null; noLicence: boolean; status: LicenseStatus; typeLabel?: string }
export function buildUtilisationOption(bars: UtilisationBar[], o: { chrome; isRtl; noData: string; noLicence: string }): EChartsCoreOption
// horizontal bars sorted by pct desc (no-licence first, no-data last), colour statusColor(status), markLine at 80 and 100,
// markArea 0-80 / 80-100 / 100-max with STATUS_COLORS at low opacity, x max = max(120, highest pct + 10), no-licence bar at x max,
// no-data bar 0 with label noData; height grows with rows (no top-N, the panel scrolls)
// licensingByTypeOption.ts
export interface ByTypeBar { key: string; label: string; licensed: number; actual: number | null; color: string }
export function buildByTypeOption(bars: ByTypeBar[], o: { chrome; isRtl; licensedLabel: string; actualLabel: string }): EChartsCoreOption
// grouped bars, licensed opacity 0.35, actual full; actual null renders "—"
```
- `LicensingReport` state (all in the saved config, keys exactly): `cardTypeKey` (`Application` | `ITComponent`), `metric`, `licenseType` (`""` = All), `groupBy`, `view` (`"chart"` = Utilisation, `"bytype"`, `"table"`), `scopeIds`, `fiscalYearParam` (`null` = current; options `cur … cur-4`, no Forecast), `pickedCardId` (`string | null`), `extraColumns`, `sortK`, `sortD`. One `useApiQuery` on `/reports/licensing?type&metric&fiscal_year&group_by&card_id`; `licenseType`, scope, drill and view never refetch.
  - Toolbar (inside `ReportShell`): card type, metric, licence type (All + catalogue from `license_types`, archived included and marked), group-by (same option builders as the cost report: `commonGroupableFields`, `relationGroupOptions`), `CardScopeFilter`, fiscal year select + chip, Columns menu in the table view (`isBuiltInFieldType`), and in the By-type view a `CardPicker types={["Application","ITComponent","Platform"]}` (Platform added by the agent's call in the spec). `ReportShell.actions` holds the Import button (only with `licenses.edit` or `*`) opening `LicensingImportDialog` (Task 12). Title icon `badge`, icon colour a token.
  - Metric cards: Compliant / Approaching / Over-licensed / No actual data counted from the rows' status (or `by_type[licenseType].status` when a type is picked; a type with `no_data` counts as No actual data), coloured by `statusColor`; hidden when `aggregate` is set.
  - Trend above every view: rows from `trend` summed over the cards that pass scope (`scope.closure`), drill (`applyDrill`) and the picked card; one stacked component per licence type (or the picked type), `extraSeries` licensed tick. Shown always (the Forecast year cannot be picked, see Ambiguities).
  - Utilisation view: bars from rows (or from groups when group-by is on: worst of the group's cards, `worst_of` rule, computed client-side by taking max pct / any no-licence); left click opens `CardDetailSidePanel`, right click drills (`setDrill`), `CostDrillBar` with `crumbsOf`, hint text; drill resets on type, metric, group-by, year, picked card.
  - By licence type view: bars from `by_type` summed over the filtered rows (or the aggregate), colours `catalogueHues`, no drill, no right click.
  - Table view: `LicensingTable`.
  - `CostLegend` entries: licence types with their hue (trend and by-type).
- `LicensingTable` props `{ rows; types: LicenseType[]; labelOf; groups?; extraColumns; fields; sortK; sortD; onSort; onOpen; onDrill }`: one header row (`<label> lic.`, `<label> act.`, `<label> %` per type, `Total lic.`, `Total act.`, `Status`, extra columns), group header rows when grouped, total row without %, every cell plain text so `extractSheetsFromDOM` exports it.
- Route `/reports/licensing` (lazy) in `App.tsx`; `ROUTE_PERMISSIONS` `{ path: "/reports/licensing", permission: "licenses.view" }`; `navItems.ts` entry `{ labelKey: "reports.licensing", icon: "badge", path: "/reports/licensing" }` after cost; `pageTitle.ts`; `savedReportStyles.ts` `licensing: { icon: "badge", color: <a theme token>, path: "/reports/licensing" }` and its label.

- [ ] **Step 1: Write the failing tests**
```ts
// licensingUtilisationOption.test.ts
it("sorts by pct desc, no-licence first, no-data last");
it("colours by status token and draws markLine 80 and 100");
it("puts a no-licence bar at the axis max with the no-licence label");
// licensingByTypeOption.test.ts
it("one licensed and one actual series per type, licensed faded"); it("missing actual shows a dash label");
// costTrendOption.test.ts
it("uses colorOf when given and appends extraSeries"); it("defaults unchanged for the cost report");
// LicensingTable.test.tsx
it("renders one header row with lic./act./% per type and no total %"); it("sorts by a type column");
it("right click on a row drills, click opens"); it("group header rows when grouped");
// LicensingReport.test.tsx (vi.mock("@/api/client"))
it("requests /reports/licensing with type, metric and no fiscal_year by default");
it("metric cards count statuses, and follow the licence type filter");
it("does not offer the Forecast year in the year select");
it("picking a Platform in By type sends card_id, hides metric cards and resets the drill");
it("scope and drill re-sum the trend without a new request");
it("shows Import only with licenses.edit");
it("persists and restores pickedCardId through the saved config");
// routePermissions.test.ts (existing parity test) passes with the new route
```
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/features/reports/licensing* src/features/reports/Licensing* src/features/reports/costTrendOption.test.ts src/lib/routePermissions.test.ts` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** same plus `npx vitest run src/features/reports/Cost* src/features/reports/cost* src/theme/rawColours.sourceScan.test.ts src/lazyRoutes.sourceScan.test.tsx` → PASS; `npx tsc --noEmit && npm run lint` clean.
- [ ] **Step 5: Commit** `feat(licensing): Licensing report page`.

---

### Task 12: Import dialog

**Files:**
- Create: `frontend/src/features/reports/LicensingImportDialog.tsx`; Modify `en/reports.json`
- Test: `frontend/src/features/reports/LicensingImportDialog.test.tsx`

**Interfaces:**
- Consumes: Task 8 route and response; `api.upload`; `MAX_ATTACHMENT_BYTES` from `lib/attachmentFormats.ts` (pre-upload size check).
- Produces: `LicensingImportDialog({ open, onClose, onApplied }: { open: boolean; onClose: () => void; onApplied: () => void })` — file input `accept=".xlsx"`, the column hint, `api.upload("/licenses/import?dry_run=true", file)` → "N rows matched" / "N rows skipped" pills, a table of skipped and flagged rows (row, component, translated reason `reports:licensing.import.reasons.<code>`), Apply (`dry_run=false`, same file) labelled "Apply N rows", disabled at 0 matched; after Apply `onApplied()` (the report bumps its `refetchKey`).

- [ ] **Step 1: Write the failing tests**: `it("previews with dry_run=true and lists skipped rows with their reason")`, `it("applies with dry_run=false and calls onApplied")`, `it("disables Apply when nothing matched")`, `it("refuses a file over the size cap before uploading")`, `it("shows the server message on a 400")`, `it("has a translation key for every backend reason code")` (the list of codes from Task 8 hard-coded in the test).
- [ ] **Step 2: Run** `npx vitest run src/features/reports/LicensingImportDialog.test.tsx` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** → PASS; tsc + lint clean.
- [ ] **Step 5: Commit** `feat(licensing): import dialog`.

---

### Task 13: Docs, version, changelog, OpenAPI, rules proposal

**Files:**
- Modify: `docs/guide/reports.md` (new "## Licensing Report" after Cost Report: views, gestures, import, statuses), `docs/guide/card-details.md` (Licensing section), `docs/admin/metamodel.md` ("## Licence types" after "## Cost items"), `docs/admin/workspace-transfer.md` (two sheets), `docs/reference/glossary.md` (Licence type, Utilisation), `scripts/screenshots/pages.ts` (`103_report_licensing` route `/reports/licensing`, `104_card_licensing` on a demo Application scrolled to the section; `filenames` for the 8 named locales), `VERSION` (`2.190.0`), `CHANGELOG.md`, `docs/api/openapi.json` (regenerated)
- Proposal only (not written): `.claude/rules/licensing-items.md`

- [ ] **Step 1: Docs** in English only, image references `![…](../assets/img/en/103_report_licensing.png)` and `104_card_licensing.png` in the English pages (the siblings come from `/translate`). Run `mkdocs build --strict` → no error.
- [ ] **Step 2: Version and changelog**: `VERSION` → `2.190.0`; `CHANGELOG.md` heading `## [2.190.0] - <merge date>` with **Added** (Licensing section on Application and IT Component cards; Licensing report with Utilisation, By licence type and Table views; Excel import of licence counts; Licence types catalogue) and **Changed** (the Licensing Analysis extension's data moves into core; uninstall the extension after upgrading; `licenses.view` / `licenses.edit` permissions).
- [ ] **Step 3: OpenAPI**: from the repo root `python scripts/dump_openapi.py`; `git diff docs/api/openapi.json` shows only the new `/cards/{card_id}/licenses…`, `/metamodel/license-types…`, `/reports/licensing` and `/licenses/import` paths and their schemas.
- [ ] **Step 4: Rules file proposal** — prepare, do not write, the exact text of `.claude/rules/licensing-items.md` (frontmatter `paths:` = the licensing services, routes, models, migrations 177/178, `LicensingSection*`, `LicensingReport*`, `licensing*Option.ts`, `lib/licenses.ts`), mirroring `cost-items.md`: the data shape, the one status definition (`license_status.py`), year resolution and licensed-only carry, permissions, event + redaction, migration 178 report key, import rules, guard tests. Show it to the user with the lines and ask for a yes.
- [ ] **Step 5: Commit** `docs(licensing): guide, admin page, changelog, OpenAPI` (version bump in the same commit).

---

### Task 14: Finish

- [ ] **Step 1: Graph and full suites**: `/graphify . --update --mode deep`; `./scripts/test.sh` and `cd frontend && npm run test:run` → green.
- [ ] **Step 2: `/translate`** (Sonnet translator): fills the nine locales for the new UI keys, `seed.py` `translations` of `licensingModel` and its options, the doc siblings and the screenshot filenames; parity tests green.
- [ ] **Step 3: Review chain**, each by a fresh agent, in order: `simplify` → re-run the tests of the files it touched → `ponytail-review` (whole branch diff; apply every Must/Should with its test, re-run) → `security-review`. VAPT pass (new routes and tables; `.claude/rules/vapt.md`, Medium tier, DB backup first).
- [ ] **Step 4: Render check** in the browser pane against the local deploy (`turbo-ea-conf`, images built per CLAUDE.md, DB backup first): card section (current, carried-forward, Forecast), report in its three views in light and dark, a Platform pick, the import preview, the licence types dialog, RTL (`ar`) once.
- [ ] **Step 5: PR** from the template (Summary, Changes, Test Plan with the four CI boxes, Checklist); push; read the `Backend` / `Frontend` / `MCP Mutation Tests` results and report survivors to the user. No comments on the PR.

---

## Ambiguities and contradictions found while planning (not decided by the spec)

Recorded for the user and the plan reviewer; where the plan had to pick, the pick is stated.

1. **Trend visibility**: the cost report shows its trend only when the Forecast year is selected (`showForecast` in `CostReport.tsx`), but the licensing year select cannot offer the Forecast year. "As in the cost report" would never show it. Plan: always shown.
2. **`/license-types` gate**: the spec says "gated by `admin.metamodel`"; the cost catalogue's GET is open to any signed-in user and only writes are gated. Plan: mirror costs (GET open).
3. **Spelling**: the code uses `license` (keys, routes, permissions); the spec's UI text says "licence". English UI copy spelling is not settled. Plan: identifiers `license`, English strings "licence" as in the spec; import header accepts both.
4. **ITComponent already has a `licenseType` text field** ("License Type", seed.py `Cost` section). Next to the new "Licence type" catalogue the two will read as the same thing. Not addressed by the spec.
5. **"The general-fields section"**: Application has "Application Information", IT Component "Component Information"; neither is called "general". Plan: those two (`GENERAL_SECTION`).
6. **`remove_field_contributions` in a migration**: it is async ORM and cannot run inside a sync Alembic step. Plan: extract its pure body (`strip_ext_fields`) and call that from 178.
7. **Disabling the extension does not stop an admin re-enabling it**, which would re-apply the four `ext.licensing.multivalue` fields (the `licensingModel` key collision is skipped). The spec says re-enable "cannot recreate" them. Not solved by `enabled=false` alone.
8. **Data-quality recompute "for the two types"** cannot run in a sync migration either. Plan: bump `_DQ_RESCORE_FLAG` to V4 (whole-instance one-shot rescore at startup, migration 137's pattern), which rescores every type, not only two.
9. **Saved reports of the old extension** (`ext:licensing:*` report types) become dead entries in the gallery. The spec does not say whether 178 converts, deletes or leaves them. Plan: left as they are.
10. **Where the trend's scope/drill filtering happens**: "the series per year for the active card, drill or scope" could be server-side, but the cost report scopes and drills client-side. Plan: the response carries per-card trend values and the page sums them (one request, no refetch on drill/scope).
11. **Card section with an empty `licensingModel`**: the report excludes such cards, but the spec does not say what the section shows. Plan: the section renders with a hint and the edit link.
12. **Licence type colours vs the Costs section**: the spec gives archived types their sort-order hue; `CostsSection` paints archived items grey. Plan follows the spec for licensing and leaves costs alone.
13. **Licence type filter in the report**: the spec says the bar shows the selected type's percentage, not whether the status, metric cards and table status follow the type too. Plan: they follow it (`by_type[type].status`, `no_data` counted as No actual data).
14. **Event payload**: costs carry no fiscal year; the History summary of a licence change is unreadable without one. Plan: `fiscal_year` added to the payload (not sensitive).
15. **`CardLicenses` among the sheets that finalise cards**: licences change no card attribute, so `_finalize_cards` does nothing for them; added only because the spec says so.
16. **Import rows with both Licensed and Actual empty** and **fractional counts** are not covered by the listed skip reasons. Plan: `nothing_to_write` and `invalid_number`.
17. **Upload helper**: `_read_validated_upload` lives in `api/v1/file_attachments.py` (private). Plan: made public and imported by the licensing route instead of copying it.
