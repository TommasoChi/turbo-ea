"""Integration tests for GET /metamodel/enterprise-objects.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

from sqlalchemy import select

from app.models.enterprise_object import EnterpriseObject, EnterpriseObjectCardMapping
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


async def test_create_custom_enterprise_object(client, db, admin_user):
    resp = await client.post(
        "/api/v1/metamodel/enterprise-objects",
        json={"key": "AIModel", "name": "AI Model", "layer": "application", "icon": "smart_toy"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["is_standard"] is False
    assert body["is_locked"] is False
    assert body["key"] == "AIModel"
    assert body["layer"] == "application"
    assert body["icon"] == "smart_toy"

    result = await db.execute(select(EnterpriseObject).where(EnterpriseObject.key == "AIModel"))
    row = result.scalar_one()
    assert row.is_standard is False
    assert row.is_locked is False


async def test_create_rejects_duplicate_custom_key(client, db, admin_user):
    resp = await client.post(
        "/api/v1/metamodel/enterprise-objects",
        json={"key": "AIModel", "name": "AI Model", "layer": "application"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 201

    resp = await client.post(
        "/api/v1/metamodel/enterprise-objects",
        json={"key": "AIModel", "name": "Different name", "layer": "application"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 409


async def test_create_rejects_key_colliding_with_standard_type(client, db, admin_user):
    """BusinessObject is a standard ArchiMate element type (taxonomy.py) —
    even if no EnterpriseObject row for it exists yet (no seed run here),
    a custom object must not be allowed to claim that key."""
    resp = await client.post(
        "/api/v1/metamodel/enterprise-objects",
        json={"key": "BusinessObject", "name": "Shadow", "layer": "business"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 409


async def test_create_rejects_key_colliding_with_other_section_type(client, db, admin_user):
    """Grouping/Location/AndJunction/OrJunction are standard too, even though
    they carry no layer — same collision rule applies."""
    resp = await client.post(
        "/api/v1/metamodel/enterprise-objects",
        json={"key": "Grouping", "name": "Shadow Grouping"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 409


async def test_patch_updates_description_and_visibility(client, db, admin_user):
    await seed.seed_metamodel(db)

    resp = await client.patch(
        "/api/v1/metamodel/enterprise-objects/BusinessObject",
        json={"description": "A thing a business cares about.", "is_hidden": True},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["is_hidden"] is True
    assert body["description"] == "A thing a business cares about."

    result = await db.execute(
        select(EnterpriseObject).where(EnterpriseObject.key == "BusinessObject")
    )
    row = result.scalar_one()
    assert row.is_hidden is True
    assert row.description == "A thing a business cares about."


async def test_patch_rejects_edits_on_locked_object(client, db, admin_user):
    await seed.seed_metamodel(db)

    result = await db.execute(select(EnterpriseObject).where(EnterpriseObject.key == "Grouping"))
    row = result.scalar_one()
    assert row.is_locked is True
    original_hidden = row.is_hidden

    resp = await client.patch(
        "/api/v1/metamodel/enterprise-objects/Grouping",
        json={"is_hidden": not original_hidden},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 422

    await db.refresh(row)
    assert row.is_hidden == original_hidden


async def test_patch_rejects_key_change(client, db, admin_user):
    await seed.seed_metamodel(db)

    resp = await client.patch(
        "/api/v1/metamodel/enterprise-objects/BusinessObject",
        json={"key": "NotBusinessObject", "description": "renamed attempt"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 200

    result = await db.execute(
        select(EnterpriseObject).where(EnterpriseObject.key == "BusinessObject")
    )
    row = result.scalar_one()
    assert row.description == "renamed attempt"

    none_result = await db.execute(
        select(EnterpriseObject).where(EnterpriseObject.key == "NotBusinessObject")
    )
    assert none_result.scalar_one_or_none() is None


async def test_patch_missing_object_returns_404(client, db, admin_user):
    resp = await client.patch(
        "/api/v1/metamodel/enterprise-objects/DoesNotExist",
        json={"description": "x"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 404


async def test_add_card_mapping_row(client, db, admin_user):
    await seed.seed_metamodel(db)

    resp = await client.post(
        "/api/v1/metamodel/enterprise-objects/DataObject/card-mappings",
        json={"card_type_key": "ITComponent", "card_subtype_key": "software"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["enterprise_object_key"] == "DataObject"
    assert body["card_type_key"] == "ITComponent"
    assert body["card_subtype_key"] == "software"
    assert "id" in body

    result = await db.execute(
        select(EnterpriseObjectCardMapping).where(
            EnterpriseObjectCardMapping.enterprise_object_key == "DataObject",
            EnterpriseObjectCardMapping.card_type_key == "ITComponent",
            EnterpriseObjectCardMapping.card_subtype_key == "software",
        )
    )
    assert result.scalar_one_or_none() is not None


async def test_add_card_mapping_rejects_unknown_enterprise_object(client, db, admin_user):
    await seed.seed_metamodel(db)

    resp = await client.post(
        "/api/v1/metamodel/enterprise-objects/DoesNotExist/card-mappings",
        json={"card_type_key": "ITComponent"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 404


async def test_add_card_mapping_rejects_unknown_card_type(client, db, admin_user):
    await seed.seed_metamodel(db)

    resp = await client.post(
        "/api/v1/metamodel/enterprise-objects/DataObject/card-mappings",
        json={"card_type_key": "NotACardType"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 400


async def test_add_duplicate_card_mapping_row_is_rejected(client, db, admin_user):
    await seed.seed_metamodel(db)

    resp = await client.post(
        "/api/v1/metamodel/enterprise-objects/DataObject/card-mappings",
        json={"card_type_key": "ITComponent", "card_subtype_key": "software"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 201

    resp = await client.post(
        "/api/v1/metamodel/enterprise-objects/DataObject/card-mappings",
        json={"card_type_key": "ITComponent", "card_subtype_key": "software"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 409


async def test_add_duplicate_card_mapping_row_with_null_subtype_is_rejected(client, db, admin_user):
    """``postgresql_nulls_not_distinct=True`` means two NULL-subtype rows for
    the same (enterprise object, card type) collide too, not just literal
    duplicates."""
    await seed.seed_metamodel(db)

    resp = await client.post(
        "/api/v1/metamodel/enterprise-objects/DataObject/card-mappings",
        json={"card_type_key": "ITComponent"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 201

    resp = await client.post(
        "/api/v1/metamodel/enterprise-objects/DataObject/card-mappings",
        json={"card_type_key": "ITComponent"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 409


async def test_remove_card_mapping_row(client, db, admin_user):
    await seed.seed_metamodel(db)

    created = await client.post(
        "/api/v1/metamodel/enterprise-objects/DataObject/card-mappings",
        json={"card_type_key": "ITComponent", "card_subtype_key": "software"},
        headers=auth_headers(admin_user),
    )
    assert created.status_code == 201
    mapping_id = created.json()["id"]

    resp = await client.delete(
        f"/api/v1/metamodel/enterprise-objects/DataObject/card-mappings/{mapping_id}",
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 204

    result = await db.execute(
        select(EnterpriseObjectCardMapping).where(EnterpriseObjectCardMapping.id == mapping_id)
    )
    assert result.scalar_one_or_none() is None


async def test_remove_card_mapping_row_missing_id_returns_404(client, db, admin_user):
    await seed.seed_metamodel(db)

    resp = await client.delete(
        "/api/v1/metamodel/enterprise-objects/DataObject/card-mappings/"
        "00000000-0000-0000-0000-000000000000",
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 404


async def test_remove_card_mapping_row_wrong_enterprise_object_returns_404(client, db, admin_user):
    """A mapping id that belongs to a different enterprise object than the one
    in the URL must not be deletable via that other object's path."""
    await seed.seed_metamodel(db)

    created = await client.post(
        "/api/v1/metamodel/enterprise-objects/DataObject/card-mappings",
        json={"card_type_key": "ITComponent", "card_subtype_key": "software"},
        headers=auth_headers(admin_user),
    )
    assert created.status_code == 201
    mapping_id = created.json()["id"]

    resp = await client.delete(
        f"/api/v1/metamodel/enterprise-objects/BusinessObject/card-mappings/{mapping_id}",
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 404

    result = await db.execute(
        select(EnterpriseObjectCardMapping).where(EnterpriseObjectCardMapping.id == mapping_id)
    )
    assert result.scalar_one_or_none() is not None
