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
    assert r.status_code == 422 and "Nope" in r.json()["detail"]


async def test_relation_mapping_rejects_unknown_relationship_and_access(client, env):
    h = auth_headers(env["admin"])
    r = await client.patch(
        "/api/v1/metamodel/relation-types/relAppToITC", json={"archimate_type": "Wibble"}, headers=h
    )
    assert r.status_code == 422 and "Wibble" in r.json()["detail"]
    r = await client.patch(
        "/api/v1/metamodel/relation-types/relAppToDataObj",
        json={"archimate_access": "Maybe"},
        headers=h,
    )
    assert r.status_code == 422 and "Maybe" in r.json()["detail"]
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
    assert r.status_code == 422 and "yes" in r.json()["detail"]


async def test_viewer_cannot_remap(client, env):
    r = await client.patch(
        "/api/v1/metamodel/types/Application",
        json={"archimate_type": "Node"},
        headers=auth_headers(env["viewer"]),
    )
    assert r.status_code == 403


@pytest.mark.parametrize("bad", [["x"], {}, 5, True])
async def test_non_string_names_are_422_not_500(client, env, bad):
    h = auth_headers(env["admin"])
    r = await client.patch(
        "/api/v1/metamodel/types/Application", json={"archimate_type": bad}, headers=h
    )
    assert r.status_code == 422 and repr(bad) in r.json()["detail"]
    r = await client.patch(
        "/api/v1/metamodel/types/ITComponent",
        json={"subtypes": [{"key": "x", "archimate_type": bad}]},
        headers=h,
    )
    assert r.status_code == 422
    r = await client.patch(
        "/api/v1/metamodel/relation-types/relAppToITC", json={"archimate_type": bad}, headers=h
    )
    assert r.status_code == 422 and repr(bad) in r.json()["detail"]
    r = await client.patch(
        "/api/v1/metamodel/relation-types/relAppToDataObj",
        json={"archimate_access": bad},
        headers=h,
    )
    assert r.status_code == 422


async def test_access_crud_is_accepted(client, env):
    r = await client.patch(
        "/api/v1/metamodel/relation-types/relAppToDataObj",
        json={"archimate_access": "crud"},
        headers=auth_headers(env["admin"]),
    )
    assert r.status_code == 200 and r.json()["archimate_access"] == "crud"


async def test_reversed_flag_persists(client, env):
    h = auth_headers(env["admin"])
    url = "/api/v1/metamodel/relation-types/relAppToITC"
    for flag in (False, True):
        r = await client.patch(url, json={"archimate_reversed": flag}, headers=h)
        assert r.status_code == 200 and r.json()["archimate_reversed"] is flag
        got = (await client.get(url, headers=h)).json()
        assert got["archimate_reversed"] is flag


async def test_relation_type_can_be_remapped_and_cleared(client, env):
    h = auth_headers(env["admin"])
    url = "/api/v1/metamodel/relation-types/relAppToITC"
    r = await client.patch(url, json={"archimate_type": "Realization"}, headers=h)
    assert r.status_code == 200 and r.json()["archimate_type"] == "Realization"
    r = await client.patch(url, json={"archimate_type": None}, headers=h)
    assert r.status_code == 200 and r.json()["archimate_type"] is None


async def test_create_type_validates_and_stores_mapping(client, env):
    h = auth_headers(env["admin"])
    base = {"key": "NewT", "label": "New T"}
    r = await client.post(
        "/api/v1/metamodel/types", json={**base, "archimate_type": "Banana"}, headers=h
    )
    assert r.status_code == 422 and "Banana" in r.json()["detail"]
    r = await client.post(
        "/api/v1/metamodel/types",
        json={**base, "subtypes": [{"key": "s", "label": "S", "archimate_type": "Nope"}]},
        headers=h,
    )
    assert r.status_code == 422 and "Nope" in r.json()["detail"]
    r = await client.post(
        "/api/v1/metamodel/types", json={**base, "archimate_type": "Node"}, headers=h
    )
    assert r.status_code == 201 and r.json()["archimate_type"] == "Node"


async def test_create_relation_type_validates_and_stores_mapping(client, env):
    h = auth_headers(env["admin"])
    base = {
        "key": "relNew",
        "label": "uses",
        "source_type_key": "Application",
        "target_type_key": "ITComponent",
    }
    url = "/api/v1/metamodel/relation-types"
    r = await client.post(url, json={**base, "archimate_type": "Wibble"}, headers=h)
    assert r.status_code == 422 and "Wibble" in r.json()["detail"]
    r = await client.post(
        url, json={**base, "archimate_type": "Serving", "archimate_reversed": True}, headers=h
    )
    assert r.status_code == 201
    assert (r.json()["archimate_type"], r.json()["archimate_reversed"]) == ("Serving", True)
