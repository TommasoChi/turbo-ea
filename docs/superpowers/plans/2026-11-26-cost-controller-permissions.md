# Cost access and the Cost Controller role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Backend tasks go to `backend-dev`, frontend tasks to `frontend-dev` (project rule); neither commits.

**Goal:** One cost-permission rule in two layers (application permission opens the function, card permission says on which cards), a new card permission `card.edit_costs`, a Cost Controller stakeholder role, a PPM Manager application role, Member and BPM Admin out of the PPM and the costs, and amounts withheld from whoever cannot view a card's costs.

**Architecture:** `card.edit_costs` joins the card-permission registry and `APP_TO_CARD_PERMISSION_MAP`; `PermissionService.can_edit_costs` stops reusing the license rule; the PPM write routes get two helpers (manage = `ppm.view` + `ppm.manage` + card edit, cost write = `ppm.view` + `ppm.manage` + `can_edit_costs`); one migration copies `card.edit` into `card.edit_costs` and takes `ppm.manage` and `costs.view` from the built-in `member` and `bpm_admin` roles; the seed adds the roles; workspace transfer fills the new key for older bundles; the PPM read routes omit amounts without cost access; the frontend reads a new `can_edit_costs` flag.

**Tech Stack:** FastAPI, SQLAlchemy async, Alembic, pytest (factories in `backend/tests/conftest.py`), React 19 + MUI 6 + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-26-cost-controller-permissions-design.md` (R21, R22, R23; the matrix in it is the acceptance table).

## Global Constraints

- Branch from an updated `main` (`feat/cost-controller-permissions`), never commit to `main`; merge only after review and green CI.
- Bump only `/VERSION` (minor; `2.215.0` unless `main` moved, and then the constant of Task 5 follows it) and add a `## [x.y.z] - 2026-11-26` heading to `CHANGELOG.md`.
- `cd backend && ruff format . && ruff check .` before every commit; ruff line length 100.
- No raw SQL outside migrations; no new tables. The migration after `201` is `202` (check `main` first), Python-side fetch-mutate-update with `CAST(:s AS jsonb)` (the pattern of `195_stakeholder_role_view_costs.py`).
- English only in code, seed labels and docs; translations by `/translate` before the PR.
- Every new or changed route response: regenerate `docs/api/openapi.json` with `python scripts/dump_openapi.py` from the repo root.
- A card the user cannot read does not exist for them (404 stays 404, even before a 403 on the card permission); amounts are omitted from the response (keys absent, no `None`, no zero), never only hidden by the page.
- Licenses keep their rule: `can_edit_licenses` behaves exactly as before.
- Run the `vapt` agent before the PR (this PR touches `permissions.py` and `permission_service.py`).
- Existing tests that assumed the old rule are updated explicitly (list in Task 6), never loosened to pass.

## Review Focus

- A role with `costs.edit` whose card type has a View deny must not get the cost write button: `can_edit_costs` in `/my-permissions` is `PermissionService.can_edit_costs`, not a union of maps.
- A user with `ppm.manage` who is neither `inventory.edit` nor a stakeholder with `card.edit` gets 403 on every Manage route and 200 on none; on a hidden initiative they get 404.
- Member and BPM Admin (after the migration and on a fresh install) get 403 on every PPM write route and see no cost field; a user with the PPM Manager application role and a Responsible stakeholder role on an initiative manages it and its costs.
- An older workspace bundle, fork or upstream, imports with the same cost-editing rights its stakeholder roles had (`0.0.0-dev` is not "older").
- Without cost access: no `amount`, `planned`, `actual`, `remaining_*`, total, rollup, calculated value or numeric custom field in any PPM response (and no zeros standing in for them), while the rows (description, FY, Provider, dates) stay.

---

### Task 1: Permission registry, defaults and legacy helper

**Files:**
- Modify: `backend/app/core/permissions.py`
- Test: `backend/tests/core/test_permissions_edit_costs.py`

**Interfaces:**
- Produces: `EDIT_COSTS_CARD_PERMISSION = "card.edit_costs"`; `COST_CONTROLLER_CARD_PERMISSIONS: dict[str, bool]`; `PPM_MANAGER_APP_PERMISSIONS: dict[str, bool]`; `with_legacy_edit_cost_grant(role_key: str, permissions: dict) -> dict`; `"costController"` in `DEFAULT_CARD_PERMISSIONS_BY_ROLE`; `"costs.edit": "card.edit_costs"` in `APP_TO_CARD_PERMISSION_MAP`; `MEMBER_PERMISSIONS` and `BPM_ADMIN_PERMISSIONS` with `ppm.manage` and `costs.view` False.

