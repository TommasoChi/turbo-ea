"""Cost history and cost items follow the cost permissions, not ``card.edit``."""

import pytest

from app.core.permissions import COST_CONTROLLER_CARD_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.services import cost_item_types
from app.services.fiscal_year import current_fiscal_year
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

YEAR = current_fiscal_year(1) - 1
COST_FIELDS = [
    {"section": "Cost", "fields": [{"key": "costTotalAnnual", "type": "cost", "weight": 0}]}
]
BODY = {"fiscal_year": YEAR, "field_key": "costTotalAnnual", "value": 10}


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@ch-perm.com", role="admin")
    for key in ("Initiative", "Application", "ITComponent"):
        await create_card_type(db, key=key, fields_schema=COST_FIELDS)
        await create_stakeholder_role_def(
            db,
            card_type_key=key,
            key="costController",
            label="Cost Controller",
            permissions=COST_CONTROLLER_CARD_PERMISSIONS,
        )
    await cost_item_types.create_item(db, "lic", "Licences")
    controller = await create_user(db, email="cc@ch-perm.com", role="viewer")
    return {"admin": admin, "controller": controller}


async def _assign(db, card, user, role="costController"):
    db.add(Stakeholder(card_id=card.id, user_id=user.id, role=role))
    await db.flush()


async def test_cost_controller_lists_and_writes_cost_history_without_card_edit(client, db, env):
    card = await create_card(db, card_type="Initiative", name="Init", user_id=env["admin"].id)
    await _assign(db, card, env["controller"])
    url = f"/api/v1/cards/{card.id}/cost-history"
    headers = auth_headers(env["controller"])
    assert (await client.put(url, json=BODY, headers=headers)).status_code == 200
    resp = await client.get(url, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["rows"] == [{**BODY}]
    delete = await client.delete(f"{url}/{YEAR}/costTotalAnnual", headers=headers)
    assert delete.status_code == 204


async def test_card_edit_without_edit_costs_reads_but_cannot_write_history(client, db, env):
    await create_stakeholder_role_def(
        db,
        card_type_key="Initiative",
        key="editor",
        label="Editor",
        permissions={"card.view": True, "card.edit": True, "card.view_costs": True},
    )
    editor = await create_user(db, email="ed@ch-perm.com", role="viewer")
    card = await create_card(db, card_type="Initiative", name="Init", user_id=env["admin"].id)
    await _assign(db, card, editor, "editor")
    url = f"/api/v1/cards/{card.id}/cost-history"
    assert (await client.put(url, json=BODY, headers=auth_headers(editor))).status_code == 403
    assert (await client.get(url, headers=auth_headers(editor))).status_code == 200


async def test_costs_view_alone_reads_history_but_cannot_write(client, db, env):
    await create_role(
        db, key="cost-reader", permissions={"inventory.view": True, "costs.view": True}
    )
    reader = await create_user(db, email="rd@ch-perm.com", role="cost-reader")
    card = await create_card(db, card_type="Initiative", name="Init", user_id=env["admin"].id)
    url = f"/api/v1/cards/{card.id}/cost-history"
    assert (await client.get(url, headers=auth_headers(reader))).status_code == 200
    assert (await client.put(url, json=BODY, headers=auth_headers(reader))).status_code == 403


async def test_hidden_initiative_is_404_for_the_cost_controller(client, db, env):
    from sqlalchemy import select

    card = await create_card(db, card_type="Initiative", name="Init", user_id=env["admin"].id)
    ct = (await db.execute(select(CardType).where(CardType.key == "Initiative"))).scalar_one()
    ct.role_permissions = {"viewer": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()
    url = f"/api/v1/cards/{card.id}/cost-history"
    headers = auth_headers(env["controller"])
    assert (await client.get(url, headers=headers)).status_code == 404
    assert (await client.put(url, json=BODY, headers=headers)).status_code == 404
    delete_url = f"{url}/{YEAR}/{BODY['field_key']}"
    assert (await client.delete(delete_url, headers=headers)).status_code == 404


@pytest.mark.parametrize("card_type", ["Application", "ITComponent"])
async def test_cost_controller_writes_cost_items_on_applications_and_components(
    client, db, env, card_type
):
    card = await create_card(db, card_type=card_type, name="Thing", user_id=env["admin"].id)
    await _assign(db, card, env["controller"])
    resp = await client.put(
        f"/api/v1/cards/{card.id}/costs/{YEAR}/items/lic",
        json={"amount": 5},
        headers=auth_headers(env["controller"]),
    )
    assert resp.status_code == 200
