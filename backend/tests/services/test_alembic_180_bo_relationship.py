"""Upgrade preserves custom DataObject metadata while adding BO defaults."""

import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import select

from app.models.card_type import CardType
from app.models.diagram import Diagram
from app.models.relation_type import RelationType
from tests.conftest import create_card_type, create_relation_type

path = Path(__file__).resolve().parents[2] / "alembic/versions/180_bo_relationship.py"
spec = importlib.util.spec_from_file_location("mig180", path)
mig = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mig)


async def test_upgrade_is_additive_and_idempotent(db):
    from app.services.seed import RELATIONS, TYPES

    await create_card_type(
        db,
        key="DataObject",
        subtypes=[{"key": "custom", "label": "Custom"}],
        fields_schema=[
            {"section": "Data Information", "fields": [{"key": "custom", "type": "text"}]}
        ],
    )
    await create_relation_type(
        db,
        key="relAppToDataObj",
        source_type_key="Application",
        target_type_key="DataObject",
        attributes_schema=[{"key": "custom", "type": "boolean"}],
    )
    conn = await db.connection()
    await conn.run_sync(mig._upgrade_body)
    await conn.run_sync(mig._upgrade_body)
    db.expire_all()
    obj = (await db.execute(select(CardType).where(CardType.key == "DataObject"))).scalar_one()
    assert {s["key"] for s in obj.subtypes} == {"custom", "data", "document"}
    assert {f["key"] for s in obj.fields_schema for f in s["fields"]} == {"custom", "isPaymentData"}
    defaults = next(entry for entry in TYPES if entry["key"] == "DataObject")
    installed_subtypes = {entry["key"]: entry for entry in obj.subtypes}
    for subtype in defaults["subtypes"]:
        assert installed_subtypes[subtype["key"]]["translations"] == subtype["translations"]
    payment = next(f for s in obj.fields_schema for f in s["fields"] if f["key"] == "isPaymentData")
    seed_payment = next(
        f for s in defaults["fields_schema"] for f in s["fields"] if f["key"] == "isPaymentData"
    )
    assert payment["translations"] == seed_payment["translations"]
    app = (
        await db.execute(select(RelationType).where(RelationType.key == "relAppToDataObj"))
    ).scalar_one()
    assert {a["key"] for a in app.attributes_schema} == {"custom", "dataOwnership"}
    er = (
        await db.execute(
            select(RelationType).where(RelationType.key == "relDataObjectToDataObject")
        )
    ).scalar_one()
    assert er.source_type_key == er.target_type_key == "DataObject"
    er_defaults = next(entry for entry in RELATIONS if entry["key"] == er.key)
    assert er.sort_order == er_defaults["sort_order"]
    assert (er.archimate_type, er.archimate_reversed, er.archimate_access) == (
        "Association",
        False,
        None,
    )
    assert {o["key"] for o in er.attributes_schema[0]["options"]} == {"1:1", "1:n", "n:1", "n:m"}
    diagrams = (
        (await db.execute(select(Diagram).where(Diagram.kind == "boRelationship"))).scalars().all()
    )
    assert len(diagrams) == 1
    assert diagrams[0].data == {"positions": {}}


async def test_fresh_seed_installs_bo_defaults(db):
    from app.services.seed import seed_metamodel

    await seed_metamodel(db)
    obj = (await db.execute(select(CardType).where(CardType.key == "DataObject"))).scalar_one()
    assert {v["key"] for v in obj.subtypes} >= {"data", "document"}
    assert any(f["key"] == "isPaymentData" for s in obj.fields_schema for f in s["fields"])
    app = (
        await db.execute(select(RelationType).where(RelationType.key == "relAppToDataObj"))
    ).scalar_one()
    assert any(a["key"] == "dataOwnership" for a in app.attributes_schema)
    er = (
        await db.execute(
            select(RelationType).where(RelationType.key == "relDataObjectToDataObject")
        )
    ).scalar_one()
    assert er.source_type_key == er.target_type_key == "DataObject"
    diagrams = (
        (await db.execute(select(Diagram).where(Diagram.kind == "boRelationship"))).scalars().all()
    )
    assert len(diagrams) == 1
    assert diagrams[0].data == {"positions": {}}


