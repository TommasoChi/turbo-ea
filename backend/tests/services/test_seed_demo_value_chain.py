"""The demo seed must light up every part of the Value Chain pages.

Unit half: reads the real demo lists and pins the data shapes the report
builders look for (a level-1 Core value stream, ordered leaves, a cross-cutting
stream, a value gate, a business goal, a process spanning two leaves).
DB half: seeds the whole demo and calls the endpoints as an admin.
"""

from __future__ import annotations

import pytest

from app.services.seed import seed_metamodel
from app.services.seed_demo import (
    BUSINESS_CONTEXTS,
    OBJECTIVES,
    RELATIONS,
    seed_demo_data,
)
from app.services.seed_demo_bpm import _BPM_RELATION_SPECS, PROCESSES, seed_bpm_demo_data
from tests.conftest import auth_headers, create_role, create_user

STREAMS = [c for c in BUSINESS_CONTEXTS if c.get("subtype") == "valueStream"]
ROOTS = [
    c
    for c in STREAMS
    if "parent_id" not in c
    and c["attributes"].get("hierarchyLevel") == 1
    and c["attributes"].get("isCore") is True
]


def _rels(type_key: str) -> list[dict]:
    return [r for r in RELATIONS if r["type"] == type_key]


def _leaves(root: dict) -> list[dict]:
    return [c for c in STREAMS if c.get("parent_id") == root["id"]]


def _name_of(card_id) -> str:
    return next(c["name"] for c in BUSINESS_CONTEXTS if c["id"] == card_id)


def test_exactly_one_level_one_core_value_stream() -> None:
    assert len(ROOTS) == 1
    assert ROOTS[0]["attributes"].get("isCross") is not True


def test_sequence_leaves_have_distinct_sort_order_and_a_chain_of_two() -> None:
    root = ROOTS[0]
    sequence = [c for c in _leaves(root) if c["attributes"].get("isCross") is not True]
    assert len(sequence) == 3
    assert sorted(c["attributes"]["sortOrder"] for c in sequence) == [1, 2, 3]
    ids = {c["id"] for c in sequence}
    chain = [r for r in _rels("relBusinessContextSuccessor") if r["target_id"] in ids]
    # source succeeds target: the chain covers two leaves, the third is ordered
    # by sortOrder alone, so both ordering paths are exercised.
    assert len(chain) == 1
    assert chain[0]["source_id"] in ids and chain[0]["target_id"] in ids


def test_one_cross_cutting_stream_under_the_root() -> None:
    cross = [c for c in _leaves(ROOTS[0]) if c["attributes"].get("isCross") is True]
    assert len(cross) == 1
    assert cross[0]["attributes"]["levelOrder"] == 1


def test_one_value_gate_on_a_leaf_and_one_business_goal_on_the_root() -> None:
    root = ROOTS[0]
    leaf_ids = {c["id"] for c in _leaves(root)}
    by_id = {o["id"]: o for o in OBJECTIVES}
    links = {
        sub: [
            r
            for r in _rels("relObjectiveToBizCtx")
            if r["source_id"] in by_id and by_id[r["source_id"]].get("subtype") == sub
        ]
        for sub in ("valueGate", "businessGoal")
    }
    assert len(links["valueGate"]) == 1
    assert links["valueGate"][0]["target_id"] in leaf_ids
    assert len(links["businessGoal"]) == 1
    assert links["businessGoal"][0]["target_id"] == root["id"]


def test_leaves_link_to_capabilities() -> None:
    leaf_ids = {c["id"] for c in _leaves(ROOTS[0])}
    assert len([r for r in _rels("relBizCtxToBC") if r["source_id"] in leaf_ids]) >= 2


def test_core_category_realizes_the_root_and_processes_cover_adjacent_leaves() -> None:
    root = ROOTS[0]
    sequence = sorted(
        (c for c in _leaves(root) if c["attributes"].get("isCross") is not True),
        key=lambda c: c["attributes"]["sortOrder"],
    )
    names = [c["name"] for c in sequence]
    links = [s for s in _BPM_RELATION_SPECS if s[0] == "relProcessToBizCtx"]
    assert ("relProcessToBizCtx", "bp_cat_core", root["name"]) in links

    by_process: dict[str, list[str]] = {}
    for _, src, tgt, *_ in links:
        if src.startswith("bp_vc_"):
            by_process.setdefault(src, []).append(tgt)
    spans = [t for t in by_process.values() if len(t) == 2]
    singles = [t for t in by_process.values() if len(t) == 1]
    assert len(spans) == 1
    positions = sorted(names.index(n) for n in spans[0])
    assert positions[1] - positions[0] == 1  # adjacent leaves -> contiguous span
    assert len(singles) >= 1

    new = [c for c in PROCESSES if c["attributes"].get("levelOrder") is not None]
    assert sorted({c["attributes"]["levelOrder"] for c in new}) == [1, 2]


def test_all_three_bands_have_a_category() -> None:
    bands = {c["attributes"]["processType"] for c in PROCESSES if c.get("subtype") == "category"}
    assert bands == {"core", "management", "support"}


@pytest.mark.asyncio
async def test_demo_seed_populates_the_value_chain_pages(db, client) -> None:
    await seed_metamodel(db)
    await seed_demo_data(db)
    await seed_bpm_demo_data(db)
    await create_role(db, key="admin_vc", label="Admin", permissions={"*": True}, is_system=False)
    admin = await create_user(db, email="vc-admin@test.com", role="admin_vc")
    await db.commit()

    chain = await client.get("/api/v1/reports/value-chain", headers=auth_headers(admin))
    assert chain.status_code == 200
    body = chain.json()
    core = next(b for b in body["bands"] if b["key"] == "core")
    assert [b["name"] for b in core["boxes"]] == ["Core Business Processes"]
    house = body["core_house"]
    assert len(house["level_one"]) == 1
    root_id = house["level_one"][0]["id"]
    # Sequence leaves in order, then the cross-cutting stream (no sortOrder).
    assert [i["name"] for i in house["level_two"][root_id]] == [
        "Engineer Product",
        "Build & Verify",
        "Deliver & Support",
        "Quality & Compliance Assurance",
    ]

    category_id = core["boxes"][0]["id"]
    stream = await client.get(
        f"/api/v1/reports/value-chain/{category_id}", headers=auth_headers(admin)
    )
    assert stream.status_code == 200
    roots = stream.json()["roots"]
    assert len(roots) == 1
    root = roots[0]
    assert len(root["sequence"]) == 3
    assert len(root["cross"]) == 1
    assert len(root["spans"]) == 1
    assert root["spans"][0]["end_index"] - root["spans"][0]["start_index"] == 1
    assert len(root["gates"]) == 1
    assert len(root["goals"]) == 1
    assert root["row_count"] == 2
    assert len(root["capabilities"]) >= 2
