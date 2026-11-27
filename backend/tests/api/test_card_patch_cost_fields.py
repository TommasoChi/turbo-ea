"""Every user-facing card write changes a cost-type field only for a caller who may edit costs."""

from sqlalchemy import select

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.card import Card
from app.models.card_cost_history import CardCostHistory
from app.models.stakeholder import Stakeholder
from app.services.fiscal_year import current_fiscal_year
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

FIELDS = [
    {
        "section": "Cost",
        "fields": [
            {"key": "costBudget", "type": "cost", "weight": 0},
            {"key": "note", "type": "text", "weight": 0},
        ],
    }
]
EDITOR = {"card.view": True, "card.edit": True, "card.view_costs": True}
COST_EDITOR = {**EDITOR, "card.edit_costs": True}


async def _setup(db, perms, extra_role_perms=None):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions={**VIEWER_PERMISSIONS, **(extra_role_perms or {})},
    )
    admin = await create_user(db, email="admin@patch-cost.com", role="admin")
    await create_card_type(db, key="Initiative", fields_schema=FIELDS)
    await create_stakeholder_role_def(
        db, card_type_key="Initiative", key="editor", label="Editor", permissions=perms
    )
    user = await create_user(db, email="ed@patch-cost.com", role="viewer")
    card = await create_card(
        db,
        card_type="Initiative",
        name="Init",
        user_id=admin.id,
        attributes={"costBudget": 5, "note": "old"},
    )
    db.add(Stakeholder(card_id=card.id, user_id=user.id, role="editor"))
    fy = current_fiscal_year(1)
    db.add(CardCostHistory(card_id=card.id, fiscal_year=fy, field_key="costBudget", value=5))
    await db.flush()
    return user, card, fy


async def _history(db, card_id, fy):
    row = await db.scalar(
        select(CardCostHistory.value).where(
            CardCostHistory.card_id == card_id,
            CardCostHistory.fiscal_year == fy,
            CardCostHistory.field_key == "costBudget",
        )
    )
    return float(row)


async def _attributes(db, card_id):
    return (await db.execute(select(Card.attributes).where(Card.id == card_id))).scalar_one()


async def test_edit_without_edit_costs_keeps_the_cost_field_and_saves_the_rest(client, db):
    user, card, fy = await _setup(db, EDITOR)
    resp = await client.patch(
        f"/api/v1/cards/{card.id}",
        json={"attributes": {"costBudget": 99, "note": "new"}},
        headers=auth_headers(user),
    )
    assert resp.status_code == 200
    assert await _attributes(db, card.id) == {"costBudget": 5, "note": "new"}
    assert await _history(db, card.id, fy) == 5


async def test_edit_with_edit_costs_changes_the_cost_field(client, db):
    user, card, fy = await _setup(db, COST_EDITOR)
    resp = await client.patch(
        f"/api/v1/cards/{card.id}",
        json={"attributes": {"costBudget": 99, "note": "new"}},
        headers=auth_headers(user),
    )
    assert resp.status_code == 200
    assert await _attributes(db, card.id) == {"costBudget": 99, "note": "new"}
    assert await _history(db, card.id, fy) == 99


async def test_bulk_edit_without_edit_costs_keeps_the_cost_field_and_saves_the_rest(client, db):
    user, card, fy = await _setup(
        db,
        EDITOR,
        extra_role_perms={"inventory.bulk_edit": True, "inventory.edit": True},
    )
    resp = await client.patch(
        "/api/v1/cards/bulk",
        json={"ids": [str(card.id)], "updates": {"attributes": {"costBudget": 99, "note": "new"}}},
        headers=auth_headers(user),
    )
    assert resp.status_code == 200, resp.text
    assert await _attributes(db, card.id) == {"costBudget": 5, "note": "new"}
    assert await _history(db, card.id, fy) == 5


async def test_bulk_edit_with_edit_costs_changes_the_cost_field(client, db):
    user, card, _fy = await _setup(
        db,
        COST_EDITOR,
        extra_role_perms={"inventory.bulk_edit": True, "inventory.edit": True},
    )
    resp = await client.patch(
        "/api/v1/cards/bulk",
        json={"ids": [str(card.id)], "updates": {"attributes": {"costBudget": 99, "note": "new"}}},
        headers=auth_headers(user),
    )
    assert resp.status_code == 200, resp.text
    assert await _attributes(db, card.id) == {"costBudget": 99, "note": "new"}


async def test_rollback_restore_without_edit_costs_keeps_the_cost_field(db):
    from app.api.v1 import mutation_batches as routes

    user, card, _fy = await _setup(db, EDITOR)
    op = {
        "op": "restore_card_fields",
        "card_id": str(card.id),
        "fields": {"attributes": {"costBudget": 1, "note": "back"}, "attr_costBudget": 1},
    }
    await routes._require_rollback_permissions(db, user, [op])
    assert op["fields"] == {"attributes": {"costBudget": 5, "note": "back"}}


