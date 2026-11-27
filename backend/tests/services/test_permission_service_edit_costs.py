"""Editing a card's costs follows `card.edit_costs` (stakeholder) or `costs.edit` (app)."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.services.permission_service import PermissionService
from tests.conftest import (
    create_card,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

_VIEW = {"inventory.view": True}

# (id, app permissions, stakeholder role permissions or None, expected)
PROFILES = [
    ("stakeholder_edit_costs", _VIEW | {"costs.view": True}, {"card.edit_costs": True}, True),
    ("stakeholder_card_edit_only", _VIEW | {"costs.view": True}, {"card.edit": True}, False),
    ("app_costs_edit", _VIEW | {"costs.edit": True, "costs.view": True}, None, True),
    ("costs_edit_without_view", _VIEW | {"costs.edit": True}, None, False),
    ("edit_costs_alone", _VIEW, {"card.edit_costs": True}, False),
    ("view_costs_alone", _VIEW | {"costs.view": True}, {"card.view_costs": True}, False),
    ("viewer", _VIEW, None, False),
    (
        "cost_controller",
        _VIEW | {"costs.view": True},
        {"card.view": True, "card.view_costs": True, "card.edit_costs": True},
        True,
    ),
    (
        "responsible_pm",
        _VIEW | {"costs.view": True},
        {"card.view": True, "card.edit": True, "card.view_costs": True, "card.edit_costs": True},
        True,
    ),
    (
        "observer",
        _VIEW,
        {"card.view": True, "card.view_costs": False, "card.edit_costs": False},
        False,
    ),
    ("admin", {"*": True}, None, True),
]


async def _setup(db, app_card_type, app_perms, stakeholder_perms):
    await create_role(db, key="p", permissions=app_perms)
    user = await create_user(db, role="p", email="p@x.com")
    card = await create_card(db, card_type="Application")
    if stakeholder_perms is not None:
        await create_stakeholder_role_def(db, key="sr", label="SR", permissions=stakeholder_perms)
        db.add(Stakeholder(card_id=card.id, user_id=user.id, role="sr"))
        await db.flush()
    return user, card


@pytest.mark.parametrize(
    ("app_perms", "sh_perms", "expected"), [p[1:] for p in PROFILES], ids=[p[0] for p in PROFILES]
)
async def test_can_edit_costs_matrix(db, app_card_type, app_perms, sh_perms, expected):
    user, card = await _setup(db, app_card_type, app_perms, sh_perms)

    assert await PermissionService.can_edit_costs(db, user, card.id) is expected


async def test_can_edit_licenses_unchanged(db, app_card_type):
    user, card = await _setup(
        db,
        app_card_type,
        _VIEW | {"licenses.view": True},
        {"card.edit": True, "card.view_licenses": True},
    )

    assert await PermissionService.can_edit_licenses(db, user, card.id) is True


@pytest.mark.parametrize(
    ("app_perms", "sh_perms", "expected"), [p[1:] for p in PROFILES], ids=[p[0] for p in PROFILES]
)
async def test_effective_can_edit_costs_equals_service(
    db, app_card_type, app_perms, sh_perms, expected
):
    user, card = await _setup(db, app_card_type, app_perms, sh_perms)

    eff = await PermissionService.get_effective_card_permissions(db, user, card.id)

    assert eff["effective"]["can_edit_costs"] is expected


async def test_effective_can_edit_costs_false_when_type_view_denied(db, app_card_type):
    user, card = await _setup(
        db, app_card_type, _VIEW | {"costs.edit": True, "costs.view": True}, None
    )
    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    ct.role_permissions = {"p": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()

    assert await PermissionService.can_edit_costs(db, user, card.id) is False
    eff = await PermissionService.get_effective_card_permissions(db, user, card.id)
    assert eff["effective"]["can_edit_costs"] is False
