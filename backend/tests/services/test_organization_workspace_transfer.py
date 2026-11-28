"""Organization chart state travels with workspace bundles."""

from app.services.workspace_io import build_bundle, parse_bundle, schema
from tests.conftest import create_card, create_card_type, create_stakeholder_role_def


async def test_workspace_exports_organization_chart_state_and_role_flag(db):
    await create_card_type(db, key="Organization", label="Organization")
    role = await create_stakeholder_role_def(
        db, card_type_key="Organization", key="manager", label="Manager"
    )
    role.is_position_role = True
    card = await create_card(db, card_type="Organization", name="Position")
    card.organization_cone_state = "orphaned"
    await db.flush()
    bundle = parse_bundle(await build_bundle(db))
    try:
        role_row = next(
            r for r in bundle.rows(schema.SHEET_STAKEHOLDER_ROLES) if r["key"] == "manager"
        )
        card_row = next(r for r in bundle.rows(schema.SHEET_CARDS) if r["name"] == "Position")
        assert role_row["is_position_role"] is True
        assert card_row["organization_cone_state"] == "orphaned"
    finally:
        bundle.close()


async def test_legacy_role_without_flag_clears_matched_position_role(db):
    from app.services.workspace_io import apply_bundle
    from app.services.workspace_io.bundle import WorkspaceBundle
    from tests.conftest import create_user

    await create_card_type(db, key="Organization", label="Organization")
    role = await create_stakeholder_role_def(
        db, card_type_key="Organization", key="manager", label="Manager"
    )
    role.is_position_role = True
    actor = await create_user(db, email="import-admin@example.com", role="admin")
    await db.flush()
    bundle = WorkspaceBundle(
        manifest={},
        sheets={
            schema.SHEET_STAKEHOLDER_ROLES: [
                {
                    "card_type_key": "Organization",
                    "key": "manager",
                    "label": "Manager",
                }
            ]
        },
    )
    result = await apply_bundle(db, bundle, actor, commit=False)
    assert result.total_failed == 0
    await db.refresh(role)
    assert role.is_position_role is False


async def test_legacy_organization_root_import_is_unconfirmed(db):
    from sqlalchemy import select

    from app.models.card import Card
    from app.services.workspace_io import apply_bundle
    from app.services.workspace_io.bundle import WorkspaceBundle
    from tests.conftest import create_user

    await create_card_type(db, key="Organization", label="Organization")
    actor = await create_user(db, email="root-import@example.com", role="admin")
    bundle = WorkspaceBundle(
        manifest={},
        sheets={
            schema.SHEET_CARDS: [
                {"type": "Organization", "name": "Legacy root"},
            ]
        },
    )
    result = await apply_bundle(db, bundle, actor, commit=False)
    assert result.total_failed == 0
    card = await db.scalar(select(Card).where(Card.name == "Legacy root"))
    assert card.organization_cone_state == "unconfirmed_root"


async def test_nonadmin_mixed_import_rejects_before_any_card_write(db):
    import pytest
    from fastapi import HTTPException
    from sqlalchemy import select

    from app.models.card import Card
    from app.services.workspace_io import apply_bundle
    from app.services.workspace_io.bundle import WorkspaceBundle
    from tests.conftest import create_user

    for key in ("Application", "Organization"):
        await create_card_type(db, key=key, label=key)
    actor = await create_user(db, email="member-import@example.com", role="member")
    bundle = WorkspaceBundle(
        manifest={},
        sheets={
            schema.SHEET_CARDS: [
                {"type": "Application", "name": "Imported app"},
                {"type": "Organization", "name": "Imported org"},
            ]
        },
    )
    with pytest.raises(HTTPException) as exc:
        await apply_bundle(db, bundle, actor, commit=False)
    assert exc.value.status_code == 403
    assert not (
        await db.scalars(select(Card).where(Card.name.in_(["Imported app", "Imported org"])))
    ).all()


