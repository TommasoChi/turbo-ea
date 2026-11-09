"""Ordinary inventory deletes preserve internal proof for BO comparisons."""

import json

import pytest
from sqlalchemy import select, update

from app.models.bo_operation_receipt import BoOperationReceipt
from app.models.card import Card
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
