"""Integration tests for GET /metamodel/enterprise-objects.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

from sqlalchemy import select

from app.models.enterprise_object import EnterpriseObject
from app.services import seed
from tests.conftest import auth_headers


async def test_list_enterprise_objects_includes_card_mappings(client, db, admin_user):
    await seed.seed_metamodel(db)

    resp = await client.get(
        "/api/v1/metamodel/enterprise-objects",
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 200
    business_object = next(o for o in resp.json() if o["key"] == "BusinessObject")
    assert any(m["card_type_key"] == "DataObject" for m in business_object["card_mappings"])
    mapping = next(
        m for m in business_object["card_mappings"] if m["card_type_key"] == "DataObject"
    )
    assert mapping["enterprise_object_key"] == "BusinessObject"
    assert "id" in mapping
    assert "card_subtype_key" in mapping


async def test_list_enterprise_objects_excludes_hidden_by_default(client, db, admin_user):
    await seed.seed_metamodel(db)

    result = await db.execute(
        select(EnterpriseObject).where(EnterpriseObject.key == "BusinessActor")
    )
    actor = result.scalar_one()
    actor.is_hidden = True
    await db.flush()

    resp = await client.get(
        "/api/v1/metamodel/enterprise-objects",
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 200
    keys = [o["key"] for o in resp.json()]
    assert "BusinessActor" not in keys

    resp = await client.get(
        "/api/v1/metamodel/enterprise-objects?include_hidden=true",
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 200
    keys = [o["key"] for o in resp.json()]
    assert "BusinessActor" in keys


async def test_list_enterprise_objects_accessible_to_non_admin(client, db, viewer_user):
    """The drawing palette calls this for any user who can edit a diagram,
    not just admins — so a viewer-role user must get 200, not 403."""
    await seed.seed_metamodel(db)

    resp = await client.get(
        "/api/v1/metamodel/enterprise-objects",
        headers=auth_headers(viewer_user),
    )
    assert resp.status_code == 200