async def test_nonadmin_cannot_import_organization_assignment(db):
    import pytest
    from fastapi import HTTPException
    from sqlalchemy import delete, select

    from app.models.stakeholder import Stakeholder
    from app.services.workspace_io.applier import apply_selected
    from tests.conftest import create_user

    await create_card_type(db, key="Organization", label="Organization")
    actor = await create_user(db, email="member-assignment-import@example.com", role="member")
    card = await create_card(db, card_type="Organization", name="Existing org")
    assignment = Stakeholder(card_id=card.id, user_id=actor.id, role="responsible")
    db.add(assignment)
    await db.flush()
    bundle = parse_bundle(await build_bundle(db))
    try:
        await db.execute(delete(Stakeholder).where(Stakeholder.id == assignment.id))
        with pytest.raises(HTTPException) as exc:
            await apply_selected(db, bundle, actor, sheets={"Stakeholders"}, dry_run=False)
        assert exc.value.status_code == 403
        assert not (
            await db.scalars(select(Stakeholder).where(Stakeholder.card_id == card.id))
        ).all()
    finally:
        bundle.close()


async def test_imported_orphan_restricts_matching_organization(db):
    from app.services.workspace_io import apply_bundle
    from app.services.workspace_io.bundle import WorkspaceBundle
    from tests.conftest import create_user

    await create_card_type(db, key="Organization", label="Organization")
    actor = await create_user(db, email="orphan-import@example.com", role="admin")
    card = await create_card(db, card_type="Organization", name="Existing org")
    card.organization_cone_state = "connected"
    await db.flush()
    bundle = WorkspaceBundle(
        manifest={},
        sheets={
            schema.SHEET_CARDS: [
                {
                    "type": "Organization",
                    "name": "Existing org",
                    "organization_cone_state": "orphaned",
                }
            ]
        },
    )
    await apply_bundle(db, bundle, actor, commit=False)
    await db.refresh(card)
    assert card.organization_cone_state == "orphaned"


async def test_nonadmin_cannot_import_organization_role_matrix(db):
    import pytest
    from fastapi import HTTPException

    from app.services.workspace_io.applier import apply_selected
    from app.services.workspace_io.bundle import WorkspaceBundle
    from tests.conftest import create_user

    card_type = await create_card_type(db, key="Organization", label="Organization")
    actor = await create_user(db, email="matrix-import@example.com", role="member")
    bundle = WorkspaceBundle(
        manifest={},
        sheets={
            schema.SHEET_CARD_TYPES: [
                {
                    "key": "Organization",
                    "role_permissions": {"member": {"inventory.view": False}},
                }
            ]
        },
    )
    with pytest.raises(HTTPException) as exc:
        await apply_selected(db, bundle, actor, sheets={schema.SHEET_CARD_TYPES}, dry_run=False)
    assert exc.value.status_code == 403
    await db.refresh(card_type)
    assert card_type.role_permissions == {}


async def test_nonadmin_platform_migration_rejects_organization_before_other_writes(db):
    import pytest
    from fastapi import HTTPException
    from sqlalchemy import select

    from app.models.card import Card
    from app.models.migration import Migration, StagedRecord
    from app.services.migration.apply import apply_migration
    from tests.conftest import create_user

    for key in ("Application", "Organization"):
        await create_card_type(db, key=key, label=key)
    actor = await create_user(db, email="platform-member@example.com", role="member")
    migration = Migration(name="Test", file_hash="a" * 64, created_by=actor.id)
    db.add(migration)
    await db.flush()
    for key in ("Application", "Organization"):
        db.add(
            StagedRecord(
                migration_id=migration.id,
                entity_kind="card",
                source_id=key,
                card_type_key=key,
                action="create",
                source_data={"payload": {"type": key, "name": key + " imported"}},
            )
        )
    await db.flush()
    with pytest.raises(HTTPException) as exc:
        await apply_migration(db, migration, actor)
    assert exc.value.status_code == 403
    assert not (await db.scalars(select(Card).where(Card.name.like("% imported")))).all()