async def test_rollback_restore_with_edit_costs_restores_the_cost_field(db):
    from app.api.v1 import mutation_batches as routes

    user, card, _fy = await _setup(db, COST_EDITOR)
    op = {
        "op": "restore_card_fields",
        "card_id": str(card.id),
        "fields": {"attributes": {"costBudget": 1, "note": "back"}},
    }
    await routes._require_rollback_permissions(db, user, [op])
    assert op["fields"] == {"attributes": {"costBudget": 1, "note": "back"}}


async def _creator(db, *, costs_edit: bool):
    perms = {**VIEWER_PERMISSIONS, "inventory.create": True, "costs.view": True}
    if costs_edit:
        perms["costs.edit"] = True
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="creator", label="Creator", permissions=perms)
    await create_card_type(db, key="Initiative", fields_schema=FIELDS)
    return await create_user(db, email="creator@patch-cost.com", role="creator")


async def test_create_without_edit_costs_drops_the_cost_field(client, db):
    user = await _creator(db, costs_edit=False)
    resp = await client.post(
        "/api/v1/cards",
        json={"type": "Initiative", "name": "New", "attributes": {"costBudget": 7, "note": "n"}},
        headers=auth_headers(user),
    )
    assert resp.status_code == 201, resp.text
    stored = (await db.execute(select(Card.attributes).where(Card.name == "New"))).scalar_one()
    assert stored == {"note": "n"}


async def test_create_with_edit_costs_keeps_the_cost_field(client, db):
    user = await _creator(db, costs_edit=True)
    resp = await client.post(
        "/api/v1/cards",
        json={"type": "Initiative", "name": "New", "attributes": {"costBudget": 7, "note": "n"}},
        headers=auth_headers(user),
    )
    assert resp.status_code == 201, resp.text
    stored = (await db.execute(select(Card.attributes).where(Card.name == "New"))).scalar_one()
    assert stored == {"costBudget": 7, "note": "n"}


async def test_bulk_create_without_edit_costs_drops_the_cost_field(client, db):
    user = await _creator(db, costs_edit=False)
    resp = await client.post(
        "/api/v1/cards/bulk-create",
        json={
            "cards": [
                {
                    "row_index": 0,
                    "type": "Initiative",
                    "name": "Imp",
                    "attributes": {"costBudget": 7, "note": "n"},
                }
            ]
        },
        headers=auth_headers(user),
    )
    assert resp.status_code == 200, resp.text
    stored = (await db.execute(select(Card.attributes).where(Card.name == "Imp"))).scalar_one()
    assert stored == {"note": "n"}


async def test_null_attributes_without_edit_costs_keeps_the_cost_field(client, db):
    user, card, fy = await _setup(db, EDITOR)
    resp = await client.patch(
        f"/api/v1/cards/{card.id}", json={"attributes": None}, headers=auth_headers(user)
    )
    assert resp.status_code == 200, resp.text
    assert await _attributes(db, card.id) == {"costBudget": 5}
    assert await _history(db, card.id, fy) == 5


async def test_null_attributes_with_edit_costs_still_clears(client, db):
    user, card, _fy = await _setup(db, COST_EDITOR)
    resp = await client.patch(
        f"/api/v1/cards/{card.id}", json={"attributes": None}, headers=auth_headers(user)
    )
    assert resp.status_code == 200, resp.text
    assert await _attributes(db, card.id) == {}


async def test_bulk_null_attributes_without_edit_costs_keeps_the_cost_field(client, db):
    user, card, fy = await _setup(
        db, EDITOR, extra_role_perms={"inventory.bulk_edit": True, "inventory.edit": True}
    )
    resp = await client.patch(
        "/api/v1/cards/bulk",
        json={"ids": [str(card.id)], "updates": {"attributes": None}},
        headers=auth_headers(user),
    )
    assert resp.status_code == 200, resp.text
    assert await _attributes(db, card.id) == {"costBudget": 5}
    assert await _history(db, card.id, fy) == 5


async def test_bulk_null_attributes_with_edit_costs_still_clears(client, db):
    user, card, _fy = await _setup(
        db, COST_EDITOR, extra_role_perms={"inventory.bulk_edit": True, "inventory.edit": True}
    )
    resp = await client.patch(
        "/api/v1/cards/bulk",
        json={"ids": [str(card.id)], "updates": {"attributes": None}},
        headers=auth_headers(user),
    )
    assert resp.status_code == 200, resp.text
    assert await _attributes(db, card.id) == {}
