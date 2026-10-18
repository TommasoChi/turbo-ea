"""ArchiMate is an optional module, OFF by default: an admin switches it on."""

from __future__ import annotations

import pytest

from tests.conftest import auth_headers, create_role, create_user


@pytest.fixture
async def module_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions={"diagrams.view": True})
    return {
        "admin": await create_user(db, email="admin@test.com", role="admin"),
        "viewer": await create_user(db, email="viewer@test.com", role="viewer"),
    }


async def test_off_by_default(client, db, module_env):
    resp = await client.get(
        "/api/v1/settings/archimate-enabled", headers=auth_headers(module_env["admin"])
    )
    assert resp.status_code == 200
    assert resp.json() == {"enabled": False}


async def test_admin_can_switch_it_on_and_off(client, db, module_env):
    h = auth_headers(module_env["admin"])
    resp = await client.patch(
        "/api/v1/settings/archimate-enabled", json={"enabled": True}, headers=h
    )
    assert resp.status_code == 200
    assert (await client.get("/api/v1/settings/archimate-enabled", headers=h)).json() == {
        "enabled": True
    }
    await client.patch("/api/v1/settings/archimate-enabled", json={"enabled": False}, headers=h)
    assert (await client.get("/api/v1/settings/archimate-enabled", headers=h)).json() == {
        "enabled": False
    }


async def test_non_admin_cannot_switch_it(client, db, module_env):
    resp = await client.patch(
        "/api/v1/settings/archimate-enabled",
        json={"enabled": True},
        headers=auth_headers(module_env["viewer"]),
    )
    assert resp.status_code == 403


async def test_bootstrap_carries_the_flag(client, db, module_env):
    boot = (await client.get("/api/v1/settings/bootstrap")).json()
    assert boot["archimate_enabled"] is False
    await client.patch(
        "/api/v1/settings/archimate-enabled",
        json={"enabled": True},
        headers=auth_headers(module_env["admin"]),
    )
    assert (await client.get("/api/v1/settings/bootstrap")).json()["archimate_enabled"] is True


async def test_flag_does_not_disturb_the_other_module_flags(client, db, module_env):
    h = auth_headers(module_env["admin"])
    await client.patch("/api/v1/settings/archimate-enabled", json={"enabled": True}, headers=h)
    assert (await client.get("/api/v1/settings/value-chain-enabled", headers=h)).json() == {
        "enabled": True
    }
