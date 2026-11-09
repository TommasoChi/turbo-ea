import asyncio
import uuid

import pytest
from sqlalchemy import delete, event, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.relations import apply_relation_operations
from app.models.bo_operation_receipt import BoOperationReceipt
from app.models.card import Card
from app.models.card_type import CardType
from app.models.diagram import Diagram
from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.role import Role
from app.models.stakeholder import Stakeholder
from app.models.user import User
from app.models.user_favorite import UserFavorite
from app.schemas.bo_relationship import (
    BoApplication,
    BoApplicationLink,
    BoEdge,
    BoInventoryItem,
    BoLayoutUpdate,
    BoRelationDraft,
)
from app.schemas.relation import RelationBulkOperation
from app.services.bo_relationship import (
    ErDeleteEvidence,
    inventory_item_revision,
    save_bo_layout,
)
from app.services.bo_relationship import set_bo_master as assign_master
from app.services.bo_relationship_constants import BO_RELATIONSHIP_KIND, ER_DELETE_RECEIPT
from app.services.bo_relationship_writes import create_er_draft
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

pytestmark = pytest.mark.anyio

BASE = "/api/v1/bo-relationship"
ER = "relDataObjectToDataObject"
APP_LINK = "relAppToDataObj"


@pytest.fixture
async def env(db):
    permissions = {"boRelationship.view": True, "boRelationship.edit": True}
    await create_role(db)
    await create_role(db, key="viewer", permissions={"boRelationship.view": True})
    await create_role(db, key="editor", permissions=permissions)
    await create_role(
        db,
        key="partial",
        permissions={**permissions, "relations.manage": True, "inventory.edit": True},
    )
    await create_card_type(db, key="DataObject", subtypes=[{"key": "Data"}, {"key": "Document"}])
    await create_card_type(
        db,
        key="Application",
        subtypes=[{"key": "Restricted"}],
        role_permissions={
            "partial": {"inventory.view": {"value": False, "subtypes": ["Restricted"]}}
        },
    )
    await create_relation_type(
        db, key=ER, source_type_key="DataObject", target_type_key="DataObject"
    )
    await create_relation_type(
        db, key=APP_LINK, source_type_key="Application", target_type_key="DataObject"
    )
    return {
        key: auth_headers(await create_user(db, role=key))
        for key in ("admin", "viewer", "editor", "partial")
    }


async def bo(db, name="Customer"):
    return await create_card(db, card_type="DataObject", subtype="Data", name=name)


async def test_draft_object_recovers_lost_response_and_does_not_recreate_deleted_card(
    client, db, env
):
    url = f"{BASE}/objects/{uuid.uuid4()}"
    body = {"name": "Order", "subtype": "Data"}
    assert (await client.put(url, json=body, headers=env["viewer"])).status_code == 403
    assert (await client.put(url, json=body, headers=env["editor"])).status_code == 403
    assert (await client.put(url, json={"name": "Order"}, headers=env["admin"])).status_code == 422

    first = await client.put(url, json=body, headers=env["admin"])
    assert first.status_code == 200
    original = first.json()
    assert original == {
        "id": original["id"],
        "name": "Order",
        "subtype": "Data",
        "isPersonalData": False,
        "isPaymentData": False,
    }
    replay = await client.put(url, json=body, headers=env["admin"])
    assert replay.json() == original
    card_id = uuid.UUID(original["id"])
    assert list(await db.scalars(select(Card.id).where(Card.type == "DataObject"))) == [card_id]
    assert (
        len(
            list(
                await db.scalars(
                    select(Event).where(
                        Event.event_type == "card.created", Event.card_id == card_id
                    )
                )
            )
        )
        == 1
    )
    assert (
        await client.put(url, json={**body, "name": "Different"}, headers=env["admin"])
    ).status_code == 409
    await db.execute(delete(Card).where(Card.id == card_id))
    assert (await client.put(url, json=body, headers=env["admin"])).status_code == 404
    assert not list(await db.scalars(select(Card.id).where(Card.type == "DataObject")))


async def test_object_draft_checks_subtype_grants_and_current_read_scope(client, db, env):
    card_type = await db.scalar(select(CardType).where(CardType.key == "DataObject"))
    card_type.fields_schema = [{"fields": [{"key": "isPersonalData", "type": "boolean"}]}]
    card_type.role_permissions = {
        "editor": {
            "inventory.create": {"value": True, "subtypes": ["Data"]},
            "inventory.view": {"value": False, "subtypes": ["Document"]},
        }
    }
    await db.flush()
    PermissionService.invalidate_type_permission_cache()
    url = f"{BASE}/objects/{uuid.uuid4()}"
    body = {"name": "Order", "subtype": "Data", "isPersonalData": True, "isPaymentData": True}
    denied = await client.put(url, json={**body, "subtype": "Document"}, headers=env["editor"])
    assert denied.status_code == 403
    created = await client.put(url, json=body, headers=env["editor"])
    assert created.status_code == 200
    assert created.json()["isPersonalData"] is True
    assert created.json()["isPaymentData"] is False
    card = await db.get(Card, uuid.UUID(created.json()["id"]))
    assert card.attributes == {"isPersonalData": True}
    card.subtype = "Document"
    await db.flush()
    assert (await client.put(url, json=body, headers=env["editor"])).status_code == 404
    invalid_subtype = await client.put(
        f"{BASE}/objects/{uuid.uuid4()}",
        json={**body, "subtype": "Unknown"},
        headers=env["admin"],
    )
    assert invalid_subtype.status_code == 422


