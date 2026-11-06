"""``licensingModel`` on Application / IT Component is protected like the derived cost total."""

import copy

import pytest

from app.services.licensing_migration import LICENSING_MODEL_FIELD, LICENSING_SECTION
from tests.conftest import auth_headers, create_card_type, create_role, create_user

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
