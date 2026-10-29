"""The IT-component and data-object element maps apply CardReadScope (audit 2026-10).

Only the application map did: the other two named every linked card and process to
anyone with ``reports.bpm_dashboard``, hidden card types included.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.card_type import CardType
from app.models.process_element import ProcessElement
from app.services.permission_service import PermissionService
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

MAPS = [
    ("element-it-component-map", "ITComponent", "it_component_id", "it_component_name"),
    ("element-data-object-map", "DataObject", "data_object_id", "data_object_name"),
]
LINK = {"ITComponent": "it_component_id", "DataObject": "data_object_id"}


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions={"inventory.view": True, "reports.bpm_dashboard": True},
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    for key in ("BusinessProcess", "ITComponent", "DataObject"):
        await create_card_type(db, key=key, label=key)
    proc = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=admin.id)
    linked = {}
    for key in ("ITComponent", "DataObject"):
        card = await create_card(db, card_type=key, name=f"{key} one", user_id=admin.id)
        db.add(
            ProcessElement(
                process_id=proc.id,
                bpmn_element_id=f"t_{key}",
                element_type="task",
                name=f"Uses {key}",
                sequence_order=0,
                **{LINK[key]: card.id},
            )
        )
        linked[key] = card
    await db.flush()
    return {"admin": admin, "viewer": viewer, "proc": proc, "linked": linked}


async def _hide_type(db, key):
    ct = (await db.execute(select(CardType).where(CardType.key == key))).scalar_one()
    ct.role_permissions = {"viewer": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()


@pytest.mark.parametrize("path,type_key,id_key,name_key", MAPS)
async def test_a_reader_sees_the_cards_they_may_read(client, env, path, type_key, id_key, name_key):
    resp = await client.get(f"/api/v1/reports/bpm/{path}", headers=auth_headers(env["viewer"]))
    assert resp.status_code == 200
    assert [row[name_key] for row in resp.json()] == [f"{type_key} one"]


@pytest.mark.parametrize("path,type_key,id_key,name_key", MAPS)
async def test_a_hidden_linked_card_is_left_out(client, db, env, path, type_key, id_key, name_key):
    await _hide_type(db, type_key)
    resp = await client.get(f"/api/v1/reports/bpm/{path}", headers=auth_headers(env["viewer"]))
    assert resp.status_code == 200
    assert resp.json() == []
    admin = await client.get(f"/api/v1/reports/bpm/{path}", headers=auth_headers(env["admin"]))
    assert len(admin.json()) == 1


@pytest.mark.parametrize("path,type_key,id_key,name_key", MAPS)
async def test_elements_of_a_hidden_process_are_left_out(
    client, db, env, path, type_key, id_key, name_key
):
    await _hide_type(db, "BusinessProcess")
    resp = await client.get(f"/api/v1/reports/bpm/{path}", headers=auth_headers(env["viewer"]))
    assert resp.status_code == 200
    assert resp.json() == []