async def test_er_draft_reuses_reverse_link_and_preserves_subsequent_attribute_edit(
    client, db, env
):
    a, b, c = await bo(db), await bo(db, "Order"), await bo(db, "Address")
    url = f"{BASE}/relation-drafts/{uuid.uuid4()}"
    body = {"source_id": str(a.id), "target_id": str(b.id), "cardinality": "1:n"}
    assert (await client.put(url, json=body, headers=env["editor"])).status_code == 403
    assert (
        await client.put(url, json={**body, "cardinality": "2:5"}, headers=env["admin"])
    ).status_code == 422
    assert (
        await client.put(url, json={**body, "target_id": str(a.id)}, headers=env["admin"])
    ).status_code == 422
    first = await client.put(url, json=body, headers=env["admin"])
    assert first.status_code == 200
    edge = first.json()
    assert edge["cardinality"] == "1:n"
    reverse = await client.put(
        f"{BASE}/relation-drafts/{uuid.uuid4()}",
        json={"source_id": str(b.id), "target_id": str(a.id), "cardinality": "1:1"},
        headers=env["admin"],
    )
    assert reverse.status_code == 200
    assert reverse.json() == edge
    edit = await client.patch(
        f"/api/v1/relations/{edge['id']}",
        json={"attributes": {"cardinality": "n:m"}},
        headers=env["admin"],
    )
    assert edit.status_code == 200
    replay = await client.put(url, json=body, headers=env["admin"])
    assert replay.status_code == 200
    assert replay.json() == {**edge, "cardinality": "n:m"}
    for src, tgt in ((a, c), (b, c)):
        response = await client.put(
            f"{BASE}/relation-drafts/{uuid.uuid4()}",
            json={"source_id": str(src.id), "target_id": str(tgt.id)},
            headers=env["admin"],
        )
        assert response.status_code == 200
        assert response.json()["cardinality"] is None
        assert (await db.get(Relation, uuid.UUID(response.json()["id"]))).attributes == {}
    assert len(list(await db.scalars(select(Relation.id).where(Relation.type == ER)))) == 3
    assert (
        await client.delete(f"{BASE}/relations/{edge['id']}", headers=env["admin"])
    ).status_code == 204
    assert (await client.put(url, json=body, headers=env["admin"])).status_code == 404


async def test_reverse_bulk_create_waits_for_uncommitted_er_draft(test_engine):
    async with AsyncSession(test_engine, expire_on_commit=False) as setup, setup.begin():
        admin = await create_role(setup, key="bo-er-concurrent-admin")
        actor = await create_user(setup, role=admin.key)
        card_type = await create_card_type(setup, key="DataObject")
        relation_type = await create_relation_type(
            setup, key=ER, source_type_key="DataObject", target_type_key="DataObject"
        )
        a, b = await bo(setup), await bo(setup, "Order")

    try:
        second_reached_write = asyncio.Event()

        def observe_write(_conn, _cursor, statement, _params, _context, _executemany):
            if "pg_advisory_xact_lock" in statement or "INSERT INTO relations" in statement:
                second_reached_write.set()

        async def reverse_bulk_create():
            async with AsyncSession(test_engine) as session, session.begin():
                connection = await session.connection()
                event.listen(connection.sync_connection, "before_cursor_execute", observe_write)
                return await apply_relation_operations(
                    session,
                    [
                        RelationBulkOperation(
                            row_index=0, type=ER, source={"id": str(b.id)}, target={"id": str(a.id)}
                        )
                    ],
                    actor_id=actor.id,
                    dry_run=False,
                )

        async with AsyncSession(test_engine, expire_on_commit=False) as first_writer:
            first = await create_er_draft(
                first_writer,
                actor,
                uuid.uuid4(),
                BoRelationDraft(source_id=a.id, target_id=b.id, cardinality="1:n"),
            )
            second = asyncio.create_task(reverse_bulk_create())
            try:
                await asyncio.wait_for(second_reached_write.wait(), timeout=5)
                await first_writer.commit()
                results, upserted, deleted, failed = await asyncio.wait_for(second, timeout=10)
            finally:
                if not second.done():
                    second.cancel()
                    await asyncio.gather(second, return_exceptions=True)

        assert (upserted, deleted, failed) == (1, 0, 0)
        assert results[0].relation_id == str(first.id)
        async with AsyncSession(test_engine) as verify:
            rows = list(await verify.scalars(select(Relation).where(Relation.type == ER)))
            assert [(row.id, row.source_id, row.target_id, row.attributes) for row in rows] == [
                (first.id, a.id, b.id, {"cardinality": "1:n"})
            ]
    finally:
        async with AsyncSession(test_engine) as cleanup, cleanup.begin():
            await cleanup.execute(
                delete(BoOperationReceipt).where(BoOperationReceipt.actor_id == actor.id)
            )
            await cleanup.execute(delete(Event).where(Event.user_id == actor.id))
            await cleanup.execute(
                delete(MutationBatch).where(MutationBatch.actor_user_id == actor.id)
            )
            await cleanup.execute(delete(Card).where(Card.id.in_([a.id, b.id])))
            await cleanup.execute(delete(RelationType).where(RelationType.id == relation_type.id))
            await cleanup.execute(delete(CardType).where(CardType.id == card_type.id))
            await cleanup.execute(delete(User).where(User.id == actor.id))
            await cleanup.execute(delete(Role).where(Role.id == admin.id))
        PermissionService.invalidate_role_cache(admin.key)
        PermissionService.invalidate_type_permission_cache()


async def test_application_drafts_wait_for_visible_master_and_do_not_replay_transfer(
    client, db, env
):
    node = await bo(db)
    a, b = await create_card(db, name="Alpha"), await create_card(db, name="Beta")
    slave_url = f"{BASE}/application-link-drafts/{uuid.uuid4()}"
    slave = {"object_id": str(node.id), "application_id": str(b.id), "role": "slave"}
    # The API fixture reuses one session. Roll back this failed request the
    # way the production dependency does when its per-request session closes.
    async with db.begin_nested() as failed_request:
        pending = await client.put(slave_url, json=slave, headers=env["admin"])
        assert pending.status_code == 409
        assert pending.json()["detail"] == "A visible Master is required"
        await failed_request.rollback()
    assert (await client.put(slave_url, json=slave, headers=env["editor"])).status_code == 403
    assert (
        await client.put(slave_url, json={**slave, "role": "invalid"}, headers=env["admin"])
    ).status_code == 422
    assert not list(await db.scalars(select(Relation.id).where(Relation.type == APP_LINK)))

    first_url = f"{BASE}/application-link-drafts/{uuid.uuid4()}"
    first_body = {**slave, "application_id": str(a.id), "role": "master"}
    first = await client.put(first_url, json=first_body, headers=env["admin"])
    assert first.status_code == 200
    assert first.json()["is_master"] is True
    assert (await client.put(slave_url, json=slave, headers=env["admin"])).status_code == 200
    assert (
        await client.patch(
            f"/api/v1/relations/{first.json()['id']}",
            json={"attributes": {"read": True}},
            headers=env["admin"],
        )
    ).status_code == 200
    later = await client.put(
        f"{BASE}/application-link-drafts/{uuid.uuid4()}",
        json={**slave, "role": "master"},
        headers=env["admin"],
    )
    assert later.status_code == 200
    assert later.json()["is_master"] is True
    original = await db.get(Relation, uuid.UUID(first.json()["id"]))
    assert original.attributes == {"read": True}
    replay = await client.put(first_url, json=first_body, headers=env["admin"])
    assert replay.status_code == 200
    assert replay.json() == {**first.json(), "is_master": False}
    assert list(
        await db.scalars(
            select(Relation.id).where(
                Relation.type == APP_LINK, Relation.attributes["dataOwnership"].astext == "master"
            )
        )
    ) == [uuid.UUID(later.json()["id"])]


