"""Tests for seed_viewpoint_examples (ArchiMate Viewpoint Catalog starter examples)."""

from __future__ import annotations

from xml.etree.ElementTree import fromstring

from sqlalchemy import func, select

from app.models.archimate_viewpoint import ArchimateViewpointExample
from app.services.archimate.enterprise_object_seed import seed_enterprise_objects
from app.services.archimate.viewpoint_example_seed import _EXAMPLE_DEFS, seed_viewpoint_examples
from app.services.archimate.viewpoint_seed import _VIEWPOINT_DEFS, seed_viewpoints
from tests.conftest import create_card_type


async def _seed_catalog(db) -> None:
    await seed_enterprise_objects(db)
    for key in ("Application", "ITComponent", "Platform", "Initiative", "DataObject"):
        await create_card_type(db, key=key, label=key)
    await seed_viewpoints(db)
    await db.commit()


async def test_seeds_every_defined_example(db):
    await _seed_catalog(db)
    await seed_viewpoint_examples(db)
    await db.commit()
    count = (await db.execute(select(func.count()).select_from(ArchimateViewpointExample))).scalar()
    assert count == len(_EXAMPLE_DEFS)


async def test_seed_is_idempotent(db):
    await _seed_catalog(db)
    await seed_viewpoint_examples(db)
    await seed_viewpoint_examples(db)
    await db.commit()
    count = (await db.execute(select(func.count()).select_from(ArchimateViewpointExample))).scalar()
    assert count == len(_EXAMPLE_DEFS)


async def test_does_not_overwrite_an_admin_edit_on_a_second_run(db):
    await _seed_catalog(db)
    await seed_viewpoint_examples(db)
    await db.commit()
    result = await db.execute(
        select(ArchimateViewpointExample).where(
            ArchimateViewpointExample.name == _EXAMPLE_DEFS[0][1]
        )
    )
    row = result.scalar_one()
    row.exchange_xml = "<model/>"
    await db.commit()

    await seed_viewpoint_examples(db)
    await db.commit()
    result = await db.execute(
        select(ArchimateViewpointExample).where(
            ArchimateViewpointExample.name == _EXAMPLE_DEFS[0][1]
        )
    )
    assert result.scalar_one().exchange_xml == "<model/>"


def test_every_example_viewpoint_key_is_a_real_standard_viewpoint():
    standard_keys = {vp["key"] for vp in _VIEWPOINT_DEFS}
    for viewpoint_key, name, _filename in _EXAMPLE_DEFS:
        assert viewpoint_key in standard_keys, name


def test_every_fixture_file_exists_and_is_well_formed_xml():
    from app.services.archimate.viewpoint_example_seed import _FIXTURES_DIR

    for _viewpoint_key, name, filename in _EXAMPLE_DEFS:
        path = _FIXTURES_DIR / filename
        assert path.is_file(), name
        fromstring(path.read_text(encoding="utf-8"))  # raises on malformed XML
