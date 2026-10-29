"""Integration tests for GET /reports/cost-sankey.

Application -> ITComponent cost flow via app_to_itc relations, with an
optional group_by inserting a third node layer.
"""

from __future__ import annotations

import pytest

from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
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
    await create_role(
        db,
        key="noreports",
        label="No Reports",
        permissions={"inventory.view": True},
    )
    await create_card_type(db, key="Application", label="Application", fields_schema=COST_FIELDS)
    await create_card_type(db, key="ITComponent", label="IT Component", fields_schema=COST_FIELDS)
    await create_card_type(db, key="BusinessCapability", label="Business Capability")
    await create_relation_type(
        db,
        key="app_to_itc",
        label="Application to IT Component",
        source_type_key="Application",
        target_type_key="ITComponent",
    )
    admin = await create_user(db, email="admin@cost-sankey.com", role="admin")
    noreports = await create_user(db, email="noreports@cost-sankey.com", role="noreports")
    return {"admin": admin, "noreports": noreports}


class TestCostSankey:
    async def test_cost_sankey_two_level_flow(self, client, db, env):
        """One link per app_to_itc relation; value = the IT Component's cost."""
        admin = env["admin"]
        app1 = await create_card(
            db,
            card_type="Application",
            name="ERP",
            user_id=admin.id,
            attributes={"costTotalAnnual": 1000},
        )
        itc1 = await create_card(
            db,
            card_type="ITComponent",
            name="DB",
            user_id=admin.id,
            attributes={"costTotalAnnual": 500},
        )
        await create_relation(db, type_key="app_to_itc", source_id=app1.id, target_id=itc1.id)

        resp = await client.get(
            "/api/v1/reports/cost-sankey",
            params={"cost_field": "costTotalAnnual"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        names = {n["id"]: n["name"] for n in data["nodes"]}
        assert set(names.values()) == {"ERP", "DB"}
        assert len(data["links"]) == 1
        link = data["links"][0]
        assert names[data["nodes"][link["source"]]["id"]] == "ERP"
        assert names[data["nodes"][link["target"]]["id"]] == "DB"
        assert link["value"] == 500

    async def test_cost_sankey_drops_zero_cost_nodes(self, client, db, env):
        """A card with cost 0 (or no cost field set) never becomes a node."""
        admin = env["admin"]
        app1 = await create_card(db, card_type="Application", name="NoCost", user_id=admin.id)
        itc1 = await create_card(
            db,
            card_type="ITComponent",
            name="DB",
            user_id=admin.id,
            attributes={"costTotalAnnual": 500},
        )
        await create_relation(db, type_key="app_to_itc", source_id=app1.id, target_id=itc1.id)

        resp = await client.get(
            "/api/v1/reports/cost-sankey",
            params={"cost_field": "costTotalAnnual"},
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert data["nodes"] == []
        assert data["links"] == []

    async def test_cost_sankey_excludes_unlinked_cards(self, client, db, env):
        """A costed card with no app_to_itc relation never appears as an orphan node."""
        admin = env["admin"]
        await create_card(
            db,
            card_type="Application",
            name="Lonely",
            user_id=admin.id,
            attributes={"costTotalAnnual": 1000},
        )
        resp = await client.get(
            "/api/v1/reports/cost-sankey",
            params={"cost_field": "costTotalAnnual"},
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert data["nodes"] == []

    async def test_cost_sankey_fans_out_shared_component(self, client, db, env):
        """One IT Component related to two Applications: one link per relation,
        each carrying the component's full cost (no division, no dedup)."""
        admin = env["admin"]
        app1 = await create_card(
            db,
            card_type="Application",
            name="ERP",
            user_id=admin.id,
            attributes={"costTotalAnnual": 1},
        )
        app2 = await create_card(
            db,
            card_type="Application",
            name="CRM",
            user_id=admin.id,
            attributes={"costTotalAnnual": 1},
        )
        itc = await create_card(
            db,
            card_type="ITComponent",
            name="SharedDB",
            user_id=admin.id,
            attributes={"costTotalAnnual": 500},
        )
        await create_relation(db, type_key="app_to_itc", source_id=app1.id, target_id=itc.id)
        await create_relation(db, type_key="app_to_itc", source_id=app2.id, target_id=itc.id)

        resp = await client.get(
            "/api/v1/reports/cost-sankey",
            params={"cost_field": "costTotalAnnual"},
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert len(data["links"]) == 2
        assert all(link["value"] == 500 for link in data["links"])
        assert data["total"] == 1000

    async def test_cost_sankey_group_by_three_level(self, client, db, env):
        """group_by inserts a middle node layer between Application and ITComponent."""
        admin = env["admin"]
        await create_relation_type(
            db,
            key="app_to_bc",
            label="Application uses Capability",
            source_type_key="Application",
            target_type_key="BusinessCapability",
        )
        bc = await create_card(db, card_type="BusinessCapability", name="Finance", user_id=admin.id)
        app1 = await create_card(
            db,
            card_type="Application",
            name="ERP",
            user_id=admin.id,
            attributes={"costTotalAnnual": 1000},
        )
        itc1 = await create_card(
            db,
            card_type="ITComponent",
            name="DB",
            user_id=admin.id,
            attributes={"costTotalAnnual": 500},
        )
        await create_relation(db, type_key="app_to_bc", source_id=app1.id, target_id=bc.id)
        await create_relation(db, type_key="app_to_itc", source_id=app1.id, target_id=itc1.id)

        resp = await client.get(
            "/api/v1/reports/cost-sankey",
            params={"cost_field": "costTotalAnnual", "group_by": "BusinessCapability"},
            headers=auth_headers(admin),
        )
        data = resp.json()
        types_by_name = {n["name"]: n["type"] for n in data["nodes"]}
        assert types_by_name == {
            "ERP": "Application",
            "Finance": "BusinessCapability",
            "DB": "ITComponent",
        }
        assert len(data["links"]) == 2  # ERP->Finance, Finance->DB

    async def test_cost_sankey_group_by_unrelated_type_is_ignored(self, client, db, env):
        """group_by naming a type with no relation to any Application falls back
        to the plain 2-level flow instead of erroring."""
        admin = env["admin"]
        app1 = await create_card(
            db,
            card_type="Application",
            name="ERP",
            user_id=admin.id,
            attributes={"costTotalAnnual": 1000},
        )
        itc1 = await create_card(
            db,
            card_type="ITComponent",
            name="DB",
            user_id=admin.id,
            attributes={"costTotalAnnual": 500},
        )
        await create_relation(db, type_key="app_to_itc", source_id=app1.id, target_id=itc1.id)

        resp = await client.get(
            "/api/v1/reports/cost-sankey",
            params={"cost_field": "costTotalAnnual", "group_by": "BusinessCapability"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        types_by_name = {n["name"]: n["type"] for n in data["nodes"]}
        assert types_by_name == {"ERP": "Application", "DB": "ITComponent"}
        assert len(data["links"]) == 1

    async def test_cost_sankey_invalid_cost_field_400(self, client, db, env):
        resp = await client.get(
            "/api/v1/reports/cost-sankey",
            params={"cost_field": "cost;DROP TABLE"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400

    async def test_cost_sankey_permission_denied(self, client, db, env):
        resp = await client.get(
            "/api/v1/reports/cost-sankey",
            params={"cost_field": "costTotalAnnual"},
            headers=auth_headers(env["noreports"]),
        )
        assert resp.status_code == 403

    async def test_cost_sankey_respects_read_scope(self, client, db, env):
        """A relation to a card outside the caller's read scope is never
        exposed as a link or a node naming that hidden card."""
        admin = env["admin"]
        app1 = await create_card(
            db,
            card_type="Application",
            name="ERP",
            user_id=admin.id,
            attributes={"costTotalAnnual": 1000},
        )
        hidden_itc = await create_card(
            db,
            card_type="ITComponent",
            name="SecretDB",
            user_id=admin.id,
            attributes={"costTotalAnnual": 500},
            status="ARCHIVED",
        )
        await create_relation(db, type_key="app_to_itc", source_id=app1.id, target_id=hidden_itc.id)

        resp = await client.get(
            "/api/v1/reports/cost-sankey",
            params={"cost_field": "costTotalAnnual"},
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert "SecretDB" not in {n["name"] for n in data["nodes"]}
        assert data["links"] == []
