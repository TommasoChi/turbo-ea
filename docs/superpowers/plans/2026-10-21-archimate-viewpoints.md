# ArchiMate Viewpoint Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Viewpoint Catalog (the 23 standard ArchiMate viewpoints plus admin-defined custom ones) that every new ArchiMate diagram must be created against, restricting its element palette to that viewpoint's allowed Enterprise Objects.

**Architecture:** Four new tables (`archimate_viewpoints`, its Enterprise-Object bridge, its examples, and a small viewpoint×tab→card override table) plus a new nullable `viewpoint_key` FK on the existing `diagrams` table. Backend CRUD mirrors `EnterpriseObject`'s existing admin-metamodel endpoints exactly. Frontend adds a "Viewpoint Catalog" sub-tab to Architecture Studio and replaces the ArchiMate branch of diagram creation with a viewpoint-picker + example-grid, mirroring `BpmnTemplateChooser.tsx`.

**Tech Stack:** FastAPI + SQLAlchemy (async) + Alembic, React + MUI, existing `validate_exchange()` and `archi_native_import.py`.

**Spec:** `docs/superpowers/specs/2026-10-21-archimate-viewpoints-design.md` (and its input, `docs/superpowers/specs/2026-10-21-archimate-viewpoints-requisiti.md`)

## Global Constraints

- Every new UI string is translated in all 10 locales (`frontend/src/i18n/locales/{ar,da,de,en,es,fr,it,pt,ru,zh}/*.json`).
- `admin.metamodel` permission gates every Viewpoint Catalog write endpoint, exactly like the existing `EnterpriseObject`/`RelationType` endpoints (`PermissionService.require_permission(db, user, "admin.metamodel")`).
- An example upload is validated with the existing `validate_exchange()` (`app/services/archimate/validate.py`); a native Archi `.archimate` file goes through `convert_archi_native_to_exchange()` (`app/services/archimate/archi_native_import.py`) first.
- The "no more Free mode" rule applies only to `kind == "archimate"` diagrams — `drawio` diagrams are untouched.
- Deleting a Viewpoint in use by at least one diagram is a hard 409, with **no** force/cascade escape hatch (deliberately different from `delete_relation_type`'s `force=True` path, which deletes relation *instances* — a diagram is user-authored content, not a thin edge, and the spec says "blocca la cancellazione", full stop).
- A Viewpoint's `layer` field is admin-facing classification only; which nav tab(s) show a Viewpoint in its diagram picker is computed from the real layer-span of its allowed Enterprise Objects (via `taxonomy.py`'s `LAYERS`), never from this field.

## Review Focus

- Creating an archimate diagram with no `viewpoint_key` must be rejected — the core "no more Free" invariant, and the easiest one to silently regress.
- Editing a Viewpoint's allowed-objects list after diagrams already exist against it must not touch those diagrams' already-placed elements — only the designer's *future* placements are restricted.
- Deleting a Viewpoint in use must 409 and leave the diagram(s) untouched, never cascade-delete them.
- A Viewpoint spanning two tabs' layers (e.g. Implementation and Deployment: Application + Technology) must appear in *both* tabs' pickers, not just one.
- An example upload that fails `validate_exchange()` must be rejected with the validator's error and never persisted.

---

## Task 1: Models and migration

**Files:**
- Create: `backend/app/models/archimate_viewpoint.py`
- Modify: `backend/app/models/diagram.py` (add `viewpoint_key` column to `Diagram`)
- Modify: `backend/app/models/__init__.py` (export the new models, same list `EnterpriseObject` is in)
- Create: `backend/alembic/versions/161_add_archimate_viewpoints.py`
- Test: `backend/tests/services/test_alembic_161_archimate_viewpoints.py`

