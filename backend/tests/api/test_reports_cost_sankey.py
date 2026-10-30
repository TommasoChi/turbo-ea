"""Integration tests for GET /reports/cost-sankey: gating, scope and empty results.

The flow itself (cost items -> [groups] -> cards) is covered in
test_reports_cost_sankey_parity.py.
"""

from __future__ import annotations

import pytest

from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)

pytestmark = pytest.mark.anyio

COST_FIELDS = [
    {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}
]


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="noreports", label="No Reports", permissions={"inventory.view": True})
    await create_card_type(db, key="Application", label="Application", fields_schema=COST_FIELDS)
    admin = await create_user(db, email="admin@cost-sankey.com", role="admin")
    noreports = await create_user(db, email="noreports@cost-sankey.com", role="noreports")
    return {"admin": admin, "noreports": noreports}


class TestCostSankey:
    async def test_zero_cost_cards_never_become_nodes(self, client, db, env):
        admin = env["admin"]
        await create_card(db, card_type="Application", name="NoCost", user_id=admin.id)
        resp = await client.get("/api/v1/reports/cost-sankey", headers=auth_headers(admin))
        assert resp.status_code == 200
        data = resp.json()
        assert data["nodes"] == []
        assert data["links"] == []
        assert data["total"] == 0

    async def test_invalid_cost_field_400(self, client, db, env):
        resp = await client.get(
            "/api/v1/reports/cost-sankey",
            params={"cost_field": "cost;DROP TABLE"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400

    async def test_permission_denied(self, client, db, env):
        resp = await client.get(
            "/api/v1/reports/cost-sankey", headers=auth_headers(env["noreports"])
        )
        assert resp.status_code == 403

    async def test_archived_cards_are_not_exposed(self, client, db, env):
        admin = env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="SecretApp",
            user_id=admin.id,
            attributes={"costTotalAnnual": 500},
            status="ARCHIVED",
        )
        resp = await client.get("/api/v1/reports/cost-sankey", headers=auth_headers(admin))
        assert "SecretApp" not in {n["name"] for n in resp.json()["nodes"]}