- [ ] **Step 1: Write failing tests** in `test_permissions_edit_costs.py`:
  - `test_card_permission_registry_has_edit_costs`: key in `ALL_CARD_PERMISSION_KEYS`; `APP_TO_CARD_PERMISSION_MAP["costs.edit"] == "card.edit_costs"`.
  - `test_every_default_role_map_carries_edit_costs_equal_to_card_edit`: for each map in `DEFAULT_CARD_PERMISSIONS_BY_ROLE` except `costController`, `map["card.edit_costs"] == map["card.edit"]`.
  - `test_cost_controller_card_permissions`: exactly `card.view`, `card.view_costs`, `card.edit_costs`, `card.create_comments` True, every other key False.
  - `test_ppm_manager_app_role`: `ppm.view`, `ppm.manage`, `inventory.view` True; `inventory.edit`, `costs.view`, `costs.edit` False; every other key equals `VIEWER_PERMISSIONS`'s.
  - `test_member_and_bpm_admin_have_no_ppm_manage_or_costs`: `ppm.manage`, `costs.view`, `costs.edit` False; `ppm.view` unchanged.
  - `test_with_legacy_edit_cost_grant`: a map without the key gets `card.edit`'s value (False when `card.edit` is absent); a map with the key, either value, is returned unchanged; a non-dict is returned unchanged.
- [ ] **Step 2: Run** `cd backend && python -m pytest tests/core/test_permissions_edit_costs.py -q` → FAIL (names undefined).
- [ ] **Step 3: Implement** in `permissions.py`: the `CARD_PERMISSIONS` entry ("Edit this card's costs (budget, cost items, invoices) without the costs.edit permission"); the constant; the map entry; `card.edit_costs` equal to `card.edit` in every existing `*_CARD_PERMISSIONS` dict; `COST_CONTROLLER_CARD_PERMISSIONS` (same key set as `OBSERVER_CARD_PERMISSIONS`); `PPM_MANAGER_APP_PERMISSIONS = {**VIEWER_PERMISSIONS, "ppm.manage": True}`; the helper (docstring in the style of `with_legacy_cost_grant`); the `DEFAULT_CARD_PERMISSIONS_BY_ROLE["costController"]` entry; turn `ppm.manage` and `costs.view` off in `MEMBER_PERMISSIONS` and `BPM_ADMIN_PERMISSIONS`. Rewrite the `costs.edit` description (l.~251): it needs the permission or a stakeholder role with `card.edit_costs`, not "can edit the card".
- [ ] **Step 4: Run** the file and `tests/core -q` → PASS. Fix any test of defaults that pinned the old Member / BPM Admin maps (list them in the commit message).
- [ ] **Step 5: Commit** `feat(permissions): card.edit_costs, PPM Manager and Cost Controller defaults`.

### Task 2: `PermissionService` cost-edit rule and effective permissions

**Files:**
- Modify: `backend/app/services/permission_service.py` (`_can_edit_domain` l.399, `can_edit_costs` l.497, `get_effective_card_permissions` l.527)
- Test: `backend/tests/services/test_permission_service_edit_costs.py`

**Interfaces:**
- Consumes: Task 1 constants.
- Produces: `PermissionService._can_edit_domain(db, user, card_id, perm, card_perm="card.edit")` (licenses unchanged); `can_edit_costs` uses `EDIT_COSTS_CARD_PERMISSION`; `effective["can_edit_costs"]: bool` computed by `await PermissionService.can_edit_costs(db, user, card_id)`.

- [ ] **Step 1: Write failing tests** (factories from `conftest.py`; parametrise over the profiles of the spec matrix: only `view_costs`, only `edit_costs`, Viewer, Cost Controller, Responsible/PM, Observer, admin):
  - `test_can_edit_costs_matrix`: stakeholder `card.edit_costs` + `costs.view` → True; stakeholder `card.edit` only (+ `costs.view`) → **False**; app `costs.edit` + `costs.view` → True; `costs.edit` without a view right → False; `edit_costs` alone, `view_costs` alone → False.
  - `test_can_edit_licenses_unchanged`: a stakeholder with `card.edit` still edits licenses.
  - `test_effective_can_edit_costs_equals_service`: for every profile above and for a role with `costs.edit` whose type has a View deny (False), `effective["can_edit_costs"]` equals `PermissionService.can_edit_costs`.