async def test_layout_publishes_successful_drafts_after_snapshot_exists(client, db, env):
    a = await bo(db)
    assert (await client.put(f"{BASE}/layout", json={}, headers=env["admin"])).status_code == 200
    node_draft, edge_draft, app_draft = (str(uuid.uuid4()) for _ in range(3))
    node = await client.put(
        f"{BASE}/objects/{node_draft}",
        json={"name": "Order", "subtype": "Data"},
        headers=env["admin"],
    )
    assert node.status_code == 200
    b = node.json()["id"]
    edge = await client.put(
        f"{BASE}/relation-drafts/{edge_draft}",
        json={"source_id": str(a.id), "target_id": b},
        headers=env["admin"],
    )
    assert edge.status_code == 200
    app = await create_card(db, name="Alpha")
    app_link = await client.put(
        f"{BASE}/application-link-drafts/{app_draft}",
        json={"object_id": b, "application_id": str(app.id), "role": "master"},
        headers=env["admin"],
    )
    assert app_link.status_code == 200
    unrelated = await bo(db, "Other")
    drafts = [
        {"kind": "node", "id": node_draft},
        {"kind": "edge", "id": edge_draft},
        {"kind": "application_link", "id": app_draft},
    ]
    saved = await client.put(
        f"{BASE}/layout",
        json={"saved_drafts": drafts, "positions": {b: {"x": 12, "y": 24}}},
        headers=env["admin"],
    )
    assert saved.status_code == 200
    reopened = (await client.get(BASE, headers=env["viewer"])).json()
    assert {node["id"] for node in reopened["nodes"]} == {str(a.id), b}
    assert str(unrelated.id) not in reopened["positions"]
    assert reopened["positions"] == {b: {"x": 12, "y": 24}}
    assert reopened["edges"] == [edge.json()]
    assert reopened["applications"][b]["master"] == {"id": str(app.id), "name": "Alpha"}

    removed = await client.put(
        f"{BASE}/layout",
        json={"removed_relation_ids": [edge.json()["id"]]},
        headers=env["editor"],
    )
    assert removed.status_code == 200
    assert removed.json()["edges"] == []
    replay = await client.put(f"{BASE}/layout", json={"saved_drafts": drafts}, headers=env["admin"])
    assert replay.status_code == 200
    assert replay.json()["edges"] == []
    assert await db.get(Relation, uuid.UUID(edge.json()["id"])) is not None


async def test_er_delete_replays_only_for_authorized_actor_without_reemitting_events(
    client, db, env
):
    a, b = await bo(db), await bo(db, "Order")
    er = await create_relation(db, type_key=ER, source_id=a.id, target_id=b.id)
    await create_relation_type(
        db, key="other-link", source_type_key="DataObject", target_type_key="DataObject"
    )
    other = await create_relation(db, type_key="other-link", source_id=a.id, target_id=b.id)
    url = f"{BASE}/relations/{er.id}"
    assert (
        await client.delete(f"{BASE}/relations/invalid-id", headers=env["admin"])
    ).status_code == 422
    assert (await client.delete(url, headers=env["viewer"])).status_code == 403
    assert (await client.delete(url, headers=env["editor"])).status_code == 403
    assert (
        await client.delete(f"{BASE}/relations/{other.id}", headers=env["admin"])
    ).status_code == 404
    assert (await client.delete(url, headers=env["partial"])).status_code == 204
    assert (await client.delete(url, headers=env["partial"])).status_code == 204
    assert (await client.delete(url, headers=env["admin"])).status_code == 404
    assert await db.scalar(select(Relation.id).where(Relation.id == er.id)) is None
    assert await db.scalar(select(Relation.id).where(Relation.id == other.id)) == other.id
    assert set(
        await db.scalars(select(Event.card_id).where(Event.event_type == "relation.deleted"))
    ) == {a.id, b.id}
    assert (
        len(list(await db.scalars(select(Event.id).where(Event.event_type == "relation.deleted"))))
        == 2
    )

    card_type = await db.scalar(select(CardType).where(CardType.key == "DataObject"))
    card_type.role_permissions = {
        "partial": {"inventory.view": {"value": False, "subtypes": ["Document"]}}
    }
    a.subtype = "Document"
    await db.flush()
    PermissionService.invalidate_type_permission_cache()
    assert (await client.delete(url, headers=env["partial"])).status_code == 404

    role = await db.scalar(select(Role).where(Role.key == "partial"))
    role.permissions = {**role.permissions, "relations.manage": False}
    await db.flush()
    PermissionService.invalidate_role_cache("partial")
    assert (await client.delete(url, headers=env["partial"])).status_code == 403


