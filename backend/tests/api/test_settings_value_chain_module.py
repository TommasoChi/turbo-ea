"""The Value Chain is an optional module, like BPM: on by default, switchable
by an admin, and off means the pages are gated before they call anything."""

from __future__ import annotations

import pytest

from tests.conftest import auth_headers, create_role, create_user


@pytest.fixture
async def module_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions={"bpm.value_chain": True})
    return {
        "admin": await create_user(db, email="admin@test.com", role="admin"),
        "viewer": await create_user(db, email="viewer@test.com", role="viewer"),
    }


async def test_the_flag_is_raw_and_ignores_bpm(client, db, module_env):
    """BPM is a prerequisite in the UI (decision J), but the stored flag stays
    independent: Settings must render the switch's own position even with BPM
    off, so the conjunction belongs to the frontend hook, not to this API."""
    admin = module_env["admin"]
    await client.patch(
        "/api/v1/settings/bpm-enabled", json={"enabled": False}, headers=auth_headers(admin)
    )
    resp = await client.get("/api/v1/settings/value-chain-enabled", headers=auth_headers(admin))
    assert resp.json() == {"enabled": True}


async def test_enabled_by_default(client, db, module_env):
    resp = await client.get(
        "/api/v1/settings/value-chain-enabled", headers=auth_headers(module_env["admin"])
    )
    assert resp.status_code == 200
    assert resp.json() == {"enabled": True}


async def test_admin_can_switch_it_off(client, db, module_env):
    resp = await client.patch(
        "/api/v1/settings/value-chain-enabled",
        json={"enabled": False},
        headers=auth_headers(module_env["admin"]),
    )
    assert resp.status_code == 200
    resp = await client.get(
        "/api/v1/settings/value-chain-enabled", headers=auth_headers(module_env["admin"])
    )
    assert resp.json() == {"enabled": False}


async def test_non_admin_cannot_switch_it(client, db, module_env):
    resp = await client.patch(
        "/api/v1/settings/value-chain-enabled",
        json={"enabled": False},
        headers=auth_headers(module_env["viewer"]),
    )
    assert resp.status_code == 403


async def test_bootstrap_exposes_the_flag(client, db, module_env):
    resp = await client.get(
        "/api/v1/settings/bootstrap", headers=auth_headers(module_env["viewer"])
    )
    assert resp.json()["value_chain_enabled"] is True


async def test_bootstrap_follows_the_switch(client, db, module_env):
    await client.patch(
        "/api/v1/settings/value-chain-enabled",
        json={"enabled": False},
        headers=auth_headers(module_env["admin"]),
    )
    resp = await client.get(
        "/api/v1/settings/bootstrap", headers=auth_headers(module_env["viewer"])
    )
    assert resp.json()["value_chain_enabled"] is False
