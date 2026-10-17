from __future__ import annotations

from app.services.archimate import default_mapping as dm
from app.services.archimate import taxonomy as tx
from app.services.seed import RELATIONS

REL = {r["key"]: r for r in RELATIONS}


def _element(card_type: str) -> str | None:
    return dm.CARD_TYPE_DEFAULTS.get(card_type)


def test_every_default_relationship_is_a_known_type():
    for key, d in dm.RELATION_DEFAULTS.items():
        assert d["type"] in tx.RELATIONSHIP_TYPES, key


def test_every_default_element_is_a_known_type():
    for t, e in dm.CARD_TYPE_DEFAULTS.items():
        assert e is None or e in tx.ALL_ELEMENT_TYPES, t
    for k, e in dm.SUBTYPE_DEFAULTS.items():
        assert e in tx.ALL_ELEMENT_TYPES, k


def test_default_relationships_are_allowed_between_their_default_elements():
    """Applies the direction flag, then asks the matrix. A default that cannot
    hold for the type-level elements must be Association (always allowed)."""
    bad = []
    for key, d in dm.RELATION_DEFAULTS.items():
        rel = REL[key]
        s, t = _element(rel["source_type_key"]), _element(rel["target_type_key"])
        if s is None or t is None:
            continue
        if d.get("reversed"):
            s, t = t, s
        if not tx.is_relationship_allowed(s, t, d["type"]):
            bad.append((key, s, t, d["type"]))
    assert bad == [], f"switch these defaults to Association (or fix the element default): {bad}"
