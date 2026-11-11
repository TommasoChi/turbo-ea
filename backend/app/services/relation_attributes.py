"""Attribute projection for general inventory relation reads."""

from typing import Any

from app.services.bo_relationship_constants import APPLICATION_RELATION, OWNERSHIP_KEY


def public_relation_attributes(
    type_key: str, attributes: dict[str, Any] | None, hidden_keys: frozenset[str] = frozenset()
) -> dict[str, Any] | None:
    if type_key == APPLICATION_RELATION:
        hidden_keys = hidden_keys | {OWNERSHIP_KEY}
    if hidden_keys and attributes:
        return {key: value for key, value in attributes.items() if key not in hidden_keys}
    return attributes
