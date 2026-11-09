# BO Relationship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new "BO Relationship" page under Application & Data: an automatic ER-lite diagram of `DataObject` cards and their relationships, with a master/slave view of the Applications behind each one.

**Architecture:** Keep a private saved BO diagram snapshot and shared positions. Compare with live, scoped inventory on load. Reuse diagram-js and dagre. Store one Master designation on an Application link and derive other roles. Save cards, links, accepted diagram updates and positions with resumable outcomes.

**Plan status:** implementation draft. The approved mockup and the five full-plan review findings are reflected below.

**Tech Stack:** FastAPI + SQLAlchemy (backend), React + `diagram-js` + `@dagrejs/dagre` (frontend) — both already project dependencies.

**Spec:** `docs/superpowers/specs/2026-10-28-data-relationship-design.md`

## Global Constraints

- **Migration revision number:** select the next available revision from updated `main` and check the current Alembic head. Ship metamodel defaults in the seed and a guarded migration. A fresh or reset database creates the schema, stamps the head and then seeds.
- Preserve the configured DataObject subtype keys and existing card assignments on upgrade. Recognize `data` and `document` case-insensitively for diagram shapes. Return the stored keys from the API and use them for permission checks and writes.
- Work on the dedicated BO Relationship branch based on updated `main`. Keep licensing and cost-report work separate.
- No bulk/automatic import from the xlsx (per spec) — nothing in this plan reads that file.
- No fake/demo data seeded (per spec).
- New frontend strings go in `frontend/src/i18n/locales/en/reports.json` or `cards.json` (whichever a given task's component naturally belongs to) and `backend/app/services/seed.py`'s own `translations` dicts for metamodel labels — run `/translate` before the PR (`.claude/rules/i18n-locales.md`).
- Regenerate `docs/api/openapi.json` via `scripts/dump_openapi.py` after any new/changed route.
- Register `boRelationship.view` and `boRelationship.edit` in `backend/app/core/permissions.py`. Administrators start with both and other users with view only. Keep permission-based extension for later roles and groups. Declare the page gate in `frontend/src/lib/routePermissions.ts` and register the API in `backend/app/api/v1/router.py`.
- Define request and response models in `backend/app/schemas/`. Apply `CardReadScope` in module mode to every BO and Application in a response, including ids in layout maps. Enforce the normal card and relation permissions on writes.
- Include a targeted local VAPT pass for the new API and permissions, user manual and translations, the version and changelog, and the repository review and CI checks.

## Review Focus

- A `DataObject` with no relations to any other `DataObject` and no related `Application`: must render as an isolated node on the canvas (not silently dropped) and show empty Master/Slave lists in the left panel when clicked, not an error — Task 4's test `test_an_unrelated_dataobject_renders_isolated_with_empty_master_slave_lists`.
- A BO without a Master shows linked Applications under Unclassified. Assigning a Master puts every other linked Application under Slave. Transferring Master moves the former Master to Slave. Clearing the assignment or removing the Master link returns the remaining Applications to Unclassified. CRUD flags stay independent.
- Cardinality is optional and descriptive. An unset value stays absent, and two different ER links from the same BO can both carry `1:1`. The one-link rule still applies to each unordered BO pair.
- For a persisted ER edge, cancelling the delete confirmation restores the edge. Confirming adds it to the pending inventory sync queue. Save can share the drawing without the line while the inventory relation still exists. Sync deletes only the selected relation. Removing a draft, filtering or applying an inventory delta never calls the delete endpoint.
- A non-admin can view the diagram by default. Without edit permission, Save, Sync and all write actions in the canvas and drawer are unavailable. Test equivalent direct API requests.
- Create both native DataObject subtypes. Reject normal creation with a missing or unknown subtype. Keep existing unclassified BOs visible.
- Drawing or retrying B-to-A after A-to-B keeps one ER relation. Read its cardinality in the viewed direction.
- From the diagram, pick an Application and create a link with a requested role. Master transfers the single designation. Slave requires another Master. Without a Master the link is Unclassified.
- On each load, check the current inventory. Sync applies changes to the editor draft. Only Save shares the accepted diagram and positions.
- Reopen the shared diagram and offer restoration of a differing browser-local draft. Recover drawing changes and staged additions with their stable IDs. The outgoing removal queue starts empty on reopen and restore. A restored missing edge never becomes a DELETE request.
- For two edits of the same position, the last successful manual write wins even if it started from an older revision. Two edits of different positions both survive. Merge changes atomically and preserve positions outside a filtered view. Automatic proposals fill only unset positions.
- A workspace round trip into a fresh destination preserves the saved drawing and coordinates under the new card and relation IDs. Import fills the unsaved BO placeholder once and preserves an already saved destination drawing on re-import.
- A card create followed by a rejected relation is a partial save. The next attempt reuses the card ID and retries the link. A lost create response followed by a retry still produces one card.
- Concurrent Master assignments leave at most one designation. Test replacement, clearing, removal and denial for a partial editor when Master is visible, hidden or absent.
- Two editors remove different ER lines from the same snapshot and save. Both lines disappear from the shared drawing and both inventory links remain. Sync one removal and assert that only its inventory link is deleted.
- A user with BO view and no inventory grant can left-click a readable node to open the same card in the right panel. The Application picker uses BO-scoped search. Hidden results are absent from both surfaces.

---

## File Structure

- Create `backend/alembic/versions/<NEXT>_bo_relationship.py` for native DataObject subtypes, the payment field, ownership and ER metadata, and private diagram initialization.
- Create `backend/app/schemas/bo_relationship.py`, `backend/app/services/bo_relationship.py` and `backend/app/api/v1/bo_relationship.py` for the contracts, service and controller.
- Modify `backend/app/api/v1/router.py`, `backend/app/core/permissions.py` and `backend/app/services/seed.py`. Verify layout initialization on both fresh and upgraded workspaces.
- Create: `backend/tests/services/test_alembic_<NEXT>_bo_relationship.py`.
- Create: `backend/tests/api/test_bo_relationship_api.py`.
- Modify: `frontend/src/features/cards/sections/RelationAttributesEditor.tsx` — add the `cardinality` reserved key and its inversion helper, next to `flowDirection`'s.
- Modify the colocated tests for `RelationAttributesEditor.tsx` and `RelationsSection.tsx`.
- Create: `frontend/src/features/boRelationship/BoRelationshipPage.tsx` — the page shell (toolbar, Save button, canvas, left panel, right panel wiring).
- Create: `frontend/src/features/boRelationship/BoRelationshipPage.test.tsx`.
- Create: `frontend/src/features/boRelationship/boRelationshipLayout.ts` — the pure dagre-layout-for-new-nodes helper (mirrors `frontend/src/features/reports/layeredDependencyLayout.ts`'s own pattern: a pure function taking nodes/edges, returning `{id: {x, y}}`, no React).
- Create: `frontend/src/features/boRelationship/boRelationshipLayout.test.ts`.
- Modify `frontend/src/App.tsx`, `frontend/src/lib/routePermissions.ts` and the built-in Application & Data navigation.
- Modify: `frontend/src/i18n/locales/en/reports.json` or `cards.json`.

---

## Task 1: Seed and migration for the metamodel and layout

**Implemented revision** `180` follows `179`. The existing Inventory and Draw.io creation flows require a DataObject subtype. Existing Draw.io drafts can be classified in the Sync panel.

**Files:**
- Create: `backend/alembic/versions/<NEXT>_bo_relationship.py`
- Modify: `backend/app/services/seed.py`
- Modify the existing shared card writer and applicable single and bulk create/update entry points for subtype validation. Add API and writer tests.
- Test: `backend/tests/services/test_alembic_<NEXT>_bo_relationship.py`

**Interfaces:**
- Add the native `data` and `document` options to `CardType.subtypes` for DataObject and `isPaymentData` to its Data Information fields. Keep `Card.type` equal to `DataObject`. Validate the subtype in the shared creation path and test single, bulk and diagram creates. Reject clearing an assigned subtype. Allow an unrelated edit to an existing unclassified BO and let the editor classify it explicitly.
- Add the nullable explicit `dataOwnership=master` designation to `relAppToDataObj`. Derive Slave and Unclassified. Preserve CRUD and lineage. Seed `relDataObjectToDataObject` with its four cardinality options and one ER link per unordered BO pair.
- The private `Diagram` of kind `boRelationship` stores the last accepted snapshot and positions. Initialize it with an empty positions map and no accepted snapshot. Exclude it from generic diagram routes and the diagrams SDK bridge, including list, direct UUID, favorites, card links, groups, publish, update and delete. Test each direct access path. Include the saved drawing and positions in workspace transfer. Task 10 remaps BO, Application and relation IDs in the snapshot and position keys.

- [x] **Step 1: Determine the real revision number and write the failing tests**

Run `ls backend/alembic/versions/ | sort -V | tail -3` to find the actual latest revision, pick the next integer, and use it everywhere `<NEXT>` appears in this task (file name, `revision`, and `down_revision` of the migration you're about to write). Ledger it: `Task 1: Ruling: migration revision <N> (down_revision "<N-1>") — <N-1> was the latest at execution time — cost if wrong: a revision-chain conflict caught immediately by alembic on upgrade`.

```python
# backend/tests/services/test_alembic_<NEXT>_bo_relationship.py
import pytest
from sqlalchemy import select
from app.models.card_type import CardType
from app.models.relation_type import RelationType
from app.models.diagram import Diagram
import importlib.util
from pathlib import Path

_MIG_PATH = Path(__file__).resolve().parents[2] / "alembic" / "versions" / "<NEXT>_bo_relationship.py"
_spec = importlib.util.spec_from_file_location("mig_bo_relationship", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)

pytestmark = pytest.mark.anyio


async def test_adds_dataobject_fields_and_relation_attribute_and_relation_type(db):
    conn = await db.connection()
    await conn.run_sync(mig._upgrade_body)

    data_object = (await db.execute(select(CardType).where(CardType.key == "DataObject"))).scalar_one()
    keys = {f["key"] for section in data_object.fields_schema for f in section.get("fields", [])}
    assert "isPaymentData" in keys
    assert "type" not in keys
    assert {"data", "document"} <= {option["key"] for option in data_object.subtypes}

    rel_app_to_data = (
        await db.execute(select(RelationType).where(RelationType.key == "relAppToDataObj"))
    ).scalar_one()
    assert any(a["key"] == "dataOwnership" for a in rel_app_to_data.attributes_schema)

    rel_do_to_do = (
        await db.execute(select(RelationType).where(RelationType.key == "relDataObjectToDataObject"))
    ).scalar_one()
    assert rel_do_to_do.source_type_key == "DataObject"
    assert rel_do_to_do.target_type_key == "DataObject"
    assert any(a["key"] == "cardinality" for a in rel_do_to_do.attributes_schema)


async def test_seeds_exactly_one_bo_relationship_diagram(db):
    conn = await db.connection()
    await conn.run_sync(mig._upgrade_body)
    await conn.run_sync(mig._upgrade_body)  # idempotent: second run must not duplicate

    rows = (await db.execute(select(Diagram).where(Diagram.kind == "boRelationship"))).scalars().all()
    assert len(rows) == 1
    assert rows[0].id == mig.BO_RELATIONSHIP_DIAGRAM_ID
    assert rows[0].data == {"positions": {}}
```

Note the test's `DataObject`/`relAppToDataObj` fixtures are **not pre-seeded** by the `db` fixture (`backend/tests/conftest.py`'s `db` fixture only builds empty schema via `create_all`, confirmed in migration 168's own plan) — if those two rows don't already exist at test setup, create them first with `create_card_type`/`create_relation_type` from `tests/conftest`, matching the existing `DataObject` section shape from `backend/app/services/seed.py:3598` before the migration's own additive patch runs.

- [x] **Step 2: Run to verify they fail**

Run: `cd backend && PYTHONUTF8=1 POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_USER=turboea POSTGRES_PASSWORD=turboea TEST_POSTGRES_DB=turboea_test venv/Scripts/python.exe -m pytest tests/services/test_alembic_<NEXT>_bo_relationship.py -v`
Expected: FAIL — module not found (migration file doesn't exist yet).

- [x] **Step 3: Implement the migration**

Use the guarded patch pattern of migration 168. Append missing subtype keys and the payment field without overwriting admin customizations. Add relation metadata to the seed. Define operation-receipt storage and database uniqueness guards in SQLAlchemy metadata and the migration, so upgrade, fresh boot and reset install the same guarantees. Retain receipts after a card is deleted. Test upgrade, fresh bootstrap, subtype validation and visibility of existing unclassified BOs. Verify the generic diagram APIs cannot access the private snapshot.

- [x] **Step 4: Run to verify they pass**

Run: same command as Step 2.
Expected: PASS.

- [x] **Step 5: Lint**

Run: `cd backend && venv/Scripts/python.exe -m ruff check app/ alembic/versions/<NEXT>_bo_relationship.py tests/services/test_alembic_<NEXT>_bo_relationship.py && venv/Scripts/python.exe -m ruff format alembic/versions/<NEXT>_bo_relationship.py tests/services/test_alembic_<NEXT>_bo_relationship.py`
Expected: clean.

- [x] **Step 6: Commit**

```bash
git add backend/alembic/versions/<NEXT>_bo_relationship.py backend/app/services/seed.py backend/tests/services/test_alembic_<NEXT>_bo_relationship.py
git commit -m "feat(bo-relationship): metamodel migration — fields, relation type, singleton diagram row"
```

---

## Task 2: Read the saved graph, assign Master and persist the shared diagram

**Implemented contract** Layout Save accepts inventory items identified by `kind`, `id` and a per-item `revision`. It returns stale items in `inventory_conflicts` while preserving disjoint changes. Task 8 supplies those revisions and extends acceptance to authorized hard-deletion tombstones.

**Files:**
- Create: `backend/app/api/v1/bo_relationship.py`
- Modify `backend/app/api/v1/router.py` and `backend/app/core/permissions.py`. Add the typed schemas and service listed in File Structure.
- Test: `backend/tests/api/test_bo_relationship_api.py`

**Interfaces:**
- Consume the private layout storage and metamodel keys from Task 1. Keep the runtime layout constant independent of Alembic revision modules.
- `GET /api/v1/bo-relationship` (`boRelationship.view`) returns readable saved `nodes`, `edges`, `positions`, `applications` and an opaque `snapshot_revision`. Before the first Save, supply a readable inventory baseline with a null snapshot revision. Each node has `id`, `name`, nullable `subtype`, `isPersonalData` and `isPaymentData`. Each ER edge has `id`, `source`, `target` and nullable `cardinality` in stored direction. Scope snapshot and position data on every read, including after a visibility change.
- `applications` is keyed by readable DataObject id, with entries `{master: {id, name} | null, slaves: [{id, name}], unclassified: [{id, name}]}`. Derive the viewer's grouping from readable links only. If no Master is visible, show the visible applications under Unclassified without indicating whether a hidden Master exists.
- Publish `capabilities.can_manage_master` in the BO graph response. Use one backend `can_manage_bo_master` guard based on effective grants. Require `boRelationship.edit`, app-level `relations.manage`, landscape-wide module read access to Applications (`CardReadScope.type_readable("Application", mode="module")`), and the applicable type-scoped management grants for Application and DataObject. Inspect effective-role View override cells for both types, including subtype-scoped denials. Any applicable denial prevents a full-access proof. A type-wide scope result or a per-card stakeholder grant alone cannot establish complete authority. Compute the capability before any Master lookup or inventory operation. For the first release the Administrator's existing grants satisfy it.
- `PUT /api/v1/bo-relationship/objects/{object_id}/master` takes `{application_id: UUID | null}`. Apply the capability before looking up the designation. A caller without it receives the same 403 whether Master is visible, hidden or absent. Then validate the readable BO and relevant links and perform the serialized assignment, transfer or clear. Preserve the links' CRUD flags and return the scoped grouping. Use the same gate in the drawer and the Application-link draft endpoint.
- `PUT /api/v1/bo-relationship/layout` (`boRelationship.edit`) accepts changed manual `positions`, optional `auto_positions`, accepted inventory changes and explicit `removed_relation_ids` / `restored_relation_ids`. The two relation lists are disjoint. Validate each touched ID against BO scope or an authorized deletion receipt. Apply only explicit per-relation visual deltas under a lock on the latest snapshot. A stale shared revision alone cannot reject a disjoint removal. Leave untouched and out-of-scope edges in place. Save performs no inventory DELETE.
- Resolve accepted inventory values against scoped inventory. Validate finite coordinates and readable BO IDs. Manual deltas use the last committed coordinate pair, while automatic proposals only fill missing positions. Revalidate revisions on accepted inventory changes without rejecting a disjoint visual or position delta.
- `GET /api/v1/bo-relationship/objects/{object_id}/detail` (`boRelationship.view`) returns a BO-scoped card detail and effective panel permissions. Reuse the existing card response projections and redactions. Return 404 for a hidden BO and combine effective write actions with BO edit.
- `GET /api/v1/bo-relationship/applications` (`boRelationship.edit`) accepts `search`, `page` and `page_size`. Use the existing ranked, paged search and return only readable Application picker records in `{items, total}`. Apply module scope on the server. Keep the default inventory search semantics for other callers.

- [x] **Step 1: Write the failing tests**

```python
# backend/tests/api/test_bo_relationship_api.py
import pytest
from tests.conftest import auth_headers, create_card, create_card_type, create_relation, create_relation_type, create_role, create_user

pytestmark = pytest.mark.anyio


@pytest.fixture
async def env(db):
    await create_role(db, key="viewer", permissions={"boRelationship.view": True})
    await create_role(db, key="editor", permissions={"boRelationship.view": True, "boRelationship.edit": True})
    viewer = await create_user(db, email="viewer@bo.com", role="viewer")
    editor = await create_user(db, email="editor@bo.com", role="editor")
    await create_card_type(db, key="DataObject", fields_schema=[])
    await create_relation_type(
        db, key="relDataObjectToDataObject",
        source_type_key="DataObject", target_type_key="DataObject",
        attributes_schema=[{"key": "cardinality", "type": "single_select", "options": []}],
    )
    return {"viewer": viewer, "editor": editor}


async def test_lists_dataobjects_and_their_relations(client, db, env):
    a = await create_card(db, card_type="DataObject", name="Customer")
    b = await create_card(db, card_type="DataObject", name="Order")
    await create_relation(
        db, type_key="relDataObjectToDataObject", source_id=a.id, target_id=b.id,
        attributes={"cardinality": "1:n"},
    )
    resp = await client.get("/api/v1/bo-relationship", headers=auth_headers(env["viewer"]))
    assert resp.status_code == 200
    data = resp.json()
    assert {n["name"] for n in data["nodes"]} == {"Customer", "Order"}
    assert len(data["edges"]) == 1
    assert data["edges"][0]["cardinality"] == "1:n"


async def test_view_only_user_cannot_save_the_layout(client, db, env):
    resp = await client.put(
        "/api/v1/bo-relationship/layout", json={"positions": {}}, headers=auth_headers(env["viewer"])
    )
    assert resp.status_code == 403


async def test_saving_the_layout_merges_into_existing_positions_rather_than_replacing_them(client, db, env):
    a = await create_card(db, card_type="DataObject", name="Customer")
    b = await create_card(db, card_type="DataObject", name="Order")
    first = await client.put(
        "/api/v1/bo-relationship/layout",
        json={"positions": {str(a.id): {"x": 1, "y": 1}}},
        headers=auth_headers(env["editor"]),
    )
    assert first.status_code == 200
    resp = await client.put(
        "/api/v1/bo-relationship/layout",
        json={"positions": {str(b.id): {"x": 2, "y": 2}}},
        headers=auth_headers(env["editor"]),
    )
    assert resp.status_code == 200
    assert resp.json()["positions"] == {str(a.id): {"x": 1, "y": 1}, str(b.id): {"x": 2, "y": 2}}
```

- [x] **Step 2: Run to verify they fail**

Run: `cd backend && PYTHONUTF8=1 POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_USER=turboea POSTGRES_PASSWORD=turboea TEST_POSTGRES_DB=turboea_test venv/Scripts/python.exe -m pytest tests/api/test_bo_relationship_api.py -v`
Expected: FAIL — `404 Not Found` on every route.

- [x] **Step 3: Implement the router**

Use `CardReadScope` for both card types and validate inputs in the schemas. Reserve the Master marker for the ownership operation. Preserve it when generic writers replace or merge CRUD attributes, and reject attempts to set it through those writers. Cover a valid CRUD-only PATCH on a Master link by an editor who lacks the Master capability. The CRUD change succeeds and the server retains the Master marker. Enforce one Master across API, import and restore. Test transfer, clear, link removal and two concurrent assignments. For the same partial editor, seed visible, hidden and absent Master variants and assert the same disabled capability and 403 from the Task 2 Master endpoint. Include a role with an Application subtype View deny. Verify the card detail and picker search with and without inventory grants and confirm hidden cards are omitted. For layout, test malformed positions, hidden and wrong-type IDs, simultaneous disjoint updates, and two editors saving different coordinates for the same node from the same initial revision. The last committed coordinate pair wins even if another operation in the same BO Save remains pending. A failed position write or a stale automatic proposal cannot overwrite it. Exercise two visual removal payloads from the same revision and assert a shared drawing with neither edge and both inventory relations still present. Task 6 adds the outgoing Sync check.

- [x] **Step 4: Run to verify they pass**

Run: same command as Step 2.
Expected: PASS.

- [x] **Step 5: Lint & regenerate OpenAPI**

Run: `cd backend && venv/Scripts/python.exe -m ruff check app/api/v1/bo_relationship.py tests/api/test_bo_relationship_api.py && venv/Scripts/python.exe -m ruff format app/api/v1/bo_relationship.py tests/api/test_bo_relationship_api.py`
Then: `cd .. && PYTHONUTF8=1 backend/venv/Scripts/python.exe scripts/dump_openapi.py`
Expected: Ruff clean and all five BO Relationship paths present in the diff.

- [x] **Step 6: Commit**

```bash
git add backend/app/api/v1/bo_relationship.py backend/app/api/v1/router.py backend/app/core/permissions.py backend/app/schemas/bo_relationship.py backend/app/services/bo_relationship.py backend/tests/api/test_bo_relationship_api.py docs/api/openapi.json
git commit -m "feat(bo-relationship): add GET/PUT /bo-relationship endpoints"
```

---

## Task 3: Direction-aware cardinality in the relation view and editor

**API contract** `POST /relations` returns `reused` so the editor can distinguish a new link from an existing one. A reverse ER request reuses the existing link and keeps its stored direction.

**Files:**
- Modify the card relations section and picker, the Draw.io relation picker and sync, the inventory bulk editor, and the report attribute filters. Add regression tests alongside the affected code.
- Update the single and bulk relation upsert paths and regenerate OpenAPI for the single-create response.

**Interfaces:**
- Produces: `cardinalityBadge(relationType: RelationType, attributes: Record<string, unknown> | undefined, viewedFromSourceSide: boolean): { icon: string; value: string } | null` — same signature shape as the existing `flowDirectionBadge` (read its exact signature first and match it, not the sketch above verbatim, since the plan cannot re-derive TypeScript types it doesn't have in front of it). Returns `null` when the relation type carries no `cardinality` attribute, or none is set. When set and `viewedFromSourceSide` is false, `"1:n"` renders as `"n:1"` and vice versa; `"1:1"` and `"n:m"` render unchanged either way.

- [x] **Step 1: Write the failing tests**

```tsx
// Add to RelationAttributesEditor.test.tsx — read the file's existing
// flowDirectionBadge tests first and match their exact render/mock setup
// (relation-type fixture shape, how "viewed from source side" is signaled
// to the component under test) before writing these final bodies.
it("shows the stored cardinality unchanged when viewed from the source side", () => {
  // relation type has attributes_schema [{key:"cardinality", type:"single_select", options:[...]}]
  // attributes = {cardinality: "1:n"}; viewed from source → "1:n"
});

it("inverts 1:n to n:1 when viewed from the target side", () => {
  // same attributes; viewed from target → "n:1"
});

it("leaves 1:1 and n:m unchanged from either side", () => {});

it("returns null when the relation type has no cardinality attribute", () => {});
```

- [x] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run RelationAttributesEditor.test.tsx -t "cardinality"`
Expected: FAIL — `cardinalityBadge` not exported.

- [x] **Step 3: Implement**

Wire the helper into relation badges and the editor. Treat `dataOwnership` as a reserved ownership marker. Omit it from generic relation attribute controls and from every generic relation draft and request payload, including edits that replace the attribute map. Display the ownership role through the BO grouping and Master action. Test editing CRUD on an existing Master link and verify the sent payload excludes the marker. Invert asymmetric values when opening the target-side form and again when building the stored payload. Test a stored A-to-B 1:n as n:1 from B, then edit and reread from both cards. Reverse creation finds the existing ER relation.

- [x] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run RelationAttributesEditor.test.tsx`
Expected: PASS, including every pre-existing test in the file.

- [x] **Step 5: Lint & typecheck**

Run: `cd frontend && npx eslint --fix src/features/cards/sections/RelationAttributesEditor.tsx src/features/cards/sections/RelationAttributesEditor.test.tsx && npx tsc --noEmit`
Expected: clean.

- [x] **Step 6: Commit**

Commit the frontend, backend, tests, and regenerated OpenAPI together as `feat(bo): show directional cardinality`.

---

## Task 4: Layout, diagram and card panel actions

**Verified behavior.** The primary mouse button and keyboard activation open the same scoped card in the right-hand panel. A Chromium smoke test with fixture API responses verified switching BOs and zooming with the panel open. The route and menu are wired in Task 7.

**Files:**
- Create: `frontend/src/features/boRelationship/boRelationshipLayout.ts`
- Create: `frontend/src/features/boRelationship/boRelationshipLayout.test.ts`
- Create: `frontend/src/features/boRelationship/BoRelationshipPage.tsx`
- Create: `frontend/src/features/boRelationship/BoRelationshipPage.test.tsx`
- Adapt the existing `CardDetailSidePanel` and its card-content reads for a BO detail loader. Adapt `CardPicker` and `useCardSearch` to accept the BO Application search source.

**Interfaces:**
- Consume the Task 2 graph, detail, Application search and Master contracts. Reuse `CardDetailSidePanel` with a non-modal BO adapter that uses the scoped detail loader for the card and permissions. Use existing module-scoped reads for the enabled tabs. Gate or omit sections that need a stronger grant. Preserve the ordinary card write checks. Reuse `CardPicker` and its paged-search hook with the BO Application endpoint. Preserve the default loaders in other pages.
- Produces: `computeLayout(nodes: {id: string}[], edges: {source: string; target: string}[], existingPositions: Record<string, {x: number; y: number}>): Record<string, {x: number; y: number}>` — returns `existingPositions` unchanged for any id already present in it, and runs dagre only for the ids that are not. `BoRelationshipPage`'s default export, no props (a route-level page).

- [x] **Step 1: Write the failing tests for `computeLayout`**

```ts
// boRelationshipLayout.test.ts
import { computeLayout } from "./boRelationshipLayout";

test("keeps an existing position untouched", () => {
  const result = computeLayout([{ id: "a" }], [], { a: { x: 10, y: 20 } });
  expect(result.a).toEqual({ x: 10, y: 20 });
});

test("computes a position for a node with none", () => {
  const result = computeLayout([{ id: "a" }, { id: "b" }], [{ source: "a", target: "b" }], {});
  expect(result.a).toBeDefined();
  expect(result.b).toBeDefined();
  expect(result.a).not.toEqual(result.b);
});
```

- [x] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run boRelationshipLayout.test.ts`
Expected: FAIL — module does not exist.

- [x] **Step 3: Implement `computeLayout`**

Follow `frontend/src/features/reports/layeredDependencyLayout.ts`'s own use of `@dagrejs/dagre` (read it first for the exact dagre API calls this codebase already uses — `dagre.graphlib.Graph`, `setNode`/`setEdge`/`layout()` — and reuse that same call shape, not a new one): run dagre for the new nodes and their context. Keep saved coordinates fixed and place new nodes clear of their occupied space. Test adding a node to an already placed graph, with the existing coordinates preserved.

- [x] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run boRelationshipLayout.test.ts`
Expected: PASS.

- [x] **Step 5: Write the failing tests for `BoRelationshipPage` (read-only behavior)**

```tsx
// BoRelationshipPage.test.tsx — mock @/api/client the way CostReport.test.tsx
// does (read that file's mock setup for the established pattern in this repo).
it("opens the selected BO card in the right panel on left-click without navigating", async () => {
  // mock GET /bo-relationship -> one node "Customer", no edges
  // Render the page and left-click Customer. Assert the right CardDetailSidePanel
  // opens with its ID and the BO detail loader is called. Assert the canvas stays open.
  // Activate the node using the keyboard and assert the same right panel and card ID.
});

it("renders the scoped Application roles for the selected object", async () => {
  // Mock two DataObjects with different master, slave and unclassified groups.
  // Select each node and assert that its own groups appear.
});

it("an unrelated DataObject renders isolated with empty master/slave lists", async () => {});

it("refreshes both panels after assigning, transferring or clearing the Master", async () => {});
```

- [x] **Step 6: Run to verify they fail**

Run: `cd frontend && npx vitest run BoRelationshipPage.test.tsx`
Expected: FAIL — module does not exist.

- [x] **Step 7: Render the diagram and wire selection and Master controls.** Canvas Save arrives in Task 6.

Render saved nodes, ER edges and positions. Use the rounded Data shape, folded-corner Document shape and neutral legacy fallback. Put the legend below the diagram. Keep anchored nodes fixed. Render GDPR and payment badges from the snapshot flags and explain them in the diagram legend. Show scoped Application groups. A left-click on a BO opens its existing card drawer on the right without routing away. Use the same activation for the keyboard. Group the personal/payment badges under Indicators there. Hide Master controls when the API capability is false and gate all BO edits. Keep the card panel's existing save workflow for its own edits. Recheck the canvas after a successful edit and preserve unsaved canvas state. Wire inventory check and acceptance in Task 8.

- [x] **Step 8: Run to verify they pass**

Run: `cd frontend && npx vitest run boRelationshipLayout.test.ts BoRelationshipPage.test.tsx`
Expected: PASS.

- [x] **Step 9: Lint & typecheck**

Run: `cd frontend && npx eslint --fix src/features/boRelationship/ && npx tsc --noEmit`
Expected: clean.

- [x] **Step 10: Commit**

Commit the BO page, scoped card and picker changes, and regressions together as `feat(bo): add relationship diagram and panels`.

---

## Task 5: Filter panel for personal and payment data

The two facets combine with AND. Hiding the selected BO closes its card panel. Filtering changes the visible graph and keeps its positions and viewport.

**Files:**
- Modify: `frontend/src/features/boRelationship/BoRelationshipPage.tsx`
- Modify: `frontend/src/features/boRelationship/BoRelationshipPage.test.tsx`
- Add the opt-in native checkbox mode in `frontend/src/components/FilterSidebarSection.tsx` and the English filter labels in `frontend/src/i18n/locales/en/reports.json`.

**Interfaces:**
- Consumes: `FilterSectionHeader` and `FilterCheckboxList` from `@/components/FilterSidebarSection`. The BO page opts in to named native checkboxes.
- Produces: nothing consumed by a later task.

- [x] **Step 1: Write the failing test**

```tsx
it("filters out DataObjects that don't match a checked facet", async () => {
  // mock /bo-relationship with two nodes, one isPaymentData: true, one false
  // render, open the filter panel, check "Payment data"
  // expect only the matching node to remain on the canvas
});
```

- [x] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run BoRelationshipPage.test.tsx -t "filter"`
Expected: FAIL — no filter panel exists yet.

- [x] **Step 3: Implement**

Use the collapsible `FilterSectionHeader`/`FilterCheckboxList` with the `isPersonalData` and `isPaymentData` flags already returned by Task 2. Filter nodes and incident edges without altering saved positions. Add configurable fields only if included in the spec decision.

- [x] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run BoRelationshipPage.test.tsx`
Expected: PASS, including every pre-existing test in the file.

- [x] **Step 5: Lint & typecheck**

Run: `cd frontend && npx eslint --fix src/features/boRelationship/BoRelationshipPage.tsx src/features/boRelationship/BoRelationshipPage.test.tsx && npx tsc --noEmit`
Expected: clean.

- [x] **Step 6: Commit**

Commit the filters, shared checkbox option, labels, and regressions as `feat(bo): filter personal and payment data`.

---

## Task 6: Retryable Save and confirmed relation removal

Save publishes completed draft operations once using their receipts. It reports unavailable draft results and stale visual changes while applying independent edits. Only Sync submits a queued inventory deletion. Browser draft recovery remains in Task 9.

**Files**
- Modify `frontend/src/features/boRelationship/BoRelationshipPage.tsx` and its Vitest file.
- Extend the Task 2 controller, schema, service and API tests with a scoped idempotent create operation. Reuse the existing card and relation write services and the relation orientation rules. Extend the creation path with durable request identity and create-once semantics.

**Interfaces**
- Give each draft object a stable UUID in the active session. `PUT /bo-relationship/objects/{draft_id}` requires a valid DataObject subtype. Check module edit and normal subtype-scoped creation permission. Claim a durable receipt keyed by actor and draft UUID, with the card ID and creation fingerprint. Commit receipt, card and event together. Replay identical requests for readable cards. Return 409 for different payloads and 404 for unavailable originals. Retain the receipt to prevent recreating a deleted card. Persist stable draft IDs for recoverable creations and links in the browser drawing draft from Task 9. Keep outgoing deletions in memory only.
- Serialize ER lookups and creation by unordered BO pair across write paths, including simultaneous A-to-B and B-to-A requests. Keep the first stored direction and preserve attributes on replay. Key an ER create receipt by actor and stable draft operation ID as for other staged additions. If the original relation was later deleted, a restored draft retry returns unavailable and leaves it deleted. Leave cardinality absent if unset. Validate the four label values when present and impose no relationship-count limit based on them.
- Add a diagram action to choose an existing Application with `CardPicker` and connect it to a BO. Stage an operation ID and send `PUT /api/v1/bo-relationship/application-link-drafts/{draft_id}` with `object_id`, `application_id` and `role` (master, slave or unclassified). Require BO edit and normal link permissions. For role Master, apply the Task 2 capability before checking the current designation or operation receipt. Exclude Master from the role picker without that capability. Persist the link and any Master transfer with a durable operation receipt in one transaction. A retry returns the prior result under current read scope without reapplying a transfer that has since changed. Slave requires a visible, committed Master, including one saved earlier in the batch. If that Master fails, keep its dependent links pending. Offer Unclassified for links without a visible Master. Preserve CRUD flags.

- Reuse Draw.io's edge removal flow. Remove unsaved edges from the draft. For a persisted ER edge, show a confirmation naming the readable endpoints and relation. Cancel restores the edge. Confirm queues the relation id for outgoing sync. Cancelling a queued removal restores the edge.
- On individual removal sync or **Sync all**, call `DELETE /api/v1/bo-relationship/relations/{relation_id}` with the stored relation id. The route requires module edit, normal relation management authorization, readable endpoints and the BO ER relation type. Reuse normal inventory deletion and event handling. Keep failed removals pending. Deduplicate by relation id. Record an authorized deletion receipt with the relation type and endpoints in the transaction that deletes the link and publishes its event. Recheck current permissions on replay. Distinguish a lost response from an unrelated or inaccessible ID without leaking the latter or publishing a second deletion event.
- Send confirmed visual removals and restorations by relation ID through the Task 2 layout contract. Apply both of two concurrent removals of different lines and preserve the other editor's untouched lines. Save can omit the edge while the pending inventory deletion remains in the outgoing queue. Keep a successful deletion receipt or a verified inventory removal as an accepted delta until Save succeeds. Test reopen after Save before Sync and after Sync followed by Save. On reopen without a recovered deletion queue, the checker can offer the still-existing inventory relation as an incoming addition. Within the same session, suppress that suggestion while the outgoing removal is pending. Suppress removal prompts and outgoing writes when applying filters, dropping a node or accepting an inventory removal from Task 8.

- [x] **Step 1: Add regression tests.** Cover partial success and a lost card response, reverse and concurrent ER creation, link retry after a cardinality edit, Application Master transfer, retry after a later Master change, Slave with and without a Master, a failed Master with a dependent Slave, permission denial, required subtype and failure to save positions. Verify optional cardinality and the absence of a count limit. Exercise remove, cancel, confirm, Save, sync and retry from the normal diagram actions. Test a lost DELETE response, replay after permission revocation and no duplicate event. Test two sessions starting from one revision, removing different lines, saving in sequence and then syncing only one removal. Replay the Task 2 partial-role cases, including a subtype View deny, through the Application-link draft endpoint and verify the same 403 before any Master lookup or link write.
- [x] **Step 2: Run the new API and page tests.** Verify that they fail for the missing behavior.
- [x] **Step 3: Track pending work by draft ID.** Stage BO cards, ER links, Application links and roles, manual moves and accepted inventory changes. On Save, create pending cards first, then eligible links and Master assignments, then persist the successfully added items, accepted inventory changes and position deltas in the diagram. Retain successes and retry unresolved items. Keep the outgoing deletion queue independent of the Save action.
- [x] **Step 4: Run the API and page tests, typecheck and regenerate OpenAPI.** Verify Customer/Order with an injected link failure followed by a successful retry.
- [x] **Step 5: Commit the Save code and tests on the feature branch.**

---

## Task 7: Menu entry and permission wiring

The menu and the direct route share the `boRelationship.view` gate. Revision 181 adds missing view grants to seeded roles without overwriting explicit choices. Admin keeps its wildcard grant.

**Files:**
- Modify `frontend/src/App.tsx`, `frontend/src/lib/routePermissions.ts` and the built-in Application & Data navigation.
- Modify: `frontend/src/features/boRelationship/BoRelationshipPage.test.tsx` (view-permission test, if not already covered by Task 2's backend test).
- Add the guarded role backfill and regression tests in Alembic revision 181. Keep the equivalent seed guard for direct seeding.

**Interfaces:**
- Consumes: Task 4's `BoRelationshipPage`.
- Produce the lazy page and initial Administrator/edit and viewer-only grants for Task 8.

- [x] **Step 1: Write the failing test**

```tsx
it("a view-only user sees the diagram but cannot save", async () => {
  // mock the current user's permissions to boRelationship.view only (no .edit)
  // render BoRelationshipPage
  // expect the canvas/nodes to render, and the Save button to be absent or disabled
});
```

Task 6 already covers the view-only diagram. Task 7 adds regression tests for the menu, the direct route, the seeded roles and the migration.

- [x] **Step 2: Run to verify it fails (or confirm it's already covered)**

Run: `cd frontend && npx vitest run BoRelationshipPage.test.tsx`
Expected: PASS already if Task 6 covers it (skip Steps 3-4 of this task's TDD cycle for this specific test, ledger why); otherwise FAIL and continue.

- [x] **Step 3: Add the route and menu entry**

Add the lazy route and declare `boRelationship.view` in `ROUTE_PERMISSIONS`. Use the same gate for navigation. Seed the initial grants for new workspaces and apply a guarded role migration for existing workspaces. Add view where absent and preserve explicit overrides. Verify that the Administrator starts with edit and other default roles with view only. Deny direct navigation without view access.

- [x] **Step 4: Run the frontend route, menu, cards and BO regressions**

Run: `cd frontend && npx vitest run src/App.test.tsx src/layouts/AppLayout.test.tsx src/lib/routePermissions.test.ts src/lazyRoutes.sourceScan.test.tsx src/features/boRelationship src/features/cards/sections/RelationAttributesEditor.test.tsx`
Expected: every file passes.

- [x] **Step 5: Lint & typecheck**

Run: `cd frontend && npx eslint --fix src/features/boRelationship/ && npx tsc --noEmit`
Expected: clean.

- [x] **Step 6: Commit**

Commit the route, menu, role backfill and tests as `feat(bo): add permission-gated navigation`.

---

## Task 8: Draw.io-style inventory check and Sync

**Files**
- Extend the BO schemas, service, controller and API tests from Task 2.
- Update `BoRelationshipPage.tsx` and its tests. Follow the initial check, manual recheck and accept pattern in `frontend/src/features/diagrams/DiagramEditor.tsx` and `staleCheck.ts`.

**Interfaces**
- `GET /api/v1/bo-relationship/changes` (`boRelationship.view`) compares the saved snapshot with scoped live inventory. Return the readable additions, updates and removals for BOs and links. Include names, subtypes, flags, cardinality and ownership. Distinguish removal or archive from a change in visibility with internal inventory checks. Expose a hard deletion only from a verifiable authorized tombstone. When authorization cannot be established, omit the removal details. Suppress hidden entries and retain them in the shared snapshot when the editor saves.
- `POST /api/v1/bo-relationship/changes/draft` is a read-only comparison for an editor restoring a draft. Require BO view and edit. Accept a bounded, deduplicated list of `removed_relation_ids`. Return current readable BO ER relations with both endpoints in module scope as incoming additions, even when they are also present in the shared snapshot. Omit unrelated, hidden and missing IDs without distinguishing them. Perform no write and enqueue no outgoing operation.
- On the first Save, initialize one workspace baseline on the server and merge the allowed deltas. Use the inventory revision from the comparison and recheck a stale change. A layout-only Save also initializes the snapshot. A restricted editor must not publish a global snapshot limited to their visibility. Serialize concurrent initial saves.
- Sync applies chosen changes in the open editor. Save sends accepted item identifiers and their comparison revision with position deltas. Resolve accepted values server-side, preserve untouched saved state including entries outside the editor's scope, and require a recheck for any item that changed again.

- [ ] **Step 1: Test the normal flow.** Save a BO at a manually chosen position, rename it and change its subtype in inventory, then reload. Verify the old snapshot and a change notice. Sync updates the name and shape in the draft and preserves the position. Save and reopen as another user. Test a first layout-only Save and concurrent first saves from editors with different scopes. Cover added, archived and removed BOs and changed ER and Application links.
- [ ] **Step 2: Test authorization and failures.** An initial check has no writes. Test permission revocation separately from a readable item being removed or archived. Hidden items produce no notice and a restricted editor's Save preserves them. A failed check preserves the drawing. A viewer cannot persist Sync. A change made after acceptance asks the editor to recheck.
- [ ] **Step 3: Implement the check and Sync.** Keep incoming inventory changes distinct from outgoing, confirmed deletions in Task 6. Run the scoped comparison after load and from the manual check action. Use the request cancellation pattern. Update the editor only on Sync and share accepted changes and positions only on Save.
- [ ] **Step 4: Run the API and page tests, typecheck and regenerate OpenAPI.** Run the targeted VAPT cases and document the check, Sync and Save sequence in the user manual.

---

## Task 9: Browser-local drawing recovery

**Files**
- Update `frontend/src/features/boRelationship/BoRelationshipPage.tsx` and its tests. Follow the autosave, restore and unload behavior in `frontend/src/features/diagrams/DiagramEditor.tsx`.

**Interfaces**
- Save a versioned local drawing draft about every five seconds, keyed by workspace, diagram and editor identity. Include explicit visual deltas, the shared snapshot revision and the original values of touched items, plus the stable IDs and inputs of staged additions. Keep outgoing removal confirmations, their queue and server receipts outside the draft. Local storage failures leave the editor usable.
- Start from the last shared diagram on reopen. Offer Restore or Discard for a differing local draft. Validate the draft against current access before offering or displaying its contents. Restore to the local canvas without server writes. Reapply authorized draft deltas over the current shared revision. Preserve unrelated shared edits and revalidate the changes on Save. For a node explicitly moved in the local draft, the last successful manual Save wins. Applying a draft preserves other positions and never turns an untouched coordinate into a pending move. Dismissing a draft discards it. A successful shared Save clears the saved local state while still-unsaved items remain recoverable.
- Start with an empty removal queue on load and restore. Keep a missing edge as a visual difference. Pass the restored draft's explicit visually removed relation IDs to the Task 8 draft comparison endpoint. It checks readable live inventory even if the edge is unchanged between the shared snapshot and inventory. Offer a readable existing relation as an incoming addition. Never derive an outgoing delete from a restored or loaded drawing. Save and Exit invokes the normal BO Save. Keep the editor open after a failure or partial save and warn before discarding pending removal operations on exit. Warn on browser unload when inventory operations are pending.

- [ ] **Step 1: Test closing and reopening.** Use fake timers to capture a moved node and a staged BO. Reopen and verify the shared version is shown before Restore. Restore the local positions and staged IDs without publishing. Test Discard, successful Save, storage failure, a shared edit to a different node and access revoked since the draft.
- [ ] **Step 2: Test outgoing removal isolation.** Confirm an inventory removal, autosave the drawing and reopen before Sync. Restore the drawing without the line and verify the removal queue is empty. Check that the existing readable inventory relation is offered as an incoming addition even when the shared drawing still contains it. Verify neither Restore nor Save issues DELETE. Confirm that a relation already deleted by Sync stays deleted after reopening. Test Save and Exit on success and failure, the unload warning, and replaying an ER draft operation that succeeded but whose relation was later deleted.
- [ ] **Step 3: Implement and verify.** Reuse the project's recovery and request patterns. Run the focused page tests and typecheck. Document the same-browser Restore prompt and the session-only removal queue.

---

## Task 10: Workspace transfer for the saved BO diagram

**Files**
- Extend the Diagrams section in `backend/app/services/workspace_io/sections.py` and its import path in `backend/app/services/workspace_io/entities.py`. Extend the diagram rewrite in `backend/app/services/workspace_io/remap.py` and the relation matching and remap context in `backend/app/services/workspace_io/applier.py`.
- Add cases to `backend/tests/services/test_workspace_io_id_remap.py` and the workspace import tests.

**Contract**
- The Diagrams section carries the private BO singleton's saved snapshot and coordinate map. Exclude unsaved placeholders and operational metadata such as draft IDs, deletion queues, receipts and transient revisions. Preserve BO privacy after import.
- On import, rewrite card and relation IDs in the snapshot and keys of `positions` using the existing workspace `IdMap`. Keep coordinate values and the relation direction semantics. For BO ER links, use the unordered pair resolver for both relation import and the remap context used when importing only Diagrams. If the matching target relation is stored in the opposite direction, map the incoming edge to that relation and invert its displayed asymmetric cardinality when needed. Preserve the existing target relation. Report unresolved references through workspace transfer accounting and omit entries that cannot be attached to a verified destination entity.
- Treat an initialized singleton with no saved snapshot as an empty destination, so a freshly provisioned instance can receive the incoming layout. Preserve any saved target snapshot, including a deliberately empty drawing. Serialize import with Save on that singleton. Re-importing the same bundle keeps one drawing and preserves target edits. Bundles without a BO diagram leave the target drawing alone. If a nonempty incoming drawing has no resolvable BO references, report that it was skipped and keep the unsaved placeholder available for a retry after inventory import. A deliberately empty incoming drawing can still initialize the target.
- For an incoming Application link marked Master, use the same per-BO lock as the live assignment service. When the target already has a different Master, preserve that designation and import the incoming link with its CRUD values and without the Master marker. Report a non-fatal `bo_master_conflict` note in the Relations import results and preview. Count the new link as created and avoid duplicating the note on an idempotent retry that skips an existing link.

- [ ] **Step 1: Round-trip a non-default layout.** Export a saved BO diagram with moved nodes and an ER edge. Import it into a fresh instance with a preinitialized BO placeholder and new inventory IDs. Assert exact coordinates, remapped keys and endpoints, and one singleton. Verify that missing references are reported. Import both a full bundle and its Diagrams section into a destination with an existing reverse-direction ER link. Assert one relation, the existing target ID and the correct displayed cardinality.
- [ ] **Step 2: Test existing targets.** Change a target position and re-import. Verify that the edit is preserved. Repeat with a deliberately empty saved target and with a legacy bundle containing no BO diagram. Check that no draft or deletion operation travels. Test conflicting Masters in preview and apply, including an import concurrent with assignment. Assert one Master, the incoming link and its CRUD attributes, and the conflict report.
- [ ] **Step 3: Implement, verify and document.** Use the existing Diagrams transfer and id-remap paths. Run the focused workspace-transfer tests and describe saved positions and existing-drawing behavior in the user manual.

---

## Agent's calls

- Use a non-modal right panel to keep both panels usable. Wire scoped grouping and refresh through the BO endpoints.
- Load scoped Application groups and facet flags with the snapshot and compare live inventory separately. Keep the Application list in the side panel and select Applications from the diagram's link action.
- Save position deltas and test concurrent saves. Use stable draft IDs for lost-response retries.

## Agent assignments

| Role | Model | Reasoning effort |
| --- | --- | --- |
| Development | GPT-6.1 Terra | `medium` |
| Save and Sync | GPT-6.1 Sol | `medium` |
| Integration testing | GPT-6.1 Terra | `medium` |
| `simplify` | GPT-6 Sol | `medium` |
| `ponytail-review` | GPT-6.1 Sol | `medium` |
| `security-review` | GPT-6 Astra | `medium` |

Assign integration testing to a fresh agent that derives its cases from the spec. Use a fresh agent for each review pass. Run the tests, apply `simplify`, rerun the affected tests, then run `ponytail-review` followed by `security-review`. Check that each requested model is available before assigning its agent.

## Review before execution

- Verify the Task 10 conflict handling across import, updates and restores. Keep the approved shapes, indicators, legend and filters in the visual acceptance review.
- Verify seed behavior on fresh and upgraded workspaces, safe layout storage and permission wiring. The initial read contract already covers the Application groups and filter facets.
- Acceptance covers left-click card access in the right drawer, Master capability, ER and Application writes, concurrent visual removals, inventory Sync separation, scoped draft recovery, safe retries, layout saves, and workspace transfer with Master conflicts.