async def test_upgrade_relation_attributes_match_fresh_builtin_flags_and_translations(db):
    from app.services.seed import RELATIONS, _mark_builtin_attributes_schema

    await create_relation_type(
        db, key="relAppToDataObj", source_type_key="Application", target_type_key="DataObject"
    )
    conn = await db.connection()
    await conn.run_sync(mig._upgrade_body)
    db.expire_all()
    app = (
        await db.execute(select(RelationType).where(RelationType.key == "relAppToDataObj"))
    ).scalar_one()
    er = (
        await db.execute(
            select(RelationType).where(RelationType.key == "relDataObjectToDataObject")
        )
    ).scalar_one()
    for row in (app, er):
        defaults = next(x for x in RELATIONS if x["key"] == row.key)
        if row is er:
            assert row.translations == defaults["translations"]
        expected = _mark_builtin_attributes_schema(defaults["attributes_schema"])
        for field in row.attributes_schema:
            matching = next((x for x in expected if x["key"] == field["key"]), None)
            if matching:
                assert field.get("built_in") == matching["built_in"]
                assert field.get("translations") == matching.get("translations")
                assert [x.get("built_in") for x in field.get("options", [])] == [
                    x["built_in"] for x in matching.get("options", [])
                ]
                assert [x.get("translations") for x in field.get("options", [])] == [
                    x.get("translations") for x in matching.get("options", [])
                ]


@pytest.mark.parametrize(
    "conflict", ["custom_er", "orphan_er", "ownership_schema", "raw_master", "duplicate_master"]
)
async def test_upgrade_refuses_legacy_collisions_before_mutating(db, conflict):
    from sqlalchemy import text

    from tests.conftest import create_card, create_relation

    await create_card_type(
        db, key="DataObject", fields_schema=[{"section": "Data Information", "fields": []}]
    )
    attrs = [{"key": "dataOwnership", "type": "text"}] if conflict == "ownership_schema" else []
    if conflict == "duplicate_master":
        attrs = [
            {
                "key": "dataOwnership",
                "type": "single_select",
                "options": [{"key": "master", "label": "Master"}],
            }
        ]
    await create_relation_type(
        db,
        key="relAppToDataObj",
        source_type_key="Application",
        target_type_key="DataObject",
        attributes_schema=attrs,
    )
    if conflict == "custom_er":
        await create_relation_type(
            db,
            key="relDataObjectToDataObject",
            source_type_key="DataObject",
            target_type_key="DataObject",
            built_in=False,
        )
    if conflict in ("orphan_er", "raw_master", "duplicate_master"):
        obj = await create_card(db, card_type="DataObject", name="Object")
        app = await create_card(db, card_type="Application", name="Application")
        if conflict == "orphan_er":
            other = await create_card(db, card_type="DataObject", name="Other")
            await create_relation(
                db, type_key="relDataObjectToDataObject", source_id=obj.id, target_id=other.id
            )
        else:
            await create_relation(
                db,
                type_key="relAppToDataObj",
                source_id=app.id,
                target_id=obj.id,
                attributes={"dataOwnership": "master"},
            )
            if conflict == "duplicate_master":
                await db.execute(text("DROP INDEX uq_bo_master"))
                app2 = await create_card(db, card_type="Application", name="Application 2")
                await create_relation(
                    db,
                    type_key="relAppToDataObj",
                    source_id=app2.id,
                    target_id=obj.id,
                    attributes={"dataOwnership": "master"},
                )
    conn = await db.connection()
    with pytest.raises(RuntimeError, match="(?i)(ownership|master|relation|reserved)"):
        await conn.run_sync(mig._upgrade_body)
    db.expire_all()
    obj_type = (await db.execute(select(CardType).where(CardType.key == "DataObject"))).scalar_one()
    assert obj_type.subtypes == []
    assert obj_type.fields_schema[0]["fields"] == []


