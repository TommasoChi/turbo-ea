"""Ordinary inventory deletes preserve internal proof for BO comparisons."""

import asyncio
import json
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.relations import apply_relation_operations, update_relation
from app.models.bo_operation_receipt import BoOperationReceipt
from app.models.card import Card
from app.models.card_type import CardType
from app.models.event import Event
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.role import Role
from app.models.user import User
from app.schemas.relation import RelationBulkOperation, RelationRefInput, RelationUpdate
from app.services import card_write_service
from app.services.bo_inventory_deletions import record_inventory_card_deletions
from app.services.bo_relationship import set_bo_master
from app.services.bo_relationship_constants import APPLICATION_RELATION, ER_RELATION
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


@pytest.mark.parametrize("same_actor", [True, False])
async def test_bo_card_delete_and_relation_delete_do_not_deadlock(test_engine, same_actor):
    async with AsyncSession(test_engine, expire_on_commit=False) as session, session.begin():
        actor = await create_user(session)
        relation_actor = actor if same_actor else await create_user(session)
        card_type = await create_card_type(session, key="DataObject")
        relation_type = await create_relation_type(
            session, key=ER_RELATION, source_type_key="DataObject", target_type_key="DataObject"
        )
        source = await create_card(session, card_type="DataObject", name="Customer")
        target = await create_card(session, card_type="DataObject", name="Order")
        link = await create_relation(
            session, type_key=ER_RELATION, source_id=source.id, target_id=target.id
        )

    ready = asyncio.Event()
    relation_pid = None

    async def delete_link():
        nonlocal relation_pid
        async with AsyncSession(test_engine) as session, session.begin():
            current = await session.get(Relation, link.id)
            assert current is not None
            relation_pid = await session.scalar(select(func.pg_backend_pid()))
            ready.set()
            locked = await card_write_service.lock_relation_for_write(session, current)
            if locked is not None:
                await card_write_service.delete_relation(session, relation_actor.id, locked)

    async def wait_for_card_lock():
        async with AsyncSession(test_engine) as observer:
            while not await observer.scalar(select(func.pg_blocking_pids(relation_pid))):
                await asyncio.sleep(0.01)

    task = None
    try:
        async with AsyncSession(test_engine) as session, session.begin():
            card = await session.get(Card, source.id)
            assert card is not None
            await record_inventory_card_deletions(session, actor.id, [card])
            task = asyncio.create_task(delete_link())
            await asyncio.wait_for(ready.wait(), timeout=5)
            # The competing transaction is waiting on this transaction. A
            # relation lock held at this point would deadlock the cascade.
            await asyncio.wait_for(wait_for_card_lock(), timeout=5)
            await session.delete(card)
            await asyncio.wait_for(session.flush(), timeout=8)
        await asyncio.wait_for(task, timeout=5)

        async with AsyncSession(test_engine) as verify:
            assert await verify.get(Card, source.id) is None
            assert await verify.get(Relation, link.id) is None
            assert await verify.scalar(
                select(BoOperationReceipt).where(
                    BoOperationReceipt.kind == "inventory_relation_delete",
                    BoOperationReceipt.result_id == link.id,
                )
            )
    finally:
        if task is not None:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        async with AsyncSession(test_engine) as cleanup, cleanup.begin():
            actor_ids = {actor.id, relation_actor.id}
            await cleanup.execute(delete(Event).where(Event.user_id.in_(actor_ids)))
            await cleanup.execute(
                delete(BoOperationReceipt).where(BoOperationReceipt.actor_id.in_(actor_ids))
            )
            await cleanup.execute(delete(Card).where(Card.id.in_([source.id, target.id])))
            await cleanup.execute(delete(RelationType).where(RelationType.id == relation_type.id))
            await cleanup.execute(delete(CardType).where(CardType.id == card_type.id))
            await cleanup.execute(delete(User).where(User.id.in_(actor_ids)))


