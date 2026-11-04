"""cost_components: the cost fields that concur to a total, read from its calculation."""

from __future__ import annotations

from app.models.calculation import Calculation
from app.services.cost_components import cost_components, formula_field_refs
from tests.conftest import create_card_type

TOTAL = "costTotalAnnual"


def _schema(*cost_keys, other=()):
    fields = [{"key": k, "label": k, "type": "cost"} for k in cost_keys]
    fields += [{"key": k, "label": k, "type": "text"} for k in other]
    return [{"section": "Cost", "fields": fields}]


async def _calc(db, type_key, formula, active=True, field=TOTAL):
    db.add(
        Calculation(
            name=f"c-{type_key}",
            target_type_key=type_key,
            target_field_key=field,
            formula=formula,
            is_active=active,
        )
    )
    await db.flush()


def test_formula_field_refs_plain_sum():
    assert formula_field_refs("present = data.a + data.b + data.c") == ["a", "b", "c"]


def test_formula_field_refs_ignores_non_data_names_and_duplicates():
    assert formula_field_refs("x = data.a + other.b + data.a + metadata.c + data.d") == ["a", "d"]


async def test_components_from_active_calculation(db):
    await create_card_type(db, key="Workload", fields_schema=_schema(TOTAL, "a", "b", "c"))
    await _calc(db, "Workload", "x = data.a + data.b + data.c")
    assert await cost_components(db, ["Workload"], TOTAL) == ["a", "b", "c"]


async def test_no_calculation_returns_field_itself(db):
    await create_card_type(db, key="Workload", fields_schema=_schema(TOTAL))
    assert await cost_components(db, ["Workload"], TOTAL) == [TOTAL]


async def test_inactive_calculation_is_ignored_returns_field_itself(db):
    await create_card_type(db, key="Workload", fields_schema=_schema(TOTAL, "a"))
    await _calc(db, "Workload", "x = data.a", active=False)
    assert await cost_components(db, ["Workload"], TOTAL) == [TOTAL]


async def test_non_cost_field_in_formula_is_dropped(db):
    await create_card_type(db, key="Workload", fields_schema=_schema(TOTAL, "a", other=["n"]))
    await _calc(db, "Workload", "x = data.a + data.n + data.missing")
    assert await cost_components(db, ["Workload"], TOTAL) == ["a"]


async def test_combined_types_intersect(db):
    await create_card_type(db, key="Workload", fields_schema=_schema(TOTAL, "a", "b", "c"))
    await create_card_type(db, key="Asset", fields_schema=_schema(TOTAL, "b", "c", "d"))
    await _calc(db, "Workload", "x = data.a + data.b + data.c")
    await _calc(db, "Asset", "x = data.b + data.c + data.d")
    assert await cost_components(db, ["Workload", "Asset"], TOTAL) == ["b", "c"]


async def test_combined_types_without_shared_field_is_empty(db):
    await create_card_type(db, key="Workload", fields_schema=_schema(TOTAL, "a"))
    await create_card_type(db, key="Asset", fields_schema=_schema(TOTAL, "d"))
    await _calc(db, "Workload", "x = data.a")
    await _calc(db, "Asset", "x = data.d")
    assert await cost_components(db, ["Workload", "Asset"], TOTAL) == []


async def test_formula_with_multiplication_still_lists_referenced_fields(db):
    await create_card_type(db, key="Workload", fields_schema=_schema(TOTAL, "a", "b"))
    await _calc(db, "Workload", "x = data.a * 12 + data.b")
    assert await cost_components(db, ["Workload"], TOTAL) == ["a", "b"]


async def test_order_follows_formula_not_alphabet(db):
    await create_card_type(db, key="Workload", fields_schema=_schema(TOTAL, "a", "b", "c"))
    await _calc(db, "Workload", "x = data.c + data.a + data.b")
    assert await cost_components(db, ["Workload"], TOTAL) == ["c", "a", "b"]


async def test_intersection_keeps_order_of_first_type(db):
    await create_card_type(db, key="Workload", fields_schema=_schema(TOTAL, "a", "b", "c"))
    await create_card_type(db, key="Asset", fields_schema=_schema(TOTAL, "b", "c"))
    await _calc(db, "Workload", "x = data.c + data.b + data.a")
    await _calc(db, "Asset", "x = data.b + data.c")
    assert await cost_components(db, ["Workload", "Asset"], TOTAL) == ["c", "b"]


async def test_calculation_for_another_field_is_ignored(db):
    await create_card_type(db, key="Workload", fields_schema=_schema(TOTAL, "a", "other"))
    await _calc(db, "Workload", "x = data.a", field="other")
    assert await cost_components(db, ["Workload"], TOTAL) == [TOTAL]


async def test_no_types_is_empty(db):
    assert await cost_components(db, [], TOTAL) == []


async def test_mixed_types_calculated_and_plain(db):
    await create_card_type(db, key="Workload", fields_schema=_schema(TOTAL, "a"))
    await create_card_type(db, key="Asset", fields_schema=_schema(TOTAL))
    await _calc(db, "Workload", "x = data.a")
    # Workload -> [a]; Asset -> [TOTAL]; nothing shared
    assert await cost_components(db, ["Workload", "Asset"], TOTAL) == []
