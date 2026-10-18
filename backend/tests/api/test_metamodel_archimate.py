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


async def test_patch_archimate_type_on_card_type_is_silently_ignored(client, env):
    """Bug 3 fix: the EnterpriseObjectCardMapping bridge table is the real
    source of truth for card-type mapping now -- CardType.archimate_type
    stays in the model/GET response (plan's Global Constraints: a later
    cleanup, not this one) but a PATCH value is no longer read at all, so
    the seeded value survives unchanged rather than being replaced."""
    h = auth_headers(env["admin"])
    r = await client.patch(
        "/api/v1/metamodel/types/Application",
        json={"archimate_type": "ApplicationCollaboration"},
        headers=h,
    )
    assert r.status_code == 200
    assert r.json()["archimate_type"] == "ApplicationComponent"  # unchanged seeded value


async def test_invalid_archimate_type_on_card_type_is_silently_ignored_not_rejected(client, env):
    """Renamed from test_unknown_element_type_is_rejected: since the write is
    now silently ignored rather than validated, an invalid value no longer
    causes a 422 on the card-type path (still does on the relation-type
    path -- see test_relation_mapping_rejects_unknown_relationship_and_access,
    unchanged)."""
    r = await client.patch(
        "/api/v1/metamodel/types/Application",
        json={"archimate_type": "Banana"},
        headers=auth_headers(env["admin"]),
    )
    assert r.status_code == 200
    assert r.json()["archimate_type"] == "ApplicationComponent"  # unchanged seeded value


async def test_null_archimate_type_on_card_type_does_not_clear_the_mapping(client, env):
    """Renamed from test_null_clears_the_mapping: a PATCH value -- including
    an explicit null -- is no longer read, so it can no longer clear the
    seeded mapping either."""
    h = auth_headers(env["admin"])
    r = await client.patch(
        "/api/v1/metamodel/types/Application", json={"archimate_type": None}, headers=h
    )
    assert r.status_code == 200
    assert r.json()["archimate_type"] == "ApplicationComponent"  # unchanged seeded value


async def test_subtype_archimate_type_on_patch_is_silently_ignored(client, env):
    """Renamed from test_subtype_mapping_is_validated_and_kept: subtypes[].
    archimate_type is stripped from every submitted subtype dict
    (_strip_subtype_archimate_type) before the subtypes list is stored --
    not validated, not kept at its old value either, simply absent from
    whatever gets persisted. (Confirmed as having no functional impact in
    the review that requested this test update: nothing reads the stored
    subtypes[].archimate_type any more.)"""
    h = auth_headers(env["admin"])
    types = (await client.get("/api/v1/metamodel/types", headers=h)).json()
    itc = next(t for t in types if t["key"] == "ITComponent")
    assert {s["key"]: s.get("archimate_type") for s in itc["subtypes"]}["software"] == (
        "SystemSoftware"
    )

    subs = [
        {**s, "archimate_type": "Artifact"} if s["key"] == "software" else s
        for s in itc["subtypes"]
    ]
    ok = await client.patch(
        "/api/v1/metamodel/types/ITComponent", json={"subtypes": subs}, headers=h
    )
    assert ok.status_code == 200
    software = next(s for s in ok.json()["subtypes"] if s["key"] == "software")
    assert "archimate_type" not in software  # not "Artifact", not the old "SystemSoftware" either

    bad = [
        {**s, "archimate_type": "Nope"} if s["key"] == "software" else s for s in itc["subtypes"]
    ]
    r = await client.patch("/api/v1/metamodel/types/ITComponent", json={"subtypes": bad}, headers=h)
    assert r.status_code == 200  # no longer validated -- an invalid value is a no-op too
    software2 = next(s for s in r.json()["subtypes"] if s["key"] == "software")
    assert "archimate_type" not in software2


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
async def test_non_string_archimate_type_on_card_type_is_silently_ignored(client, env, bad):
    """Split out of test_non_string_names_are_422_not_500 (card-type half):
    these are no longer validated at all on the card-type/subtype path, so
    a non-string value -- same as any other value -- is simply never read,
    not a 422. The relation-type half of that test is unchanged below."""
    h = auth_headers(env["admin"])
    r = await client.patch(
        "/api/v1/metamodel/types/Application", json={"archimate_type": bad}, headers=h
    )
    assert r.status_code == 200
    assert r.json()["archimate_type"] == "ApplicationComponent"  # unchanged seeded value
    r = await client.patch(
        "/api/v1/metamodel/types/ITComponent",
        json={"subtypes": [{"key": "x", "archimate_type": bad}]},
        headers=h,
    )
    assert r.status_code == 200
    assert "archimate_type" not in r.json()["subtypes"][0]


@pytest.mark.parametrize("bad", [["x"], {}, 5, True])
async def test_non_string_names_are_422_not_500(client, env, bad):
    """Relation-type half of the original test, unchanged -- relation
    mapping is out of scope for the Bug 3 fix."""
    h = auth_headers(env["admin"])
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


async def test_create_type_with_archimate_type_is_silently_ignored(client, env):
    """Renamed from test_create_type_validates_and_stores_mapping: the
    create endpoint no longer reads archimate_type off the body at all (for
    the type or a subtype), so every one of these POSTs now succeeds
    regardless of the value's validity, and the column lands NULL / the
    subtype dict has no archimate_type key -- never the submitted value,
    valid or not."""
    h = auth_headers(env["admin"])
    r = await client.post(
        "/api/v1/metamodel/types",
        json={
            "key": "NewT",
            "label": "New T",
            "archimate_type": "Banana",
            "subtypes": [{"key": "s", "label": "S", "archimate_type": "Nope"}],
        },
        headers=h,
    )
    assert r.status_code == 201
    assert r.json()["archimate_type"] is None
    assert "archimate_type" not in r.json()["subtypes"][0]

    r = await client.post(
        "/api/v1/metamodel/types",
        json={"key": "NewT2", "label": "New T2", "archimate_type": "Node"},
        headers=h,
    )
    assert r.status_code == 201
    assert r.json()["archimate_type"] is None  # even a VALID element name is ignored on create


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
