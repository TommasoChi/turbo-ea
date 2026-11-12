"""Integration tests: how a related card shared by several cards is attributed.

Discussion #1362: one Initiative worth 50 000 improves two Business
Capabilities. The cost treemap built around Business Capability with
*Initiative · Budget* as its source showed 50 000 on each capability and a
100 000 total. ``attribution=full`` (the default) keeps the per-tile number but
counts each related card once in the total; ``attribution=split`` shares the
cost equally between the cards it links to. The capability heatmap's Total
Cost and the ``group_by`` mode follow the same rule.
"""

from __future__ import annotations

import pytest

from app.services.fiscal_year import current_fiscal_year
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)

THIS_YEAR = current_fiscal_year(1)
AGG = "Initiative:costBudget"


def _cost_fields(key: str) -> list[dict]:
    return [{"section": "Cost", "fields": [{"key": key, "type": "cost", "weight": 0}]}]


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    await create_card_type(db, key="BusinessCapability", fields_schema=[])
    await create_card_type(db, key="Initiative", fields_schema=_cost_fields("costBudget"))
    await create_card_type(db, key="Application", fields_schema=_cost_fields("costTotalAnnual"))
    await create_relation_type(
        db,
        key="relInitToCap",
        source_type_key="Initiative",
        target_type_key="BusinessCapability",
    )
    # A second relation type over the same pair: parallel links count once.
    await create_relation_type(
        db,
        key="relInitAlsoCap",
        source_type_key="Initiative",
        target_type_key="BusinessCapability",
    )
    await create_relation_type(
        db,
        key="relAppToCap",
        source_type_key="Application",
        target_type_key="BusinessCapability",
    )
    return {"admin": admin}


async def _cap(db, name, **kwargs):
    return await create_card(db, card_type="BusinessCapability", name=name, **kwargs)


async def _init(db, name, cost):
    return await create_card(db, card_type="Initiative", name=name, attributes={"costBudget": cost})


async def _app(db, name, cost):
    return await create_card(
        db, card_type="Application", name=name, attributes={"costTotalAnnual": cost}
    )


async def _link(db, src, tgt, type_key="relInitToCap"):
    await create_relation(db, type_key=type_key, source_id=src.id, target_id=tgt.id)


# The treemap half of upstream's attribution feature is not in this fork: the Cost Report
# here is the fork's own (cost items, Sankey, field / relation grouping), so only the
# capability heatmap takes `attribution`.


@pytest.mark.parametrize("route", ["/api/v1/reports/capability-heatmap"])
@pytest.mark.parametrize("value", ["half", "Full"])
async def test_invalid_attribution_is_400(client, env, route, value):
    params = {"attribution": value}
    if route.endswith("heatmap"):
        params["metric"] = "total_cost"
    resp = await client.get(route, params=params, headers=auth_headers(env["admin"]))
    assert resp.status_code == 400
    assert resp.json()["detail"] == f"Invalid attribution: {value!r}"


class TestHeatmapAttribution:
    async def _setup(self, db):
        x, y = await _cap(db, "Cap X"), await _cap(db, "Cap Y")
        app = await _app(db, "Shared App", 300)
        await _link(db, app, x, "relAppToCap")
        await _link(db, app, y, "relAppToCap")
        return x, y, app

    async def _heatmap(self, client, env, **params):
        resp = await client.get(
            "/api/v1/reports/capability-heatmap",
            params={"metric": "total_cost", **params},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200, resp.text
        return resp.json()

    async def test_heatmap_full_counts_a_shared_app_on_each_capability(self, client, db, env):
        await self._setup(db)
        data = await self._heatmap(client, env)
        assert {i["name"]: i["total_cost"] for i in data["items"]} == {
            "Cap X": 300,
            "Cap Y": 300,
        }
        assert data["attribution"] == "full"

    async def test_heatmap_split_divides_an_app_between_its_capabilities(self, client, db, env):
        await self._setup(db)
        data = await self._heatmap(client, env, attribution="split")
        assert {i["name"]: i["total_cost"] for i in data["items"]} == {
            "Cap X": 150,
            "Cap Y": 150,
        }
        assert data["attribution"] == "split"

    async def test_heatmap_app_carries_its_capability_ids(self, client, db, env):
        x, y, app = await self._setup(db)
        data = await self._heatmap(client, env)
        apps = {a["id"]: a for i in data["items"] for a in i["apps"]}
        assert apps[str(app.id)]["capability_ids"] == sorted([str(x.id), str(y.id)])
