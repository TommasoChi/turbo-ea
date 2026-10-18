# Enterprise Object Foundation & Card Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded 1:1 card↔ArchiMate mapping with an editable Enterprise Object
registry and an n:m Card Mapping bridge table, exposed through a new "Architecture Studio" admin
tab's "Card Mapping" sub-tab, with the live editor reading from it instead of the old columns.

**Architecture:** Two new tables (`enterprise_objects`, `enterprise_object_card_mappings`) back a
new section of the existing `app/api/v1/metamodel.py` router. Seed data migrates
`default_mapping.py`'s `CARD_TYPE_DEFAULTS`/`SUBTYPE_DEFAULTS` into the bridge table and seeds a
registry row per standard ArchiMate element (plus the four "Other" composite/connector types).
The frontend's existing `resolveMapping.ts` consumers (`elementTypeForCard`,
`elementTypesForCardType`) switch from reading `CardType.archimate_type` to the new n:m data. A
new "Architecture Studio" top-level tab in `MetamodelAdmin.tsx` gets its first sub-tab, "Card
Mapping": a registry list, a "New Architecture Object" dialog, a click-to-reveal description
popover, and the bridge-table editor.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic (backend), React + MUI + Vitest (frontend), same
stack as the rest of the ArchiMate feature.

**Spec:** [docs/superpowers/specs/2026-10-17-archimate-metamodel-design.md](../specs/2026-10-17-archimate-metamodel-design.md)
— this plan covers the spec's "Card Mapping" sub-tab and its backend foundation only. Framework
Grid, Connection Rules and Relation Mapping are a separate, later plan built on top of this one's
tables. Drawing Types stays out of scope per the spec's non-goals.

## Global Constraints

- Standard Enterprise Objects' `key` is the Open Group Exchange XSD 3.1 name verbatim, fixed,
  never admin-editable (spec: Constraints).
- Custom Enterprise Objects use `KeyInput`/`isValidKey` for their key, same as `CardType` creation,
  locked after creation (spec: Card Mapping §a).
- Custom Enterprise Objects use `IconPicker`/`ColorPicker` (Material Symbols), never a bespoke
  ArchiMate-notation glyph (spec: Non-goals, Card Mapping §a).
- Visibility (`is_hidden`) mirrors `CardType.is_hidden`: hiding only removes an object from the
  drawing palette going forward; it must never affect elements already drawn with that type
  (spec: Card Mapping §a). All ~40 standard objects seed `is_hidden = false` (zero regression from
  today's palette).
- The Card Mapping bridge table is flat — no override/cascade between a type-level row
  (`card_subtype_key IS NULL`) and a subtype-level row. "Link to card" unions every matching row
  (spec: Card Mapping §b).
- `Grouping`'s registry row is `is_locked = true`: no field may be edited via the API, including
  by an admin with `admin.metamodel` (spec: Card Mapping, "Other" section).
- A description popover's edit (pencil) affordance is visible only to users holding
  `admin.metamodel`; everyone else — including in the drawing palette — sees the description
  read-only (spec: Anti-goals).
- Do not delete `CardType.archimate_type`, `CardType.subtypes[].archimate_type`, or
  `backend/app/services/archimate/default_mapping.py` in this plan. They become unread by the
  switched-over consumers but stay in place; removing them is a later cleanup, not this plan's
  job — a single plan should not both introduce a new source of truth and destroy the old one in
  the same breath.
- Do not touch `RelationType.archimate_type`/`archimate_access`/`archimate_reversed` or
  `RELATION_DEFAULTS` — that's Relation Mapping's job in the next plan.

## Review Focus

- A custom Enterprise Object's key collides with one of the ~40 standard XSD names (even one not
  yet seeded as a row, e.g. a future-reserved name) — creation must be rejected, not silently
  shadow or conflict with a standard type later.
- A direct PATCH to a `Grouping`-locked Enterprise Object (bypassing the UI, e.g. via the API
  directly) — must 403/422, not silently succeed because only the frontend hid the control.
- Hiding (`is_hidden = true`) an Enterprise Object that existing diagrams already use — those
  diagrams' elements must keep resolving exactly as before (`elementTypeForCard` must not start
  returning null for a type that merely became hidden).
- A card-mapping bridge row whose `card_subtype_key` no longer exists on that card type (stale
  after a subtype rename/delete) — resolution must degrade to "no match" for that row, never throw
  (mirrors the existing `resolveMapping.ts` doc comment: "a stale mapping must not crash the
  editor").
- Inserting a duplicate bridge row (same `enterprise_object_key` + `card_type_key` +
  `card_subtype_key`) — must be rejected by a unique constraint with a clean 4xx, not a 500 or a
  silent duplicate.

---

## Task 1: `EnterpriseObject` and `EnterpriseObjectCardMapping` models + migration

**Files:**
- Create: `backend/app/models/enterprise_object.py`
- Modify: `backend/app/models/__init__.py` (export the two new classes, matching how `CardType`
  is exported)
- Create: `backend/alembic/versions/159_add_enterprise_objects.py`
- Test: `backend/tests/services/test_alembic_159_add_enterprise_objects.py` (mirror the structure
  of `test_alembic_158_archimate_foundation.py`)

**Interfaces:**
- Produces:
  ```python
  class EnterpriseObject(Base, UUIDMixin, TimestampMixin):
      __tablename__ = "enterprise_objects"
      key: Mapped[str]              # String(64), unique, not null
      name: Mapped[str]              # String(200), not null
      description: Mapped[str | None]  # Text
      icon: Mapped[str]              # String(100), default "category"
      color: Mapped[str]             # String(20), default "#1976d2"
      layer: Mapped[str | None]      # String(32) — one of taxonomy.py's LAYERS keys, or NULL
                                      # for the four "Other" rows (Grouping/Location/
                                      # AndJunction/OrJunction)
      is_standard: Mapped[bool]      # default False
      is_locked: Mapped[bool]        # default False — true only for Grouping's seed row
      is_hidden: Mapped[bool]        # default False
      sort_order: Mapped[int]        # default 0

  class EnterpriseObjectCardMapping(Base, UUIDMixin, TimestampMixin):
      __tablename__ = "enterprise_object_card_mappings"
      enterprise_object_key: Mapped[str]  # String(64), not null, FK -> enterprise_objects.key
      card_type_key: Mapped[str]          # String(100), not null, FK -> card_types.key
      card_subtype_key: Mapped[str | None]  # String(100), nullable — NULL = all subtypes
      # Unique constraint: (enterprise_object_key, card_type_key, card_subtype_key)
  ```
- Consumes: nothing (first task).

- [ ] **Step 1: Write the failing migration test**

```python
async def test_enterprise_objects_tables_exist(db_session):
    result = await db_session.execute(text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = 'enterprise_objects'"
    ))
    columns = {row[0] for row in result}
    assert {"key", "name", "layer", "is_standard", "is_locked", "is_hidden"} <= columns

async def test_enterprise_object_card_mapping_unique_constraint(db_session):
    # insert the same (enterprise_object_key, card_type_key, card_subtype_key) twice,
    # assert the second insert raises IntegrityError
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/services/test_alembic_159_add_enterprise_objects.py -v`
Expected: FAIL — tables don't exist yet.

- [ ] **Step 3: Write `EnterpriseObject`/`EnterpriseObjectCardMapping` in `backend/app/models/enterprise_object.py`**

Follow `backend/app/models/card_type.py`'s exact style (`Base, UUIDMixin, TimestampMixin`,
`Mapped[...]`/`mapped_column`). Add the unique constraint on the bridge table via
`__table_args__ = (UniqueConstraint("enterprise_object_key", "card_type_key", "card_subtype_key"),)`.

