"""Integration tests for /api/v1/metamodel/viewpoints."""

from __future__ import annotations

from sqlalchemy import select

from app.models.archimate_viewpoint import ArchimateViewpointObject
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
