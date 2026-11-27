# Visibility Cones Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Release Admin-only Organization writes and prepare inherited per-card authorization with workspace activation unavailable until phase 3.

**Architecture:** Keep the merged direct-grant resolver. Store position eligibility on stakeholder role definitions and durable root/branch state on Organization cards. Derive subordinate grants from a recursive SQLAlchemy query over the current chart. A shared backend boundary governs Organization mutations, including paths that bypass the card controller.

**Tech stack:** FastAPI, PostgreSQL, SQLAlchemy ORM, Alembic, React, MUI, pytest and Vitest.

**Spec:** [Visibility cones](../specs/2026-11-27-visibility-cones-design.md). Phase 1 shipped in PR #95. Start from `aacbd5fb8` and the join cleanup on this branch. The cleanup retains inferred `Stakeholder.card_id → Card.id` and all three projected columns.

## Global constraints

- Implement R1–R5 and R7–R11 only as specified for phase 2. Phase 3 owns inherited list/reference SQL, production activation, and activation review for ambiguous roots. Keep normal list admission and filters intact in phase 2.
- Organization is read-only for every effective application role except built-in `admin`, even when cones are off. This includes `me/observe`. Non-Organization operations keep their current behavior.
- Admin explicitly appoints Responsible at create or later. A vacancy preserves traversal. A branch orphaned by archive or deletion stays suspended until explicit reattachment to a valid active branch.
- Inherit every stakeholder permission from eligible assignments, including `card.manage_stakeholders`. Do not inherit application roles, application grants or type permission cells. Inherited `card.view` may survive a View deny. Using a write grant from the cone requires target-card readability.
- Keep PPM function gates, cost and license view/edit prerequisites, application-only callers and personal identity queries. Store only the true acting user, along with the original event details, in the audit of a cone-authorized action.
- Author English UI strings and manual text. Route payload changes start in schemas. Regenerate OpenAPI and run translation/doc gates before PR. Bump `VERSION` and add one matching changelog entry for the user-visible Admin-only behavior.
- Assign backend work to `backend-dev` and frontend work to `frontend-dev` using Codex. The calling session owns Git. Check test counts and expected failures before each implementation change. Run only targeted tests locally and leave mutation testing to CI.

## Review focus

- A user with direct Responsible, delegated `admin.metamodel`, a custom role or an Admin session impersonating Member still cannot write Organization. Check stored Deny cells as well as API outcomes.
- Archive/delete and automatic child strategies can change Parent. Restore alone must not resume a cone. Invalid paths and cycles grant no rights.
- Imported roles, cards and assignments can change authorization in both populated and empty destinations. Previews and apply use the same decision and current actor authority.
- The same user can be reached by several positions. Multiple holders, vacancies, inactive accounts, more than three levels and separate valid positions must yield consistent results.
- A manager may see a target but lack access to the source path or holder. No hidden source ID, name or extra user fields may reach the response.

## Task 1. Persist Organization chart inputs and Deny cells

**Files:** `backend/app/models/stakeholder_role_definition.py`, `backend/app/models/card.py`, `backend/alembic/versions/204_visibility_cone_inputs.py` (confirm next head before implementation), `backend/app/services/seed.py`, `backend/app/core/permissions.py`, `backend/app/api/v1/roles.py`, `backend/app/api/v1/metamodel.py`.

**Interfaces:** `StakeholderRoleDefinition.is_position_role: bool` defaults false. `Card.organization_cone_state` is nullable for other card types. Organization values are `connected`, `orphaned` and `unconfirmed_root`. A valid `connected` root is an explicit Admin-created root or one with confirmed history. The migration treats existing parentless positions without confirmation as `unconfirmed_root`. The traversal treats missing, unknown or inconsistent status as ineligible. Add no table.

- [ ] Write migration and seed tests. Assert preexisting Organization Responsible is marked on upgrade. A subsequent seed keeps an explicitly saved false. Observer and non-Organization roles remain unmarked. Verify existing root and child states, fresh chart defaults, downgrade and fresh install against the PostgreSQL Alembic head.
- [ ] Write matrix tests for upgrade, role creation, matrix save and imported Allow. Assert Organization `inventory.create`, `inventory.edit` and `inventory.delete` are stored as `False` for every non-Admin role, including new custom roles. Preserve View, unrelated cells and the Admin exception.
- [ ] Add the model columns and migration using typed SQLAlchemy operations. Reuse one core matrix normalizer at role creation, Organization matrix writes, seed, migration and transfer entry points where runtime code can be shared. Keep migration behavior pinned to its revision. Invalidate type-permission caches after committed matrix changes.
- [ ] Re-run the migration, seed and roles/metamodel tests targeted by the change. Commit the data slice after review by the calling session.

## Task 2. Enforce Organization mutations and explicit appointment

**Files:** `backend/app/services/card_write_service.py`, `backend/app/services/card_lifecycle.py`, `backend/app/api/v1/cards.py`, `backend/app/api/v1/stakeholders.py`, `backend/app/api/v1/stakeholder_roles.py`, `backend/app/services/stakeholder_service.py`, `backend/app/schemas/card.py`, and the confirmed indirect writers in the inventory below.