- [ ] **Step 2: Run:** `python -m pytest tests/services/test_permission_service_edit_costs.py -q` → FAIL.
- [ ] **Step 3: Implement:** the `card_perm` argument; `can_edit_costs` passes `EDIT_COSTS_CARD_PERMISSION`; add `"can_edit_costs": await PermissionService.can_edit_costs(db, user, card_id)` to `effective`.
- [ ] **Step 4: Run** the new file and `tests/services/test_permission_service*.py -q`. Update, explicitly and with `card.edit_costs` in their fixtures, `tests/services/test_permission_service_costs.py` (`TestCanEditCosts`, l.311-349) and any other test that gave only `card.edit`; then PASS.
- [ ] **Step 5: Commit** `feat(permissions): editing a card's costs follows card.edit_costs`.

### Task 3: Migration 202

**Files:**
- Create: `backend/alembic/versions/202_edit_costs_permission.py`
- Test: `backend/tests/services/test_alembic_202_edit_costs_permission.py`

**Interfaces:**
- Produces (pure, literals not imports, like 195): `plan_stakeholder_permissions(permissions) -> dict | None` and `plan_role_permissions(role_key: str, permissions) -> dict | None`.

- [ ] **Step 1: Write failing tests:** `plan_stakeholder_permissions({"card.edit": True})` adds `card.edit_costs` True; `{}` adds `card.edit_costs` False (the key is always written, as 195 does); a map already carrying the key → `None`; `plan_role_permissions("member", {"ppm.manage": True, "costs.view": True, "ppm.view": True})` → `ppm.manage` and `costs.view` False, `ppm.view` kept; same for `bpm_admin`; any other role key → `None`; a map already False → `None`; a DB test (`test_engine`, committed rows removed by the guard fixture) that runs `upgrade()` over a Member role, a custom role with `ppm.manage`, an admin wildcard role and a stakeholder definition, checks the custom and wildcard roles are untouched and a second run changes nothing.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `upgrade()` and `downgrade()` (downgrade drops `card.edit_costs` from stakeholder maps; the two role permissions are not restored, documented in the docstring). Revision `202`, down_revision `201`.
- [ ] **Step 4: Run** the file and `tests/services/test_alembic*.py -q` → PASS.
- [ ] **Step 5: Commit** `feat(migrations): card.edit_costs on stakeholder roles, Member and BPM Admin leave PPM and costs`.

### Task 4: Seed the roles

**Files:**
- Modify: `backend/app/services/seed.py` (Initiative `stakeholder_roles` ~l.2106, `_APP_ROLES` l.6649, the `ITComponent` type entry, `seed_roles` l.6925)
- Test: `backend/tests/services/test_seed_cost_controller.py`

**Interfaces:**
- Consumes: Task 1. Produces: module-level `_COST_CONTROLLER_ROLE: dict[str, Any]` (key `costController`, label `Cost Controller`, `counts_for_quality: True`, English description, no translations yet).

- [ ] **Step 1: Write failing tests:** after the seed on an empty database, `StakeholderRoleDefinition` rows with key `costController` exist for exactly `Initiative`, `Application` and `ITComponent`, with the Task 1 permissions and `counts_for_quality` True; no other type has it; the application role `ppm_manager` exists with `PPM_MANAGER_APP_PERMISSIONS` (`is_default` False, `is_system` False); `member` and `bpm_admin` are seeded with the Task 1 maps; a second run adds nothing; on a database seeded before this change (rows deleted) a re-run adds the roles; an admin-edited description is not overwritten.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement:** `_COST_CONTROLLER_ROLE`; append it to Initiative's explicit list and to `_APP_ROLES`; give the `ITComponent` entry an explicit `stakeholder_roles = _DEFAULT_ROLES + [_COST_CONTROLLER_ROLE]` (no other type gets it); add the `ppm_manager` entry to `seed_roles` (label `PPM Manager`, a sort order after the existing four). Translations are left to `/translate`.
- [ ] **Step 4: Run** the file and `tests/services/test_seed*.py tests/services/test_i18n_seed.py -q` (the i18n seed test stays red until `/translate`; record it).
- [ ] **Step 5: Commit** `feat(seed): Cost Controller stakeholder role and PPM Manager application role`.

