# BO Relationship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new "BO Relationship" page under Application & Data: an automatic ER-lite diagram of `DataObject` cards and their relationships, with a master/slave view of the Applications behind each one.

**Architecture:** Metamodel changes (new `DataObject` fields, a new master/slave attribute on `relAppToDataObj`, a new `DataObject`↔`DataObject` relation type) via one guarded Alembic migration, which also seeds a single, fixed-UUID `Diagram` row (`kind="boRelationship"`) — the project's existing `Diagram` model (`backend/app/models/diagram.py`) already stores an arbitrary JSONB `data` blob and already discriminates editors by `kind` (`"drawio"`/`"archimate"` today), so this reuses that row purely to persist node positions (`data.positions: {card_id: {x, y}}`) rather than inventing new storage. The diagram's nodes/edges themselves are never stored — they are read live from `DataObject` cards and the new relation type on every page load, same principle as the existing Layered Dependency View. Two new, thin, permission-gated endpoints serve that live read and the position-only write. The page's canvas reuses `diagram-js` (frontend/src/features/archimate/engine/ArchimateEngine.ts already wraps it) the way `ArchimateModeler.tsx` wires it up — a plain canvas with one node shape per `DataObject.type` value, click-to-select, drag-to-reposition, and an explicit Save button, not autosave. A new reserved relation-attribute key, `cardinality`, is added to `RelationAttributesEditor.tsx` following the exact pattern the existing reserved key `flowDirection` already uses there (a hardcoded key with its own forward/reverse inversion helper, not a new generic field type).

**Tech Stack:** FastAPI + SQLAlchemy (backend), React + `diagram-js` + `@dagrejs/dagre` (frontend) — both already project dependencies.

**Spec:** `docs/superpowers/specs/2026-10-28-data-relationship-design.md`

## Global Constraints

