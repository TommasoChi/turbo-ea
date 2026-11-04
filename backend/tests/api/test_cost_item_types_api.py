from __future__ import annotations

import pytest

from app.core.permissions import VIEWER_PERMISSIONS
from tests.conftest import auth_headers, create_role, create_user

BASE = "/api/v1/metamodel/cost-item-types"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "viewer": viewer}


async def test_get_authenticated_and_anonymous(client, env):
    r = await client.get(BASE, headers=auth_headers(env["viewer"]))
    assert r.status_code == 200 and r.json() == []
    assert (await client.get(BASE)).status_code == 401


async def test_writes_need_permission(client, env):
    h = auth_headers(env["viewer"])
    assert (await client.post(BASE, json={"key": "a", "label": "A"}, headers=h)).status_code == 403
    assert (await client.patch(f"{BASE}/a", json={"label": "B"}, headers=h)).status_code == 403


async def test_create_list_patch_archive(client, env):
    h = auth_headers(env["admin"])
    r = await client.post(BASE, json={"key": "lic", "label": " Licences "}, headers=h)
    assert r.status_code == 201 and r.json()["label"] == "Licences"
    r = await client.patch(f"{BASE}/lic", json={"archived": True}, headers=h)
    assert r.status_code == 200 and r.json()["archived"] is True
    rows = (await client.get(BASE, headers=h)).json()
    assert [(x["key"], x["archived"]) for x in rows] == [("lic", True)]


async def test_duplicate_409(client, env):
    h = auth_headers(env["admin"])
    await client.post(BASE, json={"key": "lic", "label": "L"}, headers=h)
    r = await client.post(BASE, json={"key": "lic", "label": "L2"}, headers=h)
    assert r.status_code == 409


@pytest.mark.parametrize("key", ["1x", "a b", "description", "cost_items"])
async def test_bad_key_422(client, env, key):
    r = await client.post(BASE, json={"key": key, "label": "L"}, headers=auth_headers(env["admin"]))
    assert r.status_code == 422


async def test_patch_unknown_404(client, env):
    r = await client.patch(f"{BASE}/nope", json={"label": "x"}, headers=auth_headers(env["admin"]))
    assert r.status_code == 404


@pytest.mark.parametrize("value", [1180591620717411303424, 2147483648, -1])
async def test_patch_sort_order_out_of_range_422(client, env, value):
    h = auth_headers(env["admin"])
    await client.post(BASE, json={"key": "lic", "label": "L"}, headers=h)
    r = await client.patch(f"{BASE}/lic", json={"sort_order": value}, headers=h)
    assert r.status_code == 422


@pytest.mark.parametrize("value", [0, 3, 2147483647])
async def test_patch_sort_order_in_range(client, env, value):
    h = auth_headers(env["admin"])
    await client.post(BASE, json={"key": "lic", "label": "L"}, headers=h)
    r = await client.patch(f"{BASE}/lic", json={"sort_order": value}, headers=h)
    assert r.status_code == 200 and r.json()["sort_order"] == value
