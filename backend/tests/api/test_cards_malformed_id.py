"""A malformed card id in the path answers 404, not 500.

Every ``/cards/{id}``-shaped route declares its id path param as ``str`` and
parses it in the handler body with ``uuid.UUID(card_id)``. A value that is not
a valid UUID made that call raise an unhandled ``ValueError`` which surfaced as
a 500 (found in a 2.158.0 authorization review against a live instance). The
parse now goes through ``deps.parse_uuid``, which maps a malformed id to 404 --
a syntactically invalid id names no resource, and 404 keeps every ``/{id}``
route uniform and never confirms existence.
"""

from __future__ import annotations

import pytest

from tests.conftest import auth_headers, create_card, create_card_type

MALFORMED = ["not-a-uuid", "resolve-refs", "12345", "%2e%2e"]

ROUTES = [
    "/api/v1/cards/{id}",
    "/api/v1/cards/{id}/relations",
    "/api/v1/cards/{id}/history",
    "/api/v1/cards/{id}/hierarchy",
    "/api/v1/cards/{id}/my-permissions",
    "/api/v1/cards/{id}/relation-summary",
]


@pytest.fixture
async def one_card(db, admin_user):
    await create_card_type(db, key="Application", label="Application")
    return await create_card(db, name="Real", card_type="Application")


@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize("bad", MALFORMED)
async def test_malformed_id_is_404_not_500(client, admin_user, one_card, route, bad):
    resp = await client.get(route.format(id=bad), headers=auth_headers(admin_user))
    assert resp.status_code == 404, (route, bad, resp.status_code)


async def test_a_valid_but_absent_id_is_also_404(client, admin_user, one_card):
    resp = await client.get(
        "/api/v1/cards/00000000-0000-4000-8000-00000000dead",
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 404


async def test_a_real_id_still_resolves(client, admin_user, one_card):
    resp = await client.get(f"/api/v1/cards/{one_card.id}", headers=auth_headers(admin_user))
    assert resp.status_code == 200
    assert resp.json()["name"] == "Real"
