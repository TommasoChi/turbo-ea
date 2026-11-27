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
        _VIEW | {"costs.view": True},
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


@pytest.mark.parametrize(
    ("app_perms", "sh_perms", "expected"), [p[1:] for p in PROFILES], ids=[p[0] for p in PROFILES]
)
async def test_bulk_edit_access_equals_per_card(db, app_card_type, app_perms, sh_perms, expected):
    user, card = await _setup(db, app_card_type, app_perms, sh_perms)
    other = await create_card(db, card_type="Application", name="No role here")

    bulk = await PermissionService.card_ids_with_cost_edit_access(db, user, [card.id, other.id])

    for cid in (card.id, other.id):
        assert (cid in bulk) is await PermissionService.can_edit_costs(db, user, cid)
    assert (card.id in bulk) is expected


async def test_bulk_edit_access_drops_view_denied_type(db, app_card_type):
    user, card = await _setup(
        db, app_card_type, _VIEW | {"costs.edit": True, "costs.view": True}, None
    )
    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    ct.role_permissions = {"p": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()

    assert await PermissionService.card_ids_with_cost_edit_access(db, user, [card.id]) == set()


async def test_bulk_edit_access_query_count_does_not_grow_with_cards(db, app_card_type):
    from sqlalchemy import event as sa_event

    await create_role(db, key="p", permissions=_VIEW | {"costs.view": True})
    user = await create_user(db, role="p", email="p@x.com")
    await create_stakeholder_role_def(
        db, key="sr", label="SR", permissions={"card.view_costs": True, "card.edit_costs": True}
    )

    async def count(n):
        ids = []
        for i in range(n):
            card = await create_card(db, card_type="Application", name=f"c{i}-{n}")
            db.add(Stakeholder(card_id=card.id, user_id=user.id, role="sr"))
            ids.append(card.id)
        await db.flush()
        statements: list[str] = []
        bind = db.sync_session.get_bind()

        def _record(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        sa_event.listen(bind, "before_cursor_execute", _record)
        try:
            allowed = await PermissionService.card_ids_with_cost_edit_access(db, user, ids)
        finally:
            sa_event.remove(bind, "before_cursor_execute", _record)
        assert allowed == set(ids)
        return len(statements)

    await count(1)  # warms the role caches
    assert await count(2) == await count(8)


_COST_CONTROLLER = {"card.view": True, "card.view_costs": True, "card.edit_costs": True}


async def test_cost_controller_without_app_costs_view_sees_and_edits_costs_on_the_card(
    db, app_card_type
):
    user, card = await _setup(db, app_card_type, _VIEW, _COST_CONTROLLER)

    assert await PermissionService.can_edit_costs(db, user, card.id) is True
    assert await PermissionService.card_ids_with_cost_edit_access(db, user, [card.id]) == {card.id}


async def test_cost_controller_keeps_the_per_card_grant_under_a_type_view_deny(db, app_card_type):
    user, card = await _setup(db, app_card_type, _VIEW | {"costs.view": True}, _COST_CONTROLLER)
    app_card_type.role_permissions = {"p": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()

    assert await PermissionService.can_edit_costs(db, user, card.id) is True
    assert await PermissionService.card_ids_with_cost_edit_access(db, user, [card.id]) == {card.id}
