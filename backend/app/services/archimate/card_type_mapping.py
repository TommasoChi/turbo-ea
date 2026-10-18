"""Resolve CardType (and subtype) -> ArchiMate element type mappings from the
EnterpriseObjectCardMapping bridge table.

This is the n:m replacement for the old ``CardType.archimate_type`` /
``subtypes[].archimate_type`` columns (see the 2026-10-17 ArchiMate
Enterprise Object plan). Those columns stay in the model and in GET
responses for now, but every switched-over consumer -- the frontend's
``elementTypesForCardType`` (resolveMapping.ts) and this module's callers --
reads the bridge table instead.

Mirrors ``elementTypesForCardType``'s matching semantics exactly: the bridge
table is flat, with no override/cascade between a type-level row
(``card_subtype_key IS NULL``, applies to every subtype) and a
subtype-specific row. Both kinds of row simply apply; a subtype's resolved
set is the union of its own rows and the type-level rows.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enterprise_object import EnterpriseObjectCardMapping

# A (enterprise_object_key, card_type_key, card_subtype_key) triple, the same
# shape as a EnterpriseObjectCardMapping row's three identifying columns.
MappingRow = tuple[str, str, str | None]


def card_type_element_types(card_type_key: str, mappings: list[MappingRow]) -> list[str]:
    """Every ArchiMate element type ``card_type_key`` maps to, deduped and
    sorted. Unions every bridge row for the card type, whether or not it
    carries a ``card_subtype_key`` -- same semantics as the frontend's
    ``elementTypesForCardType``, which does not filter on subtype either."""
    return sorted({eo_key for eo_key, ct_key, _ in mappings if ct_key == card_type_key})


def subtype_element_types(
    card_type_key: str, card_subtype_key: str, mappings: list[MappingRow]
) -> list[str]:
    """Every ArchiMate element type that applies to one specific subtype:
    the type-level rows (``card_subtype_key IS NULL``) union this subtype's
    own rows. No override/cascade -- both kinds of row apply at once."""
    return sorted(
        {
            eo_key
            for eo_key, ct_key, sub_key in mappings
            if ct_key == card_type_key and (sub_key is None or sub_key == card_subtype_key)
        }
    )


async def get_card_type_mapping(db: AsyncSession, card_types: list[dict]) -> list[dict]:
    """Build the ``card_types`` section for ``get_archimate_mapping``.

    ``card_types`` is a list of card type dicts as returned by
    ``GET /metamodel/types`` (each with a ``key`` and a ``subtypes`` list of
    dicts with their own ``key``). Returns one dict per card type:
    ``{"key": ..., "archimate_types": [...], "subtypes": {subtype_key: [...]}}``.
    """
    result = await db.execute(
        select(
            EnterpriseObjectCardMapping.enterprise_object_key,
            EnterpriseObjectCardMapping.card_type_key,
            EnterpriseObjectCardMapping.card_subtype_key,
        )
    )
    mappings: list[MappingRow] = list(result.all())

    out = []
    for t in card_types:
        key = t["key"]
        subtypes = {
            s["key"]: subtype_element_types(key, s["key"], mappings)
            for s in t.get("subtypes") or []
            if isinstance(s, dict) and s.get("key")
        }
        out.append(
            {
                "key": key,
                "archimate_types": card_type_element_types(key, mappings),
                "subtypes": subtypes,
            }
        )
    return out
