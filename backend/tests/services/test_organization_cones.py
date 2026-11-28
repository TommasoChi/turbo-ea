"""Organization traversal resolves only current eligible subordinate holders."""

from datetime import UTC, datetime, timedelta

from app.models.stakeholder import Stakeholder
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from tests.conftest import create_card, create_card_type, create_user


async def test_subordinates_cross_vacancy_exclude_peers_and_expired_holders(db):
    from app.services.organization_cones import organization_subordinate_ids

    await create_card_type(db, key="Organization")
    db.add(
        StakeholderRoleDefinition(
            card_type_key="Organization",
            key="responsible",
            label="Responsible",
            permissions={},
            is_position_role=True,
        )
    )
    manager = await create_user(db, email="manager@example.com")
    subordinate = await create_user(db, email="subordinate@example.com")
    expired = await create_user(db, email="expired@example.com")
    peer = await create_user(db, email="peer@example.com")
    expired.access_expires_at = datetime.now(UTC) - timedelta(days=1)
    root = await create_card(db, card_type="Organization", name="Root")
    vacant = await create_card(db, card_type="Organization", name="Vacant", parent_id=root.id)
    intermediate = await create_card(
        db, card_type="Organization", name="Expired", parent_id=vacant.id
    )
    leaf = await create_card(db, card_type="Organization", name="Leaf", parent_id=intermediate.id)
    outside = await create_card(db, card_type="Organization", name="Peer")
    for card in (root, vacant, intermediate, leaf, outside):
        card.organization_cone_state = "connected"
    db.add_all(
        [
            Stakeholder(card_id=root.id, user_id=manager.id, role="responsible"),
            Stakeholder(card_id=intermediate.id, user_id=expired.id, role="responsible"),
            Stakeholder(card_id=leaf.id, user_id=subordinate.id, role="responsible"),
            Stakeholder(card_id=outside.id, user_id=peer.id, role="responsible"),
        ]
    )
    await db.flush()
    assert set((await db.execute(organization_subordinate_ids(manager.id))).scalars()) == {
        subordinate.id
    }
    intermediate.organization_cone_state = "orphaned"
    await db.flush()
    assert (await db.execute(organization_subordinate_ids(manager.id))).scalars().all() == []


async def test_invalid_paths_cannot_suppress_a_separate_valid_position(db):
    from app.services.organization_cones import organization_subordinate_ids

    await create_card_type(db, key="Organization")
    await create_card_type(db, key="Application")
    definition = StakeholderRoleDefinition(
        card_type_key="Organization",
        key="responsible",
        label="Responsible",
        permissions={},
        is_position_role=True,
    )
    db.add(definition)
    manager = await create_user(db, email="manager2@example.com")
    subordinate = await create_user(db, email="report2@example.com")
    root = await create_card(db, card_type="Organization", name="Good root")
    child = await create_card(db, card_type="Organization", name="Good child", parent_id=root.id)
    cycle_a = await create_card(db, card_type="Organization", name="Cycle A")
    cycle_b = await create_card(db, card_type="Organization", name="Cycle B", parent_id=cycle_a.id)
    cycle_a.parent_id = cycle_b.id
    app = await create_card(db, card_type="Application", name="Wrong parent")
    invalid = await create_card(db, card_type="Organization", name="Wrong child", parent_id=app.id)
    for card in (root, child, cycle_a, cycle_b, invalid):
        card.organization_cone_state = "connected"
    db.add_all(
        [
            Stakeholder(card_id=root.id, user_id=manager.id, role="responsible"),
            Stakeholder(card_id=cycle_a.id, user_id=manager.id, role="responsible"),
            Stakeholder(card_id=invalid.id, user_id=manager.id, role="responsible"),
            Stakeholder(card_id=child.id, user_id=subordinate.id, role="responsible"),
        ]
    )
    await db.flush()
    assert set((await db.execute(organization_subordinate_ids(manager.id))).scalars()) == {
        subordinate.id
    }
    definition.is_archived = True
    await db.flush()
    assert (await db.execute(organization_subordinate_ids(manager.id))).scalars().all() == []