@pytest.mark.parametrize("writer", ["master", "patch", "upsert", "bulk", "mixed-patch"])
async def test_card_delete_and_link_update_do_not_deadlock(test_engine, writer):
    mixed = writer == "mixed-patch"
    target_type_key = "ITComponent" if mixed else "DataObject"
    relation_type_key = "testAppToItc" if mixed else APPLICATION_RELATION
    async with AsyncSession(test_engine, expire_on_commit=False) as session, session.begin():
        role = await create_role(session, key="bo_link_update_test")
        actor = await create_user(session, role=role.key)
        application_type = await create_card_type(session, key="Application")
        object_type = await create_card_type(session, key=target_type_key)
        relation_type = await create_relation_type(
            session,
            key=relation_type_key,
            source_type_key="Application",
            target_type_key=target_type_key,
        )
        application = await create_card(session, card_type="Application")
        object_ = await create_card(session, card_type=target_type_key)
        if mixed:
            # The non-BO card sorts before the Application. Locking only the
            # Application for evidence lets the writer take the other lock first.
            application.id = uuid.UUID(int=2)
            object_.id = uuid.UUID(int=1)
            await session.flush()
        link = await create_relation(
            session, type_key=relation_type_key, source_id=application.id, target_id=object_.id
        )

    ready = asyncio.Event()
    writer_pid = None

    async def update_link():
        nonlocal writer_pid
        async with AsyncSession(test_engine, expire_on_commit=False) as session:
            writer_pid = await session.scalar(select(func.pg_backend_pid()))
            ready.set()
            if writer == "bulk":
                results, upserted, deleted, failed = await apply_relation_operations(
                    session,
                    [
                        RelationBulkOperation(
                            row_index=0,
                            type=APPLICATION_RELATION,
                            source=RelationRefInput(id=str(application.id)),
                            target=RelationRefInput(id=str(object_.id)),
                            description="changed",
                        )
                    ],
                    actor_id=actor.id,
                    dry_run=False,
                )
                assert (upserted, deleted, failed) == (0, 0, 1)
                assert results[0].error == "Card not found"
                return
            with pytest.raises(HTTPException) as exc:
                if writer == "master":
                    await set_bo_master(session, actor, object_.id, application.id)
                elif writer in ("patch", "mixed-patch"):
                    await update_relation(
                        str(link.id), RelationUpdate(attributes={"test": "change"}), session, actor
                    )
                else:
                    await card_write_service.upsert_relation(
                        session,
                        card_write_service.WriteActor.from_user(actor),
                        type_key=APPLICATION_RELATION,
                        source_id=application.id,
                        target_id=object_.id,
                        description="changed",
                    )
            assert exc.value.status_code == 404

    async def wait_for_writer_block():
        async with AsyncSession(test_engine) as observer:
            while not await observer.scalar(select(func.pg_blocking_pids(writer_pid))):
                await asyncio.sleep(0.01)

    task = None
    try:
        async with AsyncSession(test_engine) as session, session.begin():
            card = await session.get(Card, application.id)
            assert card is not None
            cards = [card]
            if mixed:
                component = await session.get(Card, object_.id)
                assert component is not None
                cards.insert(0, component)
            await record_inventory_card_deletions(session, actor.id, cards)
            task = asyncio.create_task(update_link())
            await asyncio.wait_for(ready.wait(), timeout=5)
            # The hard delete owns the card lock. Let the writer get as far as
            # that lock before proceeding with the relation's DELETE cascade.
            await asyncio.wait_for(wait_for_writer_block(), timeout=5)
            for deleted_card in cards:
                await session.delete(deleted_card)
                await asyncio.wait_for(session.flush(), timeout=8)
        await asyncio.wait_for(task, timeout=5)

        async with AsyncSession(test_engine) as verify:
            assert await verify.get(Card, application.id) is None
            assert await verify.get(Relation, link.id) is None
            proof = await verify.scalar(
                select(BoOperationReceipt).where(
                    BoOperationReceipt.kind == "inventory_relation_delete",
                    BoOperationReceipt.result_id == link.id,
                )
            )
            assert (proof is None) == mixed
            if mixed:
                assert await verify.get(Card, object_.id) is None
    finally:
        if task is not None:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        async with AsyncSession(test_engine) as cleanup, cleanup.begin():
            await cleanup.execute(delete(Event).where(Event.user_id == actor.id))
            await cleanup.execute(
                delete(BoOperationReceipt).where(BoOperationReceipt.actor_id == actor.id)
            )
            await cleanup.execute(delete(Card).where(Card.id.in_([application.id, object_.id])))
            await cleanup.execute(delete(RelationType).where(RelationType.id == relation_type.id))
            await cleanup.execute(
                delete(CardType).where(CardType.id.in_([application_type.id, object_type.id]))
            )
            await cleanup.execute(delete(User).where(User.id == actor.id))
            await cleanup.execute(delete(Role).where(Role.key == role.key))


