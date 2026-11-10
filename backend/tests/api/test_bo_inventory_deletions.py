"""Ordinary inventory deletes preserve internal proof for BO comparisons."""

import asyncio
import json

import pytest
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bo_operation_receipt import BoOperationReceipt
from app.models.card import Card
from app.models.card_type import CardType
from app.models.event import Event
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.user import User
from app.services import card_write_service
from app.services.bo_inventory_deletions import record_inventory_card_deletions
from app.services.bo_relationship_constants import ER_RELATION
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
            locked = await card_write_service.lock_relation_for_delete(session, current)
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