- **Migration revision number: do not hardcode it from this plan.** At execution time, `ls backend/alembic/versions/` and use the next free number after whatever is actually latest — another branch (the cost-report work on `feature/sankey-diagram-cost-report`) is independently claiming its own next numbers, so this plan's own revision number is only knowable at execution time, not now. Ledger the chosen number as a `Ruling:` the moment Task 1 starts.
- This feature is **out of scope** for `feature/sankey-diagram-cost-report`: create a new branch for it (e.g. `feature/bo-relationship`) off `main` before Task 1 — never on `main` directly, never on the cost-report branch.
- No bulk/automatic import from the xlsx (per spec) — nothing in this plan reads that file.
- No fake/demo data seeded (per spec).
- New frontend strings go in `frontend/src/i18n/locales/en/reports.json` or `cards.json` (whichever a given task's component naturally belongs to) and `backend/app/services/seed.py`'s own `translations` dicts for metamodel labels — run `/translate` before the PR (`.claude/rules/i18n-locales.md`).
- Regenerate `docs/api/openapi.json` via `scripts/dump_openapi.py` after any new/changed route.
- New permission keys follow the existing flat `"<domain>.<action>"` string convention (e.g. `"costs.view"`, `"reports.ea_dashboard"` in `backend/app/api/v1/reports.py`) — no central enum to register in, the string literal is the whole definition.

## Review Focus

- A `DataObject` with no relations to any other `DataObject` and no related `Application`: must render as an isolated node on the canvas (not silently dropped) and show empty Master/Slave lists in the left panel when clicked, not an error — Task 4's test `test_an_unrelated_dataobject_renders_isolated_with_empty_master_slave_lists`.
- Two `Application`s related to the same `DataObject`, one marked master and one slave: the left panel must show them in their correct, separate lists — never both in the same list, never missing the badge — Task 4's test `test_master_and_slave_applications_render_in_separate_lists`.
- Saving a newly added `DataObject`↔`DataObject` relation whose `cardinality` was left unset (user drew the edge but didn't open the relation's attribute editor): must save with `cardinality` absent/null, not crash and not silently default to a specific value that looks chosen — Task 6's test `test_an_edge_saved_without_a_cardinality_value_persists_with_none`.
- A user without `boRelationship.edit` opens the page: the diagram renders (view permission is separate from edit) but the Save button and the add-node/add-edge actions are unavailable — Task 7's test `test_a_view_only_user_sees_the_diagram_but_cannot_save`.
- Two users both move nodes and save in quick succession (last-write-wins on the single shared layout row): the second save must not silently drop the first user's position for nodes neither of them touched — a save payload sends only the positions that actually changed/exist on the client's current canvas, merged into (not replacing wholesale) the stored `data.positions` map — Task 3's test `test_saving_the_layout_merges_into_existing_positions_rather_than_replacing_them`.

---

## File Structure

- Create: `backend/alembic/versions/<NEXT>_bo_relationship.py` — `DataObject.type`/`isPaymentData` fields, `relAppToDataObj.attributes_schema` gains `dataOwnership`, new relation type `relDataObjectToDataObject` (`attributes_schema`: `cardinality`), seeds the singleton `Diagram` row.
- Create: `backend/app/api/v1/bo_relationship.py` — the two new endpoints.
- Modify: `backend/app/main.py` — register the new router (match the existing `include_router` pattern).
- Create: `backend/tests/services/test_alembic_<NEXT>_bo_relationship.py`.
- Create: `backend/tests/api/test_bo_relationship_api.py`.
- Modify: `frontend/src/features/cards/sections/RelationAttributesEditor.tsx` — add the `cardinality` reserved key and its inversion helper, next to `flowDirection`'s.
- Modify: `frontend/src/features/cards/sections/RelationAttributesEditor.test.tsx`.
- Create: `frontend/src/features/boRelationship/BoRelationshipPage.tsx` — the page shell (toolbar, Save button, canvas, left panel, right panel wiring).
- Create: `frontend/src/features/boRelationship/BoRelationshipPage.test.tsx`.
- Create: `frontend/src/features/boRelationship/boRelationshipLayout.ts` — the pure dagre-layout-for-new-nodes helper (mirrors `frontend/src/features/reports/layeredDependencyLayout.ts`'s own pattern: a pure function taking nodes/edges, returning `{id: {x, y}}`, no React).
- Create: `frontend/src/features/boRelationship/boRelationshipLayout.test.ts`.
- Modify: `frontend/src/lib/extensionHost.tsx` or wherever the app's own (non-extension) nav menu is defined — read the file that actually renders the Application & Data menu group's entries first (`EXTENSION_NAV_GROUPS` in `extensionHost.tsx` is the *extension* nav registry, not necessarily where the app's own built-in page links live; find the real one before writing this task's step).
- Modify: `frontend/src/i18n/locales/en/reports.json` or `cards.json`.

---

## Task 1: Migration — metamodel fields, relation type, singleton diagram row

**Files:**
- Create: `backend/alembic/versions/<NEXT>_bo_relationship.py`
- Test: `backend/tests/services/test_alembic_<NEXT>_bo_relationship.py`

**Interfaces:**
- Produces: `DataObject.fields_schema` gains `type` (`single_select`, options `document`/`data`, label "Type") and `isPaymentData` (`boolean`, label "Contains Payment Data") in its existing `"Data Information"` section. `relAppToDataObj.attributes_schema` gains `{"key": "dataOwnership", "label": "Data Ownership", "type": "single_select", "options": [{"key": "master", "label": "Master"}, {"key": "slave", "label": "Slave"}]}`. New relation type `relDataObjectToDataObject` (`source_type_key`/`target_type_key` both `"DataObject"`, `label: "relates to"`, `attributes_schema`: `[{"key": "cardinality", "label": "Cardinality", "type": "single_select", "options": [{"key": "1:1", "label": "1:1"}, {"key": "1:n", "label": "1:n"}, {"key": "n:1", "label": "n:1"}, {"key": "n:m", "label": "n:m"}]}]`). A `Diagram` row with a **fixed, hardcoded UUID constant** (define it once, e.g. `BO_RELATIONSHIP_DIAGRAM_ID = uuid.UUID("00000000-0000-0000-0000-00000000b0b0")`, reused by Task 2's endpoints), `kind="boRelationship"`, `name="BO Relationship"`, `data={"positions": {}}`.

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
    assert {"type", "isPaymentData"} <= keys

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

Follow migration 168's established shape exactly (`backend/alembic/versions/168_it_component_cost_parity.py` — guarded per-row fetch/patch via Python, `_upgrade_body(conn)`/`_downgrade_body(conn)` taking a connection directly so tests can drive them via `conn.run_sync`, thin `upgrade()`/`downgrade()` wrappers calling `op.get_bind()`): one guarded patch each for `DataObject.fields_schema` and `relAppToDataObj.attributes_schema` (skip if the keys already exist — same idempotency the model's own tests pin), an `INSERT ... WHERE NOT EXISTS` (or a Python existence check) for the new `RelationType` row, and the same existence-guarded insert for the singleton `Diagram` row, keyed on `kind = 'boRelationship'` so re-running never creates a second one.

- [ ] **Step 4: Run to verify they pass**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Lint**

Run: `cd backend && venv/Scripts/python.exe -m ruff check app/ alembic/versions/<NEXT>_bo_relationship.py tests/services/test_alembic_<NEXT>_bo_relationship.py && venv/Scripts/python.exe -m ruff format alembic/versions/<NEXT>_bo_relationship.py tests/services/test_alembic_<NEXT>_bo_relationship.py`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add backend/alembic/versions/<NEXT>_bo_relationship.py backend/tests/services/test_alembic_<NEXT>_bo_relationship.py
git commit -m "feat(bo-relationship): metamodel migration — fields, relation type, singleton diagram row"
```

---

## Task 2: Backend API — read the live graph, save the layout

**Files:**
- Create: `backend/app/api/v1/bo_relationship.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/api/test_bo_relationship_api.py`

**Interfaces:**
- Consumes: Task 1's `BO_RELATIONSHIP_DIAGRAM_ID` constant (re-export it from the migration module, or duplicate the literal with a comment pointing at the migration — either is fine, no test pins which; a shared `backend/app/constants.py`-style module is also acceptable if one already exists, check first) and the new relation type/attribute keys.
- Produces: `GET /api/v1/bo-relationship` → `{"nodes": [{"id", "name", "type"}], "edges": [{"id", "source", "target", "cardinality": str | None}], "positions": {"<card_id>": {"x": float, "y": float}}}` — nodes are every readable `DataObject` card, edges are every `relDataObjectToDataObject` relation between two visible nodes, `cardinality` read with the same source→target convention Task 4's `cardinalityBadge` expects (store it exactly as the user set it; this endpoint does not invert it — inversion is a *display* concern, Task 4's job). `PUT /api/v1/bo-relationship/layout` with body `{"positions": {"<card_id>": {"x": float, "y": float}}}` → merges (not replaces) into the stored `data.positions`, `200 {"positions": <merged map>}`. Both gated: `GET` requires `"boRelationship.view"`, `PUT` requires `"boRelationship.edit"`.

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
    await client.put(
        "/api/v1/bo-relationship/layout",
        json={"positions": {"a": {"x": 1, "y": 1}}},
        headers=auth_headers(env["editor"]),
    )
    resp = await client.put(
        "/api/v1/bo-relationship/layout",
        json={"positions": {"b": {"x": 2, "y": 2}}},
        headers=auth_headers(env["editor"]),
    )
    assert resp.status_code == 200
    assert resp.json()["positions"] == {"a": {"x": 1, "y": 1}, "b": {"x": 2, "y": 2}}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && PYTHONUTF8=1 POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_USER=turboea POSTGRES_PASSWORD=turboea TEST_POSTGRES_DB=turboea_test venv/Scripts/python.exe -m pytest tests/api/test_bo_relationship_api.py -v`
Expected: FAIL — `404 Not Found` on every route.

- [ ] **Step 3: Implement the router**

Mirror `cost_sankey`'s own shape in `reports.py` for the read side (fetch readable `DataObject` cards via `CardReadScope`, fetch `Relation` rows between them). For the write side, fetch the singleton `Diagram` row by `BO_RELATIONSHIP_DIAGRAM_ID`, merge the incoming `positions` dict into `diagram.data["positions"]` (`{**diagram.data.get("positions", {}), **body.positions}`), reassign `diagram.data` (JSONB columns need a fresh dict assigned, not an in-place mutation, to be tracked as dirty by SQLAlchemy — same caution any other JSONB-mutating code in this codebase already takes; grep `reports.py`/`card_write_service.py` for an existing "reassign, don't mutate in place" JSONB comment if one exists, to match established wording).

- [ ] **Step 4: Run to verify they pass**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Lint & regenerate OpenAPI**

Run: `cd backend && venv/Scripts/python.exe -m ruff check app/api/v1/bo_relationship.py tests/api/test_bo_relationship_api.py && venv/Scripts/python.exe -m ruff format app/api/v1/bo_relationship.py tests/api/test_bo_relationship_api.py`
Then: `cd .. && PYTHONUTF8=1 backend/venv/Scripts/python.exe scripts/dump_openapi.py`
Expected: ruff clean; the two new paths present in the diff.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/bo_relationship.py backend/app/main.py backend/tests/api/test_bo_relationship_api.py docs/api/openapi.json
git commit -m "feat(bo-relationship): add GET/PUT /bo-relationship endpoints"
```

---

## Task 3: `cardinality` reserved relation-attribute key

**Files:**
- Modify: `frontend/src/features/cards/sections/RelationAttributesEditor.tsx`
- Test: `frontend/src/features/cards/sections/RelationAttributesEditor.test.tsx`

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

Add `cardinalityBadge` next to `flowDirectionBadge` in the same file, following its exact structure (the `hasField`/`options.find` lookups `flowDirectionBadge` already does), with an inversion map `{"1:n": "n:1", "n:1": "1:n"}` applied only when `!viewedFromSourceSide` and the stored value is a key in that map.

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run RelationAttributesEditor.test.tsx`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Lint & typecheck**

Run: `cd frontend && npx eslint --fix src/features/cards/sections/RelationAttributesEditor.tsx src/features/cards/sections/RelationAttributesEditor.test.tsx && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/cards/sections/RelationAttributesEditor.tsx frontend/src/features/cards/sections/RelationAttributesEditor.test.tsx
git commit -m "feat(bo-relationship): add the cardinality reserved relation-attribute key

Same hardcoded-key pattern flowDirection already uses, not a new generic
field type: a plain stored value would show '1:n' from both ends of the
relation, which is wrong from the target's side."
```

---

## Task 4: Layout helper + the diagram page (read-only first)

**Files:**
- Create: `frontend/src/features/boRelationship/boRelationshipLayout.ts`
- Create: `frontend/src/features/boRelationship/boRelationshipLayout.test.ts`
- Create: `frontend/src/features/boRelationship/BoRelationshipPage.tsx`
- Create: `frontend/src/features/boRelationship/BoRelationshipPage.test.tsx`

**Interfaces:**
- Consumes: Task 2's `GET /bo-relationship` response shape; `CardDetailSidePanel` (`@/components/CardDetailSidePanel`, unchanged, reused verbatim); `cardinalityBadge` (Task 3).
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

Follow `frontend/src/features/reports/layeredDependencyLayout.ts`'s own use of `@dagrejs/dagre` (read it first for the exact dagre API calls this codebase already uses — `dagre.graphlib.Graph`, `setNode`/`setEdge`/`layout()` — and reuse that same call shape, not a new one): build a dagre graph from only the nodes missing a position, run `dagre.layout`, read back `node.x`/`node.y`, merge with `existingPositions`.

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

it("renders the master/slave left panel for the selected node's related Applications", async () => {
  // mock GET /bo-relationship's node list AND a master/slave lookup — decide
  // at implementation time whether this comes from the same /bo-relationship
  // response (add a `masters`/`slaves` field per node server-side in Task 2
  // if not already there — read Task 2's Produces block again: it does NOT
  // currently include this) or a second request. If Task 2's shape is
  // missing it, that is a real gap found during this task: rule on it —
  // the simplest fix is extending Task 2's GET response with
  // `"applications": {"<card_id>": {"masters": [...], "slaves": [...]}}`
  // keyed by DataObject id, each entry `{id, name}` — and ledger that as a
  // Ruling against Task 2's Interfaces block, since Task 2 is already
  // committed by the time this is discovered.
});

it("an unrelated DataObject renders isolated with empty master/slave lists", async () => {});

it("shows Master and Slave applications in separate lists", async () => {});
```

- [ ] **Step 6: Run to verify they fail**

Run: `cd frontend && npx vitest run BoRelationshipPage.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 7: Implement `BoRelationshipPage` (read-only: render + select + panels, no Save yet)**

Wire a `diagram-js` canvas the way `ArchimateModeler.tsx` does (read its setup — the `Diagram()` instantiation, module list, container ref — and reuse the same skeleton, dropping everything ArchiMate-specific: no palette, no context pad, no viewpoint rules). One node shape per `DataObject.type` (two shapes, per the spec — pick any two distinct `diagram-js` rect/shape variants, the spec does not pin exact pixel geometry). Fetch `/bo-relationship` on mount, run `computeLayout` against the response's `positions`, render nodes/edges, render `cardinalityBadge`'s output as each edge's label. Clicking a node opens `CardDetailSidePanel` on the right (`cardId`/`open`/`onClose`, exactly as `CostReport.tsx` already uses it) and renders the left panel's Master/Slave lists from that node's `applications` entry (per Step 5's ruling, if taken).

- [ ] **Step 8: Run to verify they pass**

Run: `cd frontend && npx vitest run boRelationshipLayout.test.ts BoRelationshipPage.test.tsx`
Expected: PASS.

- [ ] **Step 9: Lint & typecheck**

Run: `cd frontend && npx eslint --fix src/features/boRelationship/ && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/features/boRelationship/
git commit -m "feat(bo-relationship): read-only diagram page — nodes, edges, side panels"
```

---

## Task 5: Optional filter panel

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

Add a collapsible side section using `FilterSectionHeader`/`FilterCheckboxList`, offering `isPersonalData` and `isPaymentData` as boolean facets (one checkbox each) — read each node's `DataObject` attributes (Task 2's response needs these two booleans per node if not already present; extend it the same way Task 4 Step 5 flagged for `applications`, ledgering the same kind of Ruling if needed). Checking a facet filters the rendered node/edge set client-side (edges to a filtered-out node are dropped too).

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

