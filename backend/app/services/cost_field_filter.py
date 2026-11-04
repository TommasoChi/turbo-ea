"""Helpers to identify and strip cost-typed fields from card and relation attributes.

Used by endpoints that gate cost visibility behind the `costs.view` permission +
stakeholder bypass — see PermissionService.can_view_costs().
"""

from __future__ import annotations

from typing import Any

from app.models.card_type import CardType
from app.models.relation_type import RelationType


def _cost_keys_from_card_schema(fields_schema: Any) -> frozenset[str]:
    keys: set[str] = set()
    if not isinstance(fields_schema, list):
        return frozenset()
    for section in fields_schema:
        if not isinstance(section, dict):
            continue
        fields = section.get("fields") or []
        if not isinstance(fields, list):
            continue
        for field in fields:
            if isinstance(field, dict) and field.get("type") == "cost":
                key = field.get("key")
                if isinstance(key, str):
                    keys.add(key)
    return frozenset(keys)


def _cost_keys_from_flat_schema(attributes_schema: Any) -> frozenset[str]:
    keys: set[str] = set()
    if not isinstance(attributes_schema, list):
        return frozenset()
    for field in attributes_schema:
        if isinstance(field, dict) and field.get("type") == "cost":
            key = field.get("key")
            if isinstance(key, str):
                keys.add(key)
    return frozenset(keys)


def cost_field_keys_for_card_type(card_type: CardType | None) -> frozenset[str]:
    """Return the keys of all type=='cost' fields in a CardType.fields_schema."""
    if card_type is None:
        return frozenset()
    return _cost_keys_from_card_schema(card_type.fields_schema)


def cost_field_keys_from_card_schema(fields_schema: Any) -> frozenset[str]:
    """Same as cost_field_keys_for_card_type but operates on a raw schema list."""
    return _cost_keys_from_card_schema(fields_schema)


def cost_field_keys_for_relation_type(relation_type: RelationType | None) -> frozenset[str]:
    """Return the keys of all type=='cost' fields in a RelationType.attributes_schema."""
    if relation_type is None:
        return frozenset()
    return _cost_keys_from_flat_schema(relation_type.attributes_schema)


def cost_field_keys_from_relation_schema(attributes_schema: Any) -> frozenset[str]:
    """Same as cost_field_keys_for_relation_type but operates on a raw schema list."""
    return _cost_keys_from_flat_schema(attributes_schema)


def strip_costs_from_attributes(card_type: CardType | None, attributes: dict | None) -> dict:
    """Return a shallow copy of `attributes` with all cost-typed keys removed."""
    if not attributes:
        return {} if attributes is None else dict(attributes)
    cost_keys = cost_field_keys_for_card_type(card_type)
    if not cost_keys:
        return dict(attributes)
    return {k: v for k, v in attributes.items() if k not in cost_keys}


def strip_costs_from_relation_attributes(
    relation_type: RelationType | None, attributes: dict | None
) -> dict:
    """Return a shallow copy of relation `attributes` with cost keys removed."""
    if not attributes:
        return {} if attributes is None else dict(attributes)
    cost_keys = cost_field_keys_for_relation_type(relation_type)
    if not cost_keys:
        return dict(attributes)
    return {k: v for k, v in attributes.items() if k not in cost_keys}


COST_ITEMS_KEY = "cost_items"


def redact_event_costs(data: dict | None, cost_keys: frozenset[str]) -> dict | None:
    """Copy of an event payload with cost values removed from its ``changes``.

    Handles both shapes: ``changes[<cost key>]`` / ``changes["cost_items"]``
    (the cost event, a calculation) and ``changes["attributes"]`` old/new dicts
    (a generic card update). The event itself stays; only the values go.
    """
    changes = data.get("changes") if isinstance(data, dict) else None
    if not isinstance(changes, dict):
        return data
    drop = cost_keys | {COST_ITEMS_KEY}
    out = {k: v for k, v in changes.items() if k not in drop}
    attrs = out.get("attributes")
    if isinstance(attrs, dict):
        out["attributes"] = {
            side: {k: v for k, v in val.items() if k not in drop} if isinstance(val, dict) else val
            for side, val in attrs.items()
        }
    return {**(data or {}), "changes": out}
