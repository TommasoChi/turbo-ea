from __future__ import annotations

import pytest

from tests.conftest import auth_headers, create_role, create_user

NS = (
    'xmlns="http://www.opengroup.org/xsd/archimate/3.0/" '
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
)
GOOD = f'<model {NS} identifier="m"><name xml:lang="en">m</name></model>'
BAD = (
    f'<model {NS} identifier="m"><elements>'
    '<element identifier="a" xsi:type="Banana"/></elements></model>'
)
FMT = "archimate-exchange-3.1"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="nobody", label="Nobody", permissions={})
    return {
        "admin": await create_user(db, email="a@t.com", role="admin"),
        "nobody": await create_user(db, email="n@t.com", role="nobody"),
    }


async def test_validate_ok(client, env):
    r = await client.post(
        "/api/v1/archimate/validate", json={"xml": GOOD}, headers=auth_headers(env["admin"])
    )
    assert r.status_code == 200 and r.json() == {"valid": True, "issues": []}


async def test_validate_reports_issues(client, env):
    r = await client.post(
        "/api/v1/archimate/validate", json={"xml": BAD}, headers=auth_headers(env["admin"])
    )
    body = r.json()
    assert body["valid"] is False
    assert body["issues"] == [
        {"code": "unknown_element_type", "message": body["issues"][0]["message"], "ref": "a"}
    ]


async def test_validate_needs_a_permission(client, env):
    r = await client.post(
        "/api/v1/archimate/validate", json={"xml": GOOD}, headers=auth_headers(env["nobody"])
    )
    assert r.status_code == 403


async def test_validate_requires_xml(client, env):
    r = await client.post("/api/v1/archimate/validate", json={}, headers=auth_headers(env["admin"]))
    assert r.status_code == 422


async def test_create_rejects_an_invalid_model_and_stores_nothing(client, env):
    h = auth_headers(env["admin"])
    r = await client.post(
        "/api/v1/diagrams",
        json={"name": "a", "kind": "archimate", "data": {"format": FMT, "xml": BAD}},
        headers=h,
    )
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["message"] == "Invalid ArchiMate model"
    assert set(detail["issues"][0]) == {"code", "message", "ref"}
    assert detail["issues"][0]["code"] == "unknown_element_type"
    assert (await client.get("/api/v1/diagrams?kind=archimate", headers=h)).json() == []


async def test_create_and_patch_accept_a_valid_model(client, env):
    h = auth_headers(env["admin"])
    r = await client.post(
        "/api/v1/diagrams",
        json={"name": "a", "kind": "archimate", "data": {"format": FMT, "xml": GOOD}},
        headers=h,
    )
    assert r.status_code == 201
    did = r.json()["id"]
    p = await client.patch(
        f"/api/v1/diagrams/{did}", json={"data": {"format": FMT, "xml": BAD}}, headers=h
    )
    assert p.status_code == 422
    assert p.json()["detail"]["issues"][0]["code"] == "unknown_element_type"
    # the rejected PATCH stored nothing
    got = (await client.get(f"/api/v1/diagrams/{did}", headers=h)).json()
    assert got["data"]["xml"] == GOOD
    ok = await client.patch(
        f"/api/v1/diagrams/{did}", json={"data": {"format": FMT, "xml": GOOD}}, headers=h
    )
    assert ok.status_code == 200


async def test_validation_runs_off_the_event_loop(client, env, monkeypatch):
    import threading

    from app.api.v1 import archimate, diagrams

    loop_thread = threading.get_ident()
    seen: list[int] = []

    def spy(xml):
        seen.append(threading.get_ident())
        return []

    monkeypatch.setattr(archimate, "validate_exchange", spy)
    monkeypatch.setattr(diagrams, "validate_exchange", spy)
    h = auth_headers(env["admin"])
    await client.post("/api/v1/archimate/validate", json={"xml": GOOD}, headers=h)
    await client.post(
        "/api/v1/diagrams",
        json={"name": "a", "kind": "archimate", "data": {"format": FMT, "xml": GOOD}},
        headers=h,
    )
    assert len(seen) == 2 and loop_thread not in seen