async def test_upgrade_keeps_compatible_master_and_custom_ownership_labels(db):
    from tests.conftest import create_card, create_relation

    await create_card_type(db, key="DataObject")
    schema = [
        {
            "key": "dataOwnership",
            "label": "Custom ownership",
            "type": "single_select",
            "options": [{"key": "master", "label": "Custom master"}],
        }
    ]
    await create_relation_type(
        db,
        key="relAppToDataObj",
        source_type_key="Application",
        target_type_key="DataObject",
        attributes_schema=schema,
    )
    obj = await create_card(db, card_type="DataObject", name="Object")
    app = await create_card(db, card_type="Application", name="Application")
    relation = await create_relation(
        db,
        type_key="relAppToDataObj",
        source_id=app.id,
        target_id=obj.id,
        attributes={"dataOwnership": "master", "crudRead": True},
    )
    conn = await db.connection()
    await conn.run_sync(mig._upgrade_body)
    db.expire_all()
    row = (
        await db.execute(select(RelationType).where(RelationType.key == "relAppToDataObj"))
    ).scalar_one()
    await db.refresh(relation)
    assert row.attributes_schema[0]["label"] == "Custom ownership"
    assert row.attributes_schema[0]["built_in"] is True
    assert row.attributes_schema[0]["options"][0]["label"] == "Custom master"
    assert row.attributes_schema[0]["options"][0]["built_in"] is True
    assert relation.attributes == {"dataOwnership": "master", "crudRead": True}


@pytest.mark.parametrize(
    "conflict", ["wrong_endpoints", "wrong_cardinality", "duplicate_pairs", "null_options"]
)
async def test_upgrade_refuses_incompatible_builtin_er_or_ownership_with_actionable_error(
    db, conflict
):
    from sqlalchemy import text

    from tests.conftest import create_card, create_relation

    attrs = (
        [{"key": "dataOwnership", "type": "single_select", "options": None}]
        if conflict == "null_options"
        else []
    )
    await create_relation_type(
        db,
        key="relAppToDataObj",
        source_type_key="Application",
        target_type_key="DataObject",
        attributes_schema=attrs,
    )
    if conflict != "null_options":
        await create_relation_type(
            db,
            key="relDataObjectToDataObject",
            built_in=True,
            source_type_key="Application" if conflict == "wrong_endpoints" else "DataObject",
            target_type_key="DataObject",
            cardinality="1:1" if conflict == "wrong_cardinality" else "n:m",
            attributes_schema=[mig.CARDINALITY],
        )
    if conflict == "duplicate_pairs":
        await db.execute(text("DROP INDEX uq_bo_er_pair"))
        a = await create_card(db, card_type="DataObject", name="A")
        b = await create_card(db, card_type="DataObject", name="B")
        await create_relation(
            db, type_key="relDataObjectToDataObject", source_id=a.id, target_id=b.id
        )
        await create_relation(
            db, type_key="relDataObjectToDataObject", source_id=b.id, target_id=a.id
        )
    conn = await db.connection()
    with pytest.raises(RuntimeError, match="(?i)(relDataObjectToDataObject|dataOwnership)"):
        await conn.run_sync(mig._upgrade_body)


@pytest.mark.parametrize("existing_keys", [("Data", "Document"), ("Data",), ("Document",)])
async def test_upgrade_preserves_existing_case_variant_subtypes_and_cards(db, existing_keys):
    from app.models.card import Card
    from tests.conftest import create_card

    definitions = [
        {"key": key, "label": key, "hidden_fields": [], "custom_metadata": {"keep": True}}
        for key in existing_keys
    ]
    await create_card_type(db, key="DataObject", subtypes=definitions)
    cards = [
        await create_card(db, card_type="DataObject", name="Data card", subtype="Data"),
        await create_card(db, card_type="DataObject", name="Document card", subtype="Document"),
        await create_card(db, card_type="DataObject", name="Unclassified", subtype=None),
    ]
    card_ids = [card.id for card in cards]
    conn = await db.connection()
    await conn.run_sync(mig._upgrade_body)
    await conn.run_sync(mig._upgrade_body)
    db.expire_all()
    obj = (await db.execute(select(CardType).where(CardType.key == "DataObject"))).scalar_one()
    expected_missing = [
        key
        for key in ("data", "document")
        if key.casefold() not in {x.casefold() for x in existing_keys}
    ]
    assert obj.subtypes == definitions + [
        next(option for option in mig.SUBTYPES if option["key"] == key) for key in expected_missing
    ]
    restored = (await db.execute(select(Card).where(Card.id.in_(card_ids)))).scalars().all()
    assert {card.name: card.subtype for card in restored} == {
        "Data card": "Data",
        "Document card": "Document",
        "Unclassified": None,
    }
