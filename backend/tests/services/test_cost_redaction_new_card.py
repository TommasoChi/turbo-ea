"""Cost attributes a creator may set on a card that does not exist yet."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.card_type import CardType
from app.services.cost_redaction import attributes_for_new_card
from app.services.permission_service import PermissionService
from tests.conftest import create_card_type, create_role, create_user

ATTRS = {"costTotalAnnual": 1000, "name_hint": "x"}
DROPPED = {"name_hint": "x"}


@pytest.fixture
async def cost_type(db):
    return await create_card_type(
        db,
        key="Application",
        fields_schema=[
            {
                "section": "General",
                "fields": [
                    {"key": "costTotalAnnual", "label": "Cost", "type": "cost"},
                    {"key": "name_hint", "label": "Hint", "type": "text"},
                ],
            }
        ],
    )


async def _user(db, permissions):
    await create_role(db, key="creator", permissions=permissions)
    return await create_user(db, role="creator")


async def test_costs_edit_without_costs_view_drops_the_cost_fields(db, cost_type):
    user = await _user(db, {"inventory.create": True, "costs.edit": True})

    assert await attributes_for_new_card(db, user, cost_type, None, dict(ATTRS)) == DROPPED


async def test_costs_view_without_costs_edit_drops_the_cost_fields(db, cost_type):
    user = await _user(db, {"inventory.create": True, "costs.view": True})

    assert await attributes_for_new_card(db, user, cost_type, None, dict(ATTRS)) == DROPPED


async def test_both_permissions_keep_the_cost_fields(db, cost_type):
    user = await _user(db, {"inventory.create": True, "costs.view": True, "costs.edit": True})

    assert await attributes_for_new_card(db, user, cost_type, None, dict(ATTRS)) == ATTRS


@pytest.mark.parametrize(
    ("cells", "subtype", "expected"),
    [
        ({"inventory.view": False}, None, DROPPED),
        ({"inventory.view": {"value": False, "subtypes": ["saas"]}}, "saas", DROPPED),
        ({"inventory.view": {"value": False, "subtypes": ["saas"]}}, "custom", ATTRS),
    ],
    ids=["type_deny", "subtype_deny_matching", "subtype_deny_other_subtype"],
)
async def test_a_view_deny_on_the_type_or_subtype_drops_the_cost_fields(
    db, cost_type, cells, subtype, expected
):
    user = await _user(db, {"inventory.create": True, "costs.view": True, "costs.edit": True})
    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    ct.role_permissions = {"creator": cells}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()

    assert await attributes_for_new_card(db, user, cost_type, subtype, dict(ATTRS)) == expected
