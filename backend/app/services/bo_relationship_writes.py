"""Retryable inventory writes staged by the BO Relationship drawing."""

import hashlib
import uuid

from fastapi import HTTPException
from pydantic import BaseModel, ValidationError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bo_operation_receipt import BoOperationReceipt
from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.user import User
from app.schemas.bo_relationship import (
    BoApplication,
    BoApplicationLink,
    BoApplicationLinkDraft,
    BoEdge,
    BoNode,
    BoObjectDraft,
    BoRelationDraft,
)
from app.services import card_write_service
from app.services.bo_relationship import (
    ErDeleteEvidence,
    bo_read_scope,
    can_manage_bo_master,
    get_bo_card,
    set_bo_master,
)
from app.services.bo_relationship_constants import (
    APPLICATION_RELATION,
    APPLICATION_TYPE,
    BO_TYPE,
    ER_DELETE_RECEIPT,
    ER_RELATION,
    MASTER,
    OWNERSHIP_KEY,
)
from app.services.card_read_scope import CardReadScope
from app.services.permission_service import PermissionService


def _draft_fingerprint(body: BaseModel) -> str:
    return hashlib.sha256(body.model_dump_json().encode()).hexdigest()


async def _find_receipt(
    db: AsyncSession, actor_id: uuid.UUID, draft_id: uuid.UUID, kind: str
) -> BoOperationReceipt | None:
    return await db.scalar(
        select(BoOperationReceipt).where(
            BoOperationReceipt.actor_id == actor_id,
            BoOperationReceipt.draft_id == draft_id,
            BoOperationReceipt.kind == kind,
        )
    )


async def _claim_draft(
    db: AsyncSession, user: User, draft_id: uuid.UUID, kind: str, body: BaseModel
) -> tuple[BoOperationReceipt, bool]:
    fingerprint = _draft_fingerprint(body)
    # Claim the key before writing inventory. A competing retry waits for the
    # complete transaction and sees its committed result, or takes over on rollback.
    claimed = await db.scalar(
        insert(BoOperationReceipt)
        .values(
            actor_id=user.id,
            draft_id=draft_id,
            kind=kind,
            result_id=draft_id,
            fingerprint=fingerprint,
        )
        .on_conflict_do_nothing(constraint="uq_bo_receipt_actor_draft_kind")
        .returning(BoOperationReceipt)
    )
    if claimed is not None:
        return claimed, False
    receipt = await _find_receipt(db, user.id, draft_id, kind)
    assert receipt is not None
    return receipt, True


def _require_same_request(receipt: BoOperationReceipt, body: BaseModel) -> None:
    if receipt.fingerprint != _draft_fingerprint(body):
        raise HTTPException(409, "Draft ID has already been used with a different request")


async def create_object_draft(
    db: AsyncSession, user: User, draft_id: uuid.UUID, body: BoObjectDraft
) -> BoNode:
    await PermissionService.require_permission(
        db, user, "inventory.create", card_type_key=BO_TYPE, subtype=body.subtype
    )
    scope = await bo_read_scope(db, user)
    receipt, replay = await _claim_draft(db, user, draft_id, "node", body)
    if replay:
        card = await get_bo_card(db, scope, receipt.result_id)
        if card.status == "ARCHIVED":
            raise HTTPException(404, "Card not found")
        _require_same_request(receipt, body)
    else:
        fields = await db.scalar(select(CardType.fields_schema).where(CardType.key == BO_TYPE))
        keys = {field.get("key") for section in fields or [] for field in section.get("fields", [])}
        attributes = {
            key: value
            for key, value in body.model_dump(exclude={"name", "subtype"}).items()
            if key in keys
        }
        try:
            card = await card_write_service.create_card(
                db,
                card_write_service.WriteActor.from_user(user),
                type_key=BO_TYPE,
                name=body.name,
                subtype=body.subtype,
                attributes=attributes,
            )
        except HTTPException as exc:
            # The ordinary sibling-name error carries the existing card's ID.
            if isinstance(exc.detail, dict) and exc.detail.get("code") == "sibling_name_conflict":
                conflicting_id = uuid.UUID(exc.detail["existing_card_id"])
                if not await scope.readable_card_ids(db, {conflicting_id}, mode="module"):
                    raise HTTPException(
                        409, "A business object with this name already exists"
                    ) from exc
            raise
        await get_bo_card(db, scope, card.id)
        receipt.result_id = card.id
    return BoNode(
        id=card.id,
        name=card.name,
        subtype=card.subtype,
        isPersonalData=(card.attributes or {}).get("isPersonalData") is True,
        isPaymentData=(card.attributes or {}).get("isPaymentData") is True,
    )


async def _relation_cards(
    db: AsyncSession,
    scope: CardReadScope,
    type_key: str,
    source_id: uuid.UUID,
    target_id: uuid.UUID,
    *,
    active_only: bool = True,
) -> tuple[Card, Card]:
    stmt = select(Card).where(
        Card.id.in_((source_id, target_id)), *scope.where(Card, mode="module")
    )
    if active_only:
        stmt = stmt.where(Card.status != "ARCHIVED")
    cards = {card.id: card for card in await db.scalars(stmt)}
    source, target = cards.get(source_id), cards.get(target_id)
    source_type = BO_TYPE if type_key == ER_RELATION else APPLICATION_TYPE
    if source is None or target is None or source.type != source_type or target.type != BO_TYPE:
        raise HTTPException(404, "Relation not found")
    return source, target


