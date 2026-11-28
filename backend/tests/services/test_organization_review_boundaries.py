import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.relation import Relation
from app.services import card_lifecycle, survey_apply
from app.services.organization_cones import valid_organization_positions
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation_type,
    create_role,
    create_user,
)


async def test_automatic_detach_does_not_confirm_mixed_type_organization_root(db):
    await create_card_type(db, key="Application", has_hierarchy=True)
    await create_card_type(db, key="Organization", has_hierarchy=True)
    admin = await create_user(db)
    parent = await create_card(db, card_type="Application", name="Legacy parent")
    child = await create_card(
        db, card_type="Organization", name="Legacy position", parent_id=parent.id
    )
    child.organization_cone_state = "connected"
    await db.flush()
    await card_lifecycle.apply_child_strategy(db, parent, "disconnect", admin.id)
    assert child.parent_id is None
    assert child.organization_cone_state == "orphaned"
    positions = valid_organization_positions()
    assert child.id not in set((await db.scalars(select(positions.c.id))).all())


async def test_organization_permissions_hide_denied_relation_and_approval_actions(client, db):
    await create_role(
        db,
        key="chart_reader",
        permissions={
            "inventory.view": True,
            "relations.manage": True,
            "inventory.approval_status": True,
        },
    )
    reader = await create_user(db, email="chart-reader-flags@example.com", role="chart_reader")
    await create_card_type(db, key="Organization")
    card = await create_card(db, card_type="Organization", name="Position")
    response = await client.get(
        f"/api/v1/cards/{card.id}/my-permissions", headers=auth_headers(reader)
    )
    assert response.status_code == 200
    effective = response.json()["effective"]
    assert effective["can_manage_relations"] is False
    assert effective["can_approval_status"] is False


@pytest.mark.parametrize("remove", [False, True])
async def test_survey_application_cannot_mutate_organization_peer(db, remove):
    await create_card_type(db, key="Application")
    await create_card_type(db, key="Organization")
    await create_relation_type(
        db, key="app_org_survey", source_type_key="Application", target_type_key="Organization"
    )
    actor = await create_user(db, email="survey-peer-guard@example.com", role="member")
    app = await create_card(db, card_type="Application", name="App")
    org = await create_card(db, card_type="Organization", name="Org")
    if remove:
        db.add(Relation(type="app_org_survey", source_id=app.id, target_id=org.id))
        await db.flush()
    with pytest.raises(HTTPException) as exc:
        await survey_apply.apply_relation_change(
            db,
            app,
            {"relation_type_key": "app_org_survey", "direction": "outgoing"},
            [] if remove else [{"id": str(org.id)}],
            actor.id,
        )
    assert exc.value.status_code == 403
    assert len(
        (await db.scalars(select(Relation).where(Relation.type == "app_org_survey"))).all()
    ) == int(remove)


async def test_bulk_application_archive_skips_organization_child_lookup(client, db, monkeypatch):
    await create_role(db, key="admin", permissions={"*": True})
    admin = await create_user(db, email="bulk-child-queries@example.com")
    await create_card_type(db, key="Application", has_hierarchy=True)
    cards = [await create_card(db, card_type="Application", name=f"Bulk {i}") for i in range(3)]
    calls = []
    original = card_lifecycle.direct_children

    async def counted(db, parent_id):
        calls.append(parent_id)
        return await original(db, parent_id)

    monkeypatch.setattr(card_lifecycle, "direct_children", counted)
    response = await client.post(
        "/api/v1/cards/bulk-archive",
        json={"card_ids": [str(c.id) for c in cards]},
        headers=auth_headers(admin),
    )
    assert response.status_code == 200
    assert sorted(calls) == sorted(c.id for c in cards)


async def test_survey_writes_only_the_active_peer_set_it_authorized(db, monkeypatch):
    from app.models.card import Card

    await create_role(db, key="admin", permissions={"*": True})
    actor = await create_user(db, email="survey-active-snapshot@example.com")
    await create_card_type(db, key="Application")
    await create_card_type(db, key="ITComponent")
    await create_relation_type(
        db, key="survey_snapshot", source_type_key="Application", target_type_key="ITComponent"
    )
    card = await create_card(db, card_type="Application", name="Survey target")
    peer = await create_card(db, card_type="ITComponent", name="Restored peer", status="ARCHIVED")
    await db.flush()
    original_scalars = db.scalars
    restored = False

    async def restore_after_selection(statement, *args, **kwargs):
        nonlocal restored
        result = await original_scalars(statement, *args, **kwargs)
        columns = getattr(statement, "column_descriptions", ())
        if not restored and any(column.get("entity") is Card for column in columns):
            restored = True
            peer.status = "ACTIVE"
            await db.flush()
        return result

    monkeypatch.setattr(db, "scalars", restore_after_selection)
    changed = await survey_apply.apply_relation_change(
        db,
        card,
        {"relation_type_key": "survey_snapshot", "direction": "outgoing"},
        [{"id": str(peer.id)}],
        actor.id,
        actor=actor,
    )
    assert restored
    assert changed is False
    assert not (await db.scalars(select(Relation).where(Relation.type == "survey_snapshot"))).all()
