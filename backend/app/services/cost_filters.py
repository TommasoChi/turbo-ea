"""The cost report's field and relation filters, evaluated on the server.

``card_filters`` is a JSON object ``{card type key: CardFilterValue}`` (one group
per selected type, the shape ``CardFilterSection`` stores). The clauses come from
the web-portal evaluator (``portal_card_filters``); this module only parses the
parameter and keeps the evaluator inside the caller's read scope: a relation pick
the caller cannot read, or a hidden descendant an *Include sub-cards* switch would
reach, answers exactly like an unknown id. Reads only; never commits.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Mapping

from sqlalchemy import ColumnElement, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation_type import RelationType
from app.services import portal_card_filters as pcf
from app.services.card_read_scope import CardReadScope

MAX_FILTER_CHARS = 20000
MAX_RELATION_KEYS = 20
MAX_IDS_PER_KEY = 200
MAX_IDS_TOTAL = 500

#: Matches no card: what an unreadable pick becomes.
_NO_CARD = str(uuid.UUID(int=0))


def _check_caps(type_key: str, name: str, filters: Mapping[str, list[str]]) -> None:
    sizes = [len(ids) for ids in filters.values()]
    if len(sizes) > MAX_RELATION_KEYS or max(sizes, default=0) > MAX_IDS_PER_KEY:
        raise ValueError(f"card_filters[{type_key!r}] has too many {name}")
    if sum(sizes) > MAX_IDS_TOTAL:
        raise ValueError(f"card_filters[{type_key!r}] picks too many values in {name}")


def parse_card_filters(raw: str | None, type_keys: list[str]) -> dict[str, dict]:
    """The active filter of each selected type; ``ValueError`` on anything malformed."""
    if not raw:
        return {}
    if len(raw) > MAX_FILTER_CHARS:
        raise ValueError("card_filters is too large")
    try:
        parsed = json.loads(raw)
    except (ValueError, RecursionError) as exc:  # a deeply nested value recurses
        raise ValueError("card_filters is not valid JSON") from exc
    if not isinstance(parsed, dict):
        raise ValueError("card_filters must be a JSON object")
    out: dict[str, dict] = {}
    for key in type_keys:
        if key not in parsed:
            continue
        value = pcf.normalise_card_filters(parsed[key])
        if value is None:
            raise ValueError(f"card_filters[{key!r}] must be an object")
        for name in ("relationFilters", "relSubtypeFilters", "attrFilters"):
            _check_caps(key, name, value[name])
        value["tagFilterIds"] = []  # the cost report offers no tag groups
        if pcf.has_active_card_filters(value):
            out[key] = value
    return out


async def _readable(
    db: AsyncSession, read_scope: CardReadScope, ids: set[uuid.UUID]
) -> set[uuid.UUID]:
    if not ids:
        return set()
    rows = await db.execute(
        select(Card.id).where(Card.id.in_(ids), *read_scope.where(Card, mode="module"))
    )
    return set(rows.scalars().all())


async def _known_keys(db: AsyncSession) -> tuple[set[str], set[str]]:
    """``(relation type keys, card type keys)`` a relation filter may name."""
    rels = (await db.execute(select(RelationType.key))).scalars().all()
    types = (await db.execute(select(CardType.key))).scalars().all()
    return set(rels), set(types)


async def _children_below(
    db: AsyncSession, roots: set[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """``{parent: children}`` for every card beneath ``roots``, in one query."""
    if not roots:
        return {}
    below = pcf.descendant_cte(list(roots)).c.id
    rows = await db.execute(select(Card.parent_id, Card.id).where(Card.id.in_(select(below))))
    children: dict[uuid.UUID, list[uuid.UUID]] = {}
    for parent_id, card_id in rows.all():
        children.setdefault(parent_id, []).append(card_id)
    return children


def _beneath(
    children: Mapping[uuid.UUID, list[uuid.UUID]], roots: set[uuid.UUID]
) -> set[uuid.UUID]:
    out: set[uuid.UUID] = set()
    stack = list(roots)
    while stack:
        for child in children.get(stack.pop(), ()):
            if child not in out:
                out.add(child)
                stack.append(child)
    return out


async def _scoped_relation_filters(
    db: AsyncSession,
    read_scope: CardReadScope,
    relation_filters: Mapping[str, list[str]],
    include_descendants: bool,
    known: tuple[set[str], set[str]],
) -> dict[str, list[str]]:
    """Each relation pick kept only when readable, widened only through readable cards.

    A key naming neither a relation type nor a card type is dropped."""
    rel_keys, type_keys = known
    relation_filters = {
        k: ids
        for k, ids in relation_filters.items()
        if pcf.parse_side_key(k)[0] in rel_keys or k in type_keys
    }
    picks = {
        k: pcf.uuids(i for i in ids if i != pcf.EMPTY_KEY) for k, ids in relation_filters.items()
    }
    readable = await _readable(db, read_scope, {u for ids in picks.values() for u in ids})
    children = await _children_below(db, readable) if include_descendants else {}
    seen_below = {c for kids in children.values() for c in kids}
    readable_below = await _readable(db, read_scope, seen_below)
    out: dict[str, list[str]] = {}
    for key, ids in relation_filters.items():
        kept = {u for u in picks[key] if u in readable}
        shown = [str(u) if u in kept else _NO_CARD for u in picks[key]]
        if include_descendants:
            shown += sorted(str(u) for u in _beneath(children, kept) & readable_below)
        out[key] = [*([pcf.EMPTY_KEY] if pcf.EMPTY_KEY in ids else []), *dict.fromkeys(shown)]
    return out


async def filter_conditions(
    db: AsyncSession, read_scope: CardReadScope, filters: Mapping[str, dict]
) -> dict[str, list[ColumnElement[bool]]]:
    """``{type key: where-clauses on Card}``, computed once per request."""
    out: dict[str, list[ColumnElement[bool]]] = {}
    known = await _known_keys(db) if any(v["relationFilters"] for v in filters.values()) else None
    for type_key, value in filters.items():
        scoped = {
            **value,
            "relationFilters": await _scoped_relation_filters(
                db, read_scope, value["relationFilters"], value["includeDescendants"], known
            )
            if known
            else {},
            "includeDescendants": False,
        }
        out[type_key] = await pcf.preset_conditions(
            db,
            type_key,
            {"card_filters": scoped},
            related_end_where=read_scope.where(pcf._OTHER, mode="module"),
        )
    return out
