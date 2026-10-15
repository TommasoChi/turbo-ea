from __future__ import annotations

from sqlalchemy import select

from app.models.card_type import CardType
from app.models.relation_type import RelationType
from app.services import seed
from app.services.archimate import default_mapping as dm


async def test_seed_applies_the_default_mapping(db):
    await seed.seed_metamodel(db)
    types = {t.key: t for t in (await db.execute(select(CardType))).scalars().all()}
    assert types["Application"].archimate_type == "ApplicationComponent"
    assert types["DataObject"].archimate_type == "BusinessObject"
    assert types["BusinessContext"].archimate_type is None
    subs = {s["key"]: s.get("archimate_type") for s in types["ITComponent"].subtypes}
    assert subs["hardware"] == "Device" and subs["software"] == "SystemSoftware"


async def test_seed_maps_relations_with_direction_and_access(db):
    await seed.seed_metamodel(db)
    rels = {r.key: r for r in (await db.execute(select(RelationType))).scalars().all()}
    uses = rels["relAppToITC"]
    assert (uses.archimate_type, uses.archimate_reversed) == ("Serving", True)
    crud = rels["relAppToDataObj"]
    assert (crud.archimate_type, crud.archimate_access) == ("Access", "crud")
    assert rels["relAppSuccessor"].archimate_type == "Association"


async def test_seed_covers_every_default(db):
    await seed.seed_metamodel(db)
    keys = {r.key for r in (await db.execute(select(RelationType))).scalars().all()}
    assert set(dm.RELATION_DEFAULTS) <= keys
