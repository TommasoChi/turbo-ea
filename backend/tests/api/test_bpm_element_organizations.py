"""Integration tests for per-element Organization linking.

Unlike application_id/data_object_id/it_component_id (1:1 FK columns on
ProcessElement), Organization is a proper M:N junction table
(process_element_organizations) — a single BPMN step can involve more than
one organizational actor. See:
- POST/DELETE /bpm/processes/{process_id}/elements/{element_id}/organizations
- backend/app/models/process_element.py (ProcessElementOrganization)
- backend/app/services/element_relation_sync.py (relProcessToOrg sync)
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.process_element import ProcessElement, ProcessElementOrganization
from app.models.relation import Relation
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation_type,
    create_role,
    create_user,
)


@pytest.fixture
async def org_env(db):
    """Prerequisite data: BusinessProcess + Organization card types, the
    relProcessToOrg relation type, an admin/viewer user, one process card,
    one process element on it, and two Organization cards."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions={"inventory.view": True, "bpm.view": True},
    )
    await create_card_type(db, key="BusinessProcess", label="Business Process")
    await create_card_type(db, key="Organization", label="Organization")
    await create_relation_type(
        db,
        key="relProcessToOrg",
        label="is owned by",
        source_type_key="BusinessProcess",
        target_type_key="Organization",
    )

    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    process = await create_card(
        db, card_type="BusinessProcess", name="Order Fulfillment", user_id=admin.id
    )
    org1 = await create_card(db, card_type="Organization", name="Sales", user_id=admin.id)
    org2 = await create_card(db, card_type="Organization", name="Finance", user_id=admin.id)

    element = ProcessElement(
        process_id=process.id,
        bpmn_element_id="Task_1",
        element_type="task",
        name="Approve Order",
        sequence_order=0,
    )
    db.add(element)
    await db.commit()
    await db.refresh(element)

    return {
        "admin": admin,
        "viewer": viewer,
        "process": process,
        "element": element,
        "org1": org1,
        "org2": org2,
    }


class TestLinkElementOrganization:
    async def test_link_creates_junction_row(self, client, db, org_env):
        admin, process, element, org1 = (
            org_env["admin"],
            org_env["process"],
            org_env["element"],
            org_env["org1"],
        )
        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/elements/{element.id}/organizations",
            json={"organization_id": str(org1.id)},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        result = await db.execute(
            select(ProcessElementOrganization).where(
                ProcessElementOrganization.element_id == element.id,
                ProcessElementOrganization.organization_id == org1.id,
            )
        )
        assert result.scalar_one_or_none() is not None

    async def test_link_two_organizations_to_same_step(self, client, db, org_env):
        """A single step can involve more than one organizational actor."""
        admin, process, element, org1, org2 = (
            org_env["admin"],
            org_env["process"],
            org_env["element"],
            org_env["org1"],
            org_env["org2"],
        )
        for org in (org1, org2):
            resp = await client.post(
                f"/api/v1/bpm/processes/{process.id}/elements/{element.id}/organizations",
                json={"organization_id": str(org.id)},
                headers=auth_headers(admin),
            )
            assert resp.status_code == 200

        result = await db.execute(
            select(ProcessElementOrganization).where(
                ProcessElementOrganization.element_id == element.id
            )
        )
        linked_ids = {row.organization_id for row in result.scalars().all()}
        assert linked_ids == {org1.id, org2.id}

    async def test_link_is_idempotent(self, client, db, org_env):
        admin, process, element, org1 = (
            org_env["admin"],
            org_env["process"],
            org_env["element"],
            org_env["org1"],
        )
        for _ in range(2):
            resp = await client.post(
                f"/api/v1/bpm/processes/{process.id}/elements/{element.id}/organizations",
                json={"organization_id": str(org1.id)},
                headers=auth_headers(admin),
            )
            assert resp.status_code == 200

        result = await db.execute(
            select(ProcessElementOrganization).where(
                ProcessElementOrganization.element_id == element.id
            )
        )
        assert len(result.scalars().all()) == 1

    async def test_link_syncs_process_level_relation(self, client, db, org_env):
        """Linking an org to a step ensures relProcessToOrg exists at the
        process-card level too (element_relation_sync, additive)."""
        admin, process, element, org1 = (
            org_env["admin"],
            org_env["process"],
            org_env["element"],
            org_env["org1"],
        )
        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/elements/{element.id}/organizations",
            json={"organization_id": str(org1.id)},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        result = await db.execute(
            select(Relation).where(
                Relation.type == "relProcessToOrg",
                Relation.source_id == process.id,
                Relation.target_id == org1.id,
            )
        )
        assert result.scalar_one_or_none() is not None

    async def test_viewer_cannot_link(self, client, db, org_env):
        viewer, process, element, org1 = (
            org_env["viewer"],
            org_env["process"],
            org_env["element"],
            org_env["org1"],
        )
        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/elements/{element.id}/organizations",
            json={"organization_id": str(org1.id)},
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_link_unknown_element_404s(self, client, db, org_env):
        admin, process, org1 = org_env["admin"], org_env["process"], org_env["org1"]
        resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/elements/{uuid.uuid4()}/organizations",
            json={"organization_id": str(org1.id)},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404