- [ ] **Step 4: Generate and hand-check the Alembic migration**

Run `alembic revision --autogenerate -m "add enterprise objects"` from `backend/`, rename the
result to `159_add_enterprise_objects.py`, verify its `down_revision` points at `158`, and verify
it creates both tables with the unique constraint and FKs to `card_types.key`.

- [ ] **Step 5: Run migration and tests**

Run: `alembic upgrade head` then `pytest backend/tests/services/test_alembic_159_add_enterprise_objects.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/enterprise_object.py backend/app/models/__init__.py backend/alembic/versions/159_add_enterprise_objects.py backend/tests/services/test_alembic_159_add_enterprise_objects.py
git commit -m "feat(archimate): add EnterpriseObject and card-mapping bridge tables"
```

---

## Task 2: Seed data — the Enterprise Object registry

**Files:**
- Create: `backend/app/services/archimate/enterprise_object_seed.py`
- Modify: `backend/app/services/seed.py` (call the new seeder from `seed_metamodel`, same place
  it currently applies `CARD_TYPE_DEFAULTS`)
- Test: `backend/tests/services/test_enterprise_object_seed.py`

**Interfaces:**
- Consumes: `taxonomy.py`'s `ELEMENT_TYPES`, `LAYERS`, `COMPOSITE_TYPES` (`Grouping`, `Location`),
  `CONNECTOR_TYPES` (`AndJunction`, `OrJunction`); Task 1's `EnterpriseObject` model.
- Produces: `async def seed_enterprise_objects(db: AsyncSession) -> None` — idempotent (upsert by
  `key`, like the existing card-type seeding), called from `seed_metamodel`.

- [ ] **Step 1: Write the failing test**

```python
async def test_seed_creates_one_row_per_standard_element_type(db_session):
    await seed_enterprise_objects(db_session)
    result = await db_session.execute(select(EnterpriseObject).where(EnterpriseObject.is_standard))
    keys = {r.key for r in result.scalars()}
    assert keys == set(taxonomy.ELEMENT_TYPES)  # all ~40, not the Other-section 4

async def test_seed_creates_other_section_rows(db_session):
    await seed_enterprise_objects(db_session)
    grouping = await db_session.get(EnterpriseObject, ...)  # fetch by key="Grouping"
    assert grouping.layer is None
    assert grouping.is_locked is True
    for key in ("Location", "AndJunction", "OrJunction"):
        obj = ...  # fetch by key
        assert obj.layer is None
        assert obj.is_locked is False

def test_every_seeded_description_is_short_and_present():
    for key, desc in ENTERPRISE_OBJECT_DESCRIPTIONS.items():
        assert desc  # non-empty
        assert len(desc.split()) <= 30

async def test_seed_is_idempotent(db_session):
    await seed_enterprise_objects(db_session)
    await seed_enterprise_objects(db_session)
    result = await db_session.execute(select(func.count()).select_from(EnterpriseObject))
    assert result.scalar() == len(taxonomy.ELEMENT_TYPES) + 4
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/services/test_enterprise_object_seed.py -v`
Expected: FAIL — `seed_enterprise_objects` doesn't exist.

- [ ] **Step 3: Write `enterprise_object_seed.py`**

A `ENTERPRISE_OBJECT_DESCRIPTIONS: dict[str, str]` module constant, one entry per standard key
(the ~40 `ELEMENT_TYPES` plus `Grouping`/`Location`/`AndJunction`/`OrJunction`) — each the
ArchiMate 3.2 definition rewritten for a non-expert, **≤30 words**, no jargon. Draft every one of
these against the Open Group spec's own definitions; this is real writing, not a placeholder.