**Interface:** In a small Organization chart service, implement `require_organization_admin(user: User, card_type_key: str) -> None` using `effective_role_key(user) == "admin"` when the write targets Organization. Run the existing read gate first on a named card and preserve hidden card 404. Ordinary application and stakeholder write grants still apply elsewhere. Reject a non-Admin mutation before its first write and before any audit success entry.

- [ ] Inventory actual write call sites and assign each to a server enforcement point. Cover create/patch, bulk update and lifecycle, derived cascade candidates including reparented survivors, restore and hard delete, stakeholder CRUD and bulk, every method of `me/observe`, role definition changes and role migration, workspace and platform import, batch rollback, survey assignment and ServiceNow. Check whether cost/license, extension bridge or other mutation paths accept Organization IDs and apply the boundary wherever they do. Record file, entry point, actor, check location and test. Keep system-only bootstrapping separate from user and integration actors.
- [ ] Write API tests with direct Responsible, Member, delegated metamodel roles, effective Member impersonation and Admin. Assert 403 for each visible unauthorized Organization mutation, 404 for a hidden ID, unchanged rows after denied bulk/rollback, and unchanged Application control behavior. Denied and allowed paths must both exercise the server boundary.
- [ ] Gate all inventoried writes, including destination rows selected indirectly by lifecycle and rollback. Use the same effective role throughout one action. For deferred work, reload the real actor and revalidate impersonation and the effective role at apply. An integration without an authenticated, eligible Admin actor cannot mutate Organization. Preserve the existing authorization checks for all other resources.
- [ ] Add optional `position_responsible_user_id: UUID | None` on `CardCreate`. For Organization, an explicit active person gets the existing Responsible assignment in the same transaction after validation. Omission or null leaves the position vacant. Reject the field on other types; preserve their creator assignment rules. Reuse direct assignment writes and the existing audit contract.
- [ ] Expose `is_position_role` in stakeholder definition request/response schemas. Admin can set it for an eligible Organization role. Reject true for Observer and other types. Enforce Admin on Organization definition writes, including archive/restore and role replacement, regardless of delegated metamodel permission.
- [ ] Run targeted cards, stakeholder, metamodel, rollback, survey, integration and role tests identified by the inventory. Commit only after the gate tests pass.

## Task 3. Track branch lifecycle and resolve subordinates

**Files:** Organization chart service, `backend/app/services/card_lifecycle.py`, `backend/app/services/card_write_service.py`, `backend/app/api/v1/cards.py`, `backend/app/services/rollback_service.py`, and service/API tests listed against the write inventory.

**Interfaces:** `organization_subordinate_ids(user_id: UUID) -> Select` returns distinct active subordinate user IDs. `organization_cones_enabled(db: AsyncSession) -> bool` is the single code-owned policy seam and returns false in every deployed phase 2 request. Backend and UI tests may substitute controlled evidence. No setting, environment input or public request can enable it at this stage.

- [ ] Add a real PostgreSQL chart fixture. Assert that a vacancy preserves travel, four levels work, peers and ancestors confer nothing, multiple holders all count, duplicates collapse, and deactivated users and archived definitions confer nothing. A cycle, a wrong-type parent, a missing parent in the trace, or an orphaned root invalidates the whole affected path. A manager with another valid position still receives grants from it.
- [ ] Mark the surviving child branches `orphaned` before any existing archive/delete strategy clears or rewrites Parent. Capture all immediate Organization children even when no explicit child strategy is requested. A restore and lifecycle reparent leave the marker in place. An explicit Admin reattachment in a chart edit clears the relevant marker only if the destination is eligible and cycle checks pass. Test detach, automatic reparent, cascade, hard delete, restore, explicit reattachment and failed reattachment.
- [ ] Use recursive SQLAlchemy selects to derive chart validity from active, confirmed Organization roots, excluding orphaned/unconfirmed positions and their descendants. Traverse downward from each valid position held by the caller to collect strict descendants. Ensure recursive rows deduplicate by stable IDs so malformed or cyclic data terminates. Join holders to active users and active position-role definitions, exclude the caller, and produce a composable select for per-card grant queries.
- [ ] Test two fresh sessions across commit for revoked assignments, role flags and moves. Read inherited role definitions and chart inputs from current database state and keep reuse request-local. Verify that the direct branch retains its existing cache and unchanged results. Do not hold a database session across non-database work.

## Task 4. Prepare inherited per-card authorization and provenance

**Files:** `backend/app/services/permission_service.py`, point checks in `backend/app/services/card_read_scope.py`, `backend/app/api/v1/cards.py`, an explicit response schema in `backend/app/schemas/card.py`, and focused permission, read-scope and API tests.

