"""The Provider of a cost item: who may be picked, what a write stores, names for reads.

Flushes nothing; the id is stored as a lower-case ``str`` in ``card_costs.items``.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.card import Card
from app.models.relation import Relation
from app.services.card_costs import UNSET, CostError, _Unset, parse_provider_id
from app.services.card_read_scope import CardReadScope
from app.services.portal_card_filters import descendant_ids

PROVIDER_RELATIONS = {"Application": "relProviderToApp", "ITComponent": "relProviderToITC"}


async def _ancestor_ids(db: AsyncSession, card_id: uuid.UUID) -> set[uuid.UUID]:
    """Every ancestor, readable or not; a cycle stops the walk."""
    seen: set[uuid.UUID] = set()
    current: uuid.UUID | None = card_id
    while current is not None:
        current = (
            await db.execute(select(Card.parent_id).where(Card.id == current))
        ).scalar_one_or_none()
        if current is None or current in seen:
            break
        seen.add(current)
    return seen


async def candidate_providers(
    db: AsyncSession, read_scope: CardReadScope, card_id: uuid.UUID, card_type: str
) -> list[tuple[uuid.UUID, str]]:
    """Active, readable Providers linked to the card, an ancestor or a descendant.

    The walk crosses hidden cards, but a link counts only when the hierarchy card it
    is attached to is readable, so a hidden card's relations are never revealed."""
    targets = {card_id, *await _ancestor_ids(db, card_id), *await descendant_ids(db, [card_id])}
    end = aliased(Card)
    rows = await db.execute(
        select(Card.id, Card.name)
        .join(Relation, Relation.source_id == Card.id)
        .join(end, end.id == Relation.target_id)
        .where(
            Relation.type == PROVIDER_RELATIONS[card_type],
            Relation.target_id.in_(targets),
            Card.type == "Provider",
            Card.status == "ACTIVE",
            *read_scope.where(Card, mode="module"),
            *read_scope.where(end, mode="module"),
        )
        .distinct()
        .order_by(Card.name, Card.id)
    )
    return [(i, n) for i, n in rows.all()]


async def provider_names(
    db: AsyncSession, read_scope: CardReadScope, ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """Existing Provider cards (any status) the reader may see."""
    wanted = set(ids)
    if not wanted:
        return {}
    rows = await db.execute(
        select(Card.id, Card.name).where(
            Card.id.in_(wanted),
            Card.type == "Provider",
            *read_scope.where(Card, mode="module"),
        )
    )
    return {i: n for i, n in rows.all()}


async def _hidden(db: AsyncSession, read_scope: CardReadScope, provider_id: uuid.UUID) -> bool:
    """A Provider exists but the caller cannot read it (a deleted card, or one that is
    not a Provider, is not hidden)."""
    if provider_id in await provider_names(db, read_scope, [provider_id]):
        return False
    found = select(Card.id).where(Card.id == provider_id, Card.type == "Provider")
    return (await db.execute(found)).first() is not None


async def resolve_write(
    db: AsyncSession,
    read_scope: CardReadScope,
    card_id: uuid.UUID,
    card_type: str,
    stored: str | None,
    requested: str | None | _Unset,
) -> str | None:
    """The provider id to store; never drops a link the caller cannot see."""
    if requested is UNSET:
        return stored
    stored_id = parse_provider_id(stored)
    hidden = stored_id is not None and await _hidden(db, read_scope, stored_id)
    if requested == stored and not hidden:
        return stored
    if requested is None:
        return stored if hidden else None
    allowed = {str(i) for i, _ in await candidate_providers(db, read_scope, card_id, card_type)}
    if requested not in allowed:
        raise CostError("invalid_provider", "Provider is not linked to this card")
    return requested