async def test_rollback_parent_move_keeps_inherited_orphan_state(db):
    from app.services.rollback_service import _apply_restore_card_fields

    await create_card_type(db, key="Organization")
    root = await create_card(db, card_type="Organization", name="Root")
    orphan = await create_card(db, card_type="Organization", name="Orphan", parent_id=root.id)
    child = await create_card(db, card_type="Organization", name="Child", parent_id=orphan.id)
    root.organization_cone_state = child.organization_cone_state = "connected"
    orphan.organization_cone_state = "orphaned"
    await db.flush()
    await _apply_restore_card_fields(
        db,
        {
            "card_id": str(child.id),
            "fields": {"parent_id": str(root.id), "organization_cone_state": "connected"},
        },
    )
    await db.flush()
    assert child.parent_id == root.id
    assert child.organization_cone_state == "orphaned"


async def test_inherited_grant_revocation_is_fresh_across_sessions(test_engine, monkeypatch):
    from sqlalchemy import delete
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.card import Card
    from app.models.card_type import CardType
    from app.models.role import Role
    from app.models.user import User
    from app.services import organization_cones
    from app.services.permission_service import PermissionService
    from tests.conftest import create_role

    sessions = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    async with sessions() as writer, sessions() as reader:
        await create_role(writer, key="cone_worker", label="Worker", permissions={})
        await create_card_type(writer, key="Organization")
        await create_card_type(writer, key="Application")
        manager = await create_user(writer, email="worker-manager@example.com", role="cone_worker")
        report = await create_user(writer, email="worker-report@example.com", role="cone_worker")
        other_manager = await create_user(
            writer, email="worker-other@example.com", role="cone_worker"
        )
        root = await create_card(writer, card_type="Organization", name="Root")
        other_root = await create_card(writer, card_type="Organization", name="Other root")
        child = await create_card(writer, card_type="Organization", name="Child", parent_id=root.id)
        root.organization_cone_state = child.organization_cone_state = (
            other_root.organization_cone_state
        ) = "connected"
        target = await create_card(writer, card_type="Application", name="Target")
        position = StakeholderRoleDefinition(
            card_type_key="Organization",
            key="position",
            label="Position",
            permissions={},
            is_position_role=True,
        )
        editor = StakeholderRoleDefinition(
            card_type_key="Application",
            key="editor",
            label="Editor",
            permissions={"card.view": True},
        )
        writer.add_all(
            [
                position,
                editor,
                Stakeholder(card_id=root.id, user_id=manager.id, role="position"),
                Stakeholder(card_id=other_root.id, user_id=other_manager.id, role="position"),
                Stakeholder(card_id=child.id, user_id=report.id, role="position"),
                Stakeholder(card_id=target.id, user_id=report.id, role="editor"),
            ]
        )
        await writer.commit()
        ids = [root.id, other_root.id, child.id, target.id]
        users = [manager.id, other_manager.id, report.id]

        async def enabled(_db):
            return True

        monkeypatch.setattr(organization_cones, "organization_cones_enabled", enabled)
        try:
            PermissionService.invalidate_srd_cache("Application", "editor")
            reader_manager = await reader.get(User, manager.id)
            assert await PermissionService.stakeholder_role_permissions(
                reader, "Application", "editor"
            ) == {"card.view": True}
            assert await PermissionService.has_card_permission(
                reader, reader_manager, target.id, "card.view"
            )
            reader_cache = PermissionService._srd_cache
            writer_cache = {}
            monkeypatch.setattr(PermissionService, "_srd_cache", writer_cache)
            assert await PermissionService.stakeholder_role_permissions(
                writer, "Application", "editor"
            ) == {"card.view": True}
            editor.permissions = {}
            await writer.commit()
            monkeypatch.setattr(PermissionService, "_srd_cache", reader_cache)
            assert not await PermissionService.has_card_permission(
                reader, reader_manager, target.id, "card.view"
            )
            assert await PermissionService.stakeholder_role_permissions(
                reader, "Application", "editor"
            ) == {"card.view": True}
            editor.permissions = {"card.view": True}
            await writer.commit()
            assert await PermissionService.has_card_permission(
                reader, reader_manager, target.id, "card.view"
            )
            editor.is_archived = True
            await writer.commit()
            assert not await PermissionService.has_card_permission(
                reader, reader_manager, target.id, "card.view"
            )
            editor.is_archived = False
            child.parent_id = other_root.id
            await writer.commit()
            reader_other = await reader.get(User, other_manager.id)
            assert not await PermissionService.has_card_permission(
                reader, reader_manager, target.id, "card.view"
            )
            assert await PermissionService.has_card_permission(
                reader, reader_other, target.id, "card.view"
            )
            child.parent_id = root.id
            report.is_active = False
            await writer.commit()
            assert not await PermissionService.has_card_permission(
                reader, reader_manager, target.id, "card.view"
            )
            report.is_active = True
            report.access_expires_at = datetime.now(UTC) - timedelta(days=1)
            await writer.commit()
            assert not await PermissionService.has_card_permission(
                reader, reader_manager, target.id, "card.view"
            )
            report.access_expires_at = None
            position.is_position_role = False
            await writer.commit()
            assert not await PermissionService.has_card_permission(
                reader, reader_manager, target.id, "card.view"
            )
            position.is_position_role = True
            await writer.execute(
                delete(Stakeholder).where(
                    Stakeholder.card_id == child.id, Stakeholder.user_id == report.id
                )
            )
            await writer.commit()
            assert not await PermissionService.has_card_permission(
                reader, reader_manager, target.id, "card.view"
            )
        finally:
            await reader.rollback()
            await writer.execute(delete(Stakeholder).where(Stakeholder.card_id.in_(ids)))
            await writer.execute(delete(Card).where(Card.id == child.id))
            await writer.execute(
                delete(Card).where(Card.id.in_([root.id, other_root.id, target.id]))
            )
            await writer.execute(
                delete(StakeholderRoleDefinition).where(
                    StakeholderRoleDefinition.id.in_([position.id, editor.id])
                )
            )
            await writer.execute(
                delete(CardType).where(CardType.key.in_(["Organization", "Application"]))
            )
            await writer.execute(delete(User).where(User.id.in_(users)))
            await writer.execute(delete(Role).where(Role.key == "cone_worker"))
            await writer.commit()
            PermissionService.invalidate_srd_cache()


