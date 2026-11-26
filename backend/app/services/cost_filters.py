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
from app.services import portal_card_filters as pcf
from app.services.card_read_scope import CardReadScope

MAX_FILTER_CHARS = 20000

#: Matches no card: what an unreadable pick becomes.
_NO_CARD = str(uuid.UUID(int=0))


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


async def _scoped_relation_filters(
    db: AsyncSession,
    read_scope: CardReadScope,
    relation_filters: Mapping[str, list[str]],
    include_descendants: bool,
) -> dict[str, list[str]]:
    """Each relation pick kept only when readable, widened only through readable cards."""
    picks = {
        k: pcf.uuids(i for i in ids if i != pcf.EMPTY_KEY) for k, ids in relation_filters.items()
    }
    readable = await _readable(db, read_scope, {u for ids in picks.values() for u in ids})
    out: dict[str, list[str]] = {}
    for key, ids in relation_filters.items():
        kept = {u for u in picks[key] if u in readable}
        shown = [str(u) if u in kept else _NO_CARD for u in picks[key]]
        if include_descendants:
            below = await pcf.descendant_ids(db, kept)
            shown += sorted(str(u) for u in await _readable(db, read_scope, below))
        out[key] = [*([pcf.EMPTY_KEY] if pcf.EMPTY_KEY in ids else []), *dict.fromkeys(shown)]
    return out


async def filter_conditions(
    db: AsyncSession, read_scope: CardReadScope, filters: Mapping[str, dict]
) -> dict[str, list[ColumnElement[bool]]]:
    """``{type key: where-clauses on Card}``, computed once per request."""
    out: dict[str, list[ColumnElement[bool]]] = {}
    for type_key, value in filters.items():
        scoped = {
            **value,
            "relationFilters": await _scoped_relation_filters(
                db, read_scope, value["relationFilters"], value["includeDescendants"]
            ),
            "includeDescendants": False,
        }
        out[type_key] = await pcf.preset_conditions(
            db,
            type_key,
            {"card_filters": scoped},
            related_end_where=read_scope.where(pcf._OTHER, mode="module"),
        )
    return out
