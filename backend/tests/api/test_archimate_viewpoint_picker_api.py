"""Integration tests for /api/v1/diagrams/viewpoints-for-tab."""

from __future__ import annotations

from app.services import seed
from tests.conftest import auth_headers


async def test_implementation_and_deployment_appears_in_both_application_and_technology(
    client, db, admin_user
):
    await seed.seed_metamodel(db)
    headers = auth_headers(admin_user)
    app_resp = await client.get(
        "/api/v1/diagrams/viewpoints-for-tab?tab=application", headers=headers
    )
    tech_resp = await client.get(
        "/api/v1/diagrams/viewpoints-for-tab?tab=technology", headers=headers
    )
    app_keys = {v["key"] for v in app_resp.json()}
    tech_keys = {v["key"] for v in tech_resp.json()}
    assert "implementation-and-deployment" in app_keys
    assert "implementation-and-deployment" in tech_keys


async def test_suggested_cards_use_the_tab_override(client, db, admin_user):
    await seed.seed_metamodel(db)
    resp = await client.get(
        "/api/v1/diagrams/viewpoints-for-tab/implementation-and-deployment/suggested-cards?tab=technology",
        headers=auth_headers(admin_user),
    )
    assert set(resp.json()) == {"ITComponent", "Platform"}
