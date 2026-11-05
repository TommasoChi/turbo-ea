"""The license view / edit rule mirrors costs: global permission or stakeholder on the card."""

from __future__ import annotations

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.stakeholder import Stakeholder
from app.services.permission_service import PermissionService
from tests.conftest import (
    create_card,
    create_role,
    create_stakeholder_role_def,
    create_user,
)


async def _stake(db, *, user, card, role="responsible"):
    db.add(Stakeholder(card_id=card.id, user_id=user.id, role=role))
    await db.flush()


async def _roles(db):
    for key, edit in (("resp_l", True), ("observer_l", False)):
        await create_stakeholder_role_def(
            db, key=key, label=key, permissions={"card.view": True, "card.edit": edit}
        )


async def test_view_by_permission_or_any_stakeholder(db, app_card_type):
    await _roles(db)
    await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
    user = await create_user(db, role="viewer")
    a = await create_card(db, card_type="Application", name="A")
    b = await create_card(db, card_type="Application", name="B")
    await _stake(db, user=user, card=a, role="observer_l")

    assert await PermissionService.can_view_licenses(db, user, a.id) is True
    assert await PermissionService.can_view_licenses(db, user, b.id) is False

    await create_role(db, key="lic", permissions={"licenses.view": True})
    holder = await create_user(db, role="lic", email="lic@x.com")
    assert await PermissionService.can_view_licenses(db, holder, b.id) is True


async def test_edit_needs_licenses_edit_or_card_edit_stakeholder(db, app_card_type):
    await _roles(db)
    await create_role(
        db, key="member", permissions={"inventory.view": True, "inventory.edit": True}
    )
    user = await create_user(db, role="member")
    mine = await create_card(db, card_type="Application", name="Mine")
    other = await create_card(db, card_type="Application", name="Other")

    assert await PermissionService.can_edit_licenses(db, user, mine.id) is False

    await _stake(db, user=user, card=mine, role="resp_l")
    assert await PermissionService.can_edit_licenses(db, user, mine.id) is True
    assert await PermissionService.can_edit_licenses(db, user, other.id) is False

    await create_role(db, key="lic_ed", permissions={"licenses.edit": True})
    editor = await create_user(db, role="lic_ed", email="ed@x.com")
    assert await PermissionService.can_edit_licenses(db, editor, other.id) is True


async def test_bulk_access_matches_single(db, app_card_type):
    await _roles(db)
    await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
    user = await create_user(db, role="viewer")
    cards = [await create_card(db, card_type="Application", name=f"C{i}") for i in range(3)]
    await _stake(db, user=user, card=cards[1], role="observer_l")
    ids = [c.id for c in cards]

    bulk = await PermissionService.card_ids_with_license_access(db, user, ids)
    single = {i for i in ids if await PermissionService.can_view_licenses(db, user, i)}
    assert bulk == single == {cards[1].id}

    await create_role(db, key="lic", permissions={"licenses.view": True})
    holder = await create_user(db, role="lic", email="lic@x.com")
    assert await PermissionService.card_ids_with_license_access(db, holder, ids) == set(ids)
    assert await PermissionService.card_ids_with_license_access(db, holder, []) == set()
