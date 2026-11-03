"""Integration tests: cost field stripping on /cards endpoints.

Confirms that:
- A viewer (no costs.view, no stakeholder) sees no cost fields in card responses.
- A viewer who is a stakeholder of a card sees costs on that card only.
- A user with costs.view sees all costs.
- PATCH from a user without cost access drops cost keys silently — they cannot
  blank a cost they were not allowed to see.
"""

from __future__ import annotations

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.stakeholder import Stakeholder
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def cost_env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
    await create_card_type(
        db,
        key="Provider",
        fields_schema=[
            {
                "section": "Costs",
                "fields": [
                    {"key": "costTotalAnnual", "type": "cost", "weight": 1},
                    {"key": "name2", "type": "text", "weight": 1},
                ],
            }
        ],
    )

    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    member = await create_user(db, email="member@test.com", role="member")
    card = await create_card(
        db,
        card_type="Provider",
        name="App1",
        attributes={"costTotalAnnual": 1234, "name2": "x"},
    )
    other_card = await create_card(
        db,
        card_type="Provider",
        name="App2",
        attributes={"costTotalAnnual": 5678, "name2": "y"},
    )
    return {
        "admin": admin,
        "viewer": viewer,
        "member": member,
        "card": card,
        "other_card": other_card,
    }


class TestGetCardCostStripping:
    async def test_admin_sees_cost(self, client, db, cost_env):
        r = await client.get(
            f"/api/v1/cards/{cost_env['card'].id}",
            headers=auth_headers(cost_env["admin"]),
        )
        assert r.status_code == 200
        assert r.json()["attributes"].get("costTotalAnnual") == 1234

    async def test_member_sees_cost_via_app_perm(self, client, db, cost_env):
        # MEMBER_PERMISSIONS grants costs.view by default in this release.
        r = await client.get(
            f"/api/v1/cards/{cost_env['card'].id}",
            headers=auth_headers(cost_env["member"]),
        )
        assert r.status_code == 200
        assert r.json()["attributes"].get("costTotalAnnual") == 1234

    async def test_viewer_does_not_see_cost(self, client, db, cost_env):
        r = await client.get(
            f"/api/v1/cards/{cost_env['card'].id}",
            headers=auth_headers(cost_env["viewer"]),
        )
        assert r.status_code == 200
        attrs = r.json()["attributes"]
        assert "costTotalAnnual" not in attrs
        assert attrs.get("name2") == "x"  # non-cost fields still present

    async def test_viewer_stakeholder_sees_cost_on_their_card_only(self, client, db, cost_env):
        sh = Stakeholder(
            card_id=cost_env["card"].id,
            user_id=cost_env["viewer"].id,
            role="responsible",
        )
        db.add(sh)
        await db.flush()

        r1 = await client.get(
            f"/api/v1/cards/{cost_env['card'].id}",
            headers=auth_headers(cost_env["viewer"]),
        )
        r2 = await client.get(
            f"/api/v1/cards/{cost_env['other_card'].id}",
            headers=auth_headers(cost_env["viewer"]),
        )
        assert r1.json()["attributes"].get("costTotalAnnual") == 1234
        assert "costTotalAnnual" not in r2.json()["attributes"]


class TestListCostStripping:
    async def test_viewer_list_strips_costs(self, client, db, cost_env):
        r = await client.get(
            "/api/v1/cards?type=Application",
            headers=auth_headers(cost_env["viewer"]),
        )
        assert r.status_code == 200
        for item in r.json()["items"]:
            assert "costTotalAnnual" not in (item.get("attributes") or {})


class TestPatchDropsCostsWhenForbidden:
    async def test_editor_without_cost_access_cannot_blank_cost(self, client, db, cost_env):
        # Construct a stakeholder role that grants edit but the user has no
        # global costs.view. Because being a stakeholder also grants cost
        # access by design, we instead make a separate non-stakeholder editor
        # role without costs.view.
        await create_role(
            db,
            key="non_cost_editor",
            permissions={
                "inventory.view": True,
                "inventory.edit": True,
                "costs.view": False,
            },
        )
        editor = await create_user(db, email="editor@test.com", role="non_cost_editor")

        # Sanity: editor sees the cost stripped on GET
        r0 = await client.get(
            f"/api/v1/cards/{cost_env['card'].id}",
            headers=auth_headers(editor),
        )
        assert "costTotalAnnual" not in r0.json()["attributes"]

        # PATCH attempting to blank the cost they cannot see
        r = await client.patch(
            f"/api/v1/cards/{cost_env['card'].id}",
            json={"attributes": {"costTotalAnnual": None, "name2": "updated"}},
            headers=auth_headers(editor),
        )
        assert r.status_code == 200, r.text

        # Confirm via admin that the cost was preserved and name2 was updated
        ar = await client.get(
            f"/api/v1/cards/{cost_env['card'].id}",
            headers=auth_headers(cost_env["admin"]),
        )
        assert ar.json()["attributes"].get("costTotalAnnual") == 1234
        assert ar.json()["attributes"].get("name2") == "updated"

    async def test_stakeholder_can_update_cost(self, client, db, cost_env):
        # A stakeholder of the card should be able to set the cost even
        # without the global costs.view permission. Wire a stakeholder role
        # definition that grants edit + view.
        srd = StakeholderRoleDefinition(
            card_type_key="Provider",
            key="full_editor",
            label="Full Editor",
            permissions={"card.view": True, "card.edit": True},
            color="#000",
            sort_order=0,
            is_archived=False,
        )
        db.add(srd)
        sh = Stakeholder(
            card_id=cost_env["card"].id,
            user_id=cost_env["viewer"].id,
            role="full_editor",
        )
        db.add(sh)
        await db.flush()

        r = await client.patch(
            f"/api/v1/cards/{cost_env['card'].id}",
            json={"attributes": {"costTotalAnnual": 9999, "name2": "z"}},
            headers=auth_headers(cost_env["viewer"]),
        )
        assert r.status_code == 200, r.text
        assert r.json()["attributes"].get("costTotalAnnual") == 9999


class TestApplicationDerivedTotalRedaction:
    async def test_viewer_without_costs_view_or_stakeholder_role_never_sees_the_total(
        self, client, db, cost_env
    ):
        from app.models.card_cost import CardCost
        from app.services.fiscal_year import current_fiscal_year

        await create_card_type(
            db,
            key="Application",
            fields_schema=[
                {"section": "Costs", "fields": [{"key": "costTotalAnnual", "type": "cost"}]}
            ],
        )
        app = await create_card(db, card_type="Application", name="Derived")
        db.add(
            CardCost(
                card_id=app.id,
                fiscal_year=current_fiscal_year(1),
                items={"lic": {"amount": 70}},
            )
        )
        await db.flush()
        from app.services import card_costs

        await card_costs.recompute_derived(db, app)
        assert app.attributes["costTotalAnnual"] == 70
        for user, seen in (("admin", True), ("viewer", False)):
            r = await client.get(f"/api/v1/cards/{app.id}", headers=auth_headers(cost_env[user]))
            assert r.status_code == 200
            assert ("costTotalAnnual" in r.json()["attributes"]) is seen