async def test_admin_workspace_import_normalizes_organization_role_matrix(db):
    from app.services.workspace_io.applier import apply_selected
    from app.services.workspace_io.bundle import WorkspaceBundle
    from tests.conftest import create_role, create_user

    await create_role(db, key="member", label="Member", permissions={})
    card_type = await create_card_type(db, key="Organization", label="Organization")
    actor = await create_user(db, email="matrix-admin@example.com", role="admin")
    bundle = WorkspaceBundle(
        manifest={},
        sheets={
            schema.SHEET_CARD_TYPES: [
                {
                    "key": "Organization",
                    "role_permissions": {"member": {"inventory.edit": True}},
                }
            ]
        },
    )
    await apply_selected(db, bundle, actor, sheets={schema.SHEET_CARD_TYPES}, dry_run=False)
    await db.refresh(card_type)
    assert card_type.role_permissions["member"]["inventory.edit"] is False


async def test_imported_new_role_is_denied_organization_writes(db):
    from app.services.workspace_io.applier import apply_selected
    from app.services.workspace_io.bundle import WorkspaceBundle
    from tests.conftest import create_user

    card_type = await create_card_type(db, key="Organization", label="Organization")
    actor = await create_user(db, email="new-role-admin@example.com", role="admin")
    bundle = WorkspaceBundle(
        manifest={},
        sheets={
            schema.SHEET_ROLES: [
                {
                    "key": "newrole",
                    "label": "New Role",
                    "permissions": {},
                }
            ]
        },
    )
    await apply_selected(db, bundle, actor, sheets={schema.SHEET_ROLES}, dry_run=False)
    await db.refresh(card_type)
    assert card_type.role_permissions["newrole"]["inventory.edit"] is False


async def test_nonadmin_cannot_import_organization_tag(db):
    import pytest
    from fastapi import HTTPException
    from sqlalchemy import select

    from app.models.tag import CardTag
    from app.services.workspace_io.applier import apply_selected
    from app.services.workspace_io.bundle import WorkspaceBundle
    from tests.conftest import create_tag, create_tag_group, create_user

    await create_card_type(db, key="Organization", label="Organization")
    actor = await create_user(db, email="member-tag-import@example.com", role="member")
    card = await create_card(db, card_type="Organization", name="Position")
    group = await create_tag_group(db, name="Group")
    tag = await create_tag(db, group=group, name="Tag")
    bundle = WorkspaceBundle(
        manifest={},
        sheets={
            schema.SHEET_CARD_TAGS: [
                {
                    "card_type": "Organization",
                    "card_ref": "Position",
                    "group_name": "Group",
                    "tag_name": "Tag",
                }
            ]
        },
    )
    with pytest.raises(HTTPException) as exc:
        await apply_selected(db, bundle, actor, sheets={schema.SHEET_CARD_TAGS}, dry_run=False)
    assert exc.value.status_code == 403
    assert (
        await db.scalar(
            select(CardTag.card_id).where(CardTag.card_id == card.id, CardTag.tag_id == tag.id)
        )
        is None
    )


async def test_workspace_position_role_cell_is_typed_and_validated(db):
    import pytest
    from fastapi import HTTPException

    from app.services.workspace_io.applier import apply_selected
    from app.services.workspace_io.bundle import WorkspaceBundle
    from tests.conftest import create_user

    await create_card_type(db, key="Organization", label="Organization")
    actor = await create_user(db, email="typed-admin@example.com", role="admin")
    bundle = WorkspaceBundle(
        manifest={},
        sheets={
            schema.SHEET_STAKEHOLDER_ROLES: [
                {
                    "card_type_key": "Organization",
                    "key": "manager",
                    "label": "Manager",
                    "is_position_role": "not-a-boolean",
                }
            ]
        },
    )
    with pytest.raises(HTTPException) as exc:
        await apply_selected(
            db, bundle, actor, sheets={schema.SHEET_STAKEHOLDER_ROLES}, dry_run=False
        )
    assert exc.value.status_code == 422