### Task 5: Workspace transfer for older bundles

**Files:**
- Modify: `backend/app/services/workspace_io/applier.py` (l.1540-1605)
- Test: `backend/tests/services/test_workspace_io_legacy_edit_costs.py`

**Interfaces:**
- Consumes: `with_legacy_edit_cost_grant`. Produces: `EDIT_COSTS_SINCE = (2, 215, 0)` (equal to the version this PR bumps) and `_predates_edit_costs(bundle) -> bool`: True for a bundle without the `CostItemTypes` sheet (upstream, which never had the key), and for a fork bundle whose `app_version` is a parsed X.Y.Z below `EDIT_COSTS_SINCE`; False when `app_version` is `None` or not X.Y.Z (`0.0.0-dev`).

- [ ] **Step 1: Write failing tests:** a fork bundle at 2.214.0 imports its stakeholder roles with `card.edit_costs` = their `card.edit`; an upstream bundle of any version (including 2.230.0) does the same; a fork bundle at 2.215.0, one naming no version and one at `0.0.0-dev` import as they are; a bundle missing `costController` does not delete the target's role (upsert by natural key); `Role` rows are imported as the bundle carries them.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the constant, the predicate and the call next to the existing legacy grants (stakeholder branch only).
- [ ] **Step 4: Run** the file and `tests/services/test_workspace_io*.py -q` → PASS.
- [ ] **Step 5: Commit** `feat(workspace-transfer): older bundles keep their cost-editing rights`.

### Task 6: PPM write gates

**Files:**
- Modify: `backend/app/api/v1/ppm.py`
- Test: `backend/tests/api/test_ppm_permission_matrix.py`; conftest fixture for a user with the `ppm_manager` application role

**Interfaces:**
- Produces: `async def _require_manage(db: AsyncSession, user: User, initiative_id: str) -> Card` and `async def _require_cost_write(db, user, initiative_id: str) -> Card`. Both convert the id with `uuid.UUID`, then check in this order: `ppm.view` and `ppm.manage` (403), the initiative is readable via `_get_initiative_or_404` (404 for a hidden one), then card edit (`check_permission(db, user, "inventory.edit", card.id, "card.edit")`) or `PermissionService.can_edit_costs` (403). They return the card so handlers drop their own lookup.

- [ ] **Step 1: Write failing tests** (one parametrised test over the matrix profiles × these routes): *manage routes*: create/update/delete status report (def l.308/338/364), risk (1346/1374/1399), task (1504/1558/1611), task comment create (1674), WBS (1966/2011/2084), Gantt move (2059), dependency (2211/2285); *cost routes*: create/update/delete cost line (574/646/758, the move between budgets inside `update_cost_line` included), budget line (859/912/985), invoice (1174/1205/1244). Profiles: PPM Manager + stakeholder Responsible/PM → 2xx on both; PPM Manager + stakeholder Cost Controller → 2xx cost routes, 403 manage routes; PPM Manager with no stakeholder role → 403 on both; Member and BPM Admin (default maps) → 403 on both; Viewer → 403; "only `view_costs`" and "only `edit_costs`" profiles → 403; `ppm.manage` + `costs.edit` without a view right → 403 on cost routes; a hidden initiative + `ppm.manage` → 404; task comment edit/delete by the author still works for a Viewer-profile author.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the helpers and replace each `require_permission(db, user, "ppm.manage")` of the listed handlers (all 25, lines 314, 344, 369, 580, 652, 763, 865, 918, 990, 1180, 1211, 1249, 1352, 1380, 1404, 1510, 1564, 1616, 1680, 1972, 2017, 2073, 2089, 2217, 2290). The two `check_permission("ppm.manage")` at l.1712 and l.1732 stay (author or manager).
- [ ] **Step 4: Update, explicitly, the existing tests that assumed the old rule** (give the fixture `card.edit_costs` or the `ppm_manager` role as the case needs): `tests/api/test_card_costs_permissions.py` (l.44-50), `tests/api/test_cards_costs.py` (l.249, 316), `tests/api/test_cost_import_api.py` (l.280), `tests/api/test_cost_history_api.py` (l.206), `tests/api/test_ppm_cost_providers.py` (l.446-452), `tests/api/test_ppm.py` (l.834-866), and check `test_ppm_field_settings.py` and `test_ppm_gantt_move.py`. Then run `tests/api/test_ppm*.py tests/api/test_card_costs*.py tests/api/test_cards_costs.py -q` → PASS.
- [ ] **Step 5: Commit** `feat(ppm): manage needs card.edit, cost writes need card.edit_costs`.