async def test_unavailable_draft_results_do_not_block_unrelated_layout_positions(client, db, env):
    customer = await bo(db)
    assert (await client.put(f"{BASE}/layout", json={}, headers=env["admin"])).status_code == 200
    draft_id, link_draft_id = str(uuid.uuid4()), str(uuid.uuid4())
    node = await client.put(
        f"{BASE}/objects/{draft_id}",
        json={"name": "Order", "subtype": "Data"},
        headers=env["admin"],
    )
    assert node.status_code == 200
    order_id = node.json()["id"]
    edge = await client.put(
        f"{BASE}/relation-drafts/{link_draft_id}",
        json={"source_id": str(customer.id), "target_id": order_id},
        headers=env["admin"],
    )
    assert edge.status_code == 200
    await db.execute(delete(Card).where(Card.id == uuid.UUID(order_id)))
    drafts = [{"kind": "node", "id": draft_id}, {"kind": "edge", "id": link_draft_id}]
    payload = {
        "saved_drafts": drafts,
        "positions": {order_id: {"x": 50, "y": 60}, str(customer.id): {"x": 10, "y": 20}},
    }
    assert (
        await client.put(f"{BASE}/layout", json=payload, headers=env["editor"])
    ).status_code == 404
    result = await client.put(f"{BASE}/layout", json=payload, headers=env["admin"])
    assert result.status_code == 200
    saved = result.json()
    assert {(item["kind"], item["id"]) for item in saved["unavailable_drafts"]} == {
        ("node", draft_id),
        ("edge", link_draft_id),
    }
    assert saved["positions"] == {str(customer.id): {"x": 10, "y": 20}}
    assert [node["id"] for node in saved["nodes"]] == [str(customer.id)]
    assert saved["edges"] == []


async def test_first_read_uses_live_graph_with_stored_subtype_and_direction(client, db, env):
    customer, order = await bo(db), await bo(db, "Order")
    rel = await create_relation(
        db,
        type_key=ER,
        source_id=customer.id,
        target_id=order.id,
        attributes={"cardinality": "1:n"},
    )
    response = await client.get(BASE, headers=env["viewer"])
    assert response.status_code == 200
    graph = response.json()
    assert graph["snapshot_revision"] is None
    assert {(n["name"], n["subtype"]) for n in graph["nodes"]} == {
        ("Customer", "Data"),
        ("Order", "Data"),
    }
    assert graph["edges"] == [
        {
            "id": str(rel.id),
            "source": str(customer.id),
            "target": str(order.id),
            "cardinality": "1:n",
        }
    ]


async def test_viewer_cannot_save_or_search(client, env):
    assert (await client.put(f"{BASE}/layout", json={}, headers=env["viewer"])).status_code == 403
    assert (await client.get(f"{BASE}/applications", headers=env["viewer"])).status_code == 403


async def test_manual_positions_merge_from_stale_revision_and_auto_only_fills(client, db, env):
    a, b = await bo(db), await bo(db, "Order")
    first = await client.put(
        f"{BASE}/layout", json={"positions": {str(a.id): {"x": 1, "y": 1}}}, headers=env["editor"]
    )
    assert first.status_code == 200
    second = await client.put(
        f"{BASE}/layout",
        json={
            "snapshot_revision": None,
            "positions": {str(a.id): {"x": 2, "y": 3}},
            "auto_positions": {str(a.id): {"x": 0, "y": 0}, str(b.id): {"x": 4, "y": 5}},
        },
        headers=env["editor"],
    )
    assert second.status_code == 200
    assert second.json()["positions"] == {str(a.id): {"x": 2, "y": 3}, str(b.id): {"x": 4, "y": 5}}
    third = await client.put(
        f"{BASE}/layout",
        json={"auto_positions": {str(a.id): {"x": 9, "y": 9}}},
        headers=env["editor"],
    )
    assert third.json()["positions"] == second.json()["positions"]


async def test_explicit_disjoint_removals_merge_without_inventory_delete(client, db, env):
    a, b, c = await bo(db), await bo(db, "Order"), await bo(db, "Address")
    first = await create_relation(db, type_key=ER, source_id=a.id, target_id=b.id)
    second = await create_relation(db, type_key=ER, source_id=a.id, target_id=c.id)
    initial = await client.put(f"{BASE}/layout", json={}, headers=env["editor"])
    assert initial.status_code == 200
    revision = initial.json()["snapshot_revision"]
    for rel, editor in ((first, "editor"), (second, "partial")):
        result = await client.put(
            f"{BASE}/layout",
            json={"snapshot_revision": revision, "removed_relation_ids": [str(rel.id)]},
            headers=env[editor],
        )
        assert result.status_code == 200
    assert result.json()["edges"] == []
    assert await db.get(Relation, first.id) and await db.get(Relation, second.id)
    assert (await client.get(BASE, headers=env["viewer"])).json()["edges"] == []

    assert (
        await client.delete(f"{BASE}/relations/{second.id}", headers=env["partial"])
    ).status_code == 204
    assert list(await db.scalars(select(Relation.id).where(Relation.type == ER))) == [first.id]
    after_sync = await client.put(
        f"{BASE}/layout",
        json={"removed_relation_ids": [str(second.id)]},
        headers=env["partial"],
    )
    assert after_sync.status_code == 200
    assert (await client.get(BASE, headers=env["viewer"])).json()["edges"] == []


@pytest.mark.parametrize(
    ("delta", "editor"),
    [("removed_relation_ids", "partial"), ("restored_relation_ids", "admin")],
)
async def test_unavailable_visual_delta_does_not_block_unrelated_positions(
    client, db, env, delta, editor
):
    a, b = await bo(db), await bo(db, "Order")
    edge = await create_relation(db, type_key=ER, source_id=a.id, target_id=b.id)
    initial = await client.put(f"{BASE}/layout", json={}, headers=env["admin"])
    assert initial.status_code == 200
    revision = initial.json()["snapshot_revision"]
    removed = await client.put(
        f"{BASE}/layout",
        json={"snapshot_revision": revision, "removed_relation_ids": [str(edge.id)]},
        headers=env["admin"],
    )
    assert removed.status_code == 200
    assert (
        await client.delete(f"{BASE}/relations/{edge.id}", headers=env["admin"])
    ).status_code == 204

    payload = {
        "snapshot_revision": revision,
        delta: [str(edge.id)],
        "positions": {str(a.id): {"x": 10, "y": 20}},
    }
    strict = await client.put(f"{BASE}/layout", json=payload, headers=env[editor])
    assert strict.status_code == 404
    updated = await client.put(
        f"{BASE}/layout",
        json={**payload, "skip_unavailable_relations": True},
        headers=env[editor],
    )
    assert updated.status_code == 200
    assert updated.json()["inventory_conflicts"] == [{"kind": "edge", "id": str(edge.id)}]
    assert updated.json()["edges"] == []
    reopened = (await client.get(BASE, headers=env["viewer"])).json()
    assert reopened["positions"] == {str(a.id): {"x": 10, "y": 20}}
    assert reopened["edges"] == []