- [ ] Write test pairs for direct-only, inherited-only, both, unrelated users and the production-off gate. Assert inherited `card.view` survives View deny by card ID; inherited `card.edit` fails when the target is unreadable; a distinct direct or inherited read grant can satisfy that prerequisite. Assert non-Admin Organization writes still fail. A subordinate holding only an application grant confers zero access.
- [ ] Introduce a single inherited-assignment select scoped to the requested card or pending candidate IDs. Reuse the direct query pipeline for direct roles and retain inherited provenance internally as holder and Organization path. Keep both paths distinct so a direct, through-role operation is not subject to a new visibility requirement. Gate inherited queries before loading a chart in ordinary phase 2 requests. Leave `_stakeholder_readable_ids`, list SQL and explicit application-only checks on their existing paths.
- [ ] Apply inherited grants to point permissions, domain lookups and effective flags. Determine inherited-write read eligibility through a read-only predicate that cannot call the write path recursively. For mixed candidate sets, evaluate read eligibility in bulk. Preserve the current cost and license view/edit pairing and the caller's own PPM permissions. Keep membership, My Cards, report counts, notifications and user assignments direct.
- [ ] Add optional `inherited_stakeholder_roles` to the per-card permissions response via the schema. Leave `stakeholder_roles` as the direct list. Return no inherited entries when inactive. Disclose a path and holder only when authorized to see all returned source data. Otherwise emit a generic inherited role explanation with no source identifiers. Test a hidden ancestor, a hidden holder, several equivalent sources, and a normal visible source.
- [ ] Verify a cone-only authorization via the test seam records the real acting user and no inherited source in its persisted audit. Keep checks for no inherited reads in phase 2 production requests, and add focused regression assertions to the per-card and domain suites before implementing any missing branches. Leave full inherited list/sentinel parity to phase 3.

## Task 5. Transfer chart state with the existing workbook

**Files:** `backend/app/services/workspace_io/schema.py`, `exporter.py`, `entities.py`, `applier.py`, `backend/app/api/v1/workspace.py`, the applicable platform migration wrapper and workspace transfer tests.

- [ ] Add optional headers `is_position_role` on `StakeholderRoles` and `organization_cone_state` on `Cards`. Extend export and typed normalization, documented template, preview and apply. Preserve direct assignments and existing legacy cost and license grants. Exclude the workspace activation setting from anything export/import can activate or overwrite.
- [ ] Write real test cases for an empty and a populated destination. Explicit true and false round-trip. A missing position flag means false even on a natural-key match. Explicit orphaned state survives ID remapping and automatic parent rewrites. A legacy root without evidence enters as `unconfirmed_root`; keep an unchanged, already confirmed matching target root confirmed when topology and identity match. Always preserve a known target orphan if the import supplies no explicit state and no confirmed reattachment. A new ambiguous branch never disables unrelated valid branches.
- [ ] Put the Admin gate before chart writes in preview and apply, including selected sheets, Organization role matrices, related entities and imported stakeholder assignments. Validate status and roles with the same rules as the API. Show blocked actions in preview and refuse equivalent apply without partial chart writes. Recheck the actor in the apply transaction. Verify the reattachment rule prevents an imported automatic Parent change from clearing orphan status on its own.
- [ ] Run focused workspace import, role, card lifecycle and actor revocation tests. Keep existing preview, apply and rollback event contracts.

## Task 6. Organization read-only UI and pre-PR delivery

**Files:** `frontend/src/features/admin/metamodel/StakeholderRolePanel.tsx`, `frontend/src/components/CreateCardDialog.tsx`, `frontend/src/features/cards/CardDetail.tsx`, `CardDetailContent.tsx`, `frontend/src/components/CardDetailSidePanel.tsx`, `frontend/src/types/index.ts`, their adjacent tests and affected English i18n namespaces.

- [ ] Add the Organization-only position-role control for Admin and optional Responsible choice on create using the existing user-selection pattern. Do not add workspace activation UI. Write Vitest coverage for renders, changes, omitted Responsible and disappearance outside Organization.
- [ ] Use server permissions to hide Organization edit and stakeholder actions for non-Admin, including all entry points to `me/observe`. Keep normal Application controls. Display inherited entries separately without edit/delete actions if supplied in component fixtures. Cover empty data, a hidden-source explanation and a visible explanation. Never infer write access while permissions are loading.
- [ ] Run related Vitest tests and targeted backend guards. Regenerate OpenAPI, update the English manual and run `/translate`, the documentation gate and the project review sequence before any requested PR. VAPT evidence must name the exact reviewed revision and distinguish existing tests from verified isolated runtime results.
- [ ] Record CI mutation results after PR creation. Preserve test/mutation thresholds and suppressions. Apply one version bump and changelog heading for the completed phase 2 PR.

## Rules and learning review

- Check `card-read-scope.md` for an explicit effective-Admin-only Organization write rule, the inherited-write readability prerequisite and the phase 2 off boundary. Check `workspace-transfer.md` for legacy flag/state behavior and preservation of destination activation. Check `settings-and-seed.md` for the one-time built-in Responsible default with later Admin opt-out. Existing session and audit conventions apply. Compare against the implemented diff and ask for clear approval of each protected rule edit with its exact proposed text and location.
- Tell the owner which rules were checked and whether any change is needed. Explicitly report the learning review. Propose only lessons that are not apparent from the diff, and save each via Trail only after a yes.
- Confirm the owner has reviewed this plan before starting the phase 2 implementation. Production activation and the inherited SQL row scope are phase 3.
