from __future__ import annotations

import importlib.util
from pathlib import Path

from app.services.archimate import default_mapping as dm
from app.services.seed import RELATIONS, TYPES

_MIG = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "158_add_archimate_foundation.py"
)
_spec = importlib.util.spec_from_file_location("mig158", _MIG)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def test_every_seeded_card_type_has_a_default_entry():
    assert {t["key"] for t in TYPES} == set(dm.CARD_TYPE_DEFAULTS)


def test_every_subtype_default_names_a_real_subtype():
    real = {
        (t["key"], s["key"] if isinstance(s, dict) else s)
        for t in TYPES
        for s in t.get("subtypes", [])
    }
    assert set(dm.SUBTYPE_DEFAULTS) <= real


def test_every_relation_has_a_default_or_is_a_successor():
    seeded = {r["key"] for r in RELATIONS}
    non_successor = {k for k in seeded if not k.endswith(dm.SUCCESSOR_KEYS_SUFFIX)}
    assert non_successor <= set(dm.RELATION_DEFAULTS)
    # the only successor relation allowed to override the Association default
    assert set(dm.RELATION_DEFAULTS) - non_successor == {"relBusinessContextSuccessor"}
    assert "relBusinessContextSuccessor" in seeded


def test_access_defaults_say_how_to_derive_the_access_type():
    for key, d in dm.RELATION_DEFAULTS.items():
        assert ("access" in d) == (d["type"] == "Access"), key


def test_the_migration_embeds_exactly_the_module_defaults():
    assert mig.CARD_TYPE_DEFAULTS == dm.CARD_TYPE_DEFAULTS
    assert mig.SUBTYPE_DEFAULTS == dm.SUBTYPE_DEFAULTS
    assert mig.RELATION_DEFAULTS == dm.RELATION_DEFAULTS
    assert mig.SUCCESSOR_DEFAULT == dm.SUCCESSOR_DEFAULT