async def _replay_relation(
    db: AsyncSession,
    scope: CardReadScope,
    type_key: str,
    receipt: BoOperationReceipt,
    body: BaseModel,
) -> tuple[Relation, Card]:
    rel = await db.scalar(
        select(Relation).where(Relation.id == receipt.result_id, Relation.type == type_key)
    )
    if rel is None:
        raise HTTPException(404, "Relation not found")
    source, _ = await _relation_cards(db, scope, type_key, rel.source_id, rel.target_id)
    _require_same_request(receipt, body)
    return rel, source


async def _require_relation_type(db: AsyncSession, key: str, source_type: str) -> None:
    relation_type = await db.scalar(
        select(RelationType.key).where(
            RelationType.key == key,
            RelationType.source_type_key == source_type,
            RelationType.target_type_key == BO_TYPE,
        )
    )
    if relation_type is None:
        raise HTTPException(422, "Relation type is unavailable")


async def create_er_draft(
    db: AsyncSession, user: User, draft_id: uuid.UUID, body: BoRelationDraft
) -> BoEdge:
    await PermissionService.require_permission(db, user, "relations.manage")
    scope = await bo_read_scope(db, user)
    receipt, replay = await _claim_draft(db, user, draft_id, "edge", body)
    if replay:
        rel, _ = await _replay_relation(db, scope, ER_RELATION, receipt, body)
    else:
        await _relation_cards(db, scope, ER_RELATION, body.source_id, body.target_id)
        await _require_relation_type(db, ER_RELATION, BO_TYPE)
        rel, _, _ = await card_write_service.upsert_relation(
            db,
            card_write_service.WriteActor.from_user(user),
            type_key=ER_RELATION,
            source_id=body.source_id,
            target_id=body.target_id,
            attributes={"cardinality": body.cardinality} if body.cardinality is not None else None,
            create_only=True,
        )
        receipt.result_id = rel.id
    cardinality = (rel.attributes or {}).get("cardinality")
    return BoEdge(
        id=rel.id,
        source=rel.source_id,
        target=rel.target_id,
        cardinality=cardinality if isinstance(cardinality, str) else None,
    )


async def _require_visible_master(
    db: AsyncSession, scope: CardReadScope, body: BoApplicationLinkDraft
) -> None:
    master = await db.scalar(
        select(Relation.id)
        .join(Card, Card.id == Relation.source_id)
        .where(
            Relation.type == APPLICATION_RELATION,
            Relation.target_id == body.object_id,
            Relation.attributes[OWNERSHIP_KEY].astext == MASTER,
            Card.id != body.application_id,
            Card.type == APPLICATION_TYPE,
            Card.status != "ARCHIVED",
            *scope.where(Card, mode="module"),
        )
    )
    if master is None:
        raise HTTPException(409, "A visible Master is required")


async def create_application_link_draft(
    db: AsyncSession, user: User, draft_id: uuid.UUID, body: BoApplicationLinkDraft
) -> BoApplicationLink:
    if body.role == MASTER and not await can_manage_bo_master(db, user):
        raise HTTPException(403, "Insufficient permissions")
    await PermissionService.require_permission(db, user, "relations.manage")
    scope = await bo_read_scope(db, user)
    receipt, replay = await _claim_draft(db, user, draft_id, "application_link", body)
    if replay:
        rel, application = await _replay_relation(db, scope, APPLICATION_RELATION, receipt, body)
    else:
        application, _ = await _relation_cards(
            db, scope, APPLICATION_RELATION, body.application_id, body.object_id
        )
        await _require_relation_type(db, APPLICATION_RELATION, APPLICATION_TYPE)
        await card_write_service.lock_bo_master(db, body.object_id)
        if body.role == "slave":
            await _require_visible_master(db, scope, body)
        rel, _, _ = await card_write_service.upsert_relation(
            db,
            card_write_service.WriteActor.from_user(user),
            type_key=APPLICATION_RELATION,
            source_id=body.application_id,
            target_id=body.object_id,
            create_only=True,
        )
        if body.role == MASTER:
            await set_bo_master(db, user, body.object_id, body.application_id)
        receipt.result_id = rel.id
    return BoApplicationLink(
        id=rel.id,
        object_id=rel.target_id,
        application=BoApplication(id=application.id, name=application.name),
        is_master=(rel.attributes or {}).get(OWNERSHIP_KEY) == MASTER,
    )


async def delete_er_relation(db: AsyncSession, user: User, relation_id: uuid.UUID) -> None:
    await PermissionService.require_permission(db, user, "relations.manage")
    scope = await bo_read_scope(db, user)
    rel = await db.scalar(
        select(Relation).where(Relation.id == relation_id, Relation.type == ER_RELATION)
    )
    if rel is not None:
        await _relation_cards(
            db, scope, ER_RELATION, rel.source_id, rel.target_id, active_only=False
        )
        rel = await card_write_service.lock_relation_for_delete(db, rel)
    if rel is not None:
        evidence = ErDeleteEvidence(type=rel.type, source=rel.source_id, target=rel.target_id)
        await card_write_service.delete_relation(db, user.id, rel)
        db.add(
            BoOperationReceipt(
                actor_id=user.id,
                draft_id=relation_id,
                kind=ER_DELETE_RECEIPT,
                result_id=relation_id,
                fingerprint=evidence.model_dump_json(),
            )
        )
        return

    receipt = await _find_receipt(db, user.id, relation_id, ER_DELETE_RECEIPT)
    if receipt is None or receipt.result_id != relation_id:
        raise HTTPException(404, "Relation not found")
    try:
        evidence = ErDeleteEvidence.model_validate_json(receipt.fingerprint)
    except ValidationError as exc:
        raise HTTPException(404, "Relation not found") from exc
    if evidence.type != ER_RELATION:
        raise HTTPException(404, "Relation not found")
    await _relation_cards(
        db, scope, ER_RELATION, evidence.source, evidence.target, active_only=False
    )