async def test_nonadmin_cannot_import_organization_relation(db):
    import pytest
    from fastapi import HTTPException
    from sqlalchemy import select

    from app.models.relation import Relation
    from app.services.workspace_io.applier import apply_selected
    from app.services.workspace_io.bundle import WorkspaceBundle
    from tests.conftest import create_relation_type, create_user

    for key in ("Organization", "Application"):
        await create_card_type(db, key=key, label=key)
    await create_relation_type(
        db, key="org_app", source_type_key="Organization", target_type_key="Application"
    )
    actor = await create_user(db, email="member-relation-import@example.com", role="member")
    await create_card(db, card_type="Organization", name="Position")
    await create_card(db, card_type="Application", name="App")
    bundle = WorkspaceBundle(
        manifest={},
        sheets={
            schema.SHEET_RELATIONS: [
                {
                    "type": "org_app",
                    "source_type": "Organization",
                    "source_ref": "Position",
                    "target_type": "Application",
                    "target_ref": "App",
                }
            ]
        },
    )
    with pytest.raises(HTTPException) as exc:
        await apply_selected(db, bundle, actor, sheets={schema.SHEET_RELATIONS}, dry_run=False)
    assert exc.value.status_code == 403
    assert await db.scalar(select(Relation.id).where(Relation.type == "org_app")) is None


async def test_nonadmin_cannot_heal_existing_organization_entity(db):
    from dataclasses import replace

    import pytest
    from fastapi import HTTPException

    from app.models.todo import Todo
    from app.services.card_resolver import CardResolver
    from app.services.workspace_io.applier import SectionResult
    from app.services.workspace_io.entities import apply_entity_section
    from app.services.workspace_io.remap import RemapContext, RewriteTally
    from app.services.workspace_io.sections import ENTITY_SECTIONS
    from tests.conftest import create_user

    await create_card_type(db, key="Organization", label="Organization")
    actor = await create_user(db, email="member-heal@example.com", role="member")
    card = await create_card(db, card_type="Organization", name="Position")
    todo = Todo(description="Review", card_id=card.id, link="/cards/old")
    db.add(todo)
    await db.flush()
    bundle = parse_bundle(await build_bundle(db))

    def rewrite(kwargs, _ctx):
        kwargs["link"] = "/cards/new"
        return RewriteTally(counts={"remapped": 1})

    section = replace(next(s for s in ENTITY_SECTIONS if s.sheet == "Todos"), rewrite=rewrite)
    try:
        resolver = await CardResolver.load(db, {"Organization"})
        with pytest.raises(HTTPException) as exc:
            await apply_entity_section(
                db,
                section,
                bundle,
                SectionResult(sheet="Todos"),
                resolver,
                {actor.email: actor.id},
                RemapContext(),
                actor=actor,
            )
        assert exc.value.status_code == 403
        assert todo.link == "/cards/old"
    finally:
        bundle.close()


async def test_nonadmin_import_cannot_rescore_unrelated_organization(db):
    from app.services.workspace_io.applier import apply_selected
    from app.services.workspace_io.bundle import WorkspaceBundle
    from tests.conftest import create_user

    for key in ("Organization", "Application"):
        await create_card_type(db, key=key, label=key)
    actor = await create_user(db, email="member-derived-import@example.com", role="member")
    org = await create_card(db, card_type="Organization", name="Position")
    org.data_quality = -1
    await db.flush()
    bundle = WorkspaceBundle(
        manifest={},
        sheets={
            schema.SHEET_CARDS: [
                {
                    "type": "Application",
                    "name": "App",
                }
            ]
        },
    )
    result = await apply_selected(db, bundle, actor, sheets={schema.SHEET_CARDS}, dry_run=False)
    assert result.total_failed == 0
    await db.refresh(org)
    assert org.data_quality == -1