async def test_multiple_holders_and_overlapping_positions_deduplicate_grants(db):
    from app.services.organization_cones import (
        organization_subordinate_ids,
        organization_subordinate_positions,
    )

    await create_card_type(db, key="Organization")
    db.add(
        StakeholderRoleDefinition(
            card_type_key="Organization",
            key="position",
            label="Position",
            permissions={},
            is_position_role=True,
        )
    )
    manager = await create_user(db, email="multi-manager@example.com")
    first = await create_user(db, email="multi-first@example.com")
    second = await create_user(db, email="multi-second@example.com")
    expired = await create_user(db, email="multi-expired@example.com")
    expired.access_expires_at = datetime.now(UTC) - timedelta(days=1)
    root = await create_card(db, card_type="Organization", name="Root")
    middle = await create_card(db, card_type="Organization", name="Middle", parent_id=root.id)
    leaf = await create_card(db, card_type="Organization", name="Leaf", parent_id=middle.id)
    root.organization_cone_state = middle.organization_cone_state = leaf.organization_cone_state = (
        "connected"
    )
    db.add_all(
        [
            Stakeholder(card_id=root.id, user_id=manager.id, role="position"),
            Stakeholder(card_id=middle.id, user_id=manager.id, role="position"),
            Stakeholder(card_id=leaf.id, user_id=first.id, role="position"),
            Stakeholder(card_id=leaf.id, user_id=second.id, role="position"),
            Stakeholder(card_id=leaf.id, user_id=expired.id, role="position"),
        ]
    )
    await db.flush()
    assert set((await db.scalars(organization_subordinate_ids(manager.id))).all()) == {
        first.id,
        second.id,
    }
    rows = (await db.execute(organization_subordinate_positions(manager.id))).all()
    assert len([row for row in rows if row.holder_id == first.id]) == 2
    assert len([row for row in rows if row.holder_id == second.id]) == 2