`seed_enterprise_objects(db)`: for each key in `taxonomy.ELEMENT_TYPES`, upsert a row with
`is_standard=True`, `layer` from `taxonomy.LAYERS`, `description` from the dict above, a sensible
default `icon`/`color` (reuse whatever icon/color convention `ARCHIMATE_LAYER_COLORS` already
uses per layer, from `frontend/src/features/archimate/engine/notation.ts`'s palette — pick the
closest Material Symbol per element by hand, there's no automatic mapping). For `Grouping`,
`Location`, `AndJunction`, `OrJunction`: `is_standard=True`, `layer=None`, `is_locked` true only
for `Grouping`. Upsert by `key` (update existing rows' `description`/`icon`/`color`/`layer` on
every seed run — never touch an existing row's `is_hidden`, so an admin's visibility choice
survives a reseed, same pattern `CardType` seeding already follows for `is_hidden`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/services/test_enterprise_object_seed.py -v`
Expected: PASS.

- [ ] **Step 5: Wire into `seed_metamodel` and verify full seed still runs clean**

Run: `pytest backend/tests/services/test_seed_archimate_mapping.py backend/tests/services/test_enterprise_object_seed.py -v`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/archimate/enterprise_object_seed.py backend/app/services/seed.py backend/tests/services/test_enterprise_object_seed.py
git commit -m "feat(archimate): seed the Enterprise Object registry"
```

---

## Task 3: Seed migration — Card Mapping bridge rows from `default_mapping.py`

**Files:**
- Modify: `backend/app/services/archimate/enterprise_object_seed.py`
- Test: `backend/tests/services/test_enterprise_object_seed.py`

**Interfaces:**
- Consumes: `default_mapping.py`'s `CARD_TYPE_DEFAULTS`, `SUBTYPE_DEFAULTS`; Task 1's
  `EnterpriseObjectCardMapping`.
- Produces: `async def seed_card_mappings(db: AsyncSession) -> None`, called right after
  `seed_enterprise_objects` in `seed_metamodel`.

- [ ] **Step 1: Write the failing test**

```python
async def test_card_type_defaults_become_bridge_rows(db_session):
    await seed_enterprise_objects(db_session)
    await seed_card_mappings(db_session)
    rows = await _mapping_rows_for(db_session, "BusinessObject")  # helper: query by enterprise_object_key
    assert ("DataObject", None) in {(r.card_type_key, r.card_subtype_key) for r in rows}

async def test_subtype_defaults_become_scoped_bridge_rows(db_session):
    await seed_enterprise_objects(db_session)
    await seed_card_mappings(db_session)
    rows = await _mapping_rows_for(db_session, "Location")
    assert ("Organization", "region") in {(r.card_type_key, r.card_subtype_key) for r in rows}

async def test_unmapped_card_type_defaults_produce_no_row(db_session):
    # CARD_TYPE_DEFAULTS["BusinessContext"] is None today — no bridge row should exist
    # for card_type_key == "BusinessContext" with card_subtype_key is None at the type level
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/services/test_enterprise_object_seed.py::test_card_type_defaults_become_bridge_rows -v`
Expected: FAIL — `seed_card_mappings` doesn't exist.

- [ ] **Step 3: Write `seed_card_mappings`**

Iterate `CARD_TYPE_DEFAULTS.items()`: skip `None` values; upsert a bridge row
`(enterprise_object_key=value, card_type_key=key, card_subtype_key=None)`. Iterate
`SUBTYPE_DEFAULTS.items()`: upsert `(enterprise_object_key=value, card_type_key=card_type,
card_subtype_key=subtype)`. Idempotent — upsert on the unique constraint, don't duplicate on a
second run.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/services/test_enterprise_object_seed.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/archimate/enterprise_object_seed.py backend/tests/services/test_enterprise_object_seed.py
git commit -m "feat(archimate): migrate default_mapping.py's card-type mapping into bridge rows"
```

---

## Task 4: API — list Enterprise Objects with their card mappings

**Files:**
- Modify: `backend/app/api/v1/metamodel.py`
- Test: `backend/tests/api/test_enterprise_objects_api.py`

**Interfaces:**
- Produces: `GET /metamodel/enterprise-objects?include_hidden=true` — returns every
  `EnterpriseObject`, each serialized with a nested `card_mappings: [{id, enterprise_object_key,
  card_type_key, card_subtype_key}]` list (the row's own `enterprise_object_key` is included even
  though it duplicates the parent object's `key` — this lets the frontend flatten all objects'
  mappings into one array without losing which object each row belongs to), matching the existing
  `_serialize_card_type`-style helper pattern in the same file.

- [ ] **Step 1: Write the failing test**

```python
async def test_list_enterprise_objects_includes_card_mappings(client, admin_token):
    resp = await client.get("/metamodel/enterprise-objects", headers=admin_token)
    assert resp.status_code == 200
    business_object = next(o for o in resp.json() if o["key"] == "BusinessObject")
    assert any(m["card_type_key"] == "DataObject" for m in business_object["card_mappings"])

async def test_list_enterprise_objects_excludes_hidden_by_default(client, admin_token):
    # hide one row directly in DB, assert it's absent without include_hidden=true,
    # present with it
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/api/test_enterprise_objects_api.py -v`
Expected: FAIL — 404, route doesn't exist.

- [ ] **Step 3: Implement the endpoint in `metamodel.py`**

Follow the existing `GET /metamodel/types` handler's shape (`include_hidden` query param,
`PermissionService.require_permission` — reuse `"admin.metamodel"` for the admin screen reads,
but note this endpoint is ALSO called from the drawing palette by any user who can edit a
diagram, so gate on read access the same way `GET /metamodel/types` already does, not on
`admin.metamodel`). One SQL query for `EnterpriseObject` rows, one for
`EnterpriseObjectCardMapping` rows grouped by `enterprise_object_key` in Python (avoid N+1).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/api/test_enterprise_objects_api.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/metamodel.py backend/tests/api/test_enterprise_objects_api.py
git commit -m "feat(archimate): expose GET /metamodel/enterprise-objects"
```

---

## Task 5: API — create, update and lock-protect an Enterprise Object

**Files:**
- Modify: `backend/app/api/v1/metamodel.py`
- Test: `backend/tests/api/test_enterprise_objects_api.py`

**Interfaces:**
- Consumes: Task 4's serializer helper.
- Produces: `POST /metamodel/enterprise-objects` (always creates `is_standard=False`), `PATCH
  /metamodel/enterprise-objects/{key}`.

- [ ] **Step 1: Write the failing tests**

```python
async def test_create_custom_enterprise_object(client, admin_token):
    resp = await client.post("/metamodel/enterprise-objects", json={
        "key": "AIModel", "name": "AI Model", "layer": "application", "icon": "smart_toy",
    }, headers=admin_token)
    assert resp.status_code == 201
    assert resp.json()["is_standard"] is False

async def test_create_rejects_key_colliding_with_standard_type(client, admin_token):
    resp = await client.post("/metamodel/enterprise-objects", json={
        "key": "BusinessObject", "name": "Shadow", "layer": "business",
    }, headers=admin_token)
    assert resp.status_code == 409

async def test_patch_updates_description_and_visibility(client, admin_token):
    resp = await client.patch("/metamodel/enterprise-objects/BusinessObject", json={
        "description": "A thing a business cares about.", "is_hidden": True,
    }, headers=admin_token)
    assert resp.status_code == 200
    assert resp.json()["is_hidden"] is True

async def test_patch_rejects_edits_on_locked_object(client, admin_token):
    resp = await client.patch("/metamodel/enterprise-objects/Grouping", json={
        "is_hidden": True,
    }, headers=admin_token)
    assert resp.status_code == 422

async def test_patch_rejects_key_change():
    # "key" is not in the PATCH-updatable field list — attempting it either 400s or is silently ignored;
    # assert the row's key is unchanged after a PATCH that includes "key" in the body
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/api/test_enterprise_objects_api.py -v`
Expected: FAIL — routes don't exist.

- [ ] **Step 3: Implement both endpoints**

`POST`: validate `key` via the same `isValidKey`-equivalent server-side check already used for
`CardType` creation (find it in `metamodel.py`'s existing `create_type` handler and reuse it),
reject if `key` matches any row already in `enterprise_objects` (standard or custom — a 409).
Always set `is_standard=False`, `is_locked=False`.

`PATCH`: load the row; if `row.is_locked`, return 422 before touching the body at all. Otherwise
apply an `updatable = ["name", "description", "icon", "color", "layer", "is_hidden",
"sort_order"]` allowlist, same pattern as `update_type`'s `updatable` list — `key` and
`is_standard`/`is_locked` are never in that list, so a client sending them is silently ignored
(matches how `key` is already immutable on `CardType`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/api/test_enterprise_objects_api.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/metamodel.py backend/tests/api/test_enterprise_objects_api.py
git commit -m "feat(archimate): add create/update endpoints for custom Enterprise Objects"
```

---

## Task 6: API — add/remove a card-mapping bridge row

**Files:**
- Modify: `backend/app/api/v1/metamodel.py`
- Test: `backend/tests/api/test_enterprise_objects_api.py`

**Interfaces:**
- Produces: `POST /metamodel/enterprise-objects/{key}/card-mappings` (body:
  `{card_type_key, card_subtype_key?}`), `DELETE
  /metamodel/enterprise-objects/{key}/card-mappings/{mapping_id}`.

- [ ] **Step 1: Write the failing tests**

```python
async def test_add_card_mapping_row(client, admin_token):
    resp = await client.post(
        "/metamodel/enterprise-objects/DataObject/card-mappings",
        json={"card_type_key": "ITComponent", "card_subtype_key": "software"},
        headers=admin_token,
    )
    assert resp.status_code == 201

async def test_add_duplicate_card_mapping_row_is_rejected(client, admin_token):
    # post the same (enterprise_object, card_type, card_subtype) twice, assert second is 409

async def test_remove_card_mapping_row(client, admin_token):
    created = await client.post(..., headers=admin_token)
    mapping_id = created.json()["id"]
    resp = await client.delete(
        f"/metamodel/enterprise-objects/DataObject/card-mappings/{mapping_id}",
        headers=admin_token,
    )
    assert resp.status_code == 204
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/api/test_enterprise_objects_api.py -v`
Expected: FAIL — routes don't exist.

- [ ] **Step 3: Implement both endpoints**

`POST`: validate `card_type_key` exists (`CardType` lookup); if `card_subtype_key` given, don't
hard-validate it against the card type's live `subtypes` JSONB (Review Focus: a later subtype
rename must not retroactively break this row — validate it's a non-empty string, nothing more).
Catch the unique-constraint violation and translate to a 409, same pattern Task 5 used for `POST
/enterprise-objects`.

`DELETE`: 404 if the mapping id doesn't belong to that `enterprise_object_key`, else delete, 204.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/api/test_enterprise_objects_api.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/metamodel.py backend/tests/api/test_enterprise_objects_api.py
git commit -m "feat(archimate): add/remove card-mapping bridge rows via the API"
```

---

## Task 7: Frontend types + API client

**Files:**
- Modify: `frontend/src/types/index.ts`
- Create: `frontend/src/api/enterpriseObjects.ts`
- Test: `frontend/src/api/enterpriseObjects.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface EnterpriseObjectCardMapping {
    id: string;
    enterprise_object_key: string;
    card_type_key: string;
    card_subtype_key: string | null;
  }
  export interface EnterpriseObject {
    key: string; name: string; description: string | null; icon: string; color: string;
    layer: string | null; is_standard: boolean; is_locked: boolean; is_hidden: boolean;
    sort_order: number; card_mappings: EnterpriseObjectCardMapping[];
  }
  // frontend/src/api/enterpriseObjects.ts
  export function listEnterpriseObjects(includeHidden?: boolean): Promise<EnterpriseObject[]>;
  export function createEnterpriseObject(body: Partial<EnterpriseObject>): Promise<EnterpriseObject>;
  export function updateEnterpriseObject(key: string, body: Partial<EnterpriseObject>): Promise<EnterpriseObject>;
  export function addCardMapping(key: string, cardTypeKey: string, cardSubtypeKey?: string | null): Promise<EnterpriseObjectCardMapping>;
  export function removeCardMapping(key: string, mappingId: string): Promise<void>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
test("listEnterpriseObjects calls GET /metamodel/enterprise-objects", async () => {
  mockApi.on("get", "/metamodel/enterprise-objects", [sampleEnterpriseObject]);
  const result = await listEnterpriseObjects();
  expect(result).toEqual([sampleEnterpriseObject]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/enterpriseObjects.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the types and the five functions**

Thin wrappers over the existing `api.get`/`api.post`/`api.patch`/`api.delete` client (`@/api/client`),
same style as any other `frontend/src/api/*.ts` file in this repo.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/enterpriseObjects.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/api/enterpriseObjects.ts frontend/src/api/enterpriseObjects.test.ts
git commit -m "feat(archimate): add EnterpriseObject types and API client"
```

---

## Task 8: Switch `elementTypesForCardType` to the n:m source

**Files:**
- Modify: `frontend/src/features/archimate/mapping/resolveMapping.ts`
- Modify: `frontend/src/features/archimate/useArchimateBridge.ts`
- Modify: `frontend/src/features/archimate/mapping/validateMapping.ts`
- Test: `frontend/src/features/archimate/mapping/resolveMapping.test.ts` (extend existing)
- Test: `frontend/src/features/archimate/useArchimateBridge.test.tsx` (extend existing)
- Test: `frontend/src/features/archimate/mapping/validateMapping.test.ts` (extend existing)

**Note on scope:** `elementTypeForCard` (singular) has no production caller today — grep confirms
only its own test file calls it (`resolveMapping.ts`/`resolveMapping.test.ts`). Both of its real
production callers, `useArchimateBridge.ts:68` (`cardTypesFor`, powering the "Link to card"
candidate list) and `validateMapping.ts:38-41`, use only `elementTypesForCardType` (plural) —
which already unions the type-level value with every subtype override into one flat array. That
union is exactly the spec's n:m "Link to card" behavior already, so there is no override/precedence
rule to invent here. `staleCheck.ts` does not call either function (an earlier scan of this plan
mistakenly included it; dropped). Delete `elementTypeForCard` and its tests rather than carry
forward an unused function with no well-defined n:m behavior.

**Interfaces:**
- Consumes: Task 7's `EnterpriseObjectCardMapping`.
- Produces: `elementTypesForCardType(cardTypeKey: string, mappings: EnterpriseObjectCardMapping[]): ElementType[]`
  — note the signature changes from taking a `CardType` to taking a `cardTypeKey: string` plus
  the mappings list, since the Enterprise Object information no longer lives on `CardType` at
  all.

- [ ] **Step 1: Write the failing tests (extend existing file)**

```ts
test("elementTypesForCardType returns the union of every bridge row for that card type, deduplicated", () => {
  const mappings = [
    { id: "1", enterprise_object_key: "BusinessObject", card_type_key: "DataObject", card_subtype_key: null },
    { id: "2", enterprise_object_key: "Artifact", card_type_key: "DataObject", card_subtype_key: "file" },
    { id: "3", enterprise_object_key: "BusinessObject", card_type_key: "DataObject", card_subtype_key: "file" },
  ];
  expect(elementTypesForCardType("DataObject", mappings)).toEqual(
    expect.arrayContaining(["BusinessObject", "Artifact"]),
  );
  expect(elementTypesForCardType("DataObject", mappings)).toHaveLength(2); // deduplicated
});

test("elementTypesForCardType returns an empty array for an unmapped card type", () => {
  expect(elementTypesForCardType("BusinessContext", [])).toEqual([]);
});

test("elementTypeForCard is removed", () => {
  // this test itself is deleted along with the function in Step 3 — listed here only
  // to make the removal an explicit, checked step rather than a silent deletion
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/archimate/mapping/resolveMapping.test.ts`
Expected: FAIL — old signature takes a `CardType`, not a `cardTypeKey` + mappings array.

- [ ] **Step 3: Rewrite `elementTypesForCardType`, delete `elementTypeForCard`**

Replace the body: filter `mappings` by `card_type_key === cardTypeKey`, map to
`enterprise_object_key`, dedupe via `Set`, keep the existing `isElementType` filter. Delete
`elementTypeForCard` and its two tests from `resolveMapping.ts`/`resolveMapping.test.ts`.

- [ ] **Step 4: Update the two real call sites**

`useArchimateBridge.ts`'s `cardTypesFor`: change `elementTypesForCardType(ct)` to
`elementTypesForCardType(ct.key, mappings)`, where `mappings` comes from Task 7's
`listEnterpriseObjects()` with every object's `card_mappings` array concatenated into one flat
`EnterpriseObjectCardMapping[]` (each row already carries its own `enterprise_object_key`, so a
plain `flatMap` is enough). `validateMapping.ts`'s two call sites: same signature change.

- [ ] **Step 5: Run full affected test files**

Run: `npx vitest run src/features/archimate/mapping/resolveMapping.test.ts src/features/archimate/useArchimateBridge.test.tsx src/features/archimate/mapping/validateMapping.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/archimate/mapping/resolveMapping.ts frontend/src/features/archimate/mapping/resolveMapping.test.ts frontend/src/features/archimate/useArchimateBridge.ts frontend/src/features/archimate/useArchimateBridge.test.tsx frontend/src/features/archimate/mapping/validateMapping.ts frontend/src/features/archimate/mapping/validateMapping.test.ts
git commit -m "refactor(archimate): resolve card<->ArchiMate mapping from the n:m bridge table"
```

---

## Task 9: "Architecture Studio" tab shell + Card Mapping registry list (read-only)

**Files:**
- Create: `frontend/src/features/admin/metamodel/ArchitectureStudioTab.tsx`
- Create: `frontend/src/features/admin/metamodel/CardMappingTabContent.tsx`
- Modify: `frontend/src/features/admin/MetamodelAdmin.tsx`
- Test: `frontend/src/features/admin/metamodel/CardMappingTabContent.test.tsx`
- Test: `frontend/src/features/admin/MetamodelAdmin.test.tsx` (extend)

**Interfaces:**
- Consumes: Task 7's `listEnterpriseObjects`.
- Produces: `ArchitectureStudioTab` renders a nested `Tabs`/`Tab` with one entry, "Card Mapping"
  (matching `RelationsTabContent.tsx`'s nested-tab + local `sub` state pattern, so later plans can
  add more entries beside it without restructuring). `CardMappingTabContent` renders the registry
  as a list/grid grouped by layer, each row showing icon, name, a visibility toggle (reusing the
  eye-icon pattern from `MetamodelAdmin.tsx`'s Card Types tab), with the card-mapping count.

- [ ] **Step 1: Write the failing test**

```tsx
test("Architecture Studio tab appears right after Relation Types", async () => {
  render(<MetamodelAdmin />);
  const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
  expect(tabs.indexOf("Architecture Studio")).toBe(tabs.indexOf("Relation Types") + 1);
});

test("Card Mapping lists every visible Enterprise Object grouped by layer", async () => {
  mockApi.on("get", "/metamodel/enterprise-objects", [sampleBusinessObject, sampleDataObject]);
  render(<CardMappingTabContent />);
  expect(await screen.findByText("Business Object")).toBeVisible();
});

test("toggling visibility calls PATCH with is_hidden", async () => {
  // click the eye icon on a row, assert updateEnterpriseObject was called with { is_hidden: true }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/admin/MetamodelAdmin.test.tsx src/features/admin/metamodel/CardMappingTabContent.test.tsx`
Expected: FAIL — components don't exist.

- [ ] **Step 3: Implement `ArchitectureStudioTab` and `CardMappingTabContent`**

Mirror `RelationsTabContent.tsx`'s structure/state pattern exactly. Fetch via
`listEnterpriseObjects(true)` on mount; group by `layer` (the "Other" four, `layer === null`, go
in their own trailing section titled per the spec's "Other" section).

- [ ] **Step 4: Wire into `MetamodelAdmin.tsx`**

Insert a new `<Tab label={t("metamodel.tabs.architectureStudio")} />` immediately after
`relationTypes` in the `<Tabs>` list, and a `{tab === 2 && <ArchitectureStudioTab ... />}` block
— shift every subsequent tab's index by one (`calculations` 2→3, `tags` 3→4, `graph` 4→5,
`principles` 5→6, `regulations` 6→7, `resources` 7→8) and update their `{tab === N && ...}`
guards accordingly.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/admin/MetamodelAdmin.test.tsx src/features/admin/metamodel/CardMappingTabContent.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/admin/metamodel/ArchitectureStudioTab.tsx frontend/src/features/admin/metamodel/CardMappingTabContent.tsx frontend/src/features/admin/MetamodelAdmin.tsx frontend/src/features/admin/metamodel/CardMappingTabContent.test.tsx frontend/src/features/admin/MetamodelAdmin.test.tsx
git commit -m "feat(archimate): add the Architecture Studio admin tab with a read-only Card Mapping list"
```

---

## Task 10: New Architecture Object dialog

**Files:**
- Create: `frontend/src/features/admin/metamodel/NewArchitectureObjectDialog.tsx`
- Modify: `frontend/src/features/admin/metamodel/CardMappingTabContent.tsx`
- Test: `frontend/src/features/admin/metamodel/NewArchitectureObjectDialog.test.tsx`

**Interfaces:**
- Consumes: Task 7's `createEnterpriseObject`; `KeyInput`/`isValidKey` from
  `@/components/KeyInput`; `IconPicker`/`ColorPicker` from `@/components`.
- Produces: `<NewArchitectureObjectDialog open onClose onCreated />` — a dialog with key, name,
  layer (select, the 7 standard layers only — never "Other"), icon, color, description fields,
  mirroring `MetamodelAdmin.tsx`'s existing "New Card Type" dialog field-for-field.

- [ ] **Step 1: Write the failing test**

```tsx
test("creating a custom object posts the form and closes on success", async () => {
  const onCreated = vi.fn();
  render(<NewArchitectureObjectDialog open onClose={vi.fn()} onCreated={onCreated} />);
  await userEvent.type(screen.getByLabelText("Key"), "AIModel");
  await userEvent.type(screen.getByLabelText("Name"), "AI Model");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(onCreated).toHaveBeenCalled();
});

test("create button is disabled until key and name are valid", () => {
  render(<NewArchitectureObjectDialog open onClose={vi.fn()} onCreated={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/admin/metamodel/NewArchitectureObjectDialog.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement the dialog**

Copy `MetamodelAdmin.tsx`'s `createTypeOpen`/`newType` dialog block structure, swap the
`category` select for a `layer` select over the 7 standard layers, call
`createEnterpriseObject` on submit, call `onCreated()` then `onClose()` on success.

- [ ] **Step 4: Wire the "New Architecture Object" button into `CardMappingTabContent`**

Opens the dialog; `onCreated` refetches the registry list.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/admin/metamodel/NewArchitectureObjectDialog.test.tsx src/features/admin/metamodel/CardMappingTabContent.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/admin/metamodel/NewArchitectureObjectDialog.tsx frontend/src/features/admin/metamodel/CardMappingTabContent.tsx frontend/src/features/admin/metamodel/NewArchitectureObjectDialog.test.tsx
git commit -m "feat(archimate): add the New Architecture Object dialog"
```

---

## Task 11: Description popover with permission-gated edit

**Files:**
- Create: `frontend/src/features/admin/metamodel/EnterpriseObjectPopover.tsx`
- Modify: `frontend/src/features/admin/metamodel/CardMappingTabContent.tsx`
- Modify: `frontend/src/features/archimate/engine/ArchimatePaletteProvider.ts` (palette use, see
  Step 4)
- Test: `frontend/src/features/admin/metamodel/EnterpriseObjectPopover.test.tsx`

**Interfaces:**
- Consumes: Task 7's `EnterpriseObject`, `updateEnterpriseObject`; an existing
  permission-check hook (find the one `CardType`/`RelationType` editing already uses in
  `MetamodelAdmin.tsx`'s surrounding code, e.g. a `useHasPermission("admin.metamodel")`-shaped
  hook already in this codebase, and reuse it — do not invent a second one).
- Produces: `<EnterpriseObjectPopover object anchorEl onClose canEdit />` — click-triggered
  (`Popover` from MUI, `open={!!anchorEl}`), shows icon+name+description; when `canEdit`, a
  pencil `IconButton` switches the description to an inline-editable `TextField` with
  Save/Cancel, calling `updateEnterpriseObject(key, { description })` on Save.

- [ ] **Step 1: Write the failing tests**

```tsx
test("shows the description read-only without canEdit", () => {
  render(<EnterpriseObjectPopover object={sample} anchorEl={el} onClose={vi.fn()} canEdit={false} />);
  expect(screen.queryByLabelText("Edit description")).not.toBeInTheDocument();
});

test("pencil opens an editable field and Save persists it", async () => {
  render(<EnterpriseObjectPopover object={sample} anchorEl={el} onClose={vi.fn()} canEdit={true} />);
  await userEvent.click(screen.getByLabelText("Edit description"));
  await userEvent.clear(screen.getByRole("textbox"));
  await userEvent.type(screen.getByRole("textbox"), "New description.");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(updateEnterpriseObject).toHaveBeenCalledWith(sample.key, { description: "New description." });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/admin/metamodel/EnterpriseObjectPopover.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement the popover**

- [ ] **Step 4: Wire click-to-open in `CardMappingTabContent` (admin list) and in the drawing
  palette**

In `CardMappingTabContent`, clicking a row's name/icon opens the popover with `canEdit` from the
permission hook. In the palette
(`frontend/src/features/archimate/engine/ArchimatePaletteProvider.ts` — find wherever a palette
tile's click/label is currently rendered), add the same click-to-open popover, always with
`canEdit={false}` regardless of the viewer's permissions — the palette context never offers
editing, per the spec's Anti-goals.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/admin/metamodel/EnterpriseObjectPopover.test.tsx src/features/archimate/engine/ArchimatePaletteProvider.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/admin/metamodel/EnterpriseObjectPopover.tsx frontend/src/features/admin/metamodel/CardMappingTabContent.tsx frontend/src/features/archimate/engine/ArchimatePaletteProvider.ts frontend/src/features/admin/metamodel/EnterpriseObjectPopover.test.tsx
git commit -m "feat(archimate): click-to-reveal Enterprise Object description, admin-editable"
```

---

## Task 12: Card Mapping bridge-table editor

**Files:**
- Modify: `frontend/src/features/admin/metamodel/CardMappingTabContent.tsx`
- Create: `frontend/src/features/admin/metamodel/CardMappingRowEditor.tsx`
- Test: `frontend/src/features/admin/metamodel/CardMappingRowEditor.test.tsx`

**Interfaces:**
- Consumes: Task 6's `addCardMapping`/`removeCardMapping`; `types`/`relationTypes` already
  fetched by `MetamodelAdmin.tsx` (card type + subtype pickers).
- Produces: `<CardMappingRowEditor object onChanged />` — per-Enterprise-Object expandable
  section listing its current `card_mappings` rows with a delete button each, plus an "add" row:
  a card-type `Select` and, when that type has subtypes, a second `Select` offering "All
  subtypes" (maps to `card_subtype_key: null`) or one specific subtype.

- [ ] **Step 1: Write the failing tests**

```tsx
test("adding a mapping with 'All subtypes' selected posts card_subtype_key: null", async () => {
  render(<CardMappingRowEditor object={sample} onChanged={vi.fn()} />);
  await userEvent.click(screen.getByLabelText("Card type"));
  await userEvent.click(screen.getByRole("option", { name: "Data Object" }));
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(addCardMapping).toHaveBeenCalledWith(sample.key, "DataObject", null);
});

test("removing a row calls removeCardMapping with its id", async () => {
  render(<CardMappingRowEditor object={sampleWithOneMapping} onChanged={vi.fn()} />);
  await userEvent.click(screen.getByLabelText("Remove mapping"));
  expect(removeCardMapping).toHaveBeenCalledWith(sampleWithOneMapping.key, sampleWithOneMapping.card_mappings[0].id);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/admin/metamodel/CardMappingRowEditor.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement `CardMappingRowEditor`**

- [ ] **Step 4: Embed it in `CardMappingTabContent`'s expanded row state**

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/admin/metamodel/CardMappingRowEditor.test.tsx src/features/admin/metamodel/CardMappingTabContent.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/admin/metamodel/CardMappingRowEditor.tsx frontend/src/features/admin/metamodel/CardMappingTabContent.tsx frontend/src/features/admin/metamodel/CardMappingRowEditor.test.tsx
git commit -m "feat(archimate): edit the n:m card-mapping bridge table in Card Mapping"
```

---

## Task 13: Drawing palette reads visibility and custom objects from the registry

**Files:**
- Modify: `frontend/src/features/archimate/exchange/exchangeModel.ts` (new pseudo-type, mirroring
  `NoteObject`/`isNoteObject`)
- Modify: `frontend/src/features/archimate/engine/ArchimatePaletteProvider.ts`
- Modify: `frontend/src/features/archimate/engine/ArchimateElementFactory.ts`
- Modify: `frontend/src/features/archimate/engine/ArchimateRenderer.ts`
- Modify: wherever the editor fetches data before constructing the diagram-js modules (find the
  call site that currently supplies `bridge` as an injectable — same mechanism, same place, per
  `ArchimatePaletteProvider.$inject`'s `"bridge"` entry)
- Test: `frontend/src/features/archimate/engine/ArchimatePaletteProvider.test.ts` (extend)
- Test: `frontend/src/features/archimate/engine/ArchimateElementFactory.test.ts` (extend)
- Test: `frontend/src/features/archimate/engine/ArchimateRenderer.test.ts` (extend)

**Scope note:** this task makes a custom Enterprise Object **drawable, selectable, renderable and
deletable** on the canvas. It does **not** cover Exchange Format import/export of custom objects
(the spec's "exports as a `Label` node" constraint) — that's deferred; note it explicitly as
follow-up work when this task is done, don't silently skip it.

**Interfaces:**
- Consumes: Task 7's `EnterpriseObject[]`, fetched once and passed into the engine's module
  wiring as a new injectable (mirror exactly how `bridge` is supplied today).
- Produces:
  ```ts
  // exchangeModel.ts
  export interface CustomEnterpriseObject {
    id: string;
    isCustomObject: true;
    enterpriseObjectKey: string;  // -> EnterpriseObject.key, for icon/color/name lookup
    name: string;
  }
  export function isCustomEnterpriseObject(bo: unknown): bo is CustomEnterpriseObject;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test("getPaletteEntries omits a standard element type whose EnterpriseObject.is_hidden is true", () => {
  const provider = setup({ enterpriseObjects: [{ key: "BusinessObject", is_hidden: true, ... }] });
  expect(provider.getPaletteEntries()["create.BusinessObject"]).toBeUndefined();
});

test("getPaletteEntries adds one entry per visible custom EnterpriseObject, in its chosen layer's group", () => {
  const provider = setup({ enterpriseObjects: [{ key: "AIModel", layer: "application", is_hidden: false, icon: "smart_toy", color: "#ab12cd", is_standard: false, ... }] });
  const entry = provider.getPaletteEntries()["create.AIModel"];
  expect(entry.group).toBe("application");
});

test("ElementFactory.createShape({ enterpriseObjectKey }) produces a CustomEnterpriseObject businessObject", () => {
  const shape = factory.createShape({ enterpriseObjectKey: "AIModel" });
  expect(isCustomEnterpriseObject(shape.businessObject)).toBe(true);
});

test("Renderer draws a custom object with the generic Note-shaped body and its own icon/color", () => {
  // assert drawCustomObject (or equivalent) is invoked for a shape whose businessObject
  // isCustomEnterpriseObject, and that its fill comes from the EnterpriseObject's own color,
  // not ARCHIMATE_LAYER_COLORS.other (visually distinct from a Note)
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/archimate/engine/ArchimatePaletteProvider.test.ts src/features/archimate/engine/ArchimateElementFactory.test.ts src/features/archimate/engine/ArchimateRenderer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add `CustomEnterpriseObject`/`isCustomEnterpriseObject` to `exchangeModel.ts`**

Exact mirror of `NoteObject`/`isNoteObject`'s shape and discriminant pattern
(`isCustomObject: true` instead of `isNote: true`).

- [ ] **Step 4: Wire `EnterpriseObject[]` into the engine as a new injectable**

Follow `bridge`'s existing wiring exactly — find its supply site, add `enterpriseObjects`
alongside it, add `"enterpriseObjects"` to `ArchimatePaletteProvider.$inject` and the
constructor parameter list.

- [ ] **Step 5: Extend `ArchimateElementFactory.createShape`**

Add a third branch (alongside the existing element/Note branches) for
`attrs.enterpriseObjectKey`: build a `CustomEnterpriseObject` businessObject, size it the same as
`NOTE_SIZE` (reuse the constant, renamed if that reads better, e.g. `GENERIC_OBJECT_SIZE` — your
call, keep `NOTE_SIZE` itself unchanged since Notes still use it).

- [ ] **Step 6: Extend `ArchimateRenderer`**

Add `canRender`'s check: `isCustomEnterpriseObject(bo)` alongside the existing `isNoteObject(bo)`
check. Add a `drawCustomObject` method parallel to `drawNote`: same body path
(`noteBodyPath`/`noteBodyDetail` — reuse, don't duplicate), but fill/stroke from the matching
`EnterpriseObject`'s own `color` (looked up by `enterpriseObjectKey` in the injected
`EnterpriseObject[]`) instead of `NOTE_COLORS`, and render the object's `icon` (a Material Symbol
name) as an SVG `<text>` node with `font-family: "Material Symbols Outlined"` (mirrors how the
DOM-level `MaterialSymbol` React component already renders icons as a font ligature — this is the
same font, applied inside the SVG canvas instead of a `<span>`; confirm it actually renders
correctly in a manual visual check, this is the one part of this task with no prior precedent in
this codebase to copy verbatim).

- [ ] **Step 7: Update `getPaletteEntries` and the keyboard-drop handler**

Filter standard-type entries by `!enterpriseObjects.find(o => o.key === type)?.is_hidden` before
adding them (a type with no registry row yet — shouldn't happen once Task 2's seed has run, but
treat "not found" as visible, never as hidden, so a missing registry row fails open). Add one
entry per visible custom `EnterpriseObject` (`is_standard === false`) into its own `layer`
group, using its `icon`/`color` for the tile instead of `entryIcon(type)`/`NOTATION`. Extend
`onKeyDown` to recognize a custom-object entry's `data-archimate-type` (use the object's `key`
as the attribute value, distinct from both real `ElementType`s and the `"Note"` sentinel) and
call `createShape({ enterpriseObjectKey: key })`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/features/archimate/engine/ArchimatePaletteProvider.test.ts src/features/archimate/engine/ArchimateElementFactory.test.ts src/features/archimate/engine/ArchimateRenderer.test.ts`
Expected: PASS.

- [ ] **Step 9: Manual visual check**

Open the live editor, hide a standard type via Card Mapping, confirm it's gone from the palette
and existing diagram elements of that type are untouched; create a custom object with a chosen
icon/color, confirm it appears in its layer's palette group, draw it, confirm the icon renders
correctly (this is the step that catches an SVG font-ligature rendering problem, if any).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/features/archimate/exchange/exchangeModel.ts frontend/src/features/archimate/engine/ArchimatePaletteProvider.ts frontend/src/features/archimate/engine/ArchimateElementFactory.ts frontend/src/features/archimate/engine/ArchimateRenderer.ts frontend/src/features/archimate/engine/ArchimatePaletteProvider.test.ts frontend/src/features/archimate/engine/ArchimateElementFactory.test.ts frontend/src/features/archimate/engine/ArchimateRenderer.test.ts
git commit -m "feat(archimate): drive the drawing palette from the Enterprise Object registry"
```

---

## Task 14: i18n for all new UI strings, 10 locales

**Files:**
- Modify: `frontend/src/i18n/locales/*/admin.json` (all 10 locales)
- Test: `frontend/src/i18n/translationKeys.test.ts` (existing suite, must stay green)

**Interfaces:**
- Consumes: every `t("metamodel...")` key introduced by Tasks 9–13 (collect them by grepping the
  new components for `t("` calls once those tasks are done).

- [ ] **Step 1: Run the translation-key test to see what's missing**

Run: `npx vitest run src/i18n/translationKeys.test.ts`
Expected: FAIL, listing every new key absent from the non-English locales.

- [ ] **Step 2: Add the English source strings to `en/admin.json`**

- [ ] **Step 3: Add the translated strings to the other 9 locales**

Follow this repo's established tone/voice per locale (check a few existing `metamodel.*` keys in
each locale file for register/formality conventions before translating). "Architecture Studio"
and "Card Mapping" stay in English everywhere, matching the already-shipped convention for
"Architecture Studio" as a brand name.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/i18n/translationKeys.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/i18n/locales
git commit -m "i18n(archimate): translate the Card Mapping admin UI across 10 locales"
```

---

## Task 15: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Backend full suite**

Run: `cd backend && pytest` — expect the same pass count as before this plan, plus every new test
added in Tasks 1–6.

- [ ] **Step 2: Frontend full suite**

Run: `cd frontend && npx vitest run && npx tsc -b && npm run lint`
Expected: all green, no new failures beyond this repo's known pre-existing ones.

- [ ] **Step 3: Manual smoke test**

Open the live app, go to Admin → Metamodel → Architecture Studio → Card Mapping, create a custom
Enterprise Object, map it to a card type, open the editor's palette, confirm the new object
appears, draw it, link it to a card of the mapped type, confirm the link succeeds.

- [ ] **Step 4: Commit (only if Step 3 required a fix)**

If the smoke test is clean, no commit needed — this task is verification-only.