## Task 6: Explicit Save — new nodes, new edges, moved positions

**Files:**
- Modify: `frontend/src/features/boRelationship/BoRelationshipPage.tsx`
- Modify: `frontend/src/features/boRelationship/BoRelationshipPage.test.tsx`

**Interfaces:**
- Consumes: Task 2's `PUT /bo-relationship/layout`; the project's existing card/relation bulk-write endpoints (`POST /cards`, `POST /relations` or their bulk equivalents — read `backend/app/api/v1/cards.py`/`relations.py` for the exact route this page should call, matching whatever `ArchimateModeler.tsx` itself calls for its own "new card from the canvas" flow, since that is the nearest precedent in this codebase for "a diagram creates real cards").
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Write the failing tests**

```tsx
it("adding a node and saving creates a real DataObject card", async () => {
  // click "add node", type a name, click Save
  // expect api.post("/cards", expect.objectContaining({ type: "DataObject", name: "..." }))
});

it("an edge saved without a cardinality value persists with none", async () => {
  // draw an edge between two existing nodes without opening its attribute editor
  // click Save
  // expect the relation-create call's attributes to have no "cardinality" key,
  // or an explicit null — not a default like "n:m"
});

it("moving a node and saving calls the layout endpoint with that node's new position", async () => {});

it("the Save button and add actions are disabled without boRelationship.edit", async () => {});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run BoRelationshipPage.test.tsx -t "Save\|cardinality value persists\|moving a node"`
Expected: FAIL — no Save button/add actions exist yet.

