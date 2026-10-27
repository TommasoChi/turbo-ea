"""Tests for seed_viewpoints (ArchiMate Viewpoint Catalog, task 2)."""

from __future__ import annotations

from sqlalchemy import func, select

from app.models.archimate_viewpoint import (
    ArchimateViewpoint,
    ArchimateViewpointObject,
    ArchimateViewpointTabCard,
)
from app.services.archimate import taxonomy
from app.services.archimate.enterprise_object_seed import seed_enterprise_objects
from app.services.archimate.viewpoint_seed import (
    _TAB_CARD_DEFS,
    _VIEWPOINT_DEFS,
    seed_viewpoints,
)
from tests.conftest import create_card_type


async def _create_tab_card_types(db) -> None:
    """ArchimateViewpointObject.enterprise_object_key and
    ArchimateViewpointTabCard.card_type_key both carry real FKs
    (enterprise_objects.key / card_types.key) -- same reason
    test_enterprise_object_seed.py routes its FK-dependent assertions through
    seed.seed_metamodel(db) rather than calling the leaf seeder alone."""
    await seed_enterprise_objects(db)
    for key in ("Application", "ITComponent", "Platform", "Initiative", "DataObject"):
        await create_card_type(db, key=key, label=key)


async def test_seeds_all_27_standard_viewpoints(db):
    await _create_tab_card_types(db)
    await seed_viewpoints(db)
    await db.commit()
    result = await db.execute(select(ArchimateViewpoint))
    rows = result.scalars().all()
    assert len(rows) == 27
    assert all(r.is_standard for r in rows)
    layered = next(r for r in rows if r.key == "layered")
    assert layered.icon == "layers"


async def test_layered_viewpoint_allows_every_element_type(db):
    await _create_tab_card_types(db)
    await seed_viewpoints(db)
    await db.commit()
    result = await db.execute(
        select(ArchimateViewpointObject.enterprise_object_key).where(
            ArchimateViewpointObject.viewpoint_key == "layered"
        )
    )
    keys = {r[0] for r in result.all()}
    assert keys == set(taxonomy.ALL_ELEMENT_TYPES)


async def test_does_not_overwrite_an_admin_edit_on_a_second_run(db):
    await _create_tab_card_types(db)
    await seed_viewpoints(db)
    await db.commit()
    result = await db.execute(
        select(ArchimateViewpoint).where(ArchimateViewpoint.key == "organization")
    )
    row = result.scalar_one()
    row.description = "admin's own wording"
    await db.commit()

    await seed_viewpoints(db)
    await db.commit()
    result = await db.execute(
        select(ArchimateViewpoint).where(ArchimateViewpoint.key == "organization")
    )
    assert result.scalar_one().description == "admin's own wording"


async def test_seeds_the_tab_card_overrides(db):
    await _create_tab_card_types(db)
    await seed_viewpoints(db)
    await db.commit()
    result = await db.execute(
        select(ArchimateViewpointTabCard.card_type_key).where(
            ArchimateViewpointTabCard.viewpoint_key == "implementation-and-deployment",
            ArchimateViewpointTabCard.tab_key == "technology",
        )
    )
    assert {r[0] for r in result.all()} == {"ITComponent", "Platform"}


async def test_seed_is_idempotent(db):
    """A second run adds no duplicate viewpoint, object, or tab-card row."""
    await _create_tab_card_types(db)
    await seed_viewpoints(db)
    await seed_viewpoints(db)
    await db.commit()

    vp_count = (await db.execute(select(func.count()).select_from(ArchimateViewpoint))).scalar()
    assert vp_count == len(_VIEWPOINT_DEFS)

    tc_count = (
        await db.execute(select(func.count()).select_from(ArchimateViewpointTabCard))
    ).scalar()
    assert tc_count == len(_TAB_CARD_DEFS)


async def test_every_viewpoint_object_key_matches_a_real_taxonomy_type(db):
    # Every `objects` entry in _VIEWPOINT_DEFS must be a real
    # taxonomy.ALL_ELEMENT_TYPES key -- a typo here would otherwise only
    # surface as a DB-level FK violation at seed time.
    for vp in _VIEWPOINT_DEFS:
        for key in vp["objects"]:
            assert key in taxonomy.ALL_ELEMENT_TYPES, (vp["key"], key)


def test_every_viewpoint_description_is_short_and_present():
    for vp in _VIEWPOINT_DEFS:
        assert vp["description"], vp["key"]
        assert len(vp["description"].split()) <= 30, (vp["key"], len(vp["description"].split()))
