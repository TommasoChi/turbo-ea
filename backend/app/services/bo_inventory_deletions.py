"""Record scoped BO comparison evidence in the inventory delete transaction."""

import json
import uuid
from collections.abc import Iterable

from sqlalchemy import any_, bindparam, func, select
from sqlalchemy.dialects.postgresql import ARRAY, UUID, insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bo_operation_receipt import BoOperationReceipt
from app.models.card import Card
from app.models.relation import Relation
from app.services.bo_relationship_constants import (
    APPLICATION_RELATION,
    APPLICATION_TYPE,
    BO_TYPE,
    ER_RELATION,
    INVENTORY_CARD_DELETE,
    INVENTORY_RELATION_DELETE,
)


async def _record_evidence(
    db: AsyncSession,
    actor_id: uuid.UUID,
    kind: str,
    evidence: dict[uuid.UUID, dict[str, str | None]],
) -> None:
    if not evidence:
        return
    stmt = insert(BoOperationReceipt).values(created_at=func.clock_timestamp())
    # Restoring and deleting the same ID again must refresh its actual subtype.
    await db.execute(
        stmt.on_conflict_do_update(
            constraint="uq_bo_receipt_actor_draft_kind",
            set_={"fingerprint": stmt.excluded.fingerprint, "created_at": stmt.excluded.created_at},
        ),
        [
            {
                "actor_id": actor_id,
                "kind": kind,
                "draft_id": id_,
                "result_id": id_,
                "fingerprint": json.dumps(proof),
            }
            for id_, proof in evidence.items()
        ],
    )


async def record_inventory_card_deletions(
    db: AsyncSession, actor_id: uuid.UUID, cards: Iterable[Card]
) -> None:
    card_ids = [card.id for card in cards]
    if not card_ids:
        return
    candidates = bindparam("bo_delete_candidates", card_ids, type_=ARRAY(UUID(as_uuid=True)))
    # Lock the entire delete set in the same order as relation writers. A
    # mixed delete can include cards that do not generate BO evidence. Read
    # the subtype under lock because the ORM card may still hold an old value.
    current = await db.execute(
        select(Card.id, Card.type, Card.subtype)
        .where(Card.id == any_(candidates))
        .order_by(Card.id)
        .with_for_update()
    )
    evidence = {
        id_: {"type": type_, "subtype": subtype}
        for id_, type_, subtype in current
        if type_ in (BO_TYPE, APPLICATION_TYPE)
    }
    if not evidence:
        return
    await _record_evidence(db, actor_id, INVENTORY_CARD_DELETE, evidence)

    # Record the exact relations before the card foreign keys delete them.
    # One array bind keeps this query bounded even for a large bulk delete.
    deleted = bindparam("bo_deleted_cards", list(evidence), type_=ARRAY(UUID(as_uuid=True)))
    rows = await db.execute(
        select(Relation.id, Relation.type, Relation.source_id, Relation.target_id).where(
            Relation.type.in_((ER_RELATION, APPLICATION_RELATION)),
            (Relation.source_id == any_(deleted)) | (Relation.target_id == any_(deleted)),
        )
    )
    await _record_evidence(
        db,
        actor_id,
        INVENTORY_RELATION_DELETE,
        {id_: _relation_evidence(type_, source, target) for id_, type_, source, target in rows},
    )


def _relation_evidence(type_: str, source: uuid.UUID, target: uuid.UUID) -> dict[str, str | None]:
    return {"type": type_, "source": str(source), "target": str(target)}


async def record_inventory_relation_deletion(
    db: AsyncSession, actor_id: uuid.UUID | None, relation: Relation
) -> None:
    if actor_id is None or relation.type not in (ER_RELATION, APPLICATION_RELATION):
        return
    await _record_evidence(
        db,
        actor_id,
        INVENTORY_RELATION_DELETE,
        {relation.id: _relation_evidence(relation.type, relation.source_id, relation.target_id)},
    )
