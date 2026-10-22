"""ArchiMate diagrams are gated on the per-layer ``archimatediagrams.<tab>.<action>``
keys, not on ``diagrams.*``. A viewpoint spanning several tabs needs the key on
at least one of them."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from app.models.archimate_viewpoint import ArchimateViewpoint, ArchimateViewpointObject
from app.models.diagram import Diagram
from app.models.enterprise_object import EnterpriseObject
from tests.conftest import auth_headers, create_role, create_user

XML = '<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" identifier="m"/>'
AM = {"format": "archimate-exchange-3.1", "xml": XML}


@pytest.fixture
async def env(db):
    for key, layer in (
        ("BusinessActor", "business"),
        ("ApplicationComponent", "application"),
        ("Node", "technology"),
    ):
        db.add(EnterpriseObject(key=key, name=key, layer=layer))
    for key, objects in (
        ("vp-business", ["BusinessActor"]),
        ("vp-technology", ["Node"]),
        ("vp-app-tech", ["ApplicationComponent", "Node"]),
    ):
        db.add(ArchimateViewpoint(key=key, name=key, layer="business"))
        await db.flush()
        for o in objects:
            db.add(ArchimateViewpointObject(viewpoint_key=key, enterprise_object_key=o))
    await db.flush()

    users = {}
    for role, perms in {
        "business_manager": {"archimatediagrams.business.manage": True},
        "technology_manager": {"archimatediagrams.technology.manage": True},
        "business_viewer": {"archimatediagrams.business.view": True},
        "technology_viewer": {"archimatediagrams.technology.view": True},
        # Full plain-diagram rights, no ArchiMate keys at all.
        "drawio_only": {"diagrams.view": True, "diagrams.manage": True},
    }.items():
        await create_role(db, key=role, label=role, permissions=perms)
        users[role] = await create_user(db, email=f"{role}@t.com", role=role)
    return users


async def _create(client, user, viewpoint_key):
    return await client.post(
        "/api/v1/diagrams",
        json={"name": "a", "kind": "archimate", "viewpoint_key": viewpoint_key, "data": AM},
        headers=auth_headers(user),
    )


async def test_layer_manage_key_allows_its_own_layer_only(client, env):
    assert (await _create(client, env["business_manager"], "vp-business")).status_code == 201
    assert (await _create(client, env["business_manager"], "vp-technology")).status_code == 403


async def test_cross_layer_viewpoint_needs_one_of_its_layers(client, env):
    # vp-app-tech spans application + technology.
    assert (await _create(client, env["technology_manager"], "vp-app-tech")).status_code == 201
    assert (await _create(client, env["business_manager"], "vp-app-tech")).status_code == 403


async def test_diagrams_keys_no_longer_grant_archimate_access(client, env, db):
    assert (await _create(client, env["drawio_only"], "vp-business")).status_code == 403
    d = Diagram(name="x", kind="archimate", viewpoint_key="vp-business", data=AM)
    db.add(d)
    await db.flush()
    r = await client.get(f"/api/v1/diagrams/{d.id}", headers=auth_headers(env["drawio_only"]))
    assert r.status_code == 403


async def test_open_and_edit_follow_the_diagram_viewpoint_layers(client, env, db):
    business = Diagram(name="b", kind="archimate", viewpoint_key="vp-business", data=AM)
    technology = Diagram(name="t", kind="archimate", viewpoint_key="vp-technology", data=AM)
    db.add_all([business, technology])
    await db.flush()
    viewer = auth_headers(env["business_viewer"])
    assert (await client.get(f"/api/v1/diagrams/{business.id}", headers=viewer)).status_code == 200
    assert (
        await client.get(f"/api/v1/diagrams/{technology.id}", headers=viewer)
    ).status_code == 403
    # view is not manage
    r = await client.patch(f"/api/v1/diagrams/{business.id}", json={"name": "z"}, headers=viewer)
    assert r.status_code == 403
    r = await client.patch(
        f"/api/v1/diagrams/{technology.id}",
        json={"name": "z"},
        headers=auth_headers(env["technology_manager"]),
    )
    assert r.status_code == 200


async def test_validate_needs_an_archimate_view_key(client, env):
    body = {"xml": XML}
    r = await client.post(
        "/api/v1/archimate/validate", json=body, headers=auth_headers(env["drawio_only"])
    )
    assert r.status_code == 403
    r = await client.post(
        "/api/v1/archimate/validate", json=body, headers=auth_headers(env["technology_viewer"])
    )
    assert r.status_code == 200


# ── migration 162 ────────────────────────────────────────────────────────────

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "162_add_archimate_diagram_permissions.py"
)
_spec = importlib.util.spec_from_file_location("mig162", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def test_migration_copies_each_diagrams_value_to_every_layer():
    planned = mig.plan_role_permissions(
        {"diagrams.view": True, "diagrams.manage": False, "diagrams.publish": True}
    )
    for layer in ("business", "application", "technology"):
        assert planned[f"archimatediagrams.{layer}.view"] is True
        assert planned[f"archimatediagrams.{layer}.manage"] is False
        assert planned[f"archimatediagrams.{layer}.publish"] is True


def test_migration_keeps_explicit_values_and_wildcards():
    assert mig.plan_role_permissions({"*": True}) == {"*": True}
    planned = mig.plan_role_permissions(
        {"diagrams.manage": True, "archimatediagrams.business.manage": False}
    )
    assert planned["archimatediagrams.business.manage"] is False
    assert planned["archimatediagrams.technology.manage"] is True