### Task 7: Cost routes outside the PPM gates

**Files:**
- Modify: `backend/app/api/v1/cost_history.py` (`_load_card_for_edit`, l.64-80), `backend/app/services/ppm_field_relations.py` (`apply_configured_card_relations`, l.128-138)
- Test: `backend/tests/api/test_cost_history_permissions.py`; extend `backend/tests/api/test_ppm_field_relations.py`

- [ ] **Step 1: Write failing tests:** on an **Initiative** (the only type with a cost history; Application and IT Component answer 409 `use_cost_items`): a Cost Controller (no `card.edit`) lists and writes cost history → 200; a user with `card.edit` only (no `card.edit_costs`) writing → 403, reading with `costs.view` → 200. On an Application and an IT Component the Cost Controller writes `PUT /cards/{id}/costs/{fy}/items/{key}` → 200. A cost write through the PPM cost routes that creates a configured relation succeeds for a Cost Controller without `relations.manage`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement:** `cost_history` requires `can_view_costs` to read and `can_edit_costs` to write (no longer `card.edit`); remove the `require_permission("relations.manage")` from `apply_configured_card_relations`: all 12 callers sit on the budget/cost/invoice routes already behind `_require_cost_write`; keep a test that proves a caller without it is refused before the service runs.
- [ ] **Step 4: Run** the new files and `tests/api/test_cost_history_api.py tests/api/test_ppm_field_relations.py -q` → PASS.
- [ ] **Step 5: Commit** `feat(costs): cost history and configured relations follow the cost permissions`.

### Task 8: Withhold amounts without cost access

**Files:**
- Modify: `backend/app/schemas/ppm.py`, `backend/app/api/v1/ppm.py` (`/costs` l.535, `/financials` l.1070, `/budgets` l.825, `/rollup` l.1286, the patch and move responses), `backend/app/services/ppm_financials.py`
- Test: `backend/tests/api/test_ppm_amounts_withheld.py`

**Interfaces:**
- Produces: amount fields in the PPM schemas become `| None = None` and are omitted with `exclude_unset`/`exclude_none` (the way `/financials` already works); `PpmRollupOut`'s zero defaults must not appear for a withheld rollup; one `can_view_costs` decision per request via `PermissionService.can_view_costs`; numeric custom fields and calculated values dropped with the amounts.

- [ ] **Step 1: Write failing tests:** as a Viewer, an Observer stakeholder and a Cost-Controller-less PPM Manager on an initiative with budget lines, cost lines, invoices, a numeric custom field and a calculated field: each endpoint returns the rows (description, FY, Provider, dates) and none of the amount keys, no zero in their place; invoices absent; `/rollup` carries no totals; non-vacuity controls as Cost Controller and as admin see everything; `/reports/ppm/dashboard` and `/gantt` keep the rows and drop the amounts for the Viewer. Enumerate the amount-bearing fields from `schemas/ppm.py` and `ppm_financials.load_financials` in the test.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the optional fields and the omission on every route above.
- [ ] **Step 4: Run** the file and `tests/api/test_ppm_financials.py tests/api/test_ppm.py tests/api/test_ppm_ancestor_rollup.py -q` → PASS.
- [ ] **Step 5: Commit** `feat(ppm): amounts are withheld from users without cost access`.

### Task 9: Frontend gates