class TestUnlinkElementOrganization:
    async def test_unlink_removes_junction_row(self, client, db, org_env):
        admin, process, element, org1 = (
            org_env["admin"],
            org_env["process"],
            org_env["element"],
            org_env["org1"],
        )
        link_resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/elements/{element.id}/organizations",
            json={"organization_id": str(org1.id)},
            headers=auth_headers(admin),
        )
        assert link_resp.status_code == 200

        resp = await client.delete(
            f"/api/v1/bpm/processes/{process.id}/elements/{element.id}/organizations/{org1.id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        result = await db.execute(
            select(ProcessElementOrganization).where(
                ProcessElementOrganization.element_id == element.id,
                ProcessElementOrganization.organization_id == org1.id,
            )
        )
        assert result.scalar_one_or_none() is None

    async def test_unlink_does_not_delete_process_level_relation(self, client, db, org_env):
        """Additive-only sync policy: unlinking a step's org does NOT remove
        the process-level relProcessToOrg relation — it may have been
        created independently, or still apply via another element (see
        element_relation_sync.py docstring)."""
        admin, process, element, org1 = (
            org_env["admin"],
            org_env["process"],
            org_env["element"],
            org_env["org1"],
        )
        link_resp = await client.post(
            f"/api/v1/bpm/processes/{process.id}/elements/{element.id}/organizations",
            json={"organization_id": str(org1.id)},
            headers=auth_headers(admin),
        )
        assert link_resp.status_code == 200

        unlink_resp = await client.delete(
            f"/api/v1/bpm/processes/{process.id}/elements/{element.id}/organizations/{org1.id}",
            headers=auth_headers(admin),
        )
        assert unlink_resp.status_code == 200

        result = await db.execute(
            select(Relation).where(
                Relation.type == "relProcessToOrg",
                Relation.source_id == process.id,
                Relation.target_id == org1.id,
            )
        )
        assert result.scalar_one_or_none() is not None

    async def test_unlink_nonexistent_link_is_idempotent(self, client, db, org_env):
        admin, process, element, org1 = (
            org_env["admin"],
            org_env["process"],
            org_env["element"],
            org_env["org1"],
        )
        resp = await client.delete(
            f"/api/v1/bpm/processes/{process.id}/elements/{element.id}/organizations/{org1.id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

    async def test_viewer_cannot_unlink(self, client, db, org_env):
        viewer, process, element, org1 = (
            org_env["viewer"],
            org_env["process"],
            org_env["element"],
            org_env["org1"],
        )
        resp = await client.delete(
            f"/api/v1/bpm/processes/{process.id}/elements/{element.id}/organizations/{org1.id}",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


class TestListElementsIncludesOrganizations:
    async def test_get_elements_includes_organizations(self, client, db, org_env):
        admin, process, element, org1, org2 = (
            org_env["admin"],
            org_env["process"],
            org_env["element"],
            org_env["org1"],
            org_env["org2"],
        )
        # Link via the API (not the `db` fixture directly) so this exercises
        # the same read-after-write path a real client would.
        for org in (org1, org2):
            link_resp = await client.post(
                f"/api/v1/bpm/processes/{process.id}/elements/{element.id}/organizations",
                json={"organization_id": str(org.id)},
                headers=auth_headers(admin),
            )
            assert link_resp.status_code == 200

        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/elements",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        orgs = {o["id"] for o in data[0]["organizations"]}
        assert orgs == {str(org1.id), str(org2.id)}

    async def test_get_elements_empty_organizations_when_none_linked(self, client, db, org_env):
        admin, process = org_env["admin"], org_env["process"]
        resp = await client.get(
            f"/api/v1/bpm/processes/{process.id}/elements",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data[0]["organizations"] == []
