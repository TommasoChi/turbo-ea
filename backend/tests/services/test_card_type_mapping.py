"""Unit tests for app.services.archimate.card_type_mapping's pure resolution
functions -- the n:m bridge-table semantics that replaced
CardType.archimate_type / subtypes[].archimate_type."""

from __future__ import annotations

from app.services.archimate.card_type_mapping import (
    card_type_element_types,
    subtype_element_types,
)


def test_card_type_element_types_unions_every_row_for_the_type():
    mappings = [
        ("BusinessObject", "DataObject", None),
        ("DataObject", "DataObject", None),
    ]
    assert card_type_element_types("DataObject", mappings) == ["BusinessObject", "DataObject"]


def test_card_type_element_types_includes_subtype_scoped_rows_too():
    """Mirrors the frontend's elementTypesForCardType: it does not filter on
    subtype, so a subtype-specific row still counts toward the card type's
    own set."""
    mappings = [("Location", "Organization", "region")]
    assert card_type_element_types("Organization", mappings) == ["Location"]


def test_card_type_element_types_empty_for_unmapped_type():
    assert card_type_element_types("BusinessContext", []) == []


def test_subtype_element_types_unions_type_level_and_subtype_specific_rows():
    """No override/cascade: a subtype's resolved set includes BOTH the
    type-level rows (card_subtype_key None, apply to every subtype) and its
    own subtype-specific rows."""
    mappings = [
        ("BusinessActor", "Organization", None),
        ("Location", "Organization", "region"),
    ]
    assert subtype_element_types("Organization", "region", mappings) == [
        "BusinessActor",
        "Location",
    ]


def test_subtype_element_types_excludes_a_different_subtypes_rows():
    mappings = [
        ("Location", "Organization", "region"),
        ("BusinessActor", "Organization", "department"),
    ]
    assert subtype_element_types("Organization", "region", mappings) == ["Location"]


def test_subtype_element_types_falls_back_to_type_level_only():
    mappings = [("BusinessActor", "Organization", None)]
    assert subtype_element_types("Organization", "region", mappings) == ["BusinessActor"]
