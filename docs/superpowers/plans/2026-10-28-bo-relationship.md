# BO Relationship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new "BO Relationship" page under Application & Data: an automatic ER-lite diagram of `DataObject` cards and their relationships, with a master/slave view of the Applications behind each one.

**Architecture:** Keep a private saved BO diagram snapshot and shared positions. Compare with live, scoped inventory on load. Reuse diagram-js and dagre. Store one Master designation on an Application link and derive other roles. Save cards, links, accepted diagram updates and positions with resumable outcomes.

**Plan status:** draft. The spec records the agreed ER identity, canvas linking and roles, initial permissions, Draw.io-style sync, Save-only positions and required BO subtypes.

**Tech Stack:** FastAPI + SQLAlchemy (backend), React + `diagram-js` + `@dagrejs/dagre` (frontend) — both already project dependencies.

**Spec:** `docs/superpowers/specs/2026-10-28-data-relationship-design.md`

## Global Constraints

- **Migration revision number:** select the next available revision from updated `main` and check the current Alembic head. Ship metamodel defaults in the seed and a guarded migration. A fresh or reset database creates the schema, stamps the head and then seeds.
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
- Saving a newly added `DataObject`↔`DataObject` relation whose `cardinality` was left unset (user drew the edge but didn't open the relation's attribute editor): must save with `cardinality` absent/null, not crash and not silently default to a specific value that looks chosen — Task 6's test `test_an_edge_saved_without_a_cardinality_value_persists_with_none`.
- A non-admin can view the diagram by default. Without edit permission, Save, Sync and all write actions in the canvas and drawer are unavailable. Test equivalent direct API requests.
- Create both native DataObject subtypes. Reject normal creation with a missing or unknown subtype. Keep existing unclassified BOs visible.
- Drawing or retrying B-to-A after A-to-B keeps one ER relation. Read its cardinality in the viewed direction.
- From the diagram, pick an Application and create a link with a requested role. Master transfers the single designation. Slave requires another Master. Without a Master the link is Unclassified.
- On each load, check the current inventory. Sync applies changes to the editor draft. Only Save shares the accepted diagram and positions.
- Two editors saving changes to different nodes both retain their changes. Send changed positions only and merge them with a serialized or atomic database update. A filtered view preserves positions outside the view.
- A card create followed by a rejected relation is a partial save. The next attempt reuses the card ID and retries the link. A lost create response followed by a retry still produces one card.
- Concurrent Master assignments leave at most one persisted designation. Test replacement, clearing, removal, denied writes and an out-of-scope Master.

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

**Files:**
- Create: `backend/alembic/versions/<NEXT>_bo_relationship.py`
- Modify: `backend/app/services/seed.py`
- Modify the existing shared card writer and applicable single and bulk create/update entry points for subtype validation. Add API and writer tests.
- Test: `backend/tests/services/test_alembic_<NEXT>_bo_relationship.py`

**Interfaces:**
- Add the native `data` and `document` options to `CardType.subtypes` for DataObject and `isPaymentData` to its Data Information fields. Keep `Card.type` equal to `DataObject`. Validate the subtype in the shared creation path and test single, bulk and diagram creates. Reject clearing an assigned subtype. Allow an unrelated edit to an existing unclassified BO and let the editor classify it explicitly.
- Add the nullable explicit `dataOwnership=master` designation to `relAppToDataObj`. Derive Slave and Unclassified. Preserve CRUD and lineage. Seed `relDataObjectToDataObject` with its four cardinality options and one ER link per unordered BO pair.
- The private `Diagram` of kind `boRelationship` stores the last accepted snapshot and positions. Initialize it with an empty positions map and no accepted snapshot. Exclude it from generic diagram routes and the diagrams SDK bridge, including list, direct UUID, favorites, card links, groups, publish, update and delete. Test each direct access path. If the diagram transfers between workspaces, remap BO, Application and relation IDs in the snapshot and position keys.

