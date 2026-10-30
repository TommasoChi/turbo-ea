"""Group cost cards by a single-valued field or by the one card they link to.

Group values are raw (option value, ``"true"``/``"false"``, linked card name);
the page translates labels. A card lands in exactly one group.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.services.card_read_scope import CardReadScope

OTHER_GROUP = "__other__"


@dataclass(frozen=True)
class GroupBy:
    kind: Literal["field", "relation"]
    key: str


def parse_group_by(raw: str | None, field_keys: set[str]) -> GroupBy | None:
    """``field:<key>`` / ``rel:<key>``; a bare known field key is a saved report's old grouping."""
    if not raw:
        return None
    if raw.startswith("field:"):
        return GroupBy("field", raw[6:]) if raw[6:] else None
    if raw.startswith("rel:"):
        return GroupBy("relation", raw[4:]) if raw[4:] else None
    return GroupBy("field", raw) if raw in field_keys else None


async def assign_groups(
    db: AsyncSession,
    read_scope: CardReadScope,
    cards: list[Card],
    group_by: GroupBy | None,
) -> dict[uuid.UUID, str]:
    if group_by is None:
        return {c.id: OTHER_GROUP for c in cards}
    if group_by.kind == "field":
        return await _by_field(db, cards, group_by.key)
    return await _by_relation(db, read_scope, cards, group_by.key)


async def _by_field(db: AsyncSession, cards: list[Card], key: str) -> dict[uuid.UUID, str]:
    type_keys = {c.type for c in cards}
    types = (await db.execute(select(CardType).where(CardType.key.in_(type_keys)))).scalars().all()
    by_key = {t.key: t for t in types}
    for tk in type_keys:
        fields = [
            f
            for s in (by_key[tk].fields_schema if tk in by_key else None) or []
            for f in s.get("fields", [])
            if f.get("key") == key
        ]
        if not fields or fields[0].get("type") == "multiple_select":
            raise ValueError(f"'{key}' is not a single-valued field of {tk}")
    out: dict[uuid.UUID, str] = {}
    for c in cards:
        v = (c.attributes or {}).get(key)
        if isinstance(v, bool):
            out[c.id] = str(v).lower()
        else:
            out[c.id] = str(v) if v not in (None, "") else OTHER_GROUP
    return out


async def _by_relation(
    db: AsyncSession, read_scope: CardReadScope, cards: list[Card], key: str
) -> dict[uuid.UUID, str]:
    rt = (
        await db.execute(select(RelationType).where(RelationType.key == key))
    ).scalar_one_or_none()
    if rt is None:
        raise ValueError(f"unknown relation type '{key}'")
    # 1:1 and 1:n allow one relation per source; 1:1 also per target.
    ends = {"1:1": {rt.source_type_key, rt.target_type_key}, "1:n": {rt.source_type_key}}.get(
        rt.cardinality, set()
    )
    if not {c.type for c in cards} <= ends:
        raise ValueError(f"cards are not on the at-most-one end of '{key}'")
    ids = [c.id for c in cards]
    rels = (
        (
            await db.execute(
                select(Relation).where(
                    Relation.type == key, Relation.source_id.in_(ids) | Relation.target_id.in_(ids)
                )
            )
        )
        .scalars()
        .all()
    )
    # (card id, linked card id), first link by relation id wins
    links: dict[uuid.UUID, uuid.UUID] = {}
    for r in sorted(rels, key=lambda r: str(r.id)):
        if r.source_id in ids:
            links.setdefault(r.source_id, r.target_id)
        if rt.cardinality == "1:1" and r.target_id in ids:
            links.setdefault(r.target_id, r.source_id)
    linked = (
        (
            await db.execute(
                select(Card).where(
                    Card.id.in_(set(links.values())), *read_scope.where(Card, mode="module")
                )
            )
        )
        .scalars()
        .all()
    )
    names = {c.id: c.name for c in linked}
    return {c.id: names.get(links.get(c.id), OTHER_GROUP) for c in cards}
