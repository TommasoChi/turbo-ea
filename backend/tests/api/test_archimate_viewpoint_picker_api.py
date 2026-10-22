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
    assert {row["card_type_key"] for row in resp.json()} == {"ITComponent", "Platform"}


async def test_suggested_cards_pair_each_card_type_with_its_enterprise_object(
    client, db, admin_user
):
    await seed.seed_metamodel(db)
    resp = await client.get(
        "/api/v1/diagrams/viewpoints-for-tab/organization/suggested-cards?tab=business",
        headers=auth_headers(admin_user),
    )
    rows = {row["card_type_key"]: row["enterprise_object_key"] for row in resp.json()}
    assert rows  # "organization" has at least one real card-type mapping
    assert all(eo_key is not None for eo_key in rows.values())


async def test_suggested_cards_work_without_a_tab_for_the_unscoped_picker(
    client, db, admin_user
):
    # The tab-specific override never applies, but the fallback doesn't need
    # a tab either -- the unscoped create-diagram dialog has none to send.
    await seed.seed_metamodel(db)
    resp = await client.get(
        "/api/v1/diagrams/viewpoints-for-tab/organization/suggested-cards",
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 200
    rows = {row["card_type_key"]: row["enterprise_object_key"] for row in resp.json()}
    assert rows
    assert all(eo_key is not None for eo_key in rows.values())


VALID_EXCHANGE_XML = """<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       identifier="id-1"><name xml:lang="en">Example</name></model>"""


async def test_get_example_xml_for_seeding_a_new_diagram(client, db, admin_user):
    await seed.seed_metamodel(db)
    headers = auth_headers(admin_user)
    uploaded = await client.post(
        "/api/v1/metamodel/viewpoints/organization/examples",
        json={"name": "Nested orgs", "xml": VALID_EXCHANGE_XML},
        headers=headers,
    )
    example_id = uploaded.json()["id"]
    resp = await client.get(
        f"/api/v1/diagrams/viewpoints-for-tab/organization/examples/{example_id}",
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"id": example_id, "name": "Nested orgs", "xml": VALID_EXCHANGE_XML}


async def test_get_example_xml_404s_for_wrong_viewpoint(client, db, admin_user):
    await seed.seed_metamodel(db)
    headers = auth_headers(admin_user)
    uploaded = await client.post(
        "/api/v1/metamodel/viewpoints/organization/examples",
        json={"name": "Nested orgs", "xml": VALID_EXCHANGE_XML},
        headers=headers,
    )
    example_id = uploaded.json()["id"]
    # Right id, wrong viewpoint_key in the path -- must not leak across viewpoints.
    resp = await client.get(
        f"/api/v1/diagrams/viewpoints-for-tab/layered/examples/{example_id}",
        headers=headers,
    )
    assert resp.status_code == 404