- [ ] **Step 1: Determine the real revision number and write the failing tests**

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

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && PYTHONUTF8=1 POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_USER=turboea POSTGRES_PASSWORD=turboea TEST_POSTGRES_DB=turboea_test venv/Scripts/python.exe -m pytest tests/services/test_alembic_<NEXT>_bo_relationship.py -v`
Expected: FAIL — module not found (migration file doesn't exist yet).

- [ ] **Step 3: Implement the migration**

Use the guarded patch pattern of migration 168. Append missing subtype keys and the payment field without overwriting admin customizations. Add relation metadata to the seed. Define operation-receipt storage and database uniqueness guards in SQLAlchemy metadata and the migration, so upgrade, fresh boot and reset install the same guarantees. Retain receipts after a card is deleted. Test upgrade, fresh bootstrap, subtype validation and visibility of existing unclassified BOs. Verify the generic diagram APIs cannot access the private snapshot.

- [ ] **Step 4: Run to verify they pass**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Lint**

Run: `cd backend && venv/Scripts/python.exe -m ruff check app/ alembic/versions/<NEXT>_bo_relationship.py tests/services/test_alembic_<NEXT>_bo_relationship.py && venv/Scripts/python.exe -m ruff format alembic/versions/<NEXT>_bo_relationship.py tests/services/test_alembic_<NEXT>_bo_relationship.py`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add backend/alembic/versions/<NEXT>_bo_relationship.py backend/app/services/seed.py backend/tests/services/test_alembic_<NEXT>_bo_relationship.py
git commit -m "feat(bo-relationship): metamodel migration — fields, relation type, singleton diagram row"
```

---

## Task 2: Read the saved graph, assign Master and persist the shared diagram

**Files:**
- Create: `backend/app/api/v1/bo_relationship.py`
- Modify `backend/app/api/v1/router.py` and `backend/app/core/permissions.py`. Add the typed schemas and service listed in File Structure.
- Test: `backend/tests/api/test_bo_relationship_api.py`

**Interfaces:**
- Consume the private layout storage and metamodel keys from Task 1. Keep the runtime layout constant independent of Alembic revision modules.
- `GET /api/v1/bo-relationship` (`boRelationship.view`) returns readable saved `nodes`, `edges`, `positions` and `applications`. Before the first Save, supply a readable inventory baseline. Each node has `id`, `name`, nullable `subtype`, `isPersonalData` and `isPaymentData`. Each ER edge has `id`, `source`, `target` and nullable `cardinality` in stored direction. Scope snapshot and position data on every read, including after a visibility change.
- `applications` is keyed by readable DataObject id, with entries `{master: {id, name} | null, slaves: [{id, name}], unclassified: [{id, name}]}`. Derive the viewer's grouping from readable links only. If no Master is visible, show the visible applications under Unclassified without indicating whether a hidden Master exists.
- `PUT /api/v1/bo-relationship/objects/{object_id}/master` takes `{application_id: UUID | null}`. With module edit and applicable card and relation permissions, assign an existing readable link or clear the designation with null. Serialize assignment per BO and enforce uniqueness through every writer of the explicit marker. Apply the normal write scope to both the old and new links before changing them. Refuse an unauthorized transfer or clear without revealing the hidden application or changing its link. Return the same scoped grouping as GET and preserve CRUD flags.
- `PUT /api/v1/bo-relationship/layout` (`boRelationship.edit`) accepts changed manual positions, optional `auto_positions` and accepted changes from Task 8. Resolve accepted values against inventory and merge them with other saved state. Validate finite coordinates and readable BO IDs. Persist automatic proposals only for nodes without saved coordinates. Publish changes only on Save.

