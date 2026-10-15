"""The metamodel API exposes and validates the ArchiMate mapping."""

from __future__ import annotations

import pytest

from tests.conftest import auth_headers, create_user


@pytest.fixture
async def env(db):
    from app.services import seed

    # seeds the admin/viewer roles too
    await seed.seed_metamodel(db)
    return {
        "admin": await create_user(db, email="a@t.com", role="admin"),
        "viewer": await create_user(db, email="v@t.com", role="viewer"),
    }


async def test_types_expose_the_mapping(client, env):
    types = (
        await client.get("/api/v1/metamodel/types", headers=auth_headers(env["viewer"]))
    ).json()
    app = next(t for t in types if t["key"] == "Application")
    assert app["archimate_type"] == "ApplicationComponent"
    itc = next(t for t in types if t["key"] == "ITComponent")
    assert {s["key"]: s.get("archimate_type") for s in itc["subtypes"]}["hardware"] == "Device"


async def test_relation_types_expose_direction_and_access(client, env):
    rts = (
        await client.get("/api/v1/metamodel/relation-types", headers=auth_headers(env["viewer"]))
    ).json()
    uses = next(r for r in rts if r["key"] == "relAppToITC")
    assert (uses["archimate_type"], uses["archimate_reversed"], uses["archimate_access"]) == (
        "Serving",
        True,
        None,
    )
    crud = next(r for r in rts if r["key"] == "relAppToDataObj")
    assert (crud["archimate_type"], crud["archimate_access"]) == ("Access", "crud")


async def test_admin_can_remap_a_card_type(client, env):
    h = auth_headers(env["admin"])
    r = await client.patch(
        "/api/v1/metamodel/types/Application",
        json={"archimate_type": "ApplicationCollaboration"},
        headers=h,
    )
    assert r.status_code == 200
    assert r.json()["archimate_type"] == "ApplicationCollaboration"


async def test_unknown_element_type_is_rejected(client, env):
    r = await client.patch(
        "/api/v1/metamodel/types/Application",
        json={"archimate_type": "Banana"},
        headers=auth_headers(env["admin"]),
    )
    assert r.status_code == 422 and "Banana" in r.json()["detail"]


async def test_null_clears_the_mapping(client, env):
    h = auth_headers(env["admin"])
    r = await client.patch(
        "/api/v1/metamodel/types/Application", json={"archimate_type": None}, headers=h
    )
    assert r.status_code == 200 and r.json()["archimate_type"] is None


async def test_subtype_mapping_is_validated_and_kept(client, env):
    h = auth_headers(env["admin"])
    types = (await client.get("/api/v1/metamodel/types", headers=h)).json()
    itc = next(t for t in types if t["key"] == "ITComponent")
    subs = [
        {**s, "archimate_type": "Artifact"} if s["key"] == "software" else s
        for s in itc["subtypes"]
    ]
    ok = await client.patch(
        "/api/v1/metamodel/types/ITComponent", json={"subtypes": subs}, headers=h
    )
    assert ok.status_code == 200
    assert {s["key"]: s.get("archimate_type") for s in ok.json()["subtypes"]}["software"] == (
        "Artifact"
    )
    bad = [
        {**s, "archimate_type": "Nope"} if s["key"] == "software" else s for s in itc["subtypes"]
    ]
    r = await client.patch("/api/v1/metamodel/types/ITComponent", json={"subtypes": bad}, headers=h)
    assert r.status_code == 422


async def test_relation_mapping_rejects_unknown_relationship_and_access(client, env):
    h = auth_headers(env["admin"])
    r = await client.patch(
        "/api/v1/metamodel/relation-types/relAppToITC", json={"archimate_type": "Wibble"}, headers=h
    )
    assert r.status_code == 422
    r = await client.patch(
        "/api/v1/metamodel/relation-types/relAppToDataObj",
        json={"archimate_access": "Maybe"},
        headers=h,
    )
    assert r.status_code == 422
    r = await client.patch(
        "/api/v1/metamodel/relation-types/relAppToDataObj",
        json={"archimate_access": "ReadWrite"},
        headers=h,
    )
    assert r.status_code == 200 and r.json()["archimate_access"] == "ReadWrite"


async def test_relation_reversed_must_be_bool(client, env):
    r = await client.patch(
        "/api/v1/metamodel/relation-types/relAppToITC",
        json={"archimate_reversed": "yes"},
        headers=auth_headers(env["admin"]),
    )
    assert r.status_code == 422


async def test_viewer_cannot_remap(client, env):
    r = await client.patch(
        "/api/v1/metamodel/types/Application",
        json={"archimate_type": "Node"},
        headers=auth_headers(env["viewer"]),
    )
    assert r.status_code == 403
