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
- Keep existing tests unchanged. Add focused tests for the new resolver and any uncovered parity cases in Step 5. Use isolated PostgreSQL for the targeted backend suites.
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
- Extend `backend/tests/services/test_permission_service_scoping.py` with the seam and fast-path checks. Run the existing tests in Step 1 unchanged.

**Interfaces**

- `PermissionService.direct_stakeholder_roles(user_id: UUID) -> Select[tuple[UUID, str]]` returns a composable select of assignment card ID and role key. It selects from Stakeholder and applies the caller ID predicate.
- `PermissionService.direct_stakeholder_card_roles(user_id: UUID) -> Select[tuple[UUID, str, str]]` extends that query with the Card join and returns card ID, card type and role key.
- `PermissionService.iter_stakeholder_grants(db: AsyncSession, rows: Iterable[tuple[UUID, str, str]]) -> AsyncIterator[tuple[UUID, str, dict[str, bool]]]` resolves role definitions with the existing `stakeholder_role_permissions` method. It yields the card ID, role key and each nonempty mapping and preserves its values. Missing and archived definitions yield no mapping. Keep short-circuiting callers lazy.

- [ ] **Step 1. Record the baseline.** From the repo root in Git Bash, run these two commands sequentially. The runner's test paths are relative to `backend/`. Require a passing, nonzero test count for each command.

```bash
./scripts/test.sh tests/services/test_permission_service.py tests/services/test_permission_service_extended.py tests/services/test_permission_service_scoping.py tests/services/test_permission_service_costs.py tests/services/test_permission_service_edit_costs.py tests/services/test_permission_service_licenses.py
./scripts/test.sh tests/services/test_card_read_scope.py tests/services/test_card_read_scope_guard.py tests/services/test_card_read_scope_payloads.py tests/api/test_cards_type_read_permissions.py tests/api/test_read_scope_sentinel_sweep.py tests/api/test_stakeholders.py tests/api/test_cards.py::TestListCards::test_mine_stakeholder_filters_to_stakeholder_cards
```

- [ ] **Step 2. Write the seam test** in `test_permission_service_scoping.py` using its existing `world` and `hold` fixtures.

```python
async def test_direct_grant_queries_keep_identity_and_resolve_permissions(db, world):
    me, other, (card, outside, _) = world["me"], world["other"], world["cards"]
    await hold(db, card, me, "watcher")
    await hold(db, card, me, "undefined")
    await hold(db, outside, other, "owner")
    await create_card_type(db, key="Provider", label="Provider")
    provider = await create_card(db, card_type="Provider", name="Other type")
    await create_stakeholder_role_def(
        db, card_type_key="Provider", key="watcher", permissions={"card.edit": True}
    )
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="retired",
        permissions={"card.edit": True}, is_archived=True,
    )
    await hold(db, provider, me, "watcher")
    await hold(db, card, me, "retired")

    raw = await db.execute(PermissionService.direct_stakeholder_roles(me.id))
    assert set(raw.tuples()) == {
        (card.id, "watcher"), (card.id, "undefined"),
        (card.id, "retired"), (provider.id, "watcher"),
    }

    typed = await db.execute(PermissionService.direct_stakeholder_card_roles(me.id))
    rows = list(typed.tuples())
    assert set(rows) == {
        (card.id, "Application", "watcher"),
        (card.id, "Application", "undefined"),
        (card.id, "Application", "retired"),
        (provider.id, "Provider", "watcher"),
    }
    grants = [grant async for grant in PermissionService.iter_stakeholder_grants(db, rows)]
    assert len(grants) == 2
    assert {(cid, role): perms for cid, role, perms in grants} == {
        (card.id, "watcher"): {"card.view": True},
        (provider.id, "watcher"): {"card.edit": True},
    }
    eff = await PermissionService.get_effective_card_permissions(db, me, card.id)
    assert set(eff["stakeholder_roles"]) == {"watcher", "undefined", "retired"}
    assert eff["card_level"] == {"card.view": True}
```

