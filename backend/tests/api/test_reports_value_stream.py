"""Integration tests for the Value Stream drill-down,
GET /reports/value-chain/{category_id}."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models.card_type import CardType
from app.models.process_element import ProcessElement, ProcessElementOrganization
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
async def stream_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions={"bpm.value_chain": True, "bpm.view": True, "inventory.view": True},
    )
    await create_role(
        db,
        key="chainonly",
        label="Chain only",
        permissions={"bpm.value_chain": True, "inventory.view": True},
    )
    await create_role(db, key="nochain", label="No Chain", permissions={"inventory.view": True})
    for key, label in (
        ("BusinessProcess", "Business Process"),
        ("BusinessContext", "Business Context"),
        ("BusinessCapability", "Business Capability"),
        ("Objective", "Objective"),
        ("Application", "Application"),
        ("DataObject", "Data Object"),
        ("Organization", "Organization"),
    ):
        await create_card_type(db, key=key, label=label)
    for key, source, target in (
        ("relProcessToBizCtx", "BusinessProcess", "BusinessContext"),
        ("relBizCtxToBC", "BusinessContext", "BusinessCapability"),
        ("relObjectiveToBizCtx", "Objective", "BusinessContext"),
        ("relBusinessContextSuccessor", "BusinessContext", "BusinessContext"),
    ):
        await create_relation_type(
            db, key=key, label=key, source_type_key=source, target_type_key=target
        )
    return {
        "admin": await create_user(db, email="admin@test.com", role="admin"),
        "viewer": await create_user(db, email="viewer@test.com", role="viewer"),
        "chainonly": await create_user(db, email="chainonly@test.com", role="chainonly"),
        "nochain": await create_user(db, email="nochain@test.com", role="nochain"),
    }


async def deny_view(db, type_key: str, role_key: str) -> None:
    ct = (await db.execute(select(CardType).where(CardType.key == type_key))).scalar_one()
    ct.role_permissions = {role_key: {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()


async def add_step(db, process, *, application=None, data_object=None, organizations=()):
    element = ProcessElement(
        process_id=process.id,
        bpmn_element_id=f"Task_{uuid.uuid4().hex[:8]}",
        element_type="task",
        name="Step",
        application_id=application.id if application else None,
        data_object_id=data_object.id if data_object else None,
    )
    db.add(element)
    await db.flush()
    for org in organizations:
        db.add(ProcessElementOrganization(element_id=element.id, organization_id=org.id))
    await db.flush()
    return element


async def category(db, admin, **kwargs):
    return await create_card(
        db,
        card_type="BusinessProcess",
        name="Sales",
        user_id=admin.id,
        subtype="category",
        attributes={"processType": "core"},
        **kwargs,
    )


async def sales_flow(db, admin):
    """Sales -> Order to Cash (Quote, Invoice) + a process on Quote."""
    cat = await category(db, admin)
    root = await create_card(
        db,
        card_type="BusinessContext",
        name="Order to Cash",
        user_id=admin.id,
        subtype="valueStream",
    )
    quote = await create_card(
        db,
        card_type="BusinessContext",
        name="Quote",
        user_id=admin.id,
        subtype="valueStream",
        parent_id=root.id,
        attributes={"sortOrder": 1},
    )
    invoice = await create_card(
        db,
        card_type="BusinessContext",
        name="Invoice",
        user_id=admin.id,
        subtype="valueStream",
        parent_id=root.id,
        attributes={"sortOrder": 2},
    )
    process = await create_card(
        db,
        card_type="BusinessProcess",
        name="Quoting",
        user_id=admin.id,
        subtype="process",
        parent_id=cat.id,
        attributes={"processType": "core", "riskLevel": "low", "levelOrder": 1},
    )
    await create_relation(db, type_key="relProcessToBizCtx", source_id=cat.id, target_id=root.id)
    await create_relation(
        db, type_key="relProcessToBizCtx", source_id=process.id, target_id=quote.id
    )
    return {"cat": cat, "root": root, "quote": quote, "invoice": invoice, "process": process}


def root_of(resp):
    assert resp.status_code == 200, resp.text
    roots = resp.json()["roots"]
    assert len(roots) == 1
    return roots[0]


# --- status codes ------------------------------------------------------------


async def test_unknown_category_is_404(client, db, stream_env):
    resp = await client.get(f"{URL}/{uuid.uuid4()}", headers=auth_headers(stream_env["viewer"]))
    assert resp.status_code == 404


async def test_a_malformed_id_is_404(client, db, stream_env):
    resp = await client.get(f"{URL}/not-a-uuid", headers=auth_headers(stream_env["viewer"]))
    assert resp.status_code == 404


async def test_requires_the_permission(client, db, stream_env):
    cat = await category(db, stream_env["admin"])
    resp = await client.get(f"{URL}/{cat.id}", headers=auth_headers(stream_env["nochain"]))
    assert resp.status_code == 403


async def test_the_permission_is_checked_before_the_id(client, db, stream_env):
    resp = await client.get(
        f"{URL}/{uuid.uuid4()}?related=nonsense", headers=auth_headers(stream_env["nochain"])
    )
    assert resp.status_code == 403


async def test_rejects_an_unknown_related_mode(client, db, stream_env):
    cat = await category(db, stream_env["admin"])
    resp = await client.get(
        f"{URL}/{cat.id}?related=nonsense", headers=auth_headers(stream_env["admin"])
    )
    assert resp.status_code == 400


async def test_a_card_that_is_not_a_category_is_404(client, db, stream_env):
    admin = stream_env["admin"]
    group = await create_card(
        db, card_type="BusinessProcess", name="Group", user_id=admin.id, subtype="group"
    )
    stream = await create_card(
        db, card_type="BusinessContext", name="Stream", user_id=admin.id, subtype="category"
    )
    for card in (group, stream):
        resp = await client.get(f"{URL}/{card.id}", headers=auth_headers(admin))
        assert resp.status_code == 404


async def test_an_archived_category_is_404(client, db, stream_env):
    admin = stream_env["admin"]
    archived = await category(db, admin, status="ARCHIVED")
    soft = await category(db, admin)
    soft.archived_at = datetime.now(timezone.utc)
    await db.flush()
    for card in (archived, soft):
        resp = await client.get(f"{URL}/{card.id}", headers=auth_headers(admin))
        assert resp.status_code == 404


async def test_a_category_hidden_by_the_read_scope_is_404(client, db, stream_env):
    cat = await category(db, stream_env["admin"])
    resp = await client.get(f"{URL}/{cat.id}", headers=auth_headers(stream_env["viewer"]))
    assert resp.status_code == 200
    await deny_view(db, "BusinessProcess", "viewer")
    resp = await client.get(f"{URL}/{cat.id}", headers=auth_headers(stream_env["viewer"]))
    assert resp.status_code == 404


# --- payload -----------------------------------------------------------------


async def test_a_category_without_streams_has_no_roots(client, db, stream_env):
    cat = await category(db, stream_env["admin"])
    resp = await client.get(f"{URL}/{cat.id}", headers=auth_headers(stream_env["viewer"]))
    assert resp.status_code == 200
    assert resp.json() == {"roots": []}


async def test_cross_cutting_stream_is_separated_from_the_sequence(client, db, stream_env):
    admin = stream_env["admin"]
    cat = await category(db, admin)
    root = await create_card(
        db,
        card_type="BusinessContext",
        name="Order to Cash",
        user_id=admin.id,
        subtype="valueStream",
    )
    quote = await create_card(
        db,
        card_type="BusinessContext",
        name="Quote",
        user_id=admin.id,
        subtype="valueStream",
        parent_id=root.id,
        attributes={"sortOrder": 1},
    )
    invoice = await create_card(
        db,
        card_type="BusinessContext",
        name="Invoice",
        user_id=admin.id,
        subtype="valueStream",
        parent_id=root.id,
        attributes={"sortOrder": 2},
    )
    await create_card(
        db,
        card_type="BusinessContext",
        name="Monitoring",
        user_id=admin.id,
        subtype="valueStream",
        parent_id=root.id,
        attributes={"isCross": "True", "levelOrder": 1},
    )
    await create_relation(db, type_key="relProcessToBizCtx", source_id=cat.id, target_id=root.id)

    resp = await client.get(f"{URL}/{cat.id}", headers=auth_headers(admin))
    root_payload = root_of(resp)
    assert [s["name"] for s in root_payload["cross"]] == ["Monitoring"]
    assert [s["name"] for s in root_payload["sequence"]] == ["Quote", "Invoice"]
    assert str(quote.id) in [s["id"] for s in root_payload["sequence"]]
    assert str(invoice.id) in [s["id"] for s in root_payload["sequence"]]


async def test_contiguous_process_renders_as_one_span(client, db, stream_env):
    admin = stream_env["admin"]
    cat = await category(db, admin)
    root = await create_card(
        db,
        card_type="BusinessContext",
        name="Order to Cash",
        user_id=admin.id,
        subtype="valueStream",
    )
    first = await create_card(
        db,
        card_type="BusinessContext",
        name="Quote",
        user_id=admin.id,
        subtype="valueStream",
        parent_id=root.id,
        attributes={"sortOrder": 1},
    )
    second = await create_card(
        db,
        card_type="BusinessContext",
        name="Invoice",
        user_id=admin.id,
        subtype="valueStream",
        parent_id=root.id,
        attributes={"sortOrder": 2},
    )
    shared = await create_card(
        db,
        card_type="BusinessProcess",
        name="Order handling",
        user_id=admin.id,
        subtype="process",
        parent_id=cat.id,
        attributes={"levelOrder": 1},
    )
    await create_relation(db, type_key="relProcessToBizCtx", source_id=cat.id, target_id=root.id)
    await create_relation(
        db, type_key="relProcessToBizCtx", source_id=shared.id, target_id=first.id
    )
    await create_relation(
        db, type_key="relProcessToBizCtx", source_id=shared.id, target_id=second.id
    )

    resp = await client.get(f"{URL}/{cat.id}", headers=auth_headers(admin))
    root_payload = root_of(resp)
    assert root_payload["spans"] == [
        {
            "process_id": str(shared.id),
            "start_index": 0,
            "end_index": 1,
            "leaf_ids": [str(first.id), str(second.id)],
        }
    ]
    assert root_payload["singles"] == []
    assert root_payload["row_count"] == 1


async def test_the_full_payload_for_a_small_flow(client, db, stream_env):
    admin = stream_env["admin"]
    env = await sales_flow(db, admin)
    gate = await create_card(
        db,
        card_type="Objective",
        name="Quote approved",
        user_id=admin.id,
        subtype="valueGate",
        attributes={"objectiveType": "operational"},
    )
    goal = await create_card(
        db,
        card_type="Objective",
        name="Faster cash",
        user_id=admin.id,
        subtype="businessGoal",
        description="Cut DSO",
    )
    cap = await create_card(db, card_type="BusinessCapability", name="Pricing", user_id=admin.id)
    await create_relation(
        db, type_key="relObjectiveToBizCtx", source_id=gate.id, target_id=env["quote"].id
    )
    await create_relation(
        db, type_key="relObjectiveToBizCtx", source_id=goal.id, target_id=env["root"].id
    )
    await create_relation(
        db, type_key="relBizCtxToBC", source_id=env["invoice"].id, target_id=cap.id
    )
    await add_step(db, env["process"])
    await add_step(db, env["process"])

    resp = await client.get(f"{URL}/{env['cat'].id}", headers=auth_headers(stream_env["viewer"]))
    p, quote, invoice = env["process"], env["quote"], env["invoice"]
    assert resp.json() == {
        "roots": [
            {
                "id": str(env["root"].id),
                "name": "Order to Cash",
                "sequence": [
                    {"id": str(quote.id), "name": "Quote", "parent_id": None, "parent_name": None},
                    {
                        "id": str(invoice.id),
                        "name": "Invoice",
                        "parent_id": None,
                        "parent_name": None,
                    },
                ],
                "cross": [],
                "spans": [],
                "singles": [{"process_id": str(p.id), "leaf_id": str(quote.id), "index": 0}],
                "leaf_processes": {
                    str(quote.id): [{"id": str(p.id), "children": []}],
                    str(invoice.id): [],
                },
                "cross_processes": [],
                "row_count": 1,
                "row_of_process": {str(p.id): 0},
                "process_count": 1,
                "processes": {
                    str(p.id): {
                        "id": str(p.id),
                        "name": "Quoting",
                        "subtype": "process",
                        "element_count": 2,
                        "color_attributes": {
                            "processType": "core",
                            "maturity": None,
                            "automationLevel": None,
                            "riskLevel": "low",
                        },
                        "related": [],
                    }
                },
                "gates": [
                    {
                        "id": str(gate.id),
                        "name": "Quote approved",
                        "leaf_id": str(quote.id),
                        "objective_type": "operational",
                    }
                ],
                "capabilities": [
                    {
                        "id": str(cap.id),
                        "name": "Pricing",
                        "leaf_id": str(invoice.id),
                        "group_id": str(cap.id),
                        "group_name": "Pricing",
                    }
                ],
                "goals": [{"id": str(goal.id), "name": "Faster cash", "description": "Cut DSO"}],
            }
        ]
    }


async def test_response_matches_the_documented_schema(client, db, stream_env):
    from app.schemas.value_chain import ValueStreamResponse

    admin = stream_env["admin"]
    env = await sales_flow(db, admin)
    app = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
    await add_step(db, env["process"], application=app)
    resp = await client.get(
        f"{URL}/{env['cat'].id}?related=applications", headers=auth_headers(admin)
    )
    assert resp.status_code == 200
    parsed = ValueStreamResponse.model_validate(resp.json())
    assert parsed.model_dump() == resp.json()


# --- related modes -----------------------------------------------------------


async def related_env(db, admin):
    env = await sales_flow(db, admin)
    crm = await create_card(db, card_type="Application", name="CRM", user_id=admin.id)
    erp = await create_card(db, card_type="Application", name="ERP", user_id=admin.id)
    archived_app = await create_card(
        db, card_type="Application", name="Legacy", user_id=admin.id, status="ARCHIVED"
    )
    order = await create_card(db, card_type="DataObject", name="Order", user_id=admin.id)
    sales_team = await create_card(
        db, card_type="Organization", name="Sales Team", user_id=admin.id
    )
    finance = await create_card(db, card_type="Organization", name="Finance", user_id=admin.id)
    p = env["process"]
    await add_step(db, p, application=erp, data_object=order, organizations=[sales_team])
    await add_step(db, p, application=crm, organizations=[finance, sales_team])
    await add_step(db, p, application=crm)
    await add_step(db, p, application=archived_app)
    return {**env, "crm": crm, "erp": erp, "order": order, "sales": sales_team, "fin": finance}


def related_of(resp, process):
    return root_of(resp)["processes"][str(process.id)]["related"]


async def test_related_defaults_to_none(client, db, stream_env):
    admin = stream_env["admin"]
    env = await related_env(db, admin)
    resp = await client.get(f"{URL}/{env['cat'].id}", headers=auth_headers(admin))
    assert related_of(resp, env["process"]) == []
    resp = await client.get(f"{URL}/{env['cat'].id}?related=none", headers=auth_headers(admin))
    assert related_of(resp, env["process"]) == []
    assert root_of(resp)["processes"][str(env["process"].id)]["element_count"] == 4


async def test_related_applications(client, db, stream_env):
    admin = stream_env["admin"]
    env = await related_env(db, admin)
    resp = await client.get(
        f"{URL}/{env['cat'].id}?related=applications", headers=auth_headers(admin)
    )
    # Distinct, by name; the archived application is not visible.
    assert related_of(resp, env["process"]) == [
        {"id": str(env["crm"].id), "name": "CRM"},
        {"id": str(env["erp"].id), "name": "ERP"},
    ]


async def test_related_data_objects(client, db, stream_env):
    admin = stream_env["admin"]
    env = await related_env(db, admin)
    resp = await client.get(
        f"{URL}/{env['cat'].id}?related=dataObjects", headers=auth_headers(admin)
    )
    assert related_of(resp, env["process"]) == [{"id": str(env["order"].id), "name": "Order"}]


async def test_related_organization(client, db, stream_env):
    admin = stream_env["admin"]
    env = await related_env(db, admin)
    resp = await client.get(
        f"{URL}/{env['cat'].id}?related=organization", headers=auth_headers(admin)
    )
    assert related_of(resp, env["process"]) == [
        {"id": str(env["fin"].id), "name": "Finance"},
        {"id": str(env["sales"].id), "name": "Sales Team"},
    ]


async def test_a_denied_related_type_yields_no_related_items(client, db, stream_env):
    admin, viewer = stream_env["admin"], stream_env["viewer"]
    env = await related_env(db, admin)
    url = f"{URL}/{env['cat'].id}?related=applications"
    assert len(related_of(await client.get(url, headers=auth_headers(viewer)), env["process"])) == 2
    await deny_view(db, "Application", "viewer")
    assert related_of(await client.get(url, headers=auth_headers(viewer)), env["process"]) == []


async def test_without_bpm_view_the_steps_are_not_read(client, db, stream_env):
    """The page read steps through /bpm/processes/{id}/elements (bpm.view);
    without it every call failed and degraded to no elements."""
    admin = stream_env["admin"]
    env = await related_env(db, admin)
    resp = await client.get(
        f"{URL}/{env['cat'].id}?related=applications",
        headers=auth_headers(stream_env["chainonly"]),
    )
    info = root_of(resp)["processes"][str(env["process"].id)]
    assert info["element_count"] == 0
    assert info["related"] == []


# --- read scope --------------------------------------------------------------


async def test_denied_types_produce_no_phantom_entries(client, db, stream_env):
    admin, viewer = stream_env["admin"], stream_env["viewer"]
    env = await sales_flow(db, admin)
    gate = await create_card(
        db, card_type="Objective", name="Gate", user_id=admin.id, subtype="valueGate"
    )
    await create_relation(
        db, type_key="relObjectiveToBizCtx", source_id=gate.id, target_id=env["quote"].id
    )
    url = f"{URL}/{env['cat'].id}"
    assert len(root_of(await client.get(url, headers=auth_headers(viewer)))["gates"]) == 1

    await deny_view(db, "Objective", "viewer")
    assert root_of(await client.get(url, headers=auth_headers(viewer)))["gates"] == []

    await deny_view(db, "BusinessContext", "viewer")
    resp = await client.get(url, headers=auth_headers(viewer))
    assert resp.status_code == 200
    assert resp.json() == {"roots": []}

    # The admin is not affected by the viewer's deny.
    assert len(root_of(await client.get(url, headers=auth_headers(admin)))["gates"]) == 1
