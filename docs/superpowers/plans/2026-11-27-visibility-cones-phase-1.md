# Visibility Cones Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the four existing stakeholder authorization readers behind one direct-grant resolver and preserve every current authorization result.

**Architecture:** Keep the resolver in `PermissionService`, which already owns role-definition lookups and their cache. Share the assignment query and role-definition evaluation. Callers keep their card, candidate, type and subtype scopes and their application permission gates.

**Tech stack:** Python, SQLAlchemy ORM, PostgreSQL, FastAPI and pytest.

**Spec:** [Visibility cones](../specs/2026-11-27-visibility-cones-design.md), R2 and phase 1 of Delivery.

## Global constraints

- Implement phase 1 only. Do not traverse Organization, change type cells, add data fields, enable inheritance or change routes, public payloads or cache policy.
- Preserve `PermissionService.is_stakeholder_of`, personal views, direct assignment management, `me/observe`, and explicit application-only authorization. Preserve the inputs and defaults of all existing methods.
- Keep both `CardReadScope` modes, its current materialized ID set and its unrestricted fast path. Phase 3 owns the relational visibility query.
- Keep current tests unchanged. Add a contract test for the new resolver seam. Use isolated PostgreSQL for the targeted backend suites.
- Implement from updated `main` on a feature branch and carry this spec and plan as required. This is a no-runtime-change refactor, which takes no version bump or changelog entry.

## Review focus

- An assignment held by someone else or on a different card confers no grant. The new seam test and the existing scoping suite pin both cases.
- The same role key can have different meanings by card type. Resolve defaults, missing definitions, archived definitions and cache entries by the existing `(type, role)` key.
- The effective permissions payload still lists a directly assigned but undefined role. Its card-level grant contributes nothing.
- A direct stakeholder read can restore visibility after an application View deny. The SQL, single-card, reference and API paths must agree as they do today.
- A bulk domain query must keep its candidate bounds and retain its application-only fast path. A domain write still depends on its effective visibility rule.

## Task 1. Share the direct stakeholder grant resolver

**Files**

- Modify `backend/app/services/permission_service.py`, at `has_card_permission`, `_card_ids_with_domain_access` and `get_effective_card_permissions`.
- Modify `backend/app/services/card_read_scope.py`, at `_stakeholder_readable_ids`.
- Extend `backend/tests/services/test_permission_service_scoping.py` with the new seam test. Run the existing tests in Step 1 unchanged.

**Interfaces**

- `PermissionService.direct_stakeholder_roles(user_id: UUID) -> Select[tuple[UUID, str]]` returns a composable select of assignment card ID and role key. It selects from Stakeholder and applies the caller ID predicate.
- `PermissionService.direct_stakeholder_card_roles(user_id: UUID) -> Select[tuple[UUID, str, str]]` extends that query with the Card join and returns card ID, card type and role key.
- `PermissionService.iter_stakeholder_grants(db: AsyncSession, rows: Iterable[tuple[UUID, str, str]]) -> AsyncIterator[tuple[UUID, dict[str, bool]]]` resolves role definitions with the existing `stakeholder_role_permissions` method. It yields each nonempty mapping and preserves its values. Missing and archived definitions yield no mapping. Keep short-circuiting callers lazy.

- [ ] **Step 1. Record the baseline.** From the repo root in Git Bash, run these two commands sequentially. The runner's test paths are relative to `backend/`. Require a passing, nonzero test count for each command.

```bash
./scripts/test.sh tests/services/test_permission_service.py tests/services/test_permission_service_extended.py tests/services/test_permission_service_scoping.py tests/services/test_permission_service_costs.py tests/services/test_permission_service_edit_costs.py tests/services/test_permission_service_licenses.py
./scripts/test.sh tests/services/test_card_read_scope.py tests/services/test_card_read_scope_guard.py tests/services/test_card_read_scope_payloads.py tests/api/test_cards_type_read_permissions.py tests/api/test_read_scope_sentinel_sweep.py tests/api/test_stakeholders.py
```

- [ ] **Step 2. Write the seam test** in `test_permission_service_scoping.py` using its existing `world` and `hold` fixtures.

```python
async def test_direct_grant_queries_keep_identity_and_resolve_permissions(db, world):
    me, other, (card, outside, _) = world["me"], world["other"], world["cards"]
    await hold(db, card, me, "watcher")
    await hold(db, card, me, "undefined")
    await hold(db, outside, other, "owner")

    raw = await db.execute(PermissionService.direct_stakeholder_roles(me.id))
    assert set(raw.tuples()) == {(card.id, "watcher"), (card.id, "undefined")}

    typed = await db.execute(PermissionService.direct_stakeholder_card_roles(me.id))
    rows = list(typed.tuples())
    assert set(rows) == {
        (card.id, "Application", "watcher"),
        (card.id, "Application", "undefined"),
    }
    grants = [grant async for grant in PermissionService.iter_stakeholder_grants(db, rows)]
    assert grants == [(card.id, {"card.view": True})]
```

- [ ] **Step 3. Run the seam test before changing production code.** Run `./scripts/test.sh tests/services/test_permission_service_scoping.py::test_direct_grant_queries_keep_identity_and_resolve_permissions`. Expect one failure because the new seam does not exist. Save the command output before implementing.

- [ ] **Step 4. Implement the resolver interfaces.** Put the typed statements and async iterator next to the existing stakeholder authorization methods. Compose the typed query from the scoped assignment query. Use the existing cache and preserve its empty-map, archived and undefined behavior. The iterator does not change the original grant map or cache new facts.

- [ ] **Step 5. Wire the authorization callers.**

  - `has_card_permission` reads the single-card assignment rows, preserves the supplied `type_key` optimization and returns true on the first truthy permission. Retain the missing-card/type behavior.
  - `get_effective_card_permissions` builds `stakeholder_roles` from the original direct assignment keys in query order, including undefined keys. Derive `card_level` from truthy entries in the resolved maps. Keep existing response keys and app/type/subtype logic.
  - `_card_ids_with_domain_access` adds the candidate predicate only to its pending stakeholder lookup. Preserve the early return and both cost and license checks.
  - `_stakeholder_readable_ids` applies the current denied/allowed type and subtype SQL criteria before evaluating roles. Preserve the current per-card de-duplication and return type. Leave the fast path in `CardReadScope.load` and `include_stakeholders=False` intact.
  - Keep all exact-assignment readers listed in the spec on their direct paths. Check the four old query sites against the diff before removing duplicated grant lookup code.

- [ ] **Step 6. Verify the refactor.** Re-run the seam test and both Step 1 commands, one at a time. Require green runs and nonzero collection. Run `ruff format .` and `ruff check .` in `backend/`, then run `git diff --check`. Compare the implementation diff with the phase 1 constraints. Keep existing tests, scope guard allowlists and thresholds unchanged.

- [ ] **Step 7. Commit the implementation after the checks pass.** Run `trail check`. Stage only the two production files and the seam test, inspect the index and commit with `refactor: share direct stakeholder grants`.

## Delivery gates

- Have the project backend developer execute phase 1. Apply the repository's targeted tests and review chain before a requested PR. Because this changes the authorization path, use the isolated project VAPT review within the defensive verification scope and keep CI mutation testing in CI.
- In phase 2, start from the merged resolver. Design the Admin-only Organization checks, explicit nominations, hierarchy semantics, transfer and point authorization together. The phase remains independently releasable with cone activation unavailable.
- In phase 3, start from the merged phase 2. Plan the SQL visibility queries and parity before making the switch available. New and existing workspaces keep activation off by default.
