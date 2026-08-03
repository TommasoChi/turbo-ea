"""Tests for the public, unauthenticated GET /extensions/mcp-manifest endpoint.

No get_current_user dependency — mcp-server has no user session at its own
process startup, so this mirrors GET /settings/mcp/status's public pattern
rather than the authenticated GET /extensions/status. Rows are inserted
directly into the DB (not via extension_registry.load_installed) because
the endpoint itself calls extension_registry.refresh_from_db(db), which
would otherwise overwrite any in-memory-only registry state before the
request is handled.
"""

from __future__ import annotations

import pytest

from app.models.extension import Extension
from app.services.extensions.registry import extension_registry

MCP_TOOL = {
    "name": "ext_sample_get_thing",
    "description": "Return a thing.",
    "method": "GET",
    "path": "thing/{thing_id}",
    "input_schema": {
        "type": "object",
        "properties": {"thing_id": {"type": "string"}},
        "required": ["thing_id"],
    },
    "annotations": {"readOnlyHint": True},
    "required_permission": "ext.sample.view",
}


@pytest.fixture(autouse=True)
def _reset_registry():
    extension_registry.clear()
    yield
    extension_registry.clear()


async def _seed_extension(db, **overrides):
    row = Extension(
        key="sample",
        name="Sample",
        version="1.0.0",
        status="installed",
        enabled=True,
        capabilities=["mcp"],
        manifest={"free": True, "mcp_sdk_version": "1.0", "mcp_tools": [MCP_TOOL]},
    )
    for field, value in overrides.items():
        setattr(row, field, value)
    db.add(row)
    await db.commit()


class TestMcpManifestEndpoint:
    async def test_returns_enabled_mcp_extension(self, client, db):
        await _seed_extension(db)
        resp = await client.get("/api/v1/extensions/mcp-manifest")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["key"] == "sample"
        assert data[0]["mcp_sdk_version"] == "1.0"
        assert data[0]["mcp_tools"][0]["name"] == "ext_sample_get_thing"

    async def test_no_auth_header_required(self, client):
        # Deliberately no Authorization header — must not 401/403.
        resp = await client.get("/api/v1/extensions/mcp-manifest")
        assert resp.status_code == 200

    async def test_disabled_extension_excluded(self, client, db):
        await _seed_extension(db, enabled=False)
        resp = await client.get("/api/v1/extensions/mcp-manifest")
        assert resp.json() == []

    async def test_extension_without_mcp_capability_excluded(self, client, db):
        await _seed_extension(db, capabilities=["frontend"], manifest={"free": True})
        resp = await client.get("/api/v1/extensions/mcp-manifest")
        assert resp.json() == []

    async def test_needs_restart_extension_excluded(self, client, db):
        await _seed_extension(db, status="needs_restart")
        resp = await client.get("/api/v1/extensions/mcp-manifest")
        assert resp.json() == []
