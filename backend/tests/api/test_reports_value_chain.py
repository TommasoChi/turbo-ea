"""Integration tests for GET /reports/value-chain."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models.card_type import CardType
from app.models.relation import Relation
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)

URL = "/api/v1/reports/value-chain"


@pytest.fixture
async def chain_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions={"bpm.value_chain": True, "inventory.view": True},
    )
    await create_role(db, key="nochain", label="No Chain", permissions={"inventory.view": True})
    await create_card_type(db, key="BusinessProcess", label="Business Process")
    await create_card_type(db, key="BusinessContext", label="Business Context")
    await create_card_type(db, key="Objective", label="Objective")
    await create_relation_type(
        db,
        key="relProcessToBizCtx",
        label="realizes",
        source_type_key="BusinessProcess",
        target_type_key="BusinessContext",
    )
    await create_relation_type(
        db,
        key="relObjectiveToBizCtx",
        label="is goal for",
        source_type_key="Objective",
        target_type_key="BusinessContext",
    )
    await create_relation_type(
        db,
        key="relBusinessContextSuccessor",
        label="succeeds",
        source_type_key="BusinessContext",
        target_type_key="BusinessContext",
    )
    return {
        "admin": await create_user(db, email="admin@test.com", role="admin"),
        "viewer": await create_user(db, email="viewer@test.com", role="viewer"),
        "nochain": await create_user(db, email="nochain@test.com", role="nochain"),
    }


async def deny_view(db, type_key: str, role_key: str) -> None:
    ct = (await db.execute(select(CardType).where(CardType.key == type_key))).scalar_one()
    ct.role_permissions = {role_key: {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()


async def sales_with_streams(db, admin):
    """Category "Sales" -> parent value stream with two leaves, one gated."""
    cat = await create_card(
        db,
        card_type="BusinessProcess",
        name="Sales",
        user_id=admin.id,
        subtype="category",
        attributes={"processType": "core"},
    )
    parent_vs = await create_card(
        db,
        card_type="BusinessContext",
        name="Order to Cash",
        user_id=admin.id,
        subtype="valueStream",
    )
    leaf_a = await create_card(
        db,
        card_type="BusinessContext",
        name="Quote",
        user_id=admin.id,
        subtype="valueStream",
        parent_id=parent_vs.id,
    )
    await create_card(
        db,
        card_type="BusinessContext",
        name="Invoice",
        user_id=admin.id,
        subtype="valueStream",
        parent_id=parent_vs.id,
    )
    await create_relation(
        db, type_key="relProcessToBizCtx", source_id=cat.id, target_id=parent_vs.id
    )
    gate = await create_card(
        db, card_type="Objective", name="Gate 1", user_id=admin.id, subtype="valueGate"
    )
    await create_relation(
        db, type_key="relObjectiveToBizCtx", source_id=gate.id, target_id=leaf_a.id
    )
    return cat


def core_box(resp):
    return {b["key"]: b for b in resp.json()["bands"]}["core"]["boxes"][0]


async def test_requires_the_permission(client, db, chain_env):
    resp = await client.get(URL, headers=auth_headers(chain_env["nochain"]))
    assert resp.status_code == 403


async def test_empty_landscape_still_returns_four_bands(client, db, chain_env):
    resp = await client.get(URL, headers=auth_headers(chain_env["viewer"]))
    assert resp.status_code == 200
    assert resp.json() == {
        "bands": [
            {"key": "management", "boxes": []},
            {"key": "core", "boxes": []},
            {"key": "support", "boxes": []},
            {"key": "not_set", "boxes": []},
        ],
        "core_house": {"level_one": [], "level_two": {}, "level_three": {}},
    }


async def test_category_lands_in_its_process_type_band(client, db, chain_env):
    admin = chain_env["admin"]
    cat = await create_card(
        db,
        card_type="BusinessProcess",
        name="Sales",
        user_id=admin.id,
        subtype="category",
        attributes={"processType": "core"},
    )
    await create_card(
        db,
        card_type="BusinessProcess",
        name="Group A",
        user_id=admin.id,
        subtype="group",
        parent_id=cat.id,
    )
    resp = await client.get(URL, headers=auth_headers(admin))
    bands = {b["key"]: b for b in resp.json()["bands"]}
    assert [box["name"] for box in bands["core"]["boxes"]] == ["Sales"]
    box = bands["core"]["boxes"][0]
    assert box["group_count"] == 1
    assert box["process_count"] == 0
    assert box["has_children"] is True
    assert box["process_type"] == "core"
    assert box["id"] == str(cat.id)


async def test_unclassified_category_lands_in_not_set(client, db, chain_env):
    admin = chain_env["admin"]
    await create_card(
        db,
        card_type="BusinessProcess",
        name="Mystery",
        user_id=admin.id,
        subtype="category",
        attributes={},
    )
    resp = await client.get(URL, headers=auth_headers(admin))
    bands = {b["key"]: b for b in resp.json()["bands"]}
    assert [box["name"] for box in bands["not_set"]["boxes"]] == ["Mystery"]


async def test_value_stream_count_counts_leaves_not_linked_cards(client, db, chain_env):
    """A category linked to a parent value stream counts its LEAVES."""
    admin = chain_env["admin"]
    await sales_with_streams(db, admin)
    resp = await client.get(URL, headers=auth_headers(admin))
    box = core_box(resp)
    assert box["value_stream_count"] == 2
    assert box["value_gate_count"] == 1


async def test_response_matches_the_documented_schema(client, db, chain_env):
    admin = chain_env["admin"]
    await sales_with_streams(db, admin)
    from app.schemas.value_chain import ValueChainResponse

    resp = await client.get(URL, headers=auth_headers(admin))
    parsed = ValueChainResponse.model_validate(resp.json())
    assert parsed.model_dump() == resp.json()


async def test_archived_and_inactive_cards_are_left_out(client, db, chain_env):
    admin = chain_env["admin"]
    cat = await sales_with_streams(db, admin)
    await create_card(
        db,
        card_type="BusinessProcess",
        name="Archived category",
        user_id=admin.id,
        subtype="category",
        attributes={"processType": "core"},
        status="ARCHIVED",
    )
    archived_stream = await create_card(
        db,
        card_type="BusinessContext",
        name="Gone",
        user_id=admin.id,
        subtype="valueStream",
        status="ARCHIVED",
    )
    archived_stream.archived_at = datetime.now(timezone.utc)
    soft_archived = await create_card(
        db,
        card_type="BusinessContext",
        name="Soft archived",
        user_id=admin.id,
        subtype="valueStream",
    )
    soft_archived.archived_at = datetime.now(timezone.utc)
    await db.flush()
    await create_relation(
        db, type_key="relProcessToBizCtx", source_id=cat.id, target_id=archived_stream.id
    )
    await create_relation(
        db, type_key="relProcessToBizCtx", source_id=cat.id, target_id=soft_archived.id
    )
    resp = await client.get(URL, headers=auth_headers(admin))
    core = {b["key"]: b for b in resp.json()["bands"]}["core"]["boxes"]
    assert [box["name"] for box in core] == ["Sales"]
    # Two relations to archived streams: no phantom leaves.
    assert core[0]["value_stream_count"] == 2


async def test_a_denied_type_produces_no_phantom_counts(client, db, chain_env):
    """Relations are not scoped, cards are: a relation whose endpoint the
    reader may not view must not count (module mode honours an explicit deny)."""
    admin, viewer = chain_env["admin"], chain_env["viewer"]
    await sales_with_streams(db, admin)
    await deny_view(db, "Objective", "viewer")
    resp = await client.get(URL, headers=auth_headers(viewer))
    assert resp.status_code == 200
    assert core_box(resp)["value_stream_count"] == 2
    assert core_box(resp)["value_gate_count"] == 0

    await deny_view(db, "BusinessContext", "viewer")
    resp = await client.get(URL, headers=auth_headers(viewer))
    assert core_box(resp)["value_stream_count"] == 0
    assert core_box(resp)["value_gate_count"] == 0

    # The admin is not affected by the viewer's deny.
    resp = await client.get(URL, headers=auth_headers(admin))
    assert (core_box(resp)["value_stream_count"], core_box(resp)["value_gate_count"]) == (2, 1)


async def test_core_house_needs_no_parent_and_hierarchy_level_one_and_is_core(
    client, db, chain_env
):
    """Both signals are required: they disagree on live data, deliberately."""
    admin = chain_env["admin"]
    good = await create_card(
        db,
        card_type="BusinessContext",
        name="Core Stream",
        user_id=admin.id,
        subtype="valueStream",
        attributes={"hierarchyLevel": 1, "isCore": "True"},
    )
    await create_card(
        db,
        card_type="BusinessContext",
        name="No Level",
        user_id=admin.id,
        subtype="valueStream",
        attributes={"isCore": True},
    )
    await create_card(
        db,
        card_type="BusinessContext",
        name="Not Core",
        user_id=admin.id,
        subtype="valueStream",
        attributes={"hierarchyLevel": 1},
    )
    await create_card(
        db,
        card_type="BusinessContext",
        name="Child",
        user_id=admin.id,
        subtype="valueStream",
        parent_id=good.id,
        attributes={"hierarchyLevel": 1, "isCore": True},
    )
    resp = await client.get(URL, headers=auth_headers(admin))
    house = resp.json()["core_house"]
    assert [s["name"] for s in house["level_one"]] == ["Core Stream"]
    assert [c["name"] for c in house["level_two"][str(good.id)]] == ["Child"]
    assert house["level_three"] == {str(good.id): []}


async def test_core_house_orders_level_two_and_lists_level_three(client, db, chain_env):
    admin = chain_env["admin"]
    root = await create_card(
        db,
        card_type="BusinessContext",
        name="Sales",
        user_id=admin.id,
        subtype="valueStream",
        attributes={"hierarchyLevel": 1, "isCore": True},
    )
    first = await create_card(
        db,
        card_type="BusinessContext",
        name="Zeta",
        user_id=admin.id,
        subtype="valueStream",
        parent_id=root.id,
    )
    second = await create_card(
        db,
        card_type="BusinessContext",
        name="Alpha",
        user_id=admin.id,
        subtype="valueStream",
        parent_id=root.id,
    )
    # source succeeds target: Alpha comes after Zeta.
    await create_relation(
        db, type_key="relBusinessContextSuccessor", source_id=second.id, target_id=first.id
    )
    lead = await create_card(
        db,
        card_type="BusinessProcess",
        name="Lead-to-Order",
        user_id=admin.id,
        subtype="category",
        attributes={"processType": "core"},
    )
    await create_relation(db, type_key="relProcessToBizCtx", source_id=lead.id, target_id=root.id)
    resp = await client.get(URL, headers=auth_headers(admin))
    house = resp.json()["core_house"]
    assert [c["name"] for c in house["level_two"][str(root.id)]] == ["Zeta", "Alpha"]
    assert house["level_three"][str(root.id)] == [
        {
            "id": str(lead.id),
            "name": "Lead-to-Order",
            "has_children": False,
            "group_count": 0,
            "process_count": 0,
            "value_stream_count": 2,
            "value_gate_count": 0,
            "process_type": "core",
        }
    ]


async def test_a_card_with_two_successors_follows_the_newest_relation(client, db, chain_env):
    """`order_leaves` keeps the last successor row per card, so the rows come
    ordered by creation: the newest relation wins, whatever the heap order."""
    admin = chain_env["admin"]
    core = {"hierarchyLevel": 1, "isCore": True}
    names = ("Alpha", "Bravo", "Charlie")
    alpha, bravo, charlie = [
        await create_card(
            db,
            card_type="BusinessContext",
            name=name,
            user_id=admin.id,
            subtype="valueStream",
            attributes=dict(core),
        )
        for name in names
    ]
    # Inserted newest first, so an unordered scan returns the older row last.
    for source, day in ((charlie, 2), (bravo, 1)):
        db.add(
            Relation(
                type="relBusinessContextSuccessor",
                source_id=source.id,
                target_id=alpha.id,
                created_at=datetime(2026, 1, day, tzinfo=timezone.utc),
            )
        )
        await db.flush()
    resp = await client.get(URL, headers=auth_headers(admin))
    assert [s["name"] for s in resp.json()["core_house"]["level_one"]] == [
        "Alpha",
        "Charlie",
        "Bravo",
    ]


async def test_the_report_endpoint_still_answers_with_the_module_off(client, db, chain_env):
    """Module gating is a frontend concern in this codebase - app/api/v1/bpm.py does not
    check bpmEnabled either. Pinned so nobody adds a divergent check."""
    admin = chain_env["admin"]
    flag_url = "/api/v1/settings/value-chain-enabled"
    off = await client.patch(flag_url, json={"enabled": False}, headers=auth_headers(admin))
    assert off.status_code == 200
    assert (await client.get(flag_url)).json() == {"enabled": False}
    resp = await client.get("/api/v1/reports/value-chain", headers=auth_headers(admin))
    assert resp.status_code == 200