async def test_layout_rejects_nonfinite_coordinates_and_non_bo_ids(client, db, env):
    node = await bo(db)
    app = await create_card(db)
    for id_, x, status in ((node.id, "Infinity", 422), (app.id, 1, 404)):
        response = await client.put(
            f"{BASE}/layout",
            json={"positions": {str(id_): {"x": x, "y": 0}}},
            headers=env["editor"],
        )
        assert response.status_code == status


@pytest.mark.parametrize("master", [None, "visible", "hidden"])
async def test_partial_master_permission_does_not_depend_on_designation(client, db, env, master):
    node = await bo(db)
    visible = await create_card(db, name="Visible")
    hidden = await create_card(db, name="Hidden", subtype="Restricted")
    for app, label in ((visible, "visible"), (hidden, "hidden")):
        await create_relation(
            db,
            type_key=APP_LINK,
            source_id=app.id,
            target_id=node.id,
            attributes={"dataOwnership": "master"} if label == master else {},
        )
    graph = await client.get(BASE, headers=env["partial"])
    assert graph.status_code == 200
    assert graph.json()["capabilities"]["can_manage_master"] is False
    grouping = graph.json()["applications"][str(node.id)]
    item = {"id": str(visible.id), "name": "Visible"}
    if master == "visible":
        assert grouping == {"master": item, "slaves": [], "unclassified": []}
    else:
        assert grouping == {"master": None, "slaves": [], "unclassified": [item]}
    response = await client.put(
        f"{BASE}/objects/{node.id}/master",
        json={"application_id": str(visible.id)},
        headers=env["partial"],
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Insufficient permissions"
    draft_response = await client.put(
        f"{BASE}/application-link-drafts/{uuid.uuid4()}",
        json={"object_id": str(node.id), "application_id": str(visible.id), "role": "master"},
        headers=env["partial"],
    )
    assert draft_response.status_code == 403
    assert draft_response.json() == response.json()
    if master != "visible":
        other = await create_card(db, name="New link")
        async with db.begin_nested() as failed_request:
            slave = await client.put(
                f"{BASE}/application-link-drafts/{uuid.uuid4()}",
                json={"object_id": str(node.id), "application_id": str(other.id), "role": "slave"},
                headers=env["partial"],
            )
            assert slave.status_code == 409
            assert slave.json()["detail"] == "A visible Master is required"
            await failed_request.rollback()


async def test_master_transfers_and_clears_without_changing_crud(client, db, env):
    node = await bo(db)
    a = await create_card(db, name="Alpha")
    b = await create_card(db, name="Beta")
    ra = await create_relation(
        db, type_key=APP_LINK, source_id=a.id, target_id=node.id, attributes={"create": True}
    )
    rb = await create_relation(
        db, type_key=APP_LINK, source_id=b.id, target_id=node.id, attributes={"update": True}
    )
    for master, slave in ((a, b), (b, a)):
        response = await client.put(
            f"{BASE}/objects/{node.id}/master",
            json={"application_id": str(master.id)},
            headers=env["admin"],
        )
        assert response.status_code == 200
        assert response.json()["master"]["id"] == str(master.id)
        assert [row["id"] for row in response.json()["slaves"]] == [str(slave.id)]
    await db.refresh(ra)
    await db.refresh(rb)
    assert ra.attributes == {"create": True}
    assert rb.attributes == {"update": True, "dataOwnership": "master"}
    response = await client.put(
        f"{BASE}/objects/{node.id}/master", json={"application_id": None}, headers=env["admin"]
    )
    assert response.status_code == 200
    assert response.json()["master"] is None
    assert {row["id"] for row in response.json()["unclassified"]} == {str(a.id), str(b.id)}


async def test_generic_crud_patch_retains_master_and_rejects_marker(client, db, env):
    node = await bo(db)
    app = await create_card(db)
    link = await create_relation(
        db,
        type_key=APP_LINK,
        source_id=app.id,
        target_id=node.id,
        attributes={"dataOwnership": "master", "create": True},
    )
    url = f"/api/v1/relations/{link.id}"
    result = await client.patch(url, json={"attributes": {"update": True}}, headers=env["partial"])
    assert result.status_code == 200
    assert result.json()["attributes"] == {"update": True}
    await db.refresh(link)
    assert link.attributes == {"dataOwnership": "master", "update": True}
    forged = await client.patch(
        url, json={"attributes": {"dataOwnership": None}}, headers=env["partial"]
    )
    assert forged.status_code == 422


async def test_detail_and_picker_apply_module_scope_and_rank_paging(client, db, env):
    node = await bo(db)
    exact = await create_card(db, name="Catalog")
    await create_card(db, name="Catalog Design")
    hidden = await create_card(db, name="Catalog Hidden", subtype="Restricted")
    response = await client.get(f"{BASE}/objects/{node.id}/detail", headers=env["viewer"])
    assert response.status_code == 200
    assert response.json()["card"]["subtype"] == "Data"
    assert response.json()["permissions"]["can_edit"] is False
    response = await client.get(
        f"{BASE}/applications?search=Catalog&page=1&page_size=1", headers=env["partial"]
    )
    assert response.status_code == 200
    assert response.json() == {"items": [{"id": str(exact.id), "name": "Catalog"}], "total": 2}
    assert str(hidden.id) not in response.text


async def test_first_restricted_save_preserves_hidden_snapshot_and_positions(client, db, env):
    visible = await bo(db)
    hidden = await create_card(db, card_type="DataObject", subtype="Document", name="Hidden")
    visible.parent_id = hidden.id
    await create_relation(db, type_key=ER, source_id=visible.id, target_id=hidden.id)
    ct = await db.scalar(select(CardType).where(CardType.key == "DataObject"))
    ct.role_permissions = {"editor": {"inventory.view": {"value": False, "subtypes": ["Document"]}}}
    await db.flush()
    path = f"{BASE}/layout"
    response = await client.put(
        path, json={"positions": {str(visible.id): {"x": 1, "y": 2}}}, headers=env["editor"]
    )
    assert response.status_code == 200
    assert str(hidden.id) not in response.text
    assert response.json()["edges"] == []
    graph = (await client.get(BASE, headers=env["admin"])).json()
    assert {node["subtype"] for node in graph["nodes"]} == {"Data", "Document"}
    assert len(graph["edges"]) == 1
    response = await client.put(
        path, json={"positions": {str(hidden.id): {"x": 5, "y": 8}}}, headers=env["admin"]
    )
    assert response.status_code == 200
    response = await client.put(
        path, json={"positions": {str(hidden.id): {"x": 10, "y": 20}}}, headers=env["editor"]
    )
    assert response.status_code == 404
    assert str(hidden.id) not in (await client.get(BASE, headers=env["editor"])).text
    graph = (await client.get(BASE, headers=env["admin"])).json()
    assert graph["positions"][str(hidden.id)] == {"x": 5, "y": 8}
    response = await client.get(f"{BASE}/objects/{hidden.id}/detail", headers=env["editor"])
    assert response.status_code == 404
    response = await client.get(f"{BASE}/objects/{visible.id}/detail", headers=env["editor"])
    assert response.status_code == 200
    assert response.json()["card"]["parent_id"] is None


async def test_inventory_change_rechecks_current_value_and_keeps_disjoint_positions(
    client, db, env
):
    from app.schemas.bo_relationship import BoNode

    card = await bo(db)
    url = f"{BASE}/layout"
    initial = await client.put(url, json={}, headers=env["editor"])
    assert initial.status_code == 200
    old = BoNode.model_validate(initial.json()["nodes"][0])
    item = BoInventoryItem(kind="node", id=card.id)
    planned = old.model_copy(update={"name": "Renamed"})
    card.name = "Renamed again"
    await db.flush()
    body = {
        "snapshot_revision": initial.json()["snapshot_revision"],
        "positions": {str(card.id): {"x": 30, "y": 40}},
        "accepted_inventory_changes": [
            {
                **item.model_dump(mode="json"),
                "revision": inventory_item_revision(item, old, planned),
            }
        ],
    }
    response = await client.put(url, json=body, headers=env["editor"])
    assert response.status_code == 200
    assert response.json()["inventory_conflicts"] == [item.model_dump(mode="json")]
    assert response.json()["nodes"][0]["name"] == old.name
    assert response.json()["positions"][str(card.id)] == {"x": 30, "y": 40}
    body["positions"] = {}
    body["accepted_inventory_changes"][0]["revision"] = inventory_item_revision(
        item, old, old.model_copy(update={"name": "Renamed again"})
    )
    response = await client.put(url, json=body, headers=env["editor"])
    assert response.status_code == 200
    assert response.json()["inventory_conflicts"] == []
    assert response.json()["nodes"][0]["name"] == "Renamed again"
    assert response.json()["positions"][str(card.id)] == {"x": 30, "y": 40}


async def test_deleted_edge_visual_delta_requires_current_actor_receipt(client, db, env):
    a, b = await bo(db), await bo(db, "Order")
    relation = await create_relation(db, type_key=ER, source_id=a.id, target_id=b.id)
    assert (await client.put(f"{BASE}/layout", json={}, headers=env["admin"])).status_code == 200
    relation_id = relation.id
    await db.delete(relation)
    editor = await db.scalar(select(User).where(User.role == "editor"))
    db.add(
        BoOperationReceipt(
            actor_id=editor.id,
            draft_id=relation_id,
            result_id=relation_id,
            kind=ER_DELETE_RECEIPT,
            fingerprint=ErDeleteEvidence(type=ER, source=a.id, target=b.id).model_dump_json(),
        )
    )
    await db.flush()
    payload = {"removed_relation_ids": [str(relation_id)]}
    result = await client.put(f"{BASE}/layout", json=payload, headers=env["admin"])
    assert result.status_code == 404
    result = await client.put(f"{BASE}/layout", json=payload, headers=env["editor"])
    assert result.status_code == 200
    assert result.json()["edges"] == []


async def test_generic_post_and_bulk_cannot_designate_master(client, db, env):
    node = await bo(db)
    app = await create_card(db)
    attributes = {"dataOwnership": "master"}
    response = await client.post(
        "/api/v1/relations",
        json={
            "type": APP_LINK,
            "source_id": str(app.id),
            "target_id": str(node.id),
            "attributes": attributes,
        },
        headers=env["admin"],
    )
    assert response.status_code == 422
    response = await client.post(
        "/api/v1/relations/bulk",
        json={
            "operations": [
                {
                    "row_index": 0,
                    "type": APP_LINK,
                    "source": {"id": str(app.id)},
                    "target": {"id": str(node.id)},
                    "attributes": attributes,
                }
            ]
        },
        headers=env["admin"],
    )
    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "failed"
    assert await db.scalar(select(Relation.id).where(Relation.type == APP_LINK)) is None


async def test_master_link_delete_leaves_remaining_live_links_unclassified(client, db, env):
    node = await bo(db)
    a, b = await create_card(db, name="Alpha"), await create_card(db, name="Beta")
    link = await create_relation(
        db,
        type_key=APP_LINK,
        source_id=a.id,
        target_id=node.id,
        attributes={"dataOwnership": "master"},
    )
    await create_relation(db, type_key=APP_LINK, source_id=b.id, target_id=node.id)
    response = await client.delete(f"/api/v1/relations/{link.id}", headers=env["admin"])
    assert response.status_code == 204
    graph = await client.get(BASE, headers=env["viewer"])
    assert graph.status_code == 200
    assert graph.json()["applications"][str(node.id)] == {
        "master": None,
        "slaves": [],
        "unclassified": [{"id": str(b.id), "name": "Beta"}],
    }


async def test_dataobject_subtype_view_deny_blocks_full_master_capability(client, db, env):
    role = await db.scalar(select(Role).where(Role.key == "editor"))
    role.permissions = {**role.permissions, "relations.manage": True, "inventory.edit": True}
    type_row = await db.scalar(select(CardType).where(CardType.key == "DataObject"))
    type_row.role_permissions = {
        "editor": {"inventory.view": {"value": False, "subtypes": ["Document"]}}
    }
    await db.flush()
    node = await bo(db)
    graph = await client.get(BASE, headers=env["editor"])
    assert graph.status_code == 200
    assert graph.json()["nodes"][0]["id"] == str(node.id)
    assert graph.json()["capabilities"]["can_manage_master"] is False
    response = await client.put(
        f"{BASE}/objects/{node.id}/master", json={"application_id": None}, headers=env["editor"]
    )
    assert response.status_code == 403


async def test_accepting_visible_promotion_normalizes_a_hidden_saved_master(client, db, env):
    node = await bo(db)
    hidden = await create_card(db, name="Alpha", subtype="Restricted")
    visible = await create_card(db, name="Beta")
    await create_relation(
        db,
        type_key=APP_LINK,
        source_id=hidden.id,
        target_id=node.id,
        attributes={"dataOwnership": "master"},
    )
    link = await create_relation(db, type_key=APP_LINK, source_id=visible.id, target_id=node.id)
    assert (await client.put(f"{BASE}/layout", json={}, headers=env["admin"])).status_code == 200
    response = await client.put(
        f"{BASE}/objects/{node.id}/master",
        json={"application_id": str(visible.id)},
        headers=env["admin"],
    )
    assert response.status_code == 200
    saved = BoApplicationLink(
        id=link.id,
        object_id=node.id,
        application=BoApplication(id=visible.id, name=visible.name),
        is_master=False,
    )
    item = BoInventoryItem(kind="application_link", id=link.id)
    revision = inventory_item_revision(item, saved, saved.model_copy(update={"is_master": True}))
    response = await client.put(
        f"{BASE}/layout",
        headers=env["partial"],
        json={
            "accepted_inventory_changes": [{**item.model_dump(mode="json"), "revision": revision}]
        },
    )
    assert response.status_code == 200
    assert str(hidden.id) not in response.text
    assert response.json()["applications"][str(node.id)]["master"]["id"] == str(visible.id)
    admin_graph = (await client.get(BASE, headers=env["admin"])).json()
    assert admin_graph["applications"][str(node.id)] == {
        "master": {"id": str(visible.id), "name": visible.name},
        "slaves": [{"id": str(hidden.id), "name": hidden.name}],
        "unclassified": [],
    }


async def test_bo_detail_shapes_stakeholder_pii_for_module_readers(client, db, env):
    node = await bo(db)
    owner = await create_user(db, display_name="Owner", email="owner@private.test")
    await create_stakeholder_role_def(db, card_type_key="DataObject", key="data_owner")
    db.add(Stakeholder(card_id=node.id, user_id=owner.id, role="data_owner"))
    await db.flush()
    url = f"{BASE}/objects/{node.id}/detail"
    result = await client.get(url, headers=env["viewer"])
    assert result.status_code == 200
    (stakeholder,) = result.json()["card"]["stakeholders"]
    assert stakeholder["user_display_name"] == "Owner"
    assert stakeholder["user_email"] is None
    assert owner.email not in result.text


async def test_normal_card_save_does_not_return_bo_hidden_references_or_pii(client, db, env):
    parent = await create_card(db, name="Hidden parent", subtype="Restricted")
    node = await create_card(
        db, card_type="DataObject", subtype="Data", name="Customer", parent_id=parent.id
    )
    owner = await create_user(db, display_name="Owner", email="owner@private.test")
    await create_stakeholder_role_def(db, card_type_key="DataObject", key="data_owner")
    db.add(Stakeholder(card_id=node.id, user_id=owner.id, role="data_owner"))
    await db.flush()

    result = await client.patch(
        f"/api/v1/cards/{node.id}",
        json={"description": "Updated from the BO panel"},
        headers=env["partial"],
    )

    assert result.status_code == 200
    body = result.json()
    assert body["description"] == "Updated from the BO panel"
    assert body["parent_id"] is None
    assert body["parent_label"] is None
    (stakeholder,) = body["stakeholders"]
    assert stakeholder["user_display_name"] == "Owner"
    assert stakeholder["user_email"] is None


async def test_generic_relation_api_hides_links_to_denied_application_subtypes(client, db, env):
    node = await bo(db)
    app = await create_card(db, name="Hidden", subtype="Restricted")
    rel = await create_relation(
        db,
        type_key=APP_LINK,
        source_id=app.id,
        target_id=node.id,
        attributes={"dataOwnership": "master"},
    )
    response = await client.get(f"/api/v1/relations?card_id={node.id}", headers=env["partial"])
    assert response.status_code == 200
    assert response.json() == []
    response = await client.patch(
        f"/api/v1/relations/{rel.id}",
        json={"attributes": {"crudRead": True}},
        headers=env["partial"],
    )
    assert response.status_code == 404
    response = await client.post(
        "/api/v1/relations",
        json={"type": APP_LINK, "source_id": str(app.id), "target_id": str(node.id)},
        headers=env["partial"],
    )
    assert response.status_code == 404


async def test_master_history_omits_hidden_and_unknown_subtype_peers(client, db, env):
    role = await db.scalar(select(Role).where(Role.key == "partial"))
    role.permissions = {**role.permissions, "inventory.view": True, "reports.ea_dashboard": True}
    node = await bo(db)
    actor = await db.scalar(select(User).where(User.role == "partial"))
    db.add(UserFavorite(card_id=node.id, user_id=actor.id))
    hidden = await create_card(db, name="Hidden", subtype="Restricted")
    visible = await create_card(db, name="Visible")
    for app in (hidden, visible):
        await create_relation(db, type_key=APP_LINK, source_id=app.id, target_id=node.id)
        response = await client.put(
            f"{BASE}/objects/{node.id}/master",
            json={"application_id": str(app.id)},
            headers=env["admin"],
        )
        assert response.status_code == 200
    url = f"/api/v1/cards/{node.id}/history"
    result = await client.get(url, headers=env["partial"])
    assert result.status_code == 200
    assert {event["data"]["peer_id"] for event in result.json()} == {str(visible.id)}
    for path in ("/api/v1/events/my-cards", "/api/v1/reports/dashboard"):
        response = await client.get(path, headers=env["partial"])
        assert response.status_code == 200
        assert str(visible.id) in response.text
        assert str(hidden.id) not in response.text
    await db.delete(hidden)
    await db.flush()
    result = await client.get(url, headers=env["partial"])
    assert result.status_code == 200
    assert {event["data"]["peer_id"] for event in result.json()} == {str(visible.id)}
    response = await client.get("/api/v1/reports/dashboard", headers=env["partial"])
    assert response.status_code == 200
    assert str(hidden.id) not in response.text


async def test_restoring_present_edge_does_not_refresh_saved_cardinality(client, db, env):
    a, b = await bo(db), await bo(db, "Other")
    edge = await create_relation(
        db, type_key=ER, source_id=a.id, target_id=b.id, attributes={"cardinality": "1:n"}
    )
    url = f"{BASE}/layout"
    initial = await client.put(url, json={}, headers=env["editor"])
    assert initial.status_code == 200
    edge.attributes = {"cardinality": "n:1"}
    await db.flush()
    result = await client.put(
        url, json={"restored_relation_ids": [str(edge.id)]}, headers=env["editor"]
    )
    assert result.status_code == 200
    assert result.json()["edges"][0]["cardinality"] == "1:n"


async def test_edge_restore_respects_same_item_conflict_and_keeps_disjoint_restore(client, db, env):
    a, b, c = await bo(db), await bo(db, "Other"), await bo(db, "Third")
    first = await create_relation(
        db, type_key=ER, source_id=a.id, target_id=b.id, attributes={"cardinality": "1:n"}
    )
    second = await create_relation(db, type_key=ER, source_id=a.id, target_id=c.id)
    url = f"{BASE}/layout"
    hidden = await client.put(
        url,
        json={"removed_relation_ids": [str(first.id), str(second.id)]},
        headers=env["editor"],
    )
    assert hidden.status_code == 200 and hidden.json()["edges"] == []
    item = BoInventoryItem(kind="edge", id=first.id)
    old = BoEdge(id=first.id, source=a.id, target=b.id, cardinality="1:n")
    first.attributes = {"cardinality": "n:1"}
    await db.flush()
    result = await client.put(
        url,
        json={
            "restored_relation_ids": [str(first.id), str(second.id)],
            "accepted_inventory_changes": [
                {
                    **item.model_dump(mode="json"),
                    "revision": inventory_item_revision(item, None, old),
                }
            ],
            "positions": {str(a.id): {"x": 11, "y": 12}},
        },
        headers=env["editor"],
    )
    assert result.status_code == 200
    assert result.json()["inventory_conflicts"] == [item.model_dump(mode="json")]
    assert [edge["id"] for edge in result.json()["edges"]] == [str(second.id)]
    assert result.json()["positions"][str(a.id)] == {"x": 11, "y": 12}


async def test_concurrent_master_transfers_and_layout_saves(test_engine):
    async with AsyncSession(test_engine, expire_on_commit=False) as setup:
        admin = await create_role(setup, key="bo-concurrent-admin")
        actor = await create_user(setup, role=admin.key)
        card_types = [
            await create_card_type(setup, key=key) for key in ("DataObject", "Application")
        ]
        relation_type = await create_relation_type(
            setup, key=APP_LINK, source_type_key="Application", target_type_key="DataObject"
        )
        a, b = await bo(setup), await bo(setup, "Other object")
        apps = [await create_card(setup, name=name) for name in ("Alpha", "Beta")]
        for app in apps:
            await create_relation(setup, type_key=APP_LINK, source_id=app.id, target_id=a.id)
        await setup.commit()
    try:

        async def assign(application_id):
            async with AsyncSession(test_engine) as session, session.begin():
                return await assign_master(session, actor, a.id, application_id)

        async def save(card_id, x):
            async with AsyncSession(test_engine) as session, session.begin():
                return await save_bo_layout(
                    session,
                    actor,
                    BoLayoutUpdate(positions={card_id: {"x": x, "y": x}}, snapshot_revision=None),
                )

        first, second = await asyncio.wait_for(
            asyncio.gather(*(assign(app.id) for app in apps)), timeout=10
        )
        assert [first.master.id, second.master.id] == [app.id for app in apps]
        await asyncio.wait_for(asyncio.gather(save(a.id, 1), save(b.id, 2)), timeout=10)
        async with AsyncSession(test_engine) as first_writer:
            await save_bo_layout(
                first_writer, actor, BoLayoutUpdate(positions={a.id: {"x": 3, "y": 4}})
            )
            second_started = asyncio.Event()

            async def save_second():
                second_started.set()
                return await save(a.id, 5)

            second_writer = asyncio.create_task(save_second())
            await second_started.wait()
            await first_writer.commit()
            await asyncio.wait_for(second_writer, timeout=10)
        async with AsyncSession(test_engine) as verify:
            relations = list(
                (await verify.scalars(select(Relation).where(Relation.target_id == a.id)))
            )
            assert sum(rel.attributes.get("dataOwnership") == "master" for rel in relations) == 1
            diagram = await verify.scalar(
                select(Diagram).where(Diagram.kind == BO_RELATIONSHIP_KIND)
            )
            assert diagram.data["positions"] == {
                str(a.id): {"x": 5, "y": 5},
                str(b.id): {"x": 2, "y": 2},
            }
    finally:
        async with AsyncSession(test_engine) as cleanup, cleanup.begin():
            await cleanup.execute(delete(Event).where(Event.user_id == actor.id))
            await cleanup.execute(
                delete(MutationBatch).where(MutationBatch.actor_user_id == actor.id)
            )
            await cleanup.execute(delete(Diagram).where(Diagram.kind == BO_RELATIONSHIP_KIND))
            await cleanup.execute(
                delete(Card).where(Card.id.in_([a.id, b.id, *(app.id for app in apps)]))
            )
            await cleanup.execute(delete(RelationType).where(RelationType.id == relation_type.id))
            await cleanup.execute(
                delete(CardType).where(CardType.id.in_([ct.id for ct in card_types]))
            )
            await cleanup.execute(delete(User).where(User.id == actor.id))
            await cleanup.execute(delete(Role).where(Role.id == admin.id))
        PermissionService.invalidate_role_cache(admin.key)
        PermissionService.invalidate_type_permission_cache()
