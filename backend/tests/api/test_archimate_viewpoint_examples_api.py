"""Integration tests for /api/v1/metamodel/viewpoints/{key}/examples."""

from __future__ import annotations

from app.services import seed
from tests.conftest import auth_headers

VALID_EXCHANGE_XML = """<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       identifier="id-1"><name xml:lang="en">Example</name></model>"""


async def test_upload_valid_example(client, db, admin_user):
    await seed.seed_metamodel(db)
    resp = await client.post(
        "/api/v1/metamodel/viewpoints/organization/examples",
        json={"name": "Nested orgs", "xml": VALID_EXCHANGE_XML},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 201


async def test_upload_rejects_invalid_xml(client, db, admin_user):
    await seed.seed_metamodel(db)
    headers = auth_headers(admin_user)
    resp = await client.post(
        "/api/v1/metamodel/viewpoints/organization/examples",
        json={"name": "Broken", "xml": "<not-a-model/>"},
        headers=headers,
    )
    assert resp.status_code == 422
    resp2 = await client.get("/api/v1/metamodel/viewpoints/organization", headers=headers)
    assert resp2.json().get("examples", []) == []


async def test_malformed_example_id_is_a_404_not_a_500(client, db, admin_user):
    headers = auth_headers(admin_user)
    resp = await client.delete(
        "/api/v1/metamodel/viewpoints/organization/examples/not-a-uuid", headers=headers
    )
    assert resp.status_code == 404
    resp = await client.get(
        "/api/v1/diagrams/viewpoints-for-tab/organization/examples/not-a-uuid", headers=headers
    )
    assert resp.status_code == 404
