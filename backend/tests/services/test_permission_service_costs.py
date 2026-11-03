"""Tests for the costs.view permission rule (app-level + stakeholder bypass)."""

from __future__ import annotations

import uuid

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.stakeholder import Stakeholder
from app.services.permission_service import PermissionService
from tests.conftest import (
    create_card,
    create_role,
    create_stakeholder_role_def,
    create_user,
)


async def _make_stakeholder(db, *, user, card, role="responsible"):
    sh = Stakeholder(card_id=card.id, user_id=user.id, role=role)
    db.add(sh)
    await db.flush()
    return sh


class TestIsStakeholderOf:
    async def test_returns_true_when_stakeholder(self, db, app_card_type):
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")
        card = await create_card(db, card_type="Application")
        await _make_stakeholder(db, user=user, card=card)

        assert await PermissionService.is_stakeholder_of(db, user, card.id) is True

    async def test_returns_false_when_not_stakeholder(self, db, app_card_type):
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        user = await create_user(db, role="member")
        card = await create_card(db, card_type="Application")

        assert await PermissionService.is_stakeholder_of(db, user, card.id) is False


class TestCanViewCosts:
    async def test_admin_wildcard_grants_access(self, db, app_card_type):
        await create_role(db, key="admin", permissions={"*": True})
        user = await create_user(db, role="admin")
        card = await create_card(db, card_type="Application")

        assert await PermissionService.can_view_costs(db, user, card.id) is True

    async def test_app_perm_grants_access(self, db, app_card_type):
        await create_role(db, key="cost_role", permissions={"costs.view": True})
        user = await create_user(db, role="cost_role")
        card = await create_card(db, card_type="Application")

        assert await PermissionService.can_view_costs(db, user, card.id) is True

    async def test_stakeholder_grants_access_without_global_perm(self, db, app_card_type):
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")
        card = await create_card(db, card_type="Application")
        await _make_stakeholder(db, user=user, card=card)

        assert await PermissionService.can_view_costs(db, user, card.id) is True

    async def test_no_perm_no_stakeholder_denies(self, db, app_card_type):
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")
        card = await create_card(db, card_type="Application")

        assert await PermissionService.can_view_costs(db, user, card.id) is False


class TestCardIdsWithCostAccess:
    async def test_global_perm_returns_all(self, db, app_card_type):
        await create_role(db, key="cost_role", permissions={"costs.view": True})
        user = await create_user(db, role="cost_role")
        c1 = await create_card(db, card_type="Application", name="A")
        c2 = await create_card(db, card_type="Application", name="B")

        out = await PermissionService.card_ids_with_cost_access(db, user, [c1.id, c2.id])
        assert out == {c1.id, c2.id}

    async def test_no_perm_returns_only_stakeholder_cards(self, db, app_card_type):
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")
        c1 = await create_card(db, card_type="Application", name="A")
        c2 = await create_card(db, card_type="Application", name="B")
        await _make_stakeholder(db, user=user, card=c1)

        out = await PermissionService.card_ids_with_cost_access(db, user, [c1.id, c2.id])
        assert out == {c1.id}

    async def test_no_perm_no_stakeholders_returns_empty(self, db, app_card_type):
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")
        c1 = await create_card(db, card_type="Application", name="A")

        out = await PermissionService.card_ids_with_cost_access(db, user, [c1.id])
        assert out == set()

    async def test_empty_input_returns_empty(self, db):
        await create_role(db, key="admin", permissions={"*": True})
        user = await create_user(db, role="admin")

        out = await PermissionService.card_ids_with_cost_access(db, user, [])
        assert out == set()

    async def test_filters_unknown_ids(self, db, app_card_type):
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")
        c1 = await create_card(db, card_type="Application")
        await _make_stakeholder(db, user=user, card=c1)
        random_id = uuid.uuid4()

        out = await PermissionService.card_ids_with_cost_access(db, user, [c1.id, random_id])
        assert out == {c1.id}


class TestEffectivePermissionsIncludesCanViewCosts:
    async def test_admin_can_view_costs_true(self, db, app_card_type):
        await create_role(db, key="admin", permissions={"*": True})
        user = await create_user(db, role="admin")
        card = await create_card(db, card_type="Application")

        eff = await PermissionService.get_effective_card_permissions(db, user, card.id)
        assert eff["effective"]["can_view_costs"] is True

    async def test_app_perm_makes_can_view_costs_true(self, db, app_card_type):
        await create_role(db, key="r", permissions={"costs.view": True})
        user = await create_user(db, role="r")
        card = await create_card(db, card_type="Application")

        eff = await PermissionService.get_effective_card_permissions(db, user, card.id)
        assert eff["effective"]["can_view_costs"] is True

    async def test_stakeholder_makes_can_view_costs_true(self, db, app_card_type):
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")
        card = await create_card(db, card_type="Application")
        await _make_stakeholder(db, user=user, card=card)

        eff = await PermissionService.get_effective_card_permissions(db, user, card.id)
        assert eff["effective"]["can_view_costs"] is True

    async def test_no_access_returns_false(self, db, app_card_type):
        await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
        user = await create_user(db, role="viewer")
        card = await create_card(db, card_type="Application")

        eff = await PermissionService.get_effective_card_permissions(db, user, card.id)
        assert eff["effective"]["can_view_costs"] is False


class TestCanEditCosts:
    async def _roles(self, db):
        for key, edit in (("resp_c", True), ("process_owner_c", True), ("observer_c", False)):
            await create_stakeholder_role_def(
                db, key=key, label=key, permissions={"card.view": True, "card.edit": edit}
            )

    async def test_admin_and_app_level_grant(self, db, app_card_type):
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="ce", permissions={"costs.edit": True})
        card = await create_card(db, card_type="Application")
        for role in ("admin", "ce"):
            user = await create_user(db, role=role, email=f"{role}@ce.com")
            assert await PermissionService.can_edit_costs(db, user, card.id) is True

    async def test_edit_roles_work_when_profile_cannot_edit_cards(self, db, app_card_type):
        await self._roles(db)
        await create_role(db, key="ro", permissions={"inventory.view": True})
        mine = await create_card(db, card_type="Application")
        other = await create_card(db, card_type="Application")
        for role in ("resp_c", "process_owner_c"):
            user = await create_user(db, role="ro", email=f"{role}@x.com")
            await _make_stakeholder(db, user=user, card=mine, role=role)
            assert await PermissionService.can_edit_costs(db, user, mine.id) is True
            assert await PermissionService.can_edit_costs(db, user, other.id) is False

    async def test_observer_inventory_edit_only_and_stranger_cannot(self, db, app_card_type):
        await self._roles(db)
        await create_role(
            db, key="ie", permissions={"inventory.view": True, "inventory.edit": True}
        )
        card = await create_card(db, card_type="Application")
        obs = await create_user(db, role="ie", email="obs@x.com")
        await _make_stakeholder(db, user=obs, card=card, role="observer_c")
        member = await create_user(db, role="ie", email="m@x.com")
        assert await PermissionService.can_edit_costs(db, obs, card.id) is False
        assert await PermissionService.can_edit_costs(db, member, card.id) is False
