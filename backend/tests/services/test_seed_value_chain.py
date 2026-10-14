"""The Value Chain feature must work on a clean install, so everything it
reads lives in the seed — not in an instance's hand-made configuration."""

from __future__ import annotations

import pytest

from app.services.seed import RELATIONS, TYPES

LOCALES = ("de", "fr", "es", "it", "pt", "zh", "ru", "da", "ar")


def _type(key):
    return next(t for t in TYPES if t["key"] == key)


def _field(type_key, field_key):
    return next(
        f
        for section in _type(type_key)["fields_schema"]
        for f in section.get("fields", [])
        if f["key"] == field_key
    )


def _field_keys(type_key):
    return {f["key"] for section in _type(type_key)["fields_schema"] for f in section["fields"]}


def test_objective_has_the_two_value_chain_subtypes():
    assert {s["key"] for s in _type("Objective")["subtypes"]} >= {"valueGate", "businessGoal"}


def test_business_context_carries_the_band_fields():
    assert _field_keys("BusinessContext") >= {"isCore", "isCross", "sortOrder", "levelOrder"}


def test_business_process_carries_level_order():
    assert "levelOrder" in _field_keys("BusinessProcess")
    # BusinessProcess only gets levelOrder, not the band flags.
    assert not {"isCore", "isCross", "sortOrder"} & _field_keys("BusinessProcess")


def test_field_types():
    assert _field("BusinessContext", "isCore")["type"] == "boolean"
    assert _field("BusinessContext", "isCross")["type"] == "boolean"
    assert _field("BusinessContext", "sortOrder")["type"] == "number"
    assert _field("BusinessContext", "levelOrder")["type"] == "number"
    assert _field("BusinessProcess", "levelOrder")["type"] == "number"


def test_business_context_has_successors_enabled():
    assert _type("BusinessContext")["has_successors"] is True


def test_relation_sort_orders_are_unique():
    orders = [r["sort_order"] for r in RELATIONS]
    assert len(orders) == len(set(orders))


@pytest.mark.parametrize(
    ("key", "source", "target"),
    [
        ("relObjectiveToBizCtx", "Objective", "BusinessContext"),
        ("relBusinessContextSuccessor", "BusinessContext", "BusinessContext"),
    ],
)
def test_relation_type_is_seeded_and_built_in(key, source, target):
    rt = next(r for r in RELATIONS if r["key"] == key)
    assert (rt["source_type_key"], rt["target_type_key"]) == (source, target)
    assert rt["cardinality"] == "n:m"
    for locale in LOCALES:
        assert rt["translations"]["label"][locale]
        assert rt["translations"]["reverse_label"][locale]


def test_new_subtypes_and_fields_are_fully_translated():
    subtypes = [
        s for s in _type("Objective")["subtypes"] if s["key"] in {"valueGate", "businessGoal"}
    ]
    assert len(subtypes) == 2
    for subtype in subtypes:
        for locale in LOCALES:
            assert subtype["translations"][locale]
    for type_key, keys in (
        ("BusinessContext", ("isCore", "isCross", "sortOrder", "levelOrder")),
        ("BusinessProcess", ("levelOrder",)),
    ):
        for key in keys:
            for locale in LOCALES:
                assert _field(type_key, key)["translations"][locale]
    for type_key in ("BusinessContext", "BusinessProcess"):
        section = next(s for s in _type(type_key)["fields_schema"] if s["section"] == "Value Chain")
        for locale in LOCALES:
            assert section["translations"][locale]