- [ ] **Step 3: Implement**

Add a toolbar "Add object" action (prompts for a name, places a new unsaved node at a sensible default position) and an edge-drawing interaction (diagram-js's own connect tool, same one `ArchimateModeler.tsx` already uses — reuse its module, don't reimplement connection drawing). Track unsaved additions/moves in local state. The Save button: `POST`s each new card, then each new relation (using the just-created cards' real ids), then `PUT`s the merged position map (Task 2) for every node — new and existing — currently on the canvas. Gate the button and the two add-actions on a `canEdit` prop/hook reading `boRelationship.edit` the same way the rest of the app checks a permission (read one existing permission-gated UI control for the exact hook/check to call, e.g. however `ReportShell`'s own save button is gated, or a shared `usePermission`-style hook if one exists).

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run BoRelationshipPage.test.tsx`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Lint & typecheck**

Run: `cd frontend && npx eslint --fix src/features/boRelationship/ && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/boRelationship/
git commit -m "feat(bo-relationship): explicit Save — new objects, new relations, moved positions"
```

---

## Task 7: Menu entry and permission wiring

**Files:**
- Modify: whichever file renders the app's own Application & Data menu group (find it first — read Global Constraints' note that `EXTENSION_NAV_GROUPS` in `extensionHost.tsx` is the *extension* registry, not necessarily this one).
- Modify: `frontend/src/features/boRelationship/BoRelationshipPage.test.tsx` (view-permission test, if not already covered by Task 2's backend test).

**Interfaces:**
- Consumes: Task 4's `BoRelationshipPage`.
- Produces: nothing consumed by a later task (last task in this plan).

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

Add a route for `BoRelationshipPage` and a menu entry under Application & Data labelled "BO Relationship", gated on `boRelationship.view` — matching exactly how a neighboring entry in the same menu group is gated (read one such entry first).

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

## Self-Review

**1. Spec coverage:** menu entry (Task 7), diagram-js + dagre with hybrid persisted layout (Task 4), click → side panel + left master/slave panel (Task 4), new DataObject↔DataObject relation with direction-aware cardinality (Tasks 1 + 3), master/slave attribute on `relAppToDataObj` (Task 1), two new `DataObject` fields incl. the shape-driving `type` field (Task 1 + Task 4's two node shapes), editing existing relations on the card not the canvas (implicit: this plan never adds canvas-based relation *editing*, only creation — matches the spec's explicit split), explicit Save for new objects/relations (Task 6), optional filter panel reusing `FilterSidebarSection` (Task 5), explicit view/edit permissions in addition to `CardWriteService` (Task 1's permission strings + Task 2's gating + Task 6/7's frontend gating), no bulk import / no demo data (Global Constraints, no task does either).

**2. Step scan:** Tasks 4 and 5 each surface one real, deliberately-flagged gap against Task 2's own Produces block (the `applications` master/slave data and the `isPersonalData`/`isPaymentData` facet data aren't in Task 2's response shape as written) — each is handled as a same-task Ruling against an already-committed task's interface, not a silent assumption, which is the documented, correct way this branch's prior plans have handled a discovered interface gap (see the cost-report plans' own `Ruling:` precedent).

**3. Type consistency:** `BO_RELATIONSHIP_DIAGRAM_ID` matches between Task 1 (where it's defined) and Task 2 (where it's consumed); `cardinalityBadge`'s signature matches between Task 3 (defined) and Task 4 (consumed); the `/bo-relationship` response shape matches between Task 2 (produced) and Task 4/5 (consumed, with the two flagged extensions).

**4. Review Focus:** all five lines map to a named test — two in Task 4 (isolated node, separate master/slave lists), one in Task 6 (unset cardinality persists as none), one in Task 7/6 (view-only cannot save), one in Task 2 (layout merge, not replace).

**5. Proportion:** seven tasks for a feature this size (new metamodel shapes, a new API, a new diagram-js page, a reused filter component, an explicit save flow, menu wiring) is proportionate — no task's code block exceeds what diagram-js/dagre's own established use in this codebase (`ArchimateModeler.tsx`, `layeredDependencyLayout.ts`) already determines; every such reuse is a pointer to read, not a transcript.