**Interfaces:**
- Produces:
  - `ArchimateViewpoint(Base, UUIDMixin, TimestampMixin)`, table `archimate_viewpoints`: `key: Mapped[str]` (String(64), unique), `name: Mapped[str]` (String(200)), `icon: Mapped[str]` (String(100), default `"category"`), `description: Mapped[str | None]` (Text), `layer: Mapped[str]` (String(32), one of `taxonomy.LAYERS`'s 7 keys), `is_standard: Mapped[bool]` (default False), `is_hidden: Mapped[bool]` (default False), `sort_order: Mapped[int]` (default 0)
  - `ArchimateViewpointObject(Base, UUIDMixin, TimestampMixin)`, table `archimate_viewpoint_objects`: `viewpoint_key: Mapped[str]` (FK `archimate_viewpoints.key`), `enterprise_object_key: Mapped[str]` (FK `enterprise_objects.key`), unique constraint on the pair
  - `ArchimateViewpointExample(Base, UUIDMixin, TimestampMixin)`, table `archimate_viewpoint_examples`: `viewpoint_key: Mapped[str]` (FK `archimate_viewpoints.key`), `name: Mapped[str]` (String(200)), `exchange_xml: Mapped[str]` (Text)
  - `ArchimateViewpointTabCard(Base, UUIDMixin, TimestampMixin)`, table `archimate_viewpoint_tab_cards`: `viewpoint_key: Mapped[str]` (FK `archimate_viewpoints.key`), `tab_key: Mapped[str]` (String(32), one of `"business"`/`"application"`/`"technology"`), `card_type_key: Mapped[str]` (FK `card_types.key`), unique constraint on `(viewpoint_key, tab_key, card_type_key)` — a tab can suggest more than one card for the same viewpoint (e.g. Application + DataObject), so this is not unique on `(viewpoint_key, tab_key)` alone
  - `Diagram.viewpoint_key: Mapped[str | None]` (String(64), `ForeignKey("archimate_viewpoints.key", ondelete="RESTRICT")`, nullable — NULL for `drawio` diagrams and for any `archimate` diagram created before this feature)
- Consumes: nothing (first task)

- [ ] **Step 1: Write `backend/app/models/archimate_viewpoint.py`** with the four classes above, following `backend/app/models/enterprise_object.py`'s exact style (imports, `UniqueConstraint`, docstrings one line each).

- [ ] **Step 2: Add `viewpoint_key` to `Diagram`** in `backend/app/models/diagram.py`, placed next to `kind`.

- [ ] **Step 3: Export the new models** from `backend/app/models/__init__.py` the same way `EnterpriseObject`/`EnterpriseObjectCardMapping` are exported.

- [ ] **Step 4: Generate the Alembic migration** `161_add_archimate_viewpoints.py`, `down_revision = "160"`. Creates the four new tables and adds the `diagrams.viewpoint_key` column + its FK. Follow the structure of `backend/alembic/versions/160_add_enterprise_object_aspect.py` for style (explicit `op.create_table`/`op.add_column`, a matching `downgrade()`).

- [ ] **Step 5: Write the migration test**

```python
# backend/tests/services/test_alembic_161_archimate_viewpoints.py
"""Migration 161 adds the ArchimateViewpoint catalog and its bridge/example/
tab-card tables, plus diagrams.viewpoint_key (ArchiMate Viewpoint Catalog, task 1)."""

from __future__ import annotations

from sqlalchemy import text


async def test_archimate_viewpoint_tables_exist(db):
    for table in (
        "archimate_viewpoints",
        "archimate_viewpoint_objects",
        "archimate_viewpoint_examples",
        "archimate_viewpoint_tab_cards",
    ):
        result = await db.execute(
            text("SELECT column_name FROM information_schema.columns WHERE table_name = :t"),
            {"t": table},
        )
        assert {row[0] for row in result}, f"{table} has no columns — table missing"

    result = await db.execute(
        text("SELECT column_name FROM information_schema.columns WHERE table_name = 'diagrams'")
    )
    assert "viewpoint_key" in {row[0] for row in result}
```

Use the `db` fixture (an `AsyncSession` already pointed at the test database — see `backend/tests/conftest.py`) and the raw `information_schema.columns` query style, exactly as `backend/tests/services/test_alembic_159_add_enterprise_objects.py` does for its own new tables — do not invent a `db_engine`/`inspect()` fixture, none exists in this test suite. For the migration file itself, follow `backend/alembic/versions/159_add_enterprise_objects.py`'s structure (it creates new tables) for the four `archimate_viewpoint*` tables, and `160_add_enterprise_object_aspect.py`'s structure (it adds one column to an existing table) for the `diagrams.viewpoint_key` addition.

- [ ] **Step 6: Run migrations and the test**

Run: `cd backend && alembic upgrade head && pytest tests/services/test_alembic_161_archimate_viewpoints.py -v`
Expected: migration applies cleanly, test PASSES.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/archimate_viewpoint.py backend/app/models/diagram.py backend/app/models/__init__.py backend/alembic/versions/161_add_archimate_viewpoints.py backend/tests/services/test_alembic_161_archimate_viewpoints.py
git commit -m "feat(archimate): add Viewpoint Catalog tables and diagrams.viewpoint_key"
```

---

## Task 2: Seed the 23 standard viewpoints

**Files:**
- Create: `backend/app/services/archimate/viewpoint_seed.py`
- Modify: `backend/app/services/seed.py` (call the new seed function from `seed_metamodel`, next to the existing `await seed_enterprise_objects(db)` / `await seed_card_mappings(db)` calls)
- Test: `backend/tests/services/test_archimate_viewpoint_seed.py`

**Interfaces:**
- Consumes: `ArchimateViewpoint`, `ArchimateViewpointObject`, `ArchimateViewpointTabCard` (Task 1); `EnterpriseObject.key` values (existing, from `taxonomy.ELEMENT_TYPES`/`COMPOSITE_TYPES`)
- Produces: `async def seed_viewpoints(db: AsyncSession) -> None` — idempotent, insert-only, same contract as `seed_enterprise_objects` (never touches an existing row's admin-editable fields on a later boot)

The 23 standard viewpoints, in seed order (`sort_order` = index). `layer` is the admin-facing classification only (see Global Constraints) — it does **not** restrict `objects`. `objects` are `EnterpriseObject.key` values, one Enterprise Object per allowed ArchiMate element, taken verbatim from `taxonomy.py`'s key names.

"Core element" in the ArchiMate 3.1 spec's own definition (viewpoints 15, 19, 23 below) means *any* element may additionally appear — deliberately **not** seeded as "allow everything" here, since that would silently reintroduce Free mode for those three. Seed only the explicitly named elements; an admin can widen the list later through the editable tag-chip UI (Task 5).

| key | name | icon | layer | objects |
|---|---|---|---|---|
| `organization` | Organization | `account_tree` | business | BusinessActor, BusinessRole, BusinessCollaboration, Location, BusinessInterface |
| `business-process-cooperation` | Business Process Cooperation | `sync_alt` | business | BusinessActor, BusinessRole, BusinessCollaboration, Location, BusinessInterface, BusinessProcess, BusinessFunction, BusinessInteraction, BusinessEvent, BusinessService, BusinessObject, Representation, ApplicationComponent, ApplicationCollaboration, ApplicationInterface, ApplicationProcess, ApplicationFunction, ApplicationInteraction, ApplicationEvent, ApplicationService, DataObject |
| `product` | Product | `shopping_bag` | business | BusinessActor, BusinessRole, BusinessCollaboration, BusinessInterface, BusinessProcess, BusinessFunction, BusinessInteraction, BusinessEvent, BusinessService, BusinessObject, Product, Contract, ApplicationComponent, ApplicationCollaboration, ApplicationInterface, ApplicationProcess, ApplicationFunction, ApplicationInteraction, ApplicationEvent, ApplicationService, DataObject, TechnologyService, Artifact, Material, Value |
| `application-cooperation` | Application Cooperation | `hub` | application | Location, ApplicationComponent, ApplicationCollaboration, ApplicationInterface, ApplicationProcess, ApplicationFunction, ApplicationInteraction, ApplicationEvent, ApplicationService, DataObject |
| `application-usage` | Application Usage | `cloud` | application | BusinessActor, BusinessRole, BusinessCollaboration, BusinessProcess, BusinessFunction, BusinessInteraction, BusinessEvent, BusinessObject, ApplicationComponent, ApplicationCollaboration, ApplicationInterface, ApplicationProcess, ApplicationFunction, ApplicationInteraction, ApplicationEvent, ApplicationService, DataObject |
| `implementation-and-deployment` | Implementation and Deployment | `deployed_code` | application | ApplicationComponent, ApplicationCollaboration, ApplicationInterface, ApplicationProcess, ApplicationFunction, ApplicationInteraction, ApplicationEvent, ApplicationService, DataObject, SystemSoftware, TechnologyInterface, Path, TechnologyProcess, TechnologyFunction, TechnologyInteraction, TechnologyService, Artifact |
| `technology` | Technology | `dns` | technology | Location, Node, TechnologyCollaboration, Device, SystemSoftware, TechnologyInterface, CommunicationNetwork, Path, TechnologyProcess, TechnologyFunction, TechnologyInteraction, TechnologyService, TechnologyEvent, Artifact |
| `technology-usage` | Technology Usage | `settings_suggest` | technology | ApplicationComponent, ApplicationCollaboration, ApplicationProcess, ApplicationFunction, ApplicationInteraction, ApplicationEvent, DataObject, Node, Device, TechnologyCollaboration, SystemSoftware, TechnologyInterface, CommunicationNetwork, Path, TechnologyProcess, TechnologyFunction, TechnologyInteraction, TechnologyService, TechnologyEvent, Artifact |
| `information-structure` | Information Structure | `schema` | application | BusinessObject, Representation, DataObject, Artifact, Meaning |
| `service-realization` | Service Realization | `design_services` | business | BusinessActor, BusinessRole, BusinessCollaboration, BusinessInterface, BusinessProcess, BusinessFunction, BusinessInteraction, BusinessEvent, BusinessService, BusinessObject, Representation, ApplicationComponent, ApplicationCollaboration, ApplicationInterface, ApplicationProcess, ApplicationFunction, ApplicationInteraction, ApplicationEvent, ApplicationService, DataObject |
| `physical` | Physical | `warehouse` | technology | Location, Node, Device, Equipment, Facility, Path, CommunicationNetwork, DistributionNetwork, Material |
| `layered` | Layered | `layers` | business | every key in `taxonomy.ALL_ELEMENT_TYPES` (all 7 layers plus the 4 "Other" rows) |
| `stakeholder` | Stakeholder | `groups` | motivation | Stakeholder, Driver, Assessment, Goal, Outcome |
| `goal-realization` | Goal Realization | `flag` | motivation | Goal, Principle, Requirement, Constraint, Outcome |
| `requirements-realization` | Requirements Realization | `checklist` | motivation | Goal, Requirement, Constraint, Outcome, Value, Meaning |
| `motivation` | Motivation | `psychology` | motivation | Stakeholder, Driver, Assessment, Goal, Principle, Requirement, Constraint, Outcome, Value, Meaning |
| `strategy` | Strategy | `route` | strategy | CourseOfAction, Capability, Resource, Outcome |
| `capability-map` | Capability Map | `grid_view` | strategy | Outcome, Capability, Resource |
| `outcome-realization` | Outcome Realization | `emoji_events` | strategy | Capability, Resource, Outcome, Value, Meaning |
| `resource-map` | Resource Map | `inventory_2` | strategy | Resource, Capability, WorkPackage |
| `project` | Project | `work` | implementation | Goal, WorkPackage, ImplementationEvent, Deliverable, BusinessActor, BusinessRole |
| `migration` | Migration | `swap_horiz` | implementation | Plateau, Gap |
| `implementation-and-migration` | Implementation and Migration | `landscape` | implementation | Goal, Requirement, Constraint, WorkPackage, ImplementationEvent, Deliverable, Plateau, Gap, BusinessActor, BusinessRole, Location |

**Viewpoint×tab→card overrides** (seeded by the same function, into `ArchimateViewpointTabCard` — see spec §5):

| viewpoint_key | tab_key | card_type_key |
|---|---|---|
| `implementation-and-deployment` | application | Application |
| `implementation-and-deployment` | technology | ITComponent |
| `implementation-and-deployment` | technology | Platform |
| `migration` | business | Initiative |
| `migration` | application | Application |
| `migration` | application | DataObject |
| `migration` | technology | ITComponent |
| `migration` | technology | Platform |
| `project` | business | Initiative |
| `project` | application | Application |
| `project` | application | DataObject |
| `project` | technology | ITComponent |
| `project` | technology | Platform |
| `implementation-and-migration` | business | Initiative |
| `implementation-and-migration` | application | Application |
| `implementation-and-migration` | application | DataObject |
| `implementation-and-migration` | technology | ITComponent |
| `implementation-and-migration` | technology | Platform |

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/services/test_archimate_viewpoint_seed.py
"""Tests for seed_viewpoints (ArchiMate Viewpoint Catalog, task 2)."""

from __future__ import annotations

from sqlalchemy import select

from app.models.archimate_viewpoint import (
    ArchimateViewpoint, ArchimateViewpointObject, ArchimateViewpointTabCard,
)
from app.services.archimate.viewpoint_seed import seed_viewpoints


async def test_seeds_all_23_standard_viewpoints(db):
    await seed_viewpoints(db)
    await db.commit()
    result = await db.execute(select(ArchimateViewpoint))
    rows = result.scalars().all()
    assert len(rows) == 23
    assert all(r.is_standard for r in rows)
    layered = next(r for r in rows if r.key == "layered")
    assert layered.icon == "layers"


async def test_layered_viewpoint_allows_every_element_type(db):
    from app.services.archimate import taxonomy
    await seed_viewpoints(db)
    await db.commit()
    result = await db.execute(
        select(ArchimateViewpointObject.enterprise_object_key).where(
            ArchimateViewpointObject.viewpoint_key == "layered"
        )
    )
    keys = {r[0] for r in result.all()}
    assert keys == set(taxonomy.ALL_ELEMENT_TYPES)


async def test_does_not_overwrite_an_admin_edit_on_a_second_run(db):
    await seed_viewpoints(db)
    await db.commit()
    result = await db.execute(
        select(ArchimateViewpoint).where(ArchimateViewpoint.key == "organization")
    )
    row = result.scalar_one()
    row.description = "admin's own wording"
    await db.commit()

    await seed_viewpoints(db)
    await db.commit()
    result = await db.execute(
        select(ArchimateViewpoint).where(ArchimateViewpoint.key == "organization")
    )
    assert result.scalar_one().description == "admin's own wording"


async def test_seeds_the_tab_card_overrides(db):
    await seed_viewpoints(db)
    await db.commit()
    result = await db.execute(
        select(ArchimateViewpointTabCard.card_type_key).where(
            ArchimateViewpointTabCard.viewpoint_key == "implementation-and-deployment",
            ArchimateViewpointTabCard.tab_key == "technology",
        )
    )
    assert {r[0] for r in result.all()} == {"ITComponent", "Platform"}
```

Use the real `db` fixture (an `AsyncSession`, see `backend/tests/conftest.py`) — there is no `db_session` fixture in this suite, and `asyncio_mode=auto` means no `@pytest.mark.asyncio` decorators.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/services/test_archimate_viewpoint_seed.py -v`
Expected: FAIL — `app.services.archimate.viewpoint_seed` does not exist.

- [ ] **Step 3: Write `backend/app/services/archimate/viewpoint_seed.py`**

Two module-level data structures built from the table above: `_VIEWPOINT_DEFS` (list of dicts: key, name, icon, layer, description, objects) and `_TAB_CARD_DEFS` (list of `(viewpoint_key, tab_key, card_type_key)` tuples). `description` is one sentence per viewpoint, paraphrased from this plan's own table/spec (not a placeholder — write real text, same register as `enterprise_object_seed.py`'s `ENTERPRISE_OBJECT_DESCRIPTIONS`).

`async def seed_viewpoints(db: AsyncSession) -> None` follows `seed_enterprise_objects`'s exact shape: query existing `ArchimateViewpoint.key`s, add only the missing ones (`ArchimateViewpoint` row + its `ArchimateViewpointObject` rows, reading `_VIEWPOINT_DEFS`'s `objects` list — for `"layered"` use `taxonomy.ALL_ELEMENT_TYPES` directly instead of a literal list, so a future new element type is automatically included). Then query existing `(viewpoint_key, tab_key, card_type_key)` triples in `ArchimateViewpointTabCard` and add only the missing ones from `_TAB_CARD_DEFS`, same insert-only idempotence as `seed_card_mappings`'s triple tracking (reuse `seed_markers`'s pattern, or a plain existing-rows check if `seed_markers` doesn't generalize cleanly — match whichever the implementer finds already supports a second marker namespace without duplicating code).

- [ ] **Step 4: Wire it into `seed_metamodel`**

In `backend/app/services/seed.py`, add `await seed_viewpoints(db)` next to the existing `await seed_enterprise_objects(db)` / `await seed_card_mappings(db)` calls, after both (it needs `EnterpriseObject` rows to exist for its FK, so it must run after `seed_enterprise_objects`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && pytest tests/services/test_archimate_viewpoint_seed.py -v`
Expected: PASS (4/4).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/archimate/viewpoint_seed.py backend/app/services/seed.py backend/tests/services/test_archimate_viewpoint_seed.py
git commit -m "feat(archimate): seed the 23 standard ArchiMate viewpoints"
```

---

## Task 3: Viewpoint Catalog CRUD API

**Files:**
- Modify: `backend/app/api/v1/metamodel.py` (add the Viewpoint Catalog section, mirroring the "Enterprise Objects" section's exact shape)
- Test: `backend/tests/api/test_archimate_viewpoints_api.py`

**Interfaces:**
- Consumes: `ArchimateViewpoint`, `ArchimateViewpointObject` (Task 1); `PermissionService.require_permission`, `audit_log.record` (existing, same as every other metamodel endpoint in this file)
- Produces (all under `/metamodel/viewpoints`, same prefix style as `/metamodel/enterprise-objects`):
  - `GET /metamodel/viewpoints?include_hidden=false` → list, each serialized as `{key, name, icon, description, layer, is_standard, is_hidden, sort_order, objects: [enterprise_object_key, ...]}` — no `admin.metamodel` gate (same reasoning as `list_enterprise_objects`: the diagram-creation picker calls this for any user who can create a diagram, not just admins)
  - `GET /metamodel/viewpoints/{key}` → same shape, 404 if missing
  - `POST /metamodel/viewpoints` (201, `admin.metamodel`) → create, always `is_standard=False`
  - `PATCH /metamodel/viewpoints/{key}` (`admin.metamodel`) → update `name`/`icon`/`description`/`layer`/`is_hidden`/`sort_order` (not `key`, not `is_standard`)
  - `POST /metamodel/viewpoints/{key}/objects` (201, `admin.metamodel`), body `{enterprise_object_key}` → add one allowed object, 409 on duplicate
  - `DELETE /metamodel/viewpoints/{key}/objects/{enterprise_object_key}` (204, `admin.metamodel`) → remove one
  - `DELETE /metamodel/viewpoints/{key}` (`admin.metamodel`) → 409 if any `Diagram.viewpoint_key == key` exists (query `func.count()`, no `force` param — see Global Constraints); if `is_standard`, soft-hide (`is_hidden = True`, same as `delete_relation_type`'s `built_in` branch); else hard delete

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/api/test_archimate_viewpoints_api.py
"""Integration tests for /api/v1/metamodel/viewpoints."""

from __future__ import annotations

from app.models.archimate_viewpoint import ArchimateViewpoint
from app.models.diagram import Diagram
from app.services import seed
from tests.conftest import auth_headers


async def test_list_viewpoints_returns_the_23_standard_ones(client, db, admin_user):
    await seed.seed_metamodel(db)
    resp = await client.get("/api/v1/metamodel/viewpoints", headers=auth_headers(admin_user))
    assert resp.status_code == 200
    assert len(resp.json()) == 23


async def test_create_custom_viewpoint(client, db, admin_user):
    resp = await client.post(
        "/api/v1/metamodel/viewpoints",
        json={"key": "custom-ops", "name": "Custom Ops", "layer": "business"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 201
    assert resp.json()["is_standard"] is False


async def test_add_and_remove_allowed_object(client, db, admin_user):
    headers = auth_headers(admin_user)
    await client.post(
        "/api/v1/metamodel/viewpoints",
        json={"key": "custom-ops", "name": "Custom Ops", "layer": "business"},
        headers=headers,
    )
    resp = await client.post(
        "/api/v1/metamodel/viewpoints/custom-ops/objects",
        json={"enterprise_object_key": "BusinessActor"},
        headers=headers,
    )
    assert resp.status_code == 201
    resp = await client.get("/api/v1/metamodel/viewpoints/custom-ops", headers=headers)
    assert resp.json()["objects"] == ["BusinessActor"]
    resp = await client.delete(
        "/api/v1/metamodel/viewpoints/custom-ops/objects/BusinessActor", headers=headers
    )
    assert resp.status_code == 204


async def test_standard_viewpoint_is_hidden_not_deleted(client, db, admin_user):
    await seed.seed_metamodel(db)
    headers = auth_headers(admin_user)
    resp = await client.delete("/api/v1/metamodel/viewpoints/organization", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "hidden"
    resp = await client.get("/api/v1/metamodel/viewpoints/organization", headers=headers)
    assert resp.json()["is_hidden"] is True


async def test_delete_blocked_when_a_diagram_uses_the_viewpoint(client, db, admin_user):
    headers = auth_headers(admin_user)
    await client.post(
        "/api/v1/metamodel/viewpoints",
        json={"key": "custom-ops", "name": "Custom Ops", "layer": "business"},
        headers=headers,
    )
    # Inserted directly, not through POST /diagrams: Diagram.viewpoint_key exists
    # from Task 1, but the create-diagram endpoint does not require/accept it
    # until Task 5. Exercising the guard only needs the column populated.
    db.add(Diagram(name="D1", kind="archimate", viewpoint_key="custom-ops", data={}))
    await db.commit()
    resp = await client.delete("/api/v1/metamodel/viewpoints/custom-ops", headers=headers)
    assert resp.status_code == 409
```

Match `client`/`db`/`admin_user`/`auth_headers(...)` exactly as `backend/tests/api/test_enterprise_objects_api.py` uses them — every write call carries `headers=auth_headers(admin_user)`, there is no separate pre-authenticated client fixture. `ArchimateViewpoint` is imported but may go unused by the final test set — the implementer may drop it if so (`ruff` will flag an unused import otherwise).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/api/test_archimate_viewpoints_api.py -v`
Expected: FAIL — 404s, routes don't exist yet.

- [ ] **Step 3: Implement the routes** in `backend/app/api/v1/metamodel.py`, following `list_enterprise_objects`/`create_enterprise_object`/`update_enterprise_object`/`add_card_mapping`/`remove_card_mapping`/`delete_relation_type` line for line for structure (serializer function, permission check placement, audit_log calls, HTTPException codes).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/api/test_archimate_viewpoints_api.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/metamodel.py backend/tests/api/test_archimate_viewpoints_api.py
git commit -m "feat(archimate): Viewpoint Catalog CRUD API"
```

---

## Task 4: Example upload, validation, and scoped-picker endpoints

**Files:**
- Modify: `backend/app/api/v1/metamodel.py` (examples sub-resource, under the same Viewpoint Catalog section)
- Modify: `backend/app/api/v1/diagrams.py` (two new read endpoints for the creation dashboard)
- Test: `backend/tests/api/test_archimate_viewpoint_examples_api.py`
- Test: `backend/tests/api/test_archimate_viewpoint_picker_api.py`

**Interfaces:**
- Consumes: `validate_exchange()` (`app/services/archimate/validate.py`), `convert_archi_native_to_exchange()` (`app/services/archimate/archi_native_import.py`), `ArchimateViewpointExample`/`ArchimateViewpointTabCard` (Task 1), `taxonomy.LAYERS` (existing)
- Produces:
  - `POST /metamodel/viewpoints/{key}/examples` (201, `admin.metamodel`), body `{name, xml}` → converts via `archi_native_import` first if `xml` is Archi-native (same sniff `archi_native_import._main`/`create_archimate_diagram` already uses — check for the `archimatetool.com` namespace vs. the Exchange XSD root), then `validate_exchange()`; on any validation issue, 422 with the validator's own issue list, nothing persisted
  - `DELETE /metamodel/viewpoints/{key}/examples/{example_id}` (204, `admin.metamodel`)
  - `GET /diagrams/viewpoints-for-tab?tab=business|application|technology` → every non-hidden `ArchimateViewpoint` whose allowed objects' `EnterpriseObject.layer` set intersects the tab's layer set (`business`: strategy+business+motivation; `application`: application; `technology`: technology+physical — same three groupings as the design doc's nav table), each with its `examples: [{id, name}]`
  - `GET /diagrams/viewpoints-for-tab/{viewpoint_key}/suggested-cards?tab=...` → `ArchimateViewpointTabCard` rows for that `(viewpoint_key, tab)` if any exist, else every `card_type_key` from `EnterpriseObjectCardMapping` for the viewpoint's allowed objects (the "no override needed for single-tab viewpoints" fallback from spec §5)

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/api/test_archimate_viewpoint_examples_api.py
"""Integration tests for /api/v1/metamodel/viewpoints/{key}/examples."""

from __future__ import annotations

from app.services import seed
from tests.conftest import auth_headers

VALID_EXCHANGE_XML = """<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       identifier="id-1"><name xml:lang="en">Example</name></model>"""


async def test_upload_valid_example(client, db, admin_user):
    await seed.seed_metamodel(db)
    resp = await client.post(
        "/api/v1/metamodel/viewpoints/organization/examples",
        json={"name": "Nested orgs", "xml": VALID_EXCHANGE_XML},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 201


async def test_upload_rejects_invalid_xml(client, db, admin_user):
    await seed.seed_metamodel(db)
    headers = auth_headers(admin_user)
    resp = await client.post(
        "/api/v1/metamodel/viewpoints/organization/examples",
        json={"name": "Broken", "xml": "<not-a-model/>"},
        headers=headers,
    )
    assert resp.status_code == 422
    resp2 = await client.get("/api/v1/metamodel/viewpoints/organization", headers=headers)
    assert resp2.json().get("examples", []) == []
```

```python
# backend/tests/api/test_archimate_viewpoint_picker_api.py
"""Integration tests for /api/v1/diagrams/viewpoints-for-tab."""

from __future__ import annotations

from app.services import seed
from tests.conftest import auth_headers


async def test_implementation_and_deployment_appears_in_both_application_and_technology(
    client, db, admin_user
):
    await seed.seed_metamodel(db)
    headers = auth_headers(admin_user)
    app_resp = await client.get("/api/v1/diagrams/viewpoints-for-tab?tab=application", headers=headers)
    tech_resp = await client.get("/api/v1/diagrams/viewpoints-for-tab?tab=technology", headers=headers)
    app_keys = {v["key"] for v in app_resp.json()}
    tech_keys = {v["key"] for v in tech_resp.json()}
    assert "implementation-and-deployment" in app_keys
    assert "implementation-and-deployment" in tech_keys


async def test_suggested_cards_use_the_tab_override(client, db, admin_user):
    await seed.seed_metamodel(db)
    resp = await client.get(
        "/api/v1/diagrams/viewpoints-for-tab/implementation-and-deployment/suggested-cards?tab=technology",
        headers=auth_headers(admin_user),
    )
    assert set(resp.json()) == {"ITComponent", "Platform"}
```

Match `client`/`db`/`admin_user`/`auth_headers(...)` exactly as `backend/tests/api/test_enterprise_objects_api.py` uses them — no `admin_client`/`seeded_db` fixture exists in this suite, no `@pytest.mark.asyncio` decorators (`asyncio_mode=auto`), every path carries the `/api/v1` prefix (the global mount in `backend/app/main.py`), and `seed.seed_metamodel(db)` is the real seeding call (see Task 3's tests) — not a `seeded_db` fixture.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/api/test_archimate_viewpoint_examples_api.py tests/api/test_archimate_viewpoint_picker_api.py -v`
Expected: FAIL — routes don't exist.

- [ ] **Step 3: Implement the examples sub-resource** in `metamodel.py`, reusing the same persist-or-422 pattern `validate_exchange()`'s existing callers use (see `diagrams.py`'s `ensure_valid_archimate`).

- [ ] **Step 4: Implement the two picker endpoints** in `diagrams.py`. The tab→layer-set mapping is a small module-level constant, e.g. `TAB_LAYERS = {"business": {"strategy", "business", "motivation"}, "application": {"application"}, "technology": {"technology", "physical"}}`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && pytest tests/api/test_archimate_viewpoint_examples_api.py tests/api/test_archimate_viewpoint_picker_api.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/metamodel.py backend/app/api/v1/diagrams.py backend/tests/api/test_archimate_viewpoint_examples_api.py backend/tests/api/test_archimate_viewpoint_picker_api.py
git commit -m "feat(archimate): viewpoint example upload and scoped-picker endpoints"
```

---

## Task 5: Require a viewpoint on every new ArchiMate diagram

**Files:**
- Modify: `backend/app/schemas/diagram.py` (or wherever `DiagramCreate` is defined — find it via `grep -rn "class DiagramCreate" backend/app`)
- Modify: `backend/app/api/v1/diagrams.py` (`create_diagram`)
- Test: `backend/tests/api/test_diagrams.py` (or the existing diagram-creation test file — add to it, don't create a new one if one already covers `create_diagram`)

**Interfaces:**
- Consumes: `Diagram.viewpoint_key` (Task 1), `ArchimateViewpoint` (Task 1)
- Produces: `DiagramCreate.viewpoint_key: str | None = None`; `create_diagram` raises `HTTPException(422, "viewpoint_key is required for archimate diagrams")` when `body.kind == "archimate" and not body.viewpoint_key`, and `HTTPException(404, "Viewpoint not found")` when the key doesn't resolve to a non-hidden `ArchimateViewpoint`

- [ ] **Step 1: Write the failing tests**

```python
from app.services import seed
from tests.conftest import auth_headers


async def test_archimate_diagram_without_viewpoint_is_rejected(client, db, admin_user):
    await seed.seed_metamodel(db)
    resp = await client.post(
        "/api/v1/diagrams",
        json={
            "name": "D1", "kind": "archimate",
            "data": {"format": "archimate-exchange-3.1", "xml": "<model/>"},
        },
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 422


async def test_drawio_diagram_does_not_need_a_viewpoint(client, db, admin_user):
    resp = await client.post(
        "/api/v1/diagrams",
        json={"name": "D1", "kind": "drawio"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 201


async def test_archimate_diagram_with_unknown_viewpoint_is_rejected(client, db, admin_user):
    await seed.seed_metamodel(db)
    resp = await client.post(
        "/api/v1/diagrams",
        json={
            "name": "D1", "kind": "archimate", "viewpoint_key": "nope",
            "data": {"format": "archimate-exchange-3.1", "xml": "<model/>"},
        },
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 404
```

Match `client`/`db`/`admin_user`/`auth_headers(...)` as `backend/tests/api/test_diagrams_archimate_kind.py` uses them (no bare `/diagrams` path — the global `/api/v1` mount applies here too), and reuse `seed.seed_metamodel(db)` where the test needs a resolvable `ArchimateViewpoint` row to exist or not. Add these as new test functions in the existing `backend/tests/api/test_diagrams.py` (or `test_diagrams_archimate_kind.py`, whichever already owns `create_diagram`'s tests — check both before adding a third file).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/api/test_diagrams.py tests/api/test_diagrams_archimate_kind.py -k viewpoint -v`
Expected: FAIL (`viewpoint_key` unknown field / no validation yet).

- [ ] **Step 3: Add the field and the two checks** in `create_diagram`, before the existing `check_kind_data`/`ensure_valid_archimate` calls.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/api/test_diagrams.py -k viewpoint -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/diagram.py backend/app/api/v1/diagrams.py backend/tests/api/test_diagrams.py
git commit -m "feat(archimate): require a viewpoint on every new archimate diagram"
```

---

## Task 6: Viewpoint Catalog admin UI

**Files:**
- Modify: `frontend/src/features/admin/metamodel/ArchitectureStudioTab.tsx` (re-add the `Tabs` shell, second sub-tab)
- Create: `frontend/src/features/admin/metamodel/ViewpointCatalogTabContent.tsx`
- Create: `frontend/src/features/admin/metamodel/ViewpointEditDialog.tsx`
- Create: `frontend/src/api/archimateViewpoints.ts`
- Test: `frontend/src/features/admin/metamodel/ViewpointCatalogTabContent.test.tsx`
- Modify: 10× `frontend/src/i18n/locales/{locale}/admin.json`

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /metamodel/viewpoints*` (Task 3), the tag-chip pattern already in `CardMappingTabContent.tsx`/`RelationsMappingTabContent.tsx` (read those two files for the exact `MenuItem`/chip/`+`-button markup to mirror)
- Produces: `frontend/src/api/archimateViewpoints.ts` exporting `listViewpoints`, `createViewpoint`, `updateViewpoint`, `deleteViewpoint`, `addViewpointObject`, `removeViewpointObject` — same shape as `frontend/src/api/enterpriseObjects.ts`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/features/admin/metamodel/ViewpointCatalogTabContent.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ViewpointCatalogTabContent from "./ViewpointCatalogTabContent";

vi.mock("@/api/client", () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
import { api } from "@/api/client";

describe("ViewpointCatalogTabContent", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue([
      { key: "organization", name: "Organization", icon: "account_tree", layer: "business",
        is_standard: true, is_hidden: false, objects: ["BusinessActor"] },
    ]);
  });

  it("lists viewpoints with their layer badge and object count", async () => {
    render(<ViewpointCatalogTabContent />);
    expect(await screen.findByText("Organization")).toBeInTheDocument();
    expect(screen.getByText("business")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/admin/metamodel/ViewpointCatalogTabContent.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `frontend/src/api/archimateViewpoints.ts`**, mirroring `enterpriseObjects.ts`'s functions one for one against the Task 3 endpoints.

- [ ] **Step 4: Write `ViewpointCatalogTabContent.tsx`**: table (icon, name, layer badge, standard/custom + hidden/active status, object count, actions), "+ New Viewpoint" opening `ViewpointEditDialog.tsx` (name, icon picker, layer select, description, and the tag-chip allowed-objects editor — copy the chip+`+`-button block from `CardMappingTabContent.tsx` and point it at `addViewpointObject`/`removeViewpointObject` instead).

- [ ] **Step 5: Re-add the `Tabs` shell** in `ArchitectureStudioTab.tsx`: first sub-tab "Card Mapping" (existing `CardMappingTabContent`), second "Viewpoint Catalog" (`ViewpointCatalogTabContent`). Relations Mapping stays unmounted.

- [ ] **Step 6: Add the i18n keys** (`metamodel.tabs.architectureStudioSub.viewpointCatalog`, `metamodel.viewpoints.*` for dialog labels) to all 10 `admin.json` locales.

- [ ] **Step 7: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/admin/metamodel/ViewpointCatalogTabContent.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/admin/metamodel/ArchitectureStudioTab.tsx frontend/src/features/admin/metamodel/ViewpointCatalogTabContent.tsx frontend/src/features/admin/metamodel/ViewpointEditDialog.tsx frontend/src/api/archimateViewpoints.ts frontend/src/features/admin/metamodel/ViewpointCatalogTabContent.test.tsx frontend/src/i18n/locales/*/admin.json
git commit -m "feat(archimate): Viewpoint Catalog admin UI"
```

---

## Task 7: Scoped diagram-creation dashboard

**Files:**
- Create: `frontend/src/features/diagrams/ArchimateViewpointPicker.tsx`
- Modify: `frontend/src/features/diagrams/CreateDiagramDialog.tsx` (archimate branch delegates to the new picker instead of going straight to create)
- Modify: `frontend/src/api/diagrams.ts` (add `viewpoint_key` to the create-diagram call; add `listViewpointsForTab`, `getSuggestedCards`)
- Test: `frontend/src/features/diagrams/ArchimateViewpointPicker.test.tsx`
- Modify: 10× `frontend/src/i18n/locales/{locale}/diagrams.json` (or wherever diagram-creation strings live — check `CreateDiagramDialog.tsx`'s existing `useTranslation` namespace)

**Interfaces:**
- Consumes: `GET /diagrams/viewpoints-for-tab` + `.../suggested-cards` (Task 4), `BpmnTemplateChooser.tsx`'s `CardActionArea` grid pattern (read it for the exact markup, do not reimplement from scratch)
- Produces: `ArchimateViewpointPicker` props `{ tab: "business" | "application" | "technology" | null; onSelect: (viewpointKey: string, startingXml: string | null, suggestedCardIds: string[]) => void }` — `tab: null` means the unscoped `Diagrams` entry point, fetches every viewpoint with no layer filter

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/features/diagrams/ArchimateViewpointPicker.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ArchimateViewpointPicker from "./ArchimateViewpointPicker";

vi.mock("@/api/client", () => ({ api: { get: vi.fn() } }));
import { api } from "@/api/client";

describe("ArchimateViewpointPicker", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes("viewpoints-for-tab?tab=application")) {
        return Promise.resolve([
          { key: "application-cooperation", name: "Application Cooperation", icon: "hub", examples: [] },
        ]);
      }
      return Promise.resolve([]);
    });
  });

  it("lists only the tab's viewpoints in the combo, then shows a blank card for the selected one", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ArchimateViewpointPicker tab="application" onSelect={onSelect} />);
    await user.click(await screen.findByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Application Cooperation" }));
    expect(await screen.findByText(/blank/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/diagrams/ArchimateViewpointPicker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `ArchimateViewpointPicker.tsx`**: a `Select` populated from `listViewpointsForTab(tab)`; once a viewpoint is chosen, a grid of `CardActionArea` cards — one "blank" (a hardcoded empty ArchiMate Exchange XML skeleton) plus one per `examples` entry — click calls `onSelect(viewpointKey, xmlOrNull, suggestedCardIds)` after fetching `getSuggestedCards(viewpointKey, tab)`.

- [ ] **Step 4: Wire it into `CreateDiagramDialog.tsx`**: when `kind === "archimate"`, render `ArchimateViewpointPicker` instead of the current immediate-create flow; `onSelect` populates the create-diagram call's `viewpoint_key`, `data.xml` (if a starting example was picked) and pre-selected `card_ids`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/diagrams/ArchimateViewpointPicker.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/diagrams/ArchimateViewpointPicker.tsx frontend/src/features/diagrams/CreateDiagramDialog.tsx frontend/src/api/diagrams.ts frontend/src/features/diagrams/ArchimateViewpointPicker.test.tsx frontend/src/i18n/locales/*/diagrams.json
git commit -m "feat(archimate): scoped viewpoint+example picker for new diagrams"
```

---

## Task 8: Nav reorganization and the three scoped entry points

**Files:**
- Modify: `frontend/src/layouts/navItems.ts`
- Modify: 10× `frontend/src/i18n/locales/{locale}/nav.json`
- Modify: `frontend/src/layouts/AppLayout.tsx` (only if the `strategy_process`/`app_data` child-filtering logic needs updating for the new children — read the existing `useMemo` block first; likely no change needed beyond the new labels/paths)
- Create: three thin route-level components (or reuse one parametrized component) that render `ArchimateViewpointPicker` with `tab="business"`/`"application"`/`"technology"` behind new routes `/business-architecture/diagram`, `/application-architecture/diagram`, `/technology-architecture/diagram`
- Test: `frontend/src/layouts/AppLayout.navItems.test.tsx` (or add to the existing `AppLayout.test.tsx`)

**Interfaces:**
- Consumes: `ArchimateViewpointPicker` (Task 7)
- Produces: the three new/renamed nav labels and the three new routes

- [ ] **Step 1: Write the failing test**

```tsx
it("renames strategy_process to Business Architecture with Business Diagram as its third child", () => {
  // render AppLayout (or just NAV_ITEM_DEFS, whichever the existing nav tests already assert against), find the item
  // whose labelKey is "strategy_process", assert its children's labelKeys are
  // ["valueChain", "bpm", "businessDiagram"] in that order.
});

it("adds a new top-level Technology Architecture item with a Technology Diagram child", () => {
  // assert NAV_ITEM_DEFS has a labelKey "technologyArchitecture" with a child labelKey "technologyDiagram"
});
```

Match whatever assertion style `frontend/src/layouts/AppLayout.test.tsx` already uses against `NAV_ITEM_DEFS`/rendered nav items — read it first rather than guessing the query pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/layouts/AppLayout.test.tsx -k "Architecture"`
Expected: FAIL.

- [ ] **Step 3: Edit `navItems.ts`**: change `strategy_process`'s children order to `[valueChain, bpm, businessDiagram]` (swap bpm/valueChain, append the new child); change `app_data`'s children to `[swotAnalysis, whatIfAnalysis, dataFlow, applicationDiagram]` (all four are plain route links — `swotAnalysis`/`whatIfAnalysis`/`dataFlow` point at a placeholder route that renders "coming soon", per the spec's explicit placeholder-only scope); add a new top-level `technologyArchitecture` item with one child `technologyDiagram`. Do **not** touch the existing top-level `diagrams` item.

- [ ] **Step 4: Add the three diagram-entry route components and routes**, each a one-line wrapper rendering `ArchimateViewpointPicker` with its fixed `tab` prop, wired through to `CreateDiagramDialog`'s flow from Task 7.

- [ ] **Step 5: Add the placeholder route/page for SWOT Analysis, What-if Analysis, Data Flow** — a single reusable `ComingSoonPage` component ("not available yet"), per the spec's explicit scope cut.

- [ ] **Step 6: Add the new nav i18n keys** to all 10 `nav.json` locales — `strategy_process`'s own label keeps the Italian/every-locale translation of "Business Architecture", `app_data` becomes "Application & Data Architecture", plus the four new labels.

- [ ] **Step 7: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/layouts/AppLayout.test.tsx -k "Architecture"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/layouts/navItems.ts frontend/src/layouts/AppLayout.tsx frontend/src/i18n/locales/*/nav.json frontend/src/features/diagrams frontend/src/features/*/ComingSoonPage.tsx frontend/src/layouts/AppLayout.test.tsx
git commit -m "feat(archimate): rename nav to Business/Application&Data/Technology Architecture, add scoped diagram entries"
```

---

## Task 9: Designer palette restriction

**Files:**
- Modify: the ArchiMate diagram-js palette module (locate it via `grep -rln "diagram-js" frontend/src/features/diagrams` — this plan does not know its exact current filename; read whichever file registers the element palette before editing it)
- Test: add to that module's existing test file

**Interfaces:**
- Consumes: the open diagram's `viewpoint_key` (already loaded with the diagram, Task 5) and `GET /metamodel/viewpoints/{key}` (Task 3) for its `objects` list
- Produces: when the open diagram has a non-null `viewpoint_key`, the palette renders only entries whose Enterprise Object key is in that viewpoint's `objects`; when `viewpoint_key` is null (any `archimate` diagram created before this feature — see Review Focus), the palette is unfiltered, unchanged from today

- [ ] **Step 1: Write the failing test** — exact assertion depends on the palette module's existing test conventions (read it first: does it render the whole editor, or test a pure "which entries are visible" function?). At minimum: given a diagram with `viewpoint_key="organization"`, the palette must include `BusinessActor` and must not include `ApplicationComponent`; given `viewpoint_key=null`, both are present.

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL (no filtering exists yet).

- [ ] **Step 3: Add the filter**, fetching the viewpoint's `objects` once per diagram load (not per palette render) and intersecting against the palette's existing full entry list.

- [ ] **Step 4: Run test to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add <the palette module and its test>
git commit -m "feat(archimate): restrict the designer palette to the diagram's viewpoint"
```

---

## What's left to the builder

- The actual 23 example `.archimate` diagrams (content, not code) — tracked separately per the spec, outside this plan's scope. `seed_viewpoints` (Task 2) seeds zero examples; admins upload them later through Task 6's UI, or a follow-up data-only PR calls `POST /metamodel/viewpoints/{key}/examples` directly.
- The exact `description` sentence per viewpoint in Task 2's `_VIEWPOINT_DEFS` — write real text; this plan gives the data an implementer needs to look up (name/layer/objects), not prose to copy verbatim.
- Task 9's exact file path, left open because this plan was not able to confirm the diagram-js palette module's current name without reading the frontend's diagram-editor tree directly — the implementer resolves this in Step 1 of that task, not by guessing.
