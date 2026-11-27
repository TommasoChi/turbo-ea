"""A configured relation created by a cost write follows the cost-write gate, not
``relations.manage``."""

from sqlalchemy import select

from app.core.permissions import COST_CONTROLLER_CARD_PERMISSIONS
from app.models.relation import Relation
from app.models.stakeholder import Stakeholder
from tests.api.test_ppm import ppm_env as ppm_env  # noqa: F401
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_ppm_manager_user,
    create_relation_type,
    create_stakeholder_role_def,
)

SETTINGS = "/api/v1/settings/pml/financial-fields"
RELATION = "org_supports_initiative"


async def _configured(client, db, ppm_env):
    await create_card_type(db, key="Organization", label="Organization")
    organization = await create_card(db, card_type="Organization", name="Supplier")
    await create_relation_type(
        db,
        key=RELATION,
        label="Supports",
        source_type_key="Organization",
        target_type_key="Initiative",
    )
    await create_stakeholder_role_def(
        db,
        card_type_key="Initiative",
        key="costController",
        label="Cost Controller",
        permissions=COST_CONTROLLER_CARD_PERMISSIONS,
    )
    config = {
        "fields": [
            {
                "key": "org",
                "label": "Org",
                "kind": "card_reference",
                "card_type": "Organization",
                "relation_type": RELATION,
            }
        ],
        "visible_columns": ["org"],
    }
    resp = await client.put(
        f"{SETTINGS}/budget", json=config, headers=auth_headers(ppm_env["admin"])
    )
    assert resp.status_code == 200, resp.text
    payload = {
        "fiscal_year": 2026,
        "category": "opex",
        "amount": 100,
        "field_values": {"org": str(organization.id)},
    }
    return payload


async def test_cost_controller_creates_the_configured_relation_without_relations_manage(
    client, db, ppm_env
):
    payload = await _configured(client, db, ppm_env)
    user = await create_ppm_manager_user(db)
    db.add(Stakeholder(card_id=ppm_env["initiative"].id, user_id=user.id, role="costController"))
    await db.flush()
    resp = await client.post(
        f"/api/v1/ppm/initiatives/{ppm_env['initiative'].id}/budgets",
        json=payload,
        headers=auth_headers(user),
    )
    assert resp.status_code == 200, resp.text
    relation = await db.scalar(select(Relation).where(Relation.type == RELATION))
    assert relation is not None


async def test_a_caller_without_cost_edit_is_refused_and_no_relation_is_created(
    client, db, ppm_env
):
    payload = await _configured(client, db, ppm_env)
    user = await create_ppm_manager_user(db)  # ppm.manage, but no cost-edit access
    resp = await client.post(
        f"/api/v1/ppm/initiatives/{ppm_env['initiative'].id}/budgets",
        json=payload,
        headers=auth_headers(user),
    )
    assert resp.status_code == 403
    await db.rollback()
    assert (await db.scalars(select(Relation).where(Relation.type == RELATION))).all() == []