**Files:**
- Modify: `frontend/src/types/index.ts` (card perms l.98 and its default objects), `frontend/src/features/cards/CardDetailContent.tsx` (l.162-166, 474-641), `frontend/src/features/ppm/PpmProjectDetail.tsx` (perms default l.67 and the tab list `PPM_TAB_LABEL_KEYS`), `PpmCostTab.tsx` (l.69), `PpmManageDialog.tsx`, `PpmReportsTab.tsx`, `PpmRiskTab.tsx`, `PpmTaskBoard.tsx`, `PpmGanttTab.tsx`, `PpmOverviewTab.tsx`, `PpmProjectReport.tsx`, `PpmCostCharts.tsx`, `frontend/src/features/admin/metamodel/StakeholderRolePanel.tsx` (l.447-453), `frontend/src/i18n/locales/en/admin.json`
- Test: next to each changed file (`*.test.tsx`)

**Interfaces:**
- Consumes: `effective.can_edit_costs` from `GET /cards/{id}/my-permissions`. Produces: `can_edit_costs: boolean` on the card-permissions type (default `false` wherever `can_view_costs` is defaulted); a prop `canEdit: boolean` on the PPM tabs and on `PpmCostTab`, set in `PpmProjectDetail` and `PpmManageDialog` to `can("ppm.manage") && perms.can_edit` (`can("ppm.manage") && perms.can_edit_costs` for the cost tab); a prop `canViewCosts: boolean` on the overview, report and chart components.

- [ ] **Step 1: Write failing tests:** Manage buttons (summary, timeline, reports) render only when `can("ppm.manage") && perms.can_edit`; the cost Manage button and the Cost tab's `readOnly` follow `can_edit_costs` (a Cost Controller edits costs and gets no Manage for reports or Gantt); the report, risk, task and Gantt tabs render read-only without `canEdit`; with `can_view_costs` false the cost sections, the Budget & Costs tab and its Manage are not rendered and the remaining tab indices and the `tab` search parameter still land on the right tab; `PpmOverviewTab`, `PpmProjectReport` and `PpmCostCharts` render without NaN or zeros when the amounts are absent; the role panel shows a translated description for `card.edit_costs` (key `metamodel.stakeholderPanel.editCostsDescription`).
- [ ] **Step 2: Run:** `cd frontend && npx vitest run src/features/cards src/features/ppm src/features/admin/metamodel` → FAIL.
- [ ] **Step 3: Implement** the gates and props above; the cost Manage button in `CardDetailContent.tsx:165` follows `can_edit_costs` (a user who only views costs sees the summary, no Manage); add `editCostsDescription` (English) to `admin.json`.
- [ ] **Step 4: Run** `npm run test:run -- src/features/cards src/features/ppm src/features/admin src/hooks src/i18n` → PASS.
- [ ] **Step 5: Commit** `feat(frontend): manage and cost buttons follow the card permissions`.

### Task 10: Docs, OpenAPI, version, full verification

**Files:**
- Modify: `docs/admin/metamodel.md` (stakeholder role permissions: `card.edit_costs`, the Cost Controller), `docs/admin/users.md` (the PPM Manager role, Member and BPM Admin without PPM Manage and costs), the PPM guide page (Manage needs card edit, no amounts without cost access), `docs/api/openapi.json`, `/VERSION`, `CHANGELOG.md`

- [ ] **Step 1:** `python scripts/dump_openapi.py` from the repo root; the diff shows only the optional amount fields (the `my-permissions` route has no `response_model`, so `can_edit_costs` is documented in the guide, not the spec).
- [ ] **Step 2:** Write the docs (English) and the CHANGELOG entry: Added (`card.edit_costs`, Cost Controller, PPM Manager), Changed (PPM amounts need cost access; Manage needs card edit; Member and BPM Admin lose PPM Manage and cost view, a Project Manager with a Member role needs the PPM Manager role; who can assign the Cost Controller; a deleted built-in role is recreated at restart); bump `/VERSION`.
- [ ] **Step 3:** Run `cd backend && ruff format . && ruff check . && python -m pytest tests -q`, then `cd frontend && npm run test:run`, one at a time → green; record failures by name.
- [ ] **Step 4:** Run `/translate`, then `scripts/docs/docker-docs.sh all`, then the review chain (`code-simplifier`, `code-reviewer`, `security-reviewer`) and the `vapt` agent; fix findings with tests.
- [ ] **Step 5:** Open the PR with `.github/pull_request_template.md` (Test Plan names the existing tests updated in Task 6); after the review, ask the owner before editing any rule file (`card-read-scope.md`, `cost-items.md`, the permissions rules) and before saving the learning.
