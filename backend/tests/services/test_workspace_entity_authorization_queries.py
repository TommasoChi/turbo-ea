import pytest
from sqlalchemy import event, select

from app.models.card import Card
from app.models.todo import Todo
from app.services.card_resolver import CardResolver
from app.services.workspace_io.applier import SectionResult
from app.services.workspace_io.bundle import WorkspaceBundle
from app.services.workspace_io.entities import apply_entity_section
from app.services.workspace_io.sections import ENTITY_SECTIONS
from tests.conftest import create_card, create_card_type, create_user


@pytest.mark.parametrize("role,max_queries", [("admin", 0), ("member", 1)])
async def test_entity_import_batches_organization_lookup(db, monkeypatch, role, max_queries):
    from uuid import uuid4

    await create_card_type(db, key="Application")
    actor = await create_user(db, email=f"{role}-batch@example.com", role=role)
    cards = [await create_card(db, card_type="Application", name=f"App {i}") for i in range(3)]
    resolver = await CardResolver.load(db, {"Application"})
    bundle = WorkspaceBundle(
        manifest={},
        sheets={
            "Todos": [
                {
                    "id": str(uuid4()),
                    "description": f"Review {i}",
                    "status": "open",
                    "card_id__type": "Application",
                    "card_id__ref": card.name,
                }
                for i, card in enumerate(cards)
            ]
        },
    )
    queries = 0
    connection = (await db.connection()).sync_connection

    def counted(conn, cursor, statement, parameters, context, executemany):
        nonlocal queries
        compiled = context.compiled
        descriptions = getattr(getattr(compiled, "statement", None), "column_descriptions", ())
        if any(col.get("entity") is Card for col in descriptions):
            queries += 1

    event.listen(connection, "before_cursor_execute", counted)
    result = SectionResult(sheet="Todos")
    try:
        await apply_entity_section(
            db,
            next(s for s in ENTITY_SECTIONS if s.sheet == "Todos"),
            bundle,
            result,
            resolver,
            {},
            actor=actor,
        )
        assert result.created == 3
        assert result.failed == result.conflict == 0
        assert queries <= max_queries
        assert len((await db.scalars(select(Todo))).all()) == 3
    finally:
        event.remove(connection, "before_cursor_execute", counted)
        bundle.close()


@pytest.mark.parametrize("role,max_queries", [("admin", 0), ("member", 1)])
@pytest.mark.parametrize("sheet", ["CardTags", "Relations"])
async def test_link_import_batches_organization_lookup(db, role, max_queries, sheet):
    from app.services.workspace_io.applier import _apply_card_tags, _apply_relations
    from tests.conftest import create_relation_type, create_tag, create_tag_group

    await create_card_type(db, key="Application")
    actor = await create_user(db, email=f"{role}-{sheet}@example.com", role=role)
    cards = [await create_card(db, card_type="Application", name=f"App {i}") for i in range(4)]
    if sheet == "CardTags":
        group = await create_tag_group(db, name="Group")
        await create_tag(db, group=group, name="Tag")
        rows = [
            {
                "card_type": "Application",
                "card_ref": card.name,
                "group_name": "Group",
                "tag_name": "Tag",
            }
            for card in cards[:3]
        ]
        apply = _apply_card_tags
    else:
        await create_relation_type(
            db, key="app_app", source_type_key="Application", target_type_key="Application"
        )
        rows = [
            {
                "type": "app_app",
                "source_type": "Application",
                "source_ref": card.name,
                "target_type": "Application",
                "target_ref": cards[3].name,
            }
            for card in cards[:3]
        ]
        apply = _apply_relations
    bundle = WorkspaceBundle(manifest={}, sheets={sheet: rows})
    queries = 0
    connection = (await db.connection()).sync_connection

    def counted(conn, cursor, statement, parameters, context, executemany):
        nonlocal queries
        compiled = context.compiled
        query = getattr(compiled, "statement", None)
        descriptions = getattr(query, "column_descriptions", ())
        if any(col.get("entity") is Card for col in descriptions):
            selected = {col.get("name") for col in descriptions}
            if selected <= {"id", "type", "Card"}:
                queries += 1

    event.listen(connection, "before_cursor_execute", counted)
    result = SectionResult(sheet=sheet)
    try:
        await apply(db, bundle, result, False, user=actor)
        assert result.created == 3
        assert result.failed == result.conflict == 0
        assert queries <= max_queries
    finally:
        event.remove(connection, "before_cursor_execute", counted)
        bundle.close()
