"""``licensingModel`` on Application / IT Component is protected like the derived cost total."""

import copy

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.services.licensing_migration import LICENSING_MODEL_FIELD, LICENSING_SECTION
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)

URL = "/api/v1/metamodel/types/"
OTHER = {"section": "Application Information", "fields": [{"key": "hostingType", "type": "text"}]}


def _licensing(field=None, section=LICENSING_SECTION):
    return {"section": section, "fields": [field or copy.deepcopy(LICENSING_MODEL_FIELD)]}


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="a@license-guard.com", role="admin")
    for key in ("Application", "ITComponent", "Provider"):
        await create_card_type(db, key=key, fields_schema=[OTHER, _licensing()])
    return auth_headers(admin)


def _is_refused(r):
    return r.status_code == 400 and r.json()["detail"] == "license_field_required"


@pytest.mark.parametrize("key", ["Application", "ITComponent"])
async def test_removing_the_field_is_refused(client, env, key):
    r = await client.patch(URL + key, json={"fields_schema": [OTHER]}, headers=env)
    assert _is_refused(r), r.text
    r = await client.patch(
        URL + key, json={"fields_schema": [OTHER, _licensing(None) | {"fields": []}]}, headers=env
    )
    assert _is_refused(r), r.text


async def test_retyping_the_field_is_refused(client, env):
    field = {**copy.deepcopy(LICENSING_MODEL_FIELD), "type": "text"}
    r = await client.patch(
        URL + "Application", json={"fields_schema": [_licensing(field)]}, headers=env
    )
    assert _is_refused(r), r.text


@pytest.mark.parametrize("dropped", ["users", "installations"])
async def test_removing_a_required_option_is_refused(client, env, dropped):
    field = copy.deepcopy(LICENSING_MODEL_FIELD)
    field["options"] = [o for o in field["options"] if o["key"] != dropped]
    r = await client.patch(
        URL + "Application", json={"fields_schema": [_licensing(field)]}, headers=env
    )
    assert _is_refused(r), r.text


async def test_moving_the_field_out_of_its_section_is_refused(client, env):
    moved = {"section": "Application Information", "fields": [copy.deepcopy(LICENSING_MODEL_FIELD)]}
    r = await client.patch(URL + "Application", json={"fields_schema": [moved]}, headers=env)
    assert _is_refused(r), r.text
    renamed = _licensing(section="Renamed")
    r = await client.patch(URL + "Application", json={"fields_schema": [renamed]}, headers=env)
    assert _is_refused(r), r.text


async def test_label_translations_and_extra_options_are_allowed(client, env):
    field = copy.deepcopy(LICENSING_MODEL_FIELD)
    field["label"] = "License model"
    field["translations"] = {"it": "Modello"}
    field["options"].append({"key": "cores", "label": "Cores"})
    r = await client.patch(
        URL + "Application", json={"fields_schema": [OTHER, _licensing(field)]}, headers=env
    )
    assert r.status_code == 200, r.text
    # an unrelated edit that leaves the field alone is fine too
    r = await client.patch(URL + "ITComponent", json={"label": "IT Comp"}, headers=env)
    assert r.status_code == 200, r.text


async def test_other_types_are_not_guarded(client, env):
    r = await client.patch(URL + "Provider", json={"fields_schema": [OTHER]}, headers=env)
    assert r.status_code == 200, r.text


async def test_a_duplicate_key_is_refused_and_card_values_survive(client, db, env):
    """Guard and cleanup must read the same field: a second ``licensingModel`` (here a text
    one in a later section) is refused, and no card loses its stored values."""
    admin = await create_user(db, email="b@license-guard.com", role="admin")
    card = await create_card(
        db,
        card_type="Application",
        name="Billing",
        user_id=admin.id,
        attributes={"licensingModel": ["users", "installations"]},
    )
    card_id = card.id
    dup = {"section": "Later", "fields": [{"key": "licensingModel", "type": "text"}]}
    r = await client.patch(
        URL + "Application", json={"fields_schema": [OTHER, _licensing(), dup]}, headers=env
    )
    assert _is_refused(r), r.text
    db.expire_all()
    row = (await db.execute(select(Card).where(Card.id == card_id))).scalar_one()
    assert row.attributes["licensingModel"] == ["users", "installations"]


async def test_the_field_defined_on_another_type_or_absent_is_not_protected(client, db):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="c@license-guard.com", role="admin")
    await create_card_type(db, key="Application", fields_schema=[OTHER])
    await create_card_type(
        db,
        key="ITComponent",
        fields_schema=[{"section": "Mine", "fields": [{"key": "licensingModel", "type": "text"}]}],
    )
    for key in ("Application", "ITComponent"):
        r = await client.patch(
            URL + key, json={"fields_schema": [OTHER]}, headers=auth_headers(admin)
        )
        assert r.status_code == 200, r.text


async def test_an_extension_stamped_field_is_refused(client, env):
    field = {**copy.deepcopy(LICENSING_MODEL_FIELD), "ext": "licensing"}
    r = await client.patch(
        URL + "Application", json={"fields_schema": [OTHER, _licensing(field)]}, headers=env
    )
    assert _is_refused(r), r.text


async def test_a_field_that_already_lacks_a_required_option_does_not_block_other_edits(client, db):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="d@license-guard.com", role="admin")
    deficient = copy.deepcopy(LICENSING_MODEL_FIELD)
    deficient["options"] = [o for o in deficient["options"] if o["key"] == "users"]
    await create_card_type(db, key="Application", fields_schema=[OTHER, _licensing(deficient)])
    h = auth_headers(admin)
    edited = {"section": "Application Information", "fields": [{"key": "x", "type": "text"}]}
    r = await client.patch(
        URL + "Application", json={"fields_schema": [edited, _licensing(deficient)]}, headers=h
    )
    assert r.status_code == 200, r.text
    # ...but removing the option it does have is still refused
    gone = copy.deepcopy(deficient)
    gone["options"] = []
    r = await client.patch(
        URL + "Application", json={"fields_schema": [edited, _licensing(gone)]}, headers=h
    )
    assert _is_refused(r), r.text