- [ ] **Step 1: Write the failing tests**

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

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && PYTHONUTF8=1 POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_USER=turboea POSTGRES_PASSWORD=turboea TEST_POSTGRES_DB=turboea_test venv/Scripts/python.exe -m pytest tests/api/test_bo_relationship_api.py -v`
Expected: FAIL — `404 Not Found` on every route.

- [ ] **Step 3: Implement the router**

Use `CardReadScope` for both card types and validate inputs in the schemas. Reserve the Master marker for the ownership operation. Preserve it when generic writers replace or merge CRUD attributes, and reject attempts to set it through those writers. Enforce one Master across API, import and restore. Test transfer, clear, link removal, a hidden Master, two concurrent assignments and denied writes. For layout, test malformed positions, hidden and wrong-type IDs, and simultaneous disjoint updates.

- [ ] **Step 4: Run to verify they pass**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Lint & regenerate OpenAPI**

Run: `cd backend && venv/Scripts/python.exe -m ruff check app/api/v1/bo_relationship.py tests/api/test_bo_relationship_api.py && venv/Scripts/python.exe -m ruff format app/api/v1/bo_relationship.py tests/api/test_bo_relationship_api.py`
Then: `cd .. && PYTHONUTF8=1 backend/venv/Scripts/python.exe scripts/dump_openapi.py`
Expected: ruff clean; the two new paths present in the diff.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/bo_relationship.py backend/app/api/v1/router.py backend/app/core/permissions.py backend/app/schemas/bo_relationship.py backend/app/services/bo_relationship.py backend/tests/api/test_bo_relationship_api.py docs/api/openapi.json
git commit -m "feat(bo-relationship): add GET/PUT /bo-relationship endpoints"
```

---

## Task 3: Direction-aware cardinality in the relation view and editor

**Files:**
- Modify `RelationAttributesEditor.tsx` and `RelationsSection.tsx` under `frontend/src/features/cards/sections/`. Update both colocated tests.

