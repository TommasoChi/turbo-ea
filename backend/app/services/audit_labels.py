"""Display labels for the Security & admin log.

An audit row names admin-defined things by their *label*, never their key
(``services/audit_log`` contract: "labels, not keys"). The lookups every writer
needs — a card type's label, a role's label, a category's label — and the one clipping rule for long
free text live here, so the writers cannot drift on what an unknown key or an
over-long description turns into.

The lookups share three rules:

* **One query** for any number of keys, and **no query at all** for none — a
  writer may call them unconditionally without paying an ``IN ()`` round trip.
* An unknown key (or a row with an empty label) is **absent** from the result,
  so the caller decides the fallback — usually the key itself.
* ``None`` keys are ignored.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import overload

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card_type import CardType
from app.models.card_type_category import CardTypeCategory
from app.models.cost_item_type import CostItemType
from app.models.role import Role

# The longest free text (a description, a rationale) one side of an audit
# change may carry; longer text is clipped so one edit of a page-long text
# cannot make a row arbitrarily large.
AUDIT_TEXT_LIMIT = 500

_ELLIPSIS = "…"


def _wanted(keys: Iterable[str | None]) -> set[str]:
    return {k for k in keys if k}


async def card_type_labels(db: AsyncSession, keys: Iterable[str | None]) -> dict[str, str]:
    """``{card type key: label}`` for ``keys``, in one query (none when empty)."""
    wanted = _wanted(keys)
    if not wanted:
        return {}
    rows = await db.execute(select(CardType.key, CardType.label).where(CardType.key.in_(wanted)))
    return {key: label for key, label in rows.all() if label}


@overload
async def card_type_label(db: AsyncSession, key: str) -> str: ...
@overload
async def card_type_label(db: AsyncSession, key: None) -> None: ...
async def card_type_label(db: AsyncSession, key: str | None) -> str | None:
    """One card type's label; the key itself when no type (or label) answers to
    it, and ``None`` for ``None``."""
    if not key:
        return key
    return (await card_type_labels(db, [key])).get(key, key)


async def role_labels(db: AsyncSession, keys: Iterable[str | None]) -> dict[str, str]:
    """``{role key: label}`` for ``keys``, in one query (none when empty)."""
    wanted = _wanted(keys)
    if not wanted:
        return {}
    rows = await db.execute(select(Role.key, Role.label).where(Role.key.in_(wanted)))
    return {key: label for key, label in rows.all() if label}


async def category_labels(db: AsyncSession, keys: Iterable[str | None]) -> dict[str, str]:
    """``{card type category key: label}`` for ``keys``, in one query (none
    when empty). A card type stores its category by key; a renamed custom
    category's key is no longer what anyone reads."""
    wanted = _wanted(keys)
    if not wanted:
        return {}
    rows = await db.execute(
        select(CardTypeCategory.key, CardTypeCategory.label).where(CardTypeCategory.key.in_(wanted))
    )
    return {key: label for key, label in rows.all() if label}


async def cost_item_labels(db: AsyncSession, keys: Iterable[str | None]) -> dict[str, str]:
    """``{cost item key: label}`` for ``keys``, in one query (none when empty)."""
    wanted = _wanted(keys)
    if not wanted:
        return {}
    rows = await db.execute(
        select(CostItemType.key, CostItemType.label).where(CostItemType.key.in_(wanted))
    )
    return {key: label for key, label in rows.all() if label}


async def cost_event_summaries(
    db: AsyncSession, card_name: str, payloads: Iterable[dict | None]
) -> list[str]:
    """Readable "Costs of <card> changed (items: <labels>)" per ``card.costs_updated`` payload.

    Item labels, not keys, resolved in one query for the whole list; the items part
    is left out when a payload carries no ``cost_items`` (redacted for the reader).
    """
    keysets = []
    for data in payloads:
        items = ((data or {}).get("changes") or {}).get("cost_items") or {}
        keysets.append(sorted({*(items.get("old") or []), *(items.get("new") or [])}))
    labels = await cost_item_labels(db, [k for keys in keysets for k in keys])
    text = f"Costs of {card_name} changed"
    return [
        f"{text} (items: {', '.join(labels.get(k, k) for k in keys)})" if keys else text
        for keys in keysets
    ]


def clip_text(text: str | None, limit: int = AUDIT_TEXT_LIMIT) -> str | None:
    """``text`` cut to ``limit`` characters, the last one an ellipsis; shorter
    text (and ``None``) unchanged."""
    if text is None or len(text) <= limit:
        return text
    return text[: limit - 1] + _ELLIPSIS
