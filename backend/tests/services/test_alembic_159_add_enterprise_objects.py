"""Migration 159 adds the EnterpriseObject registry and its card-mapping
bridge table (ArchiMate enterprise object foundation, task 1)."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.models.card_type import CardType
from app.models.enterprise_object import EnterpriseObject, EnterpriseObjectCardMapping


async def test_enterprise_objects_tables_exist(db):
    result = await db.execute(
        text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'enterprise_objects'"
        )
    )
    columns = {row[0] for row in result}
    assert {"key", "name", "layer", "is_standard", "is_locked", "is_hidden"} <= columns

    result = await db.execute(
        text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'enterprise_object_card_mappings'"
        )
    )
    columns = {row[0] for row in result}
    assert {
        "enterprise_object_key",
        "card_type_key",
        "card_subtype_key",
    } <= columns


async def test_enterprise_object_card_mapping_unique_constraint(db):
    db.add(CardType(key="MappingTestType", label="Mapping Test Type"))
    db.add(EnterpriseObject(key="MappingTestEO", name="Mapping Test EO"))
    await db.flush()

    # NULL subtype intentionally not used here: Postgres treats each NULL as
    # distinct for uniqueness purposes, so a concrete subtype is needed to
    # exercise the constraint.
    db.add(
        EnterpriseObjectCardMapping(
            enterprise_object_key="MappingTestEO",
            card_type_key="MappingTestType",
            card_subtype_key="widget",
        )
    )
    await db.flush()

    with pytest.raises(IntegrityError):
        async with db.begin_nested():
            db.add(
                EnterpriseObjectCardMapping(
                    enterprise_object_key="MappingTestEO",
                    card_type_key="MappingTestType",
                    card_subtype_key="widget",
                )
            )
            await db.flush()
