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
    types = {t.key: t for t in (await db.execute(select(CardType))).scalars().all()}
    rels = {r.key: r for r in (await db.execute(select(RelationType))).scalars().all()}

    for key, want in dm.CARD_TYPE_DEFAULTS.items():
        assert key in types, key
        assert types[key].archimate_type == want, key

    # Seeded subtypes absent from SUBTYPE_DEFAULTS are expected to carry no
    # archimate_type key at all (they inherit the card type's mapping).
    for (tkey, skey), want in dm.SUBTYPE_DEFAULTS.items():
        assert tkey in types, tkey
        subs = {s["key"]: s for s in types[tkey].subtypes}
        assert skey in subs, (tkey, skey)
        assert subs[skey].get("archimate_type") == want, (tkey, skey)
    for tkey, t in types.items():
        for s in t.subtypes:
            if (tkey, s["key"]) not in dm.SUBTYPE_DEFAULTS:
                assert "archimate_type" not in s, (tkey, s["key"])

    for key, d in dm.RELATION_DEFAULTS.items():
        assert key in rels, key
        r = rels[key]
        assert r.archimate_type == d["type"], key
        assert r.archimate_reversed == d.get("reversed", False), key
        assert r.archimate_access == d.get("access"), key

    for key, r in rels.items():
        if key in dm.RELATION_DEFAULTS:
            continue
        if key.startswith(dm.SUCCESSOR_KEYS_PREFIX) and key.endswith(dm.SUCCESSOR_KEYS_SUFFIX):
            want = dm.SUCCESSOR_DEFAULT
            assert (r.archimate_type, r.archimate_reversed, r.archimate_access) == (
                want["type"],
                False,
                None,
            ), key
        else:
            assert r.archimate_type is None, key


async def test_reseed_leaves_existing_rows_untouched(db):
    await seed.seed_metamodel(db)
    types = {t.key: t for t in (await db.execute(select(CardType))).scalars().all()}
    rels = {r.key: r for r in (await db.execute(select(RelationType))).scalars().all()}
    assert types["BusinessContext"].archimate_type is None

    types["Application"].archimate_type = "Node"
    types["ITComponent"].subtypes = [
        {**s, "archimate_type": "Artifact"} if s["key"] == "hardware" else s
        for s in types["ITComponent"].subtypes
    ]
    rels["relAppToITC"].archimate_type = "Flow"
    rels["relAppToITC"].archimate_reversed = False
    await db.flush()

    await seed.seed_metamodel(db)
    await db.refresh(types["Application"])
    await db.refresh(types["ITComponent"])
    await db.refresh(types["BusinessContext"])
    await db.refresh(rels["relAppToITC"])

    assert types["Application"].archimate_type == "Node"
    assert types["BusinessContext"].archimate_type is None
    subs = {s["key"]: s.get("archimate_type") for s in types["ITComponent"].subtypes}
    assert subs["hardware"] == "Artifact"
    assert (rels["relAppToITC"].archimate_type, rels["relAppToITC"].archimate_reversed) == (
        "Flow",
        False,
    )