**Interfaces:**
- Produces: `cardinalityBadge(relationType: RelationType, attributes: Record<string, unknown> | undefined, viewedFromSourceSide: boolean): { icon: string; value: string } | null` — same signature shape as the existing `flowDirectionBadge` (read its exact signature first and match it, not the sketch above verbatim, since the plan cannot re-derive TypeScript types it doesn't have in front of it). Returns `null` when the relation type carries no `cardinality` attribute, or none is set. When set and `viewedFromSourceSide` is false, `"1:n"` renders as `"n:1"` and vice versa; `"1:1"` and `"n:m"` render unchanged either way.

- [ ] **Step 1: Write the failing tests**

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

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run RelationAttributesEditor.test.tsx -t "cardinality"`
Expected: FAIL — `cardinalityBadge` not exported.

- [ ] **Step 3: Implement**

Wire the helper into relation badges and the editor. Invert asymmetric values when opening the target-side form and again when building the stored payload. Test a stored A-to-B 1:n as n:1 from B, then edit and reread from both cards. Reverse creation finds the existing ER relation.

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run RelationAttributesEditor.test.tsx`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Lint & typecheck**

Run: `cd frontend && npx eslint --fix src/features/cards/sections/RelationAttributesEditor.tsx src/features/cards/sections/RelationAttributesEditor.test.tsx && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/cards/sections/RelationAttributesEditor.tsx frontend/src/features/cards/sections/RelationAttributesEditor.test.tsx frontend/src/features/cards/sections/RelationsSection.tsx frontend/src/features/cards/sections/RelationsSection.test.tsx
git commit -m "feat(bo-relationship): add the cardinality reserved relation-attribute key

Same hardcoded-key pattern flowDirection already uses, not a new generic
field type: a plain stored value would show '1:n' from both ends of the
relation, which is wrong from the target's side."
```

---

## Task 4: Layout, diagram and card panel actions

**Files:**
- Create: `frontend/src/features/boRelationship/boRelationshipLayout.ts`
- Create: `frontend/src/features/boRelationship/boRelationshipLayout.test.ts`
- Create: `frontend/src/features/boRelationship/BoRelationshipPage.tsx`
- Create: `frontend/src/features/boRelationship/BoRelationshipPage.test.tsx`

**Interfaces:**
- Consume the Task 2 GET and Master contracts, `CardDetailSidePanel` and `cardinalityBadge`. Add the smallest BO-specific integration point needed to put the Master controls and relation-change refresh in the right-hand panel. Verify that a BO-readable card can actually open in the drawer under the agreed grants.
- Produces: `computeLayout(nodes: {id: string}[], edges: {source: string; target: string}[], existingPositions: Record<string, {x: number; y: number}>): Record<string, {x: number; y: number}>` — returns `existingPositions` unchanged for any id already present in it, and runs dagre only for the ids that are not. `BoRelationshipPage`'s default export, no props (a route-level page).

- [ ] **Step 1: Write the failing tests for `computeLayout`**

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

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run boRelationshipLayout.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `computeLayout`**

Follow `frontend/src/features/reports/layeredDependencyLayout.ts`'s own use of `@dagrejs/dagre` (read it first for the exact dagre API calls this codebase already uses — `dagre.graphlib.Graph`, `setNode`/`setEdge`/`layout()` — and reuse that same call shape, not a new one): run dagre for the new nodes and their context. Keep saved coordinates fixed and place new nodes clear of their occupied space. Test adding a node to an already placed graph, with the existing coordinates preserved.

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run boRelationshipLayout.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for `BoRelationshipPage` (read-only behavior)**

```tsx
// BoRelationshipPage.test.tsx — mock @/api/client the way CostReport.test.tsx
// does (read that file's mock setup for the established pattern in this repo).
it("renders a node per DataObject and opens the side panel on click", async () => {
  // mock GET /bo-relationship -> one node "Customer", no edges
  // render BoRelationshipPage, click the "Customer" node
  // expect CardDetailSidePanel-equivalent testid/content to appear
});

it("renders the scoped Application roles for the selected object", async () => {
  // Mock two DataObjects with different master, slave and unclassified groups.
  // Select each node and assert that its own groups appear.
});

it("an unrelated DataObject renders isolated with empty master/slave lists", async () => {});

it("refreshes both panels after assigning, transferring or clearing the Master", async () => {});
```

- [ ] **Step 6: Run to verify they fail**

Run: `cd frontend && npx vitest run BoRelationshipPage.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 7: Render the diagram and wire selection and Master controls.** Canvas Save arrives in Task 6.

Render saved nodes, ER edges and positions. Use native subtype keys for Data and Document shapes and a neutral legacy fallback. Keep anchored nodes fixed. Render GDPR and payment badges from the snapshot flags and explain them in the diagram legend. Show scoped Application groups and reuse the card drawer with a BO edit gate. Keep the card panel's existing save workflow for its own edits. Recheck the canvas after a successful edit and preserve unsaved canvas state. Wire inventory check and acceptance in Task 8.

- [ ] **Step 8: Run to verify they pass**

Run: `cd frontend && npx vitest run boRelationshipLayout.test.ts BoRelationshipPage.test.tsx`
Expected: PASS.

- [ ] **Step 9: Lint & typecheck**

Run: `cd frontend && npx eslint --fix src/features/boRelationship/ && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/features/boRelationship/ frontend/src/components/CardDetailSidePanel.tsx frontend/src/components/CardDetailSidePanel.test.tsx
git commit -m "feat(bo-relationship): diagram page — nodes, edges, side panels"
```

---

## Task 5: Filter panel for personal and payment data

**Files:**
- Modify: `frontend/src/features/boRelationship/BoRelationshipPage.tsx`
- Modify: `frontend/src/features/boRelationship/BoRelationshipPage.test.tsx`

**Interfaces:**
- Consumes: `FilterSectionHeader`/`FilterCheckboxList` (`@/components/FilterSidebarSection`, read its exact props before wiring — this plan does not repeat its signature since the component is unmodified, just consumed).
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Write the failing test**

```tsx
it("filters out DataObjects that don't match a checked facet", async () => {
  // mock /bo-relationship with two nodes, one isPaymentData: true, one false
  // render, open the filter panel, check "Payment data"
  // expect only the matching node to remain on the canvas
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run BoRelationshipPage.test.tsx -t "filter"`
Expected: FAIL — no filter panel exists yet.

- [ ] **Step 3: Implement**

Use the collapsible `FilterSectionHeader`/`FilterCheckboxList` with the `isPersonalData` and `isPaymentData` flags already returned by Task 2. Filter nodes and incident edges without altering saved positions. Add configurable fields only if included in the spec decision.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run BoRelationshipPage.test.tsx`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Lint & typecheck**

Run: `cd frontend && npx eslint --fix src/features/boRelationship/BoRelationshipPage.tsx src/features/boRelationship/BoRelationshipPage.test.tsx && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/boRelationship/
git commit -m "feat(bo-relationship): optional filter panel on isPersonalData/isPaymentData"
```

---

## Task 6: Explicit, retryable Save for objects, links and positions

**Files**
- Modify `frontend/src/features/boRelationship/BoRelationshipPage.tsx` and its Vitest file.
- Extend the Task 2 controller, schema, service and API tests with a scoped idempotent create operation. Reuse the existing card and relation write services and the relation orientation rules. Extend the creation path with durable request identity and create-once semantics.

**Interfaces**
- Give each draft object a stable UUID in the active session. `PUT /bo-relationship/objects/{draft_id}` requires a valid DataObject subtype. Check module edit and normal subtype-scoped creation permission. Claim a durable receipt keyed by actor and draft UUID, with the card ID and creation fingerprint. Commit receipt, card and event together. Replay identical requests for readable cards. Return 409 for different payloads and 404 for unavailable originals. Retain the receipt to prevent recreating a deleted card. Persist the pending queue across refresh only if the spec calls for it.
- Serialize ER lookups and creation by unordered BO pair across write paths, including simultaneous A-to-B and B-to-A requests. Keep the first stored direction and preserve attributes on replay. Leave cardinality absent if unset.
- Add a diagram action to choose an existing Application with `CardPicker` and connect it to a BO. Stage an operation ID and send `PUT /api/v1/bo-relationship/application-link-drafts/{draft_id}` with `object_id`, `application_id` and `role` (master, slave or unclassified). Require BO edit and normal link permissions. Persist the link and any Master transfer with a durable operation receipt in one transaction. A retry returns the prior result under current read scope without reapplying a transfer that has since changed. Slave requires a visible, committed Master, including one saved earlier in the batch. If that Master fails, keep its dependent links pending. Offer Unclassified for links without a visible Master. Preserve CRUD flags.

- [ ] **Step 1: Add regression tests.** Cover partial success and a lost card response, reverse and concurrent ER creation, link retry after a cardinality edit, Application Master transfer, retry after a later Master change, Slave with and without a Master, a failed Master with a dependent Slave, permission denial, required subtype and failure to save positions.
- [ ] **Step 2: Run the new API and page tests.** Verify that they fail for the missing behavior.
- [ ] **Step 3: Track pending work by draft ID.** Stage BO cards, ER links, Application links and roles, manual moves and accepted inventory changes. On Save, create pending cards first, then eligible links and Master assignments, then persist the successfully added items, accepted inventory changes and position deltas in the diagram. Retain successes and retry unresolved items.
- [ ] **Step 4: Run the API and page tests, typecheck and regenerate OpenAPI.** Verify Customer/Order with an injected link failure followed by a successful retry.
- [ ] **Step 5: Commit the Save code and tests on the feature branch.**

---

## Task 7: Menu entry and permission wiring

**Files:**
- Modify `frontend/src/App.tsx`, `frontend/src/lib/routePermissions.ts` and the built-in Application & Data navigation.
- Modify: `frontend/src/features/boRelationship/BoRelationshipPage.test.tsx` (view-permission test, if not already covered by Task 2's backend test).

**Interfaces:**
- Consumes: Task 4's `BoRelationshipPage`.
- Produce the lazy page and initial Administrator/edit and viewer-only grants for Task 8.

- [ ] **Step 1: Write the failing test**

```tsx
it("a view-only user sees the diagram but cannot save", async () => {
  // mock the current user's permissions to boRelationship.view only (no .edit)
  // render BoRelationshipPage
  // expect the canvas/nodes to render, and the Save button to be absent or disabled
});
```

(This may already be fully covered by Task 6's Step 1 "disabled without boRelationship.edit" test — if so, this task's own test is redundant and should be skipped, with a one-line note in the ledger saying why, rather than duplicated.)

- [ ] **Step 2: Run to verify it fails (or confirm it's already covered)**

Run: `cd frontend && npx vitest run BoRelationshipPage.test.tsx`
Expected: PASS already if Task 6 covers it (skip Steps 3-4 of this task's TDD cycle for this specific test, ledger why); otherwise FAIL and continue.

- [ ] **Step 3: Add the route and menu entry**

Add the lazy route and declare `boRelationship.view` in `ROUTE_PERMISSIONS`. Use the same gate for navigation. Seed the initial grants for new workspaces and apply a guarded role migration for existing workspaces. Add view where absent and preserve explicit overrides. Verify that the Administrator starts with edit and other default roles with view only. Deny direct navigation without view access.

- [ ] **Step 4: Run the full frontend reports+cards+boRelationship suite**

Run: `cd frontend && npx vitest run src/features/boRelationship src/features/cards/sections/RelationAttributesEditor.test.tsx`
Expected: every file passes.

- [ ] **Step 5: Lint & typecheck**

Run: `cd frontend && npx eslint --fix src/features/boRelationship/ && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(bo-relationship): menu entry under Application & Data, permission-gated"
```

---

## Task 8: Draw.io-style inventory check and Sync

**Files**
- Extend the BO schemas, service, controller and API tests from Task 2.
- Update `BoRelationshipPage.tsx` and its tests. Follow the initial check, manual recheck and accept pattern in `frontend/src/features/diagrams/DiagramEditor.tsx` and `staleCheck.ts`.

**Interfaces**
- `GET /api/v1/bo-relationship/changes` (`boRelationship.view`) compares the saved snapshot with scoped live inventory. Return the readable additions, updates and removals for BOs and links. Include names, subtypes, flags, cardinality and ownership. Distinguish removal or archive from a change in visibility with internal inventory checks. Expose a hard deletion only from a verifiable authorized tombstone. When authorization cannot be established, omit the removal details. Suppress hidden entries and retain them in the shared snapshot when the editor saves.
- On the first Save, initialize one workspace baseline on the server and merge the allowed deltas. Use the inventory revision from the comparison and recheck a stale change. A layout-only Save also initializes the snapshot. A restricted editor must not publish a global snapshot limited to their visibility. Serialize concurrent initial saves.
- Sync applies chosen changes in the open editor. Save sends accepted item identifiers and their comparison revision with position deltas. Resolve accepted values server-side, preserve untouched saved state including entries outside the editor's scope, and require a recheck for any item that changed again.

- [ ] **Step 1: Test the normal flow.** Save a BO at a manually chosen position, rename it and change its subtype in inventory, then reload. Verify the old snapshot and a change notice. Sync updates the name and shape in the draft and preserves the position. Save and reopen as another user. Test a first layout-only Save and concurrent first saves from editors with different scopes. Cover added, archived and removed BOs and changed ER and Application links.
- [ ] **Step 2: Test authorization and failures.** An initial check has no writes. Test permission revocation separately from a readable item being removed or archived. Hidden items produce no notice and a restricted editor's Save preserves them. A failed check preserves the drawing. A viewer cannot persist Sync. A change made after acceptance asks the editor to recheck.
- [ ] **Step 3: Implement the check and Sync.** Run the scoped comparison after load and from the manual check action. Use the request cancellation pattern. Update the editor only on Sync and share accepted changes and positions only on Save.
- [ ] **Step 4: Run the API and page tests, typecheck and regenerate OpenAPI.** Run the targeted VAPT cases and document the check, Sync and Save sequence in the user manual.

---

## Agent's calls

- Use a non-modal right panel to keep both panels usable. Wire scoped grouping and refresh through the BO endpoints.
- Load scoped Application groups and facet flags with the snapshot and compare live inventory separately. Keep the Application list in the side panel and select Applications from the diagram's link action.
- Save position deltas and test concurrent saves. Use stable draft IDs for lost-response retries.

## Review before execution

- Decide how workspace import handles an incoming Master that conflicts with an existing designation. Preserve the target assignment until a permitted transfer is explicitly requested. Verify that imports, updates and restores cannot create two Masters.
- Resolve the remaining product questions in the spec, including cardinality validation, removal, same-node conflicts, workspace transfer, retry lifetime, badge placement and optional facets.
- Verify seed behavior on fresh and upgraded workspaces, safe layout storage and permission wiring. The initial read contract already covers the Application groups and filter facets.
- Acceptance covers subtype validation, reverse ER deduplication, Application links and ownership from the diagram, default role access, load/check/Sync/Save, safe retries and concurrent disjoint layout changes.