@pytest.mark.parametrize("bulk", [False, True])
async def test_inventory_card_delete_records_latest_subtype(client, db, bulk):
    await create_role(db)
    admin = await create_user(db)
    await create_card_type(db, key="DataObject", subtypes=[{"key": "Data"}, {"key": "Document"}])
    await create_relation_type(
        db, key=ER_RELATION, source_type_key="DataObject", target_type_key="DataObject"
    )
    card = await create_card(db, card_type="DataObject", subtype="Data")
    peer = await create_card(db, card_type="DataObject", name="Peer")
    link = await create_relation(db, type_key=ER_RELATION, source_id=card.id, target_id=peer.id)
    # A cached ORM card can predate a committed subtype change. Keep the cache
    # stale to verify that the proof is read from the row that will be deleted.
    await db.execute(
        update(Card)
        .where(Card.id == card.id)
        .values(subtype="Document")
        .execution_options(synchronize_session=False)
    )
    assert card.subtype == "Data"
    card_id = card.id
    link_id = link.id
    headers = auth_headers(admin)

    if bulk:
        response = await client.post(
            "/api/v1/cards/bulk-delete", json={"card_ids": [str(card_id)]}, headers=headers
        )
    else:
        response = await client.delete(f"/api/v1/cards/{card_id}", headers=headers)

    assert response.status_code == 200, response.text
    proof = await db.scalar(
        select(BoOperationReceipt).where(
            BoOperationReceipt.kind == "inventory_card_delete",
            BoOperationReceipt.result_id == card_id,
        )
    )
    assert proof is not None
    assert proof.actor_id == admin.id
    assert json.loads(proof.fingerprint) == {"type": "DataObject", "subtype": "Document"}
    cascade_proof = await db.scalar(
        select(BoOperationReceipt).where(
            BoOperationReceipt.kind == "inventory_relation_delete",
            BoOperationReceipt.result_id == link_id,
        )
    )
    assert cascade_proof is not None
    assert json.loads(cascade_proof.fingerprint) == {
        "type": ER_RELATION,
        "source": str(card_id),
        "target": str(peer.id),
    }


async def test_inventory_relation_delete_records_both_endpoints(client, db):
    await create_role(db)
    admin = await create_user(db)
    await create_card_type(db, key="DataObject")
    await create_relation_type(
        db, key=ER_RELATION, source_type_key="DataObject", target_type_key="DataObject"
    )
    source = await create_card(db, card_type="DataObject", name="Customer")
    target = await create_card(db, card_type="DataObject", name="Order")
    link = await create_relation(db, type_key=ER_RELATION, source_id=source.id, target_id=target.id)
    link_id = link.id

    response = await client.delete(f"/api/v1/relations/{link_id}", headers=auth_headers(admin))

    assert response.status_code == 204, response.text
    proof = await db.scalar(
        select(BoOperationReceipt).where(
            BoOperationReceipt.kind == "inventory_relation_delete",
            BoOperationReceipt.result_id == link_id,
        )
    )
    assert proof is not None
    assert proof.actor_id == admin.id
    assert json.loads(proof.fingerprint) == {
        "type": ER_RELATION,
        "source": str(source.id),
        "target": str(target.id),
    }
