from __future__ import annotations

from sqlalchemy import func, select

from app.models.enterprise_object import EnterpriseObject, EnterpriseObjectCardMapping
from app.services import seed
from app.services.archimate import default_mapping as dm
from app.services.archimate import taxonomy
from app.services.archimate.enterprise_object_seed import (
    ENTERPRISE_OBJECT_DESCRIPTIONS,
    seed_enterprise_objects,
)

_OTHER_SECTION_KEYS = ("Grouping", "Location", "AndJunction", "OrJunction")


async def _mapping_rows_for(db, enterprise_object_key: str):
    result = await db.execute(
        select(EnterpriseObjectCardMapping).where(
            EnterpriseObjectCardMapping.enterprise_object_key == enterprise_object_key
        )
    )
    return result.scalars().all()


async def test_seed_creates_one_row_per_standard_element_type(db):
    await seed_enterprise_objects(db)
    result = await db.execute(select(EnterpriseObject).where(EnterpriseObject.is_standard))
    keys = {r.key for r in result.scalars().all()}
    # All standard element types plus the 4 "Other" section rows.
    assert keys == set(taxonomy.ELEMENT_TYPES) | set(_OTHER_SECTION_KEYS)


async def test_seed_populates_layer_icon_color_for_element_types(db):
    await seed_enterprise_objects(db)
    result = await db.execute(
        select(EnterpriseObject).where(EnterpriseObject.key == "BusinessActor")
    )
    actor = result.scalar_one()
    assert actor.layer == "business"
    assert actor.icon
    assert actor.color.startswith("#")
    assert actor.description == ENTERPRISE_OBJECT_DESCRIPTIONS["BusinessActor"]
    assert actor.is_standard is True


async def test_seed_creates_other_section_rows(db):
    await seed_enterprise_objects(db)

    result = await db.execute(select(EnterpriseObject).where(EnterpriseObject.key == "Grouping"))
    grouping = result.scalar_one()
    assert grouping.layer is None
    assert grouping.is_locked is True

    for key in ("Location", "AndJunction", "OrJunction"):
        result = await db.execute(select(EnterpriseObject).where(EnterpriseObject.key == key))
        obj = result.scalar_one()
        assert obj.layer is None
        assert obj.is_locked is False


def test_every_seeded_description_is_short_and_present():
    all_keys = set(taxonomy.ELEMENT_TYPES) | set(_OTHER_SECTION_KEYS)
    assert set(ENTERPRISE_OBJECT_DESCRIPTIONS.keys()) == all_keys
    for key, desc in ENTERPRISE_OBJECT_DESCRIPTIONS.items():
        assert desc, key
        assert len(desc.split()) <= 30, (key, len(desc.split()))


async def test_seed_is_idempotent(db):
    await seed_enterprise_objects(db)
    await seed_enterprise_objects(db)
    result = await db.execute(select(func.count()).select_from(EnterpriseObject))
    assert result.scalar() == len(taxonomy.ELEMENT_TYPES) + len(_OTHER_SECTION_KEYS)


async def test_reseed_updates_description_icon_color_layer_but_not_is_hidden(db):
    await seed_enterprise_objects(db)
    result = await db.execute(
        select(EnterpriseObject).where(EnterpriseObject.key == "BusinessActor")
    )
    actor = result.scalar_one()

    # Simulate an admin hiding the row and hand-editing its description.
    actor.is_hidden = True
    actor.description = "admin-edited description"
    await db.flush()

    await seed_enterprise_objects(db)
    await db.flush()
    await db.refresh(actor)

    assert actor.is_hidden is True  # admin's visibility choice survives reseed
    assert actor.description == ENTERPRISE_OBJECT_DESCRIPTIONS["BusinessActor"]  # content refreshed


# ── seed_card_mappings ──────────────────────────────────────────────────
# card_type_key has a FK to card_types, so these go through seed_metamodel
# (which seeds CardType rows and calls seed_enterprise_objects +
# seed_card_mappings in order) rather than calling seed_card_mappings alone.


async def test_card_type_defaults_become_bridge_rows(db):
    await seed.seed_metamodel(db)
    rows = await _mapping_rows_for(db, "BusinessObject")
    assert ("DataObject", None) in {(r.card_type_key, r.card_subtype_key) for r in rows}


async def test_subtype_defaults_become_scoped_bridge_rows(db):
    await seed.seed_metamodel(db)
    rows = await _mapping_rows_for(db, "Location")
    assert ("Organization", "region") in {(r.card_type_key, r.card_subtype_key) for r in rows}


async def test_unmapped_card_type_defaults_produce_no_row(db):
    # CARD_TYPE_DEFAULTS["BusinessContext"] is None today -- no type-level
    # bridge row (card_subtype_key is None) should exist for it.
    await seed.seed_metamodel(db)
    result = await db.execute(
        select(EnterpriseObjectCardMapping).where(
            EnterpriseObjectCardMapping.card_type_key == "BusinessContext",
            EnterpriseObjectCardMapping.card_subtype_key.is_(None),
        )
    )
    assert result.scalars().all() == []


async def test_card_mappings_seed_is_idempotent(db):
    await seed.seed_metamodel(db)
    await seed.seed_metamodel(db)
    result = await db.execute(select(func.count()).select_from(EnterpriseObjectCardMapping))
    expected = len([v for v in dm.CARD_TYPE_DEFAULTS.values() if v is not None]) + len(
        dm.SUBTYPE_DEFAULTS
    )
    assert result.scalar() == expected


async def test_every_mapping_value_matches_a_seeded_enterprise_object(db):
    # Every CARD_TYPE_DEFAULTS / SUBTYPE_DEFAULTS value must be a key that
    # seed_enterprise_objects actually seeded -- a dangling reference here
    # would mean a bridge row points at a non-existent EnterpriseObject.
    await seed.seed_metamodel(db)
    result = await db.execute(select(EnterpriseObject.key))
    seeded_keys = set(result.scalars().all())
    mapping_values = {v for v in dm.CARD_TYPE_DEFAULTS.values() if v is not None}
    mapping_values |= set(dm.SUBTYPE_DEFAULTS.values())
    assert mapping_values <= seeded_keys