async def test_repair_authorizes_stored_todo_owner_when_bundle_names_another_card(db):
    from dataclasses import replace

    import pytest
    from fastapi import HTTPException

    from app.models.todo import Todo
    from app.services.card_resolver import CardResolver
    from app.services.workspace_io.applier import SectionResult
    from app.services.workspace_io.entities import apply_entity_section
    from app.services.workspace_io.remap import RemapContext, RewriteTally
    from app.services.workspace_io.sections import ENTITY_SECTIONS
    from tests.conftest import create_user

    await create_card_type(db, key="Organization")
    await create_card_type(db, key="Application")
    actor = await create_user(db, email="stored-owner@example.com", role="member")
    owner = await create_card(db, card_type="Organization", name="Stored Owner")
    other = await create_card(db, card_type="Application", name="Bundle Owner")
    todo = Todo(description="Review", card_id=owner.id, link="/cards/old")
    db.add(todo)
    await db.flush()
    bundle = parse_bundle(await build_bundle(db))
    row = next(row for row in bundle.rows("Todos") if str(row["id"]) == str(todo.id))
    row.update(
        {"card_id__id": str(other.id), "card_id__type": "Application", "card_id__ref": other.name}
    )

    def rewrite(kwargs, _ctx):
        kwargs["link"] = "/cards/new"
        return RewriteTally(counts={"remapped": 1})

    section = replace(next(s for s in ENTITY_SECTIONS if s.sheet == "Todos"), rewrite=rewrite)
    try:
        resolver = await CardResolver.load(db, {"Organization", "Application"})
        with pytest.raises(HTTPException) as exc:
            await apply_entity_section(
                db,
                section,
                bundle,
                SectionResult(sheet="Todos"),
                resolver,
                {actor.email: actor.id},
                RemapContext(),
                actor=actor,
            )
        assert exc.value.status_code == 403
        await db.refresh(todo)
        assert todo.card_id == owner.id
        assert todo.link == "/cards/old"
    finally:
        bundle.close()


async def test_role_import_preserves_view_revocation_from_another_committed_session(test_engine):
    from uuid import uuid4

    from sqlalchemy import delete, select, update
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.card_type import CardType
    from app.models.role import Role
    from app.models.user import User
    from app.services.workspace_io.applier import SectionResult, _make_config_applier
    from app.services.workspace_io.bundle import WorkspaceBundle
    from tests.conftest import create_role, create_user

    suffix = uuid4().hex[:10]
    role_key = "import_" + suffix
    reader_key = "view_" + suffix
    sessions = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    async with sessions() as writer, sessions() as importer:
        await create_role(writer, key=reader_key, permissions={"inventory.view": True})
        organization = await create_card_type(
            writer,
            key="Organization",
            role_permissions={reader_key: {"inventory.view": True}},
        )
        actor = await create_user(writer, email=f"role-import-{suffix}@example.com", role="admin")
        await writer.commit()
        actor_id = actor.id
        try:
            cached = await importer.get(CardType, organization.id)
            # Keep the importer's identity map stale while a separate editor commits a revocation.
            await writer.execute(
                update(CardType)
                .where(CardType.key == "Organization")
                .values(role_permissions={reader_key: {"inventory.view": False}})
            )
            await writer.commit()
            assert cached.role_permissions[reader_key]["inventory.view"] is True
            bundle = WorkspaceBundle(
                manifest={},
                sheets={
                    schema.SHEET_ROLES: [
                        {"key": role_key, "label": "Imported Role", "permissions": {}},
                    ]
                },
            )
            section = next(s for s in schema.CONFIG_SECTIONS if s.model is Role)
            imported_actor = await importer.get(User, actor_id)
            await _make_config_applier(section, imported_actor)(
                importer, bundle, SectionResult(sheet=schema.SHEET_ROLES), False
            )
            await importer.commit()
            async with sessions() as verifier:
                matrix = await verifier.scalar(
                    select(CardType.role_permissions).where(CardType.key == "Organization")
                )
                assert matrix[reader_key]["inventory.view"] is False
                assert matrix[role_key]["inventory.create"] is False
                assert matrix[role_key]["inventory.edit"] is False
                assert matrix[role_key]["inventory.delete"] is False
        finally:
            await importer.rollback()
            await writer.execute(delete(User).where(User.id == actor_id))
            await writer.execute(delete(CardType).where(CardType.key == "Organization"))
            await writer.execute(delete(Role).where(Role.key.in_([role_key, reader_key])))
            await writer.commit()
