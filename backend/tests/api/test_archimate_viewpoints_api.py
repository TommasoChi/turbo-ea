"""Integration tests for /api/v1/metamodel/viewpoints."""

from __future__ import annotations

from sqlalchemy import select

from app.models.archimate_viewpoint import ArchimateViewpointObject
from app.models.diagram import Diagram
from app.services import seed
from tests.conftest import auth_headers


async def test_list_viewpoints_returns_the_27_standard_ones(client, db, admin_user):
    await seed.seed_metamodel(db)
    resp = await client.get("/api/v1/metamodel/viewpoints", headers=auth_headers(admin_user))
    assert resp.status_code == 200
    assert len(resp.json()) == 27


async def test_create_custom_viewpoint(client, db, admin_user):
    resp = await client.post(
        "/api/v1/metamodel/viewpoints",
        json={"key": "custom-ops", "name": "Custom Ops", "layer": "business"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 201
    assert resp.json()["is_standard"] is False
    # Not given at creation: starts untagged, same as having no allowed objects yet.
    assert resp.json()["domains"] == []


async def test_create_custom_viewpoint_with_domains(client, db, admin_user):
    resp = await client.post(
        "/api/v1/metamodel/viewpoints",
        json={
            "key": "custom-ops",
            "name": "Custom Ops",
            "layer": "business",
            "domains": ["application", "business"],
        },
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 201
    assert resp.json()["domains"] == ["business", "application"]


async def test_domains_are_seeded_from_the_allowed_objects_layers(client, db, admin_user):
    """``domains`` is seeded once (``viewpoint_seed.py``, same TAB_LAYERS grouping as
    ``diagrams.py``'s picker/permission gate) from the allowed objects' own
    `EnterpriseObject.layer`, so a viewpoint spanning only business-layer objects
    starts at exactly ["business"], and one spanning several layers' worth of tabs
    starts with all of them, in business/application/technology order. It is then
    a stored, independently editable field (see the PATCH test below), not
    recomputed on every read."""
    await seed.seed_metamodel(db)
    headers = auth_headers(admin_user)
    resp = await client.get("/api/v1/metamodel/viewpoints/organization", headers=headers)
    assert resp.json()["domains"] == ["business"]
    resp = await client.get("/api/v1/metamodel/viewpoints/technology", headers=headers)
    assert resp.json()["domains"] == ["technology"]
    # The Layered Viewpoint spans every layer, so every tab.
    resp = await client.get("/api/v1/metamodel/viewpoints/layered", headers=headers)
    assert resp.json()["domains"] == ["business", "application", "technology"]

    # The list endpoint reads the same stored field, in bulk.
    resp = await client.get("/api/v1/metamodel/viewpoints", headers=headers)
    by_key = {v["key"]: v["domains"] for v in resp.json()}
    assert by_key["organization"] == ["business"]
    assert by_key["layered"] == ["business", "application", "technology"]


async def test_domains_are_editable_independently_of_the_allowed_objects(client, db, admin_user):
    """An admin may retag a viewpoint's domains to anything other than its seeded value --
    it never snaps back to a recomputed one. Unknown domains and a non-list are rejected;
    duplicates are folded and the stored order is always business/application/technology."""
    await seed.seed_metamodel(db)
    headers = auth_headers(admin_user)
    resp = await client.patch(
        "/api/v1/metamodel/viewpoints/organization",
        json={"domains": ["technology", "business", "business"]},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["domains"] == ["business", "technology"]

    resp = await client.get("/api/v1/metamodel/viewpoints/organization", headers=headers)
    assert resp.json()["domains"] == ["business", "technology"]  # stuck, not re-derived

    resp = await client.patch(
        "/api/v1/metamodel/viewpoints/organization",
        json={"domains": ["strategy"]},
        headers=headers,
    )
    assert resp.status_code == 422

    resp = await client.patch(
        "/api/v1/metamodel/viewpoints/organization",
        json={"domains": "business"},
        headers=headers,
    )
    assert resp.status_code == 422


async def test_add_and_remove_allowed_object(client, db, admin_user):
    # BusinessActor is a standard Enterprise Object row; archimate_viewpoint_objects
    # has a real FK to enterprise_objects.key, so it must exist before it can be
    # allowed on a viewpoint.
    await seed.seed_metamodel(db)
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


async def test_delete_custom_viewpoint_with_allowed_objects(client, db, admin_user):
    await seed.seed_metamodel(db)
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
    resp = await client.delete("/api/v1/metamodel/viewpoints/custom-ops", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "deleted"
    rows = await db.execute(
        select(ArchimateViewpointObject).where(
            ArchimateViewpointObject.viewpoint_key == "custom-ops"
        )
    )
    assert rows.scalars().all() == []


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


async def test_object_list_edits_never_touch_diagram_data(client, db, admin_user):
    """Plan Review Focus regression: editing a Viewpoint's allowed-objects list
    after diagrams already exist against it must not touch those diagrams'
    already-placed elements. The add/remove-object endpoints only touch the
    ArchimateViewpointObject bridge table, never Diagram.data."""
    # BusinessActor is a standard Enterprise Object row; archimate_viewpoint_objects
    # has a real FK to enterprise_objects.key, so it must exist before it can be
    # allowed on a viewpoint.
    await seed.seed_metamodel(db)
    headers = auth_headers(admin_user)
    await client.post(
        "/api/v1/metamodel/viewpoints",
        json={"key": "custom-ops", "name": "Custom Ops", "layer": "business"},
        headers=headers,
    )
    diagram_data = {
        "nodes": [{"id": "n1", "type": "BusinessActor", "x": 10, "y": 20}],
        "edges": [],
    }
    diagram = Diagram(name="D1", kind="archimate", viewpoint_key="custom-ops", data=diagram_data)
    db.add(diagram)
    await db.commit()
    await db.refresh(diagram)
    diagram_id = diagram.id

    resp = await client.post(
        "/api/v1/metamodel/viewpoints/custom-ops/objects",
        json={"enterprise_object_key": "BusinessActor"},
        headers=headers,
    )
    assert resp.status_code == 201
    resp = await client.delete(
        "/api/v1/metamodel/viewpoints/custom-ops/objects/BusinessActor", headers=headers
    )
    assert resp.status_code == 204

    # Column-only select bypasses the session identity map (`diagram` is still
    # cached from the `db.add`/`refresh` above with `expire_on_commit=False`),
    # so this is a real read of what the endpoints wrote, not the cached object.
    result = await db.execute(select(Diagram.data).where(Diagram.id == diagram_id))
    assert result.scalar_one() == diagram_data