- [ ] **Step 3. Run the seam test before changing production code.** Run `./scripts/test.sh tests/services/test_permission_service_scoping.py::test_direct_grant_queries_keep_identity_and_resolve_permissions`. Expect one failure because the new seam does not exist. Save the command output before implementing.

- [ ] **Step 4. Implement the resolver interfaces.** Put the typed statements and async iterator next to the existing stakeholder authorization methods. Compose the typed query from the scoped assignment query. Use the existing cache and preserve its empty-map, archived and undefined behavior. The iterator does not change the original grant map or cache new facts.

- [ ] **Step 5. Wire the authorization callers.**

  - `has_card_permission` reads the single-card assignment rows, preserves the supplied `type_key` optimization and returns true on the first truthy permission. Retain the missing-card/type behavior.
  - `get_effective_card_permissions` builds `stakeholder_roles` from the original direct assignment keys in query order, including undefined keys. Derive `card_level` from truthy entries in the resolved maps. Keep existing response keys and app/type/subtype logic.
  - `_card_ids_with_domain_access` adds the candidate predicate only to its pending stakeholder lookup. Preserve the early return and both cost and license checks.
  - `_stakeholder_readable_ids` applies the current denied/allowed type and subtype SQL criteria before evaluating roles. Skip later rows for a card that already qualified before resolving their role definitions. Filter the rows lazily against the growing result set and keep the current frozen return type. Leave the fast path in `CardReadScope.load` and `include_stakeholders=False` intact.
  - Keep all exact-assignment readers listed in the spec on their direct paths. Check the four old query sites against the diff before removing duplicated grant lookup code.

- [ ] **Step 6. Record the consumer inventory.** Search the backend for reads of stakeholder assignment rows and their call sites. Classify each as card authorization, exact assignment/personal identity or application-only authority. For every authorization consumer outside the four changed methods, record how it delegates or why it stays outside this refactor. Record the writers of Organization status, Parent, assignments and role settings for phase 2, including lifecycle, bulk, import, rollback and integration. Return the inventory in the implementation report.

- [ ] **Step 7. Verify the refactor.** Re-run the seam test and both Step 1 commands, one at a time. Require green runs and nonzero collection. Run `ruff format .` and `ruff check .` in `backend/`, then run `git diff --check`. Keep these checks explicit in the test report. Use `TestParityMatrix.test_every_answer_agrees` for the SQL, Python and single-card parity cases. Use `test_stakeholder_keeps_their_card` and `test_a_stakeholder_still_reads_a_denied_subtype_card` for API View-deny coverage. Use `test_mine_stakeholder_filters_to_stakeholder_cards` and the existing `me/observe` tests for personal assignment behavior. Check `ref_clause` with one granted ID and one hidden ID of the same denied type. Assert the domain fast path returns every candidate without a stakeholder query when its own application grant covers all candidates. Assert role lookup is skipped for the second role on an already admitted card. Add a focused regression test for any of those last three checks without existing coverage. Compare the implementation diff with the phase 1 constraints. Keep existing tests, scope guard allowlists and thresholds unchanged.

- [ ] **Step 8. Commit the implementation after the checks pass.** The calling session owns Git. After `backend-dev` reports its changes and verification, the calling session runs `trail check`, stages only the implementation and related tests, inspects the index and commits with `refactor: share direct stakeholder grants`.

## Delivery gates

- Have the project backend developer execute phase 1. Apply the repository's targeted tests and review chain before a requested PR. Because this changes the authorization path, use the isolated project VAPT review within the defensive verification scope and keep CI mutation testing in CI.
- In phase 2, start from the merged resolver. Design the Admin-only Organization checks, explicit nominations, hierarchy semantics, transfer and point authorization together. The phase remains independently releasable with cone activation unavailable.
- In phase 3, start from the merged phase 2. Plan the SQL visibility queries and parity before making the switch available. New and existing workspaces keep activation off by default.
