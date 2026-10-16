"""Editor/server contract.

`tests/fixtures/archimate/frontend_model.xml` is the frontend writer's own output for its shared
test model (`writeExchange(MODEL)`, pinned byte for byte by
`frontend/.../exchange/contract.test.ts`). It must pass the server's rules, be accepted by
`POST /diagrams` and come back from `GET` unchanged: that is what proves the editor's output is
something the server stores.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services.archimate.validate import validate_exchange
from tests.conftest import auth_headers, create_role, create_user

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "archimate" / "frontend_model.xml"
FMT = "archimate-exchange-3.1"


@pytest.fixture
async def admin(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    return await create_user(db, email="a@t.com", role="admin")


def _xml() -> str:
    # The writer emits LF only; a Windows autocrlf checkout is normalised back to that.
    return FIXTURE.read_bytes().decode("utf-8").replace("\r\n", "\n")


def test_fixture_passes_the_server_validator():
    assert validate_exchange(_xml()) == []


async def test_fixture_is_stored_and_returned_byte_for_byte(client, admin):
    xml = _xml()
    created = await client.post(
        "/api/v1/diagrams",
        json={"name": "From the editor", "kind": "archimate", "data": {"format": FMT, "xml": xml}},
        headers=auth_headers(admin),
    )
    assert created.status_code == 201, created.text
    got = await client.get(f"/api/v1/diagrams/{created.json()['id']}", headers=auth_headers(admin))
    assert got.status_code == 200
    assert got.json()["kind"] == "archimate"
    assert got.json()["data"] == {"format": FMT, "xml": xml}
