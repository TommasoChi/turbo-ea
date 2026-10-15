from __future__ import annotations

import pytest

from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

XML = '<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" identifier="m"/>'
AM = {"format": "archimate-exchange-3.1", "xml": XML}


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    return {"admin": await create_user(db, email="a@t.com", role="admin")}


async def _create(client, env, **body):
    return await client.post("/api/v1/diagrams", json=body, headers=auth_headers(env["admin"]))


async def test_default_kind_is_drawio(client, env):
    r = await _create(client, env, name="d", data={"xml": "<mxGraphModel/>"})
    assert r.status_code == 201
    got = (
        await client.get(f"/api/v1/diagrams/{r.json()['id']}", headers=auth_headers(env["admin"]))
    ).json()
    assert got["kind"] == "drawio"


async def test_archimate_diagram_roundtrips_its_data(client, env):
    r = await _create(client, env, name="a", kind="archimate", data=AM)
    assert r.status_code == 201
    got = (
        await client.get(f"/api/v1/diagrams/{r.json()['id']}", headers=auth_headers(env["admin"]))
    ).json()
    assert got["kind"] == "archimate" and got["data"] == AM


@pytest.mark.parametrize(
    "data",
    [
        None,
        {},
        {"xml": "<x/>"},
        {"format": "archimate-exchange-3.1"},
        {"format": "archimate-exchange-3.1", "xml": ""},
        {"format": "other", "xml": "<x/>"},
    ],
)
async def test_archimate_data_shape_is_enforced(client, env, data):
    r = await _create(client, env, name="a", kind="archimate", data=data)
    assert r.status_code == 422


async def test_drawio_create_refuses_archimate_data(client, env):
    assert (await _create(client, env, name="d", data=AM)).status_code == 422


async def test_unknown_kind_is_rejected(client, env):
    assert (await _create(client, env, name="a", kind="visio")).status_code == 422


async def test_list_defaults_to_drawio_and_filters_by_kind(client, env):
    h = auth_headers(env["admin"])
    d = (await _create(client, env, name="draw", data={"xml": "<m/>"})).json()["id"]
    a = (await _create(client, env, name="arch", kind="archimate", data=AM)).json()["id"]
    ids = lambda rows: {x["id"] for x in rows}  # noqa: E731
    assert ids((await client.get("/api/v1/diagrams", headers=h)).json()) == {d}
    assert ids((await client.get("/api/v1/diagrams?kind=drawio", headers=h)).json()) == {d}
    assert ids((await client.get("/api/v1/diagrams?kind=archimate", headers=h)).json()) == {a}
    assert ids((await client.get("/api/v1/diagrams?kind=all", headers=h)).json()) == {d, a}
    rows = (await client.get("/api/v1/diagrams?kind=all", headers=h)).json()
    assert {x["id"]: x["kind"] for x in rows} == {d: "drawio", a: "archimate"}
    assert (await client.get("/api/v1/diagrams?kind=nope", headers=h)).status_code == 422


async def test_card_linked_listing_hides_archimate_diagrams_by_default(client, env, db):
    """The card's Resources tab lists `GET /diagrams?card_id=`: DrawIO only."""
    h = auth_headers(env["admin"])
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="App", user_id=env["admin"].id)
    d = (
        await _create(client, env, name="draw", data={"xml": "<m/>"}, card_ids=[str(card.id)])
    ).json()["id"]
    a = (
        await _create(client, env, name="arch", kind="archimate", data=AM, card_ids=[str(card.id)])
    ).json()["id"]
    url = f"/api/v1/diagrams?card_id={card.id}"
    assert {x["id"] for x in (await client.get(url, headers=h)).json()} == {d}
    assert {x["id"] for x in (await client.get(url + "&kind=all", headers=h)).json()} == {d, a}
    # card_ids sync works as for DrawIO: explicit, replaced on PATCH.
    got = (await client.get(f"/api/v1/diagrams/{a}", headers=h)).json()
    assert got["card_ids"] == [str(card.id)]
    r = await client.patch(f"/api/v1/diagrams/{a}", json={"card_ids": []}, headers=h)
    assert r.status_code == 200 and r.json()["card_ids"] == []


async def test_patch_checks_the_data_shape_against_the_kind(client, env):
    h = auth_headers(env["admin"])
    a = (await _create(client, env, name="arch", kind="archimate", data=AM)).json()["id"]
    d = (await _create(client, env, name="draw", data={"xml": "<m/>"})).json()["id"]
    r = await client.patch(f"/api/v1/diagrams/{a}", json={"data": {"xml": "<m/>"}}, headers=h)
    assert r.status_code == 422
    assert (
        await client.patch(f"/api/v1/diagrams/{d}", json={"data": AM}, headers=h)
    ).status_code == 422
    new = {**AM, "xml": XML + " "}
    ok = await client.patch(f"/api/v1/diagrams/{a}", json={"data": new}, headers=h)
    assert ok.status_code == 200
    assert (await client.get(f"/api/v1/diagrams/{a}", headers=h)).json()["data"] == new


async def test_kind_cannot_be_changed(client, env):
    h = auth_headers(env["admin"])
    d = (await _create(client, env, name="draw", data={"xml": "<m/>"})).json()["id"]
    r = await client.patch(f"/api/v1/diagrams/{d}", json={"kind": "archimate"}, headers=h)
    assert r.status_code == 422
    # Re-sending the same kind is a no-op, not an error.
    same = await client.patch(f"/api/v1/diagrams/{d}", json={"kind": "drawio"}, headers=h)
    assert same.status_code == 200


async def test_archimate_diagrams_cannot_be_published(client, env):
    h = auth_headers(env["admin"])
    a = (await _create(client, env, name="arch", kind="archimate", data=AM)).json()["id"]
    r = await client.post(f"/api/v1/diagrams/{a}/publish", json={}, headers=h)
    assert r.status_code == 400 and "cannot be published" in r.json()["detail"]
    got = (await client.get(f"/api/v1/diagrams/{a}", headers=h)).json()
    assert got["is_published"] is False and got["public_slug"] is None


async def test_drawio_diagrams_still_publish(client, env):
    h = auth_headers(env["admin"])
    d = (await _create(client, env, name="draw", data={"xml": "<m/>"})).json()["id"]
    r = await client.post(f"/api/v1/diagrams/{d}/publish", json={}, headers=h)
    assert r.status_code == 200 and r.json()["is_published"] is True
