"""Integration tests for the generic backend extension SDK 1.2 bridges."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.models.document import Document
from app.models.event import Event
from app.models.file_attachment import FileAttachment
from app.models.notification import Notification
from app.models.stakeholder import Stakeholder
from app.services.extensions import sdk
from app.services.extensions.bridges import build_request_context
from app.services.extensions.sdk import CardRef, ExtensionBridgeError
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)


async def _product_context(db):
    await create_role(db, key="admin", permissions={"*": True})
    actor = await create_user(db, role="admin")
    for key in ("BusinessContext", "Platform", "Application"):
        await create_card_type(db, key=key, label=key)

    product = await create_card(
        db,
        card_type="BusinessContext",
        subtype="businessProduct",
        name="Cloud Backup",
        user_id=actor.id,
        lifecycle={"phase": "Invest"},
        attributes={"productStage": "Growth", "private": "not requested"},
    )
    platform = await create_card(
        db,
        card_type="Platform",
        subtype="digital",
        name="Cloud Platform",
        user_id=actor.id,
    )
    unlinked_platform = await create_card(
        db,
        card_type="Platform",
        subtype="digital",
        name="Other Platform",
        user_id=actor.id,
    )
    physical_platform = await create_card(
        db,
        card_type="Platform",
        subtype="physical",
        name="Physical Platform",
        user_id=actor.id,
    )
    direct = await create_card(db, card_type="Application", name="Direct App", user_id=actor.id)
    via = await create_card(db, card_type="Application", name="Via App", user_id=actor.id)
    both = await create_card(db, card_type="Application", name="Both App", user_id=actor.id)

    await create_relation_type(
        db,
        key="relPlatformToBusinessProduct",
        source_type_key="Platform",
        target_type_key="BusinessContext",
    )
    await create_relation_type(
        db,
        key="relAppToBizCtx",
        source_type_key="Application",
        target_type_key="BusinessContext",
    )
    await create_relation_type(
        db,
        key="relPlatformToApp",
        source_type_key="Platform",
        target_type_key="Application",
    )

    await create_relation(
        db,
        type_key="relPlatformToBusinessProduct",
        source_id=platform.id,
        target_id=product.id,
    )
    await create_relation(
        db,
        type_key="relPlatformToBusinessProduct",
        source_id=physical_platform.id,
        target_id=product.id,
    )
    await create_relation(
        db,
        type_key="relAppToBizCtx",
        source_id=direct.id,
        target_id=product.id,
    )
    await create_relation(
        db,
        type_key="relAppToBizCtx",
        source_id=both.id,
        target_id=product.id,
    )
    await create_relation(
        db,
        type_key="relPlatformToApp",
        source_id=platform.id,
        target_id=via.id,
    )
    await create_relation(
        db,
        type_key="relPlatformToApp",
        source_id=platform.id,
        target_id=both.id,
    )

    return {
        "actor": actor,
        "product": product,
        "platform": platform,
        "unlinked_platform": unlinked_platform,
        "physical_platform": physical_platform,
        "direct": direct,
        "via": via,
        "both": both,
    }


async def _dependency_context(db):
    await create_role(db, key="admin", permissions={"*": True})
    actor = await create_user(db, role="admin")
    for key in (
        "BusinessContext",
        "Platform",
        "Application",
        "ITComponent",
        "TechCategory",
    ):
        await create_card_type(db, key=key, label=key)

    product_1 = await create_card(
        db,
        card_type="BusinessContext",
        subtype="businessProduct",
        name="Cloud Backup",
        user_id=actor.id,
        attributes={"technology": "Backup", "secret": "product-secret"},
    )
    product_2 = await create_card(
        db,
        card_type="BusinessContext",
        subtype="businessProduct",
        name="Archive Service",
        user_id=actor.id,
    )
    platform = await create_card(
        db,
        card_type="Platform",
        subtype="digital",
        name="Cloud Platform",
        user_id=actor.id,
    )
    physical_platform = await create_card(
        db,
        card_type="Platform",
        subtype="physical",
        name="Physical Platform",
        user_id=actor.id,
    )
    app_1 = await create_card(
        db,
        card_type="Application",
        name="Backup API",
        user_id=actor.id,
    )
    app_2 = await create_card(
        db,
        card_type="Application",
        name="Archive API",
        user_id=actor.id,
    )
    hidden_app = await create_card(
        db,
        card_type="Application",
        name="Restricted Connector",
        user_id=actor.id,
    )
    inactive_app = await create_card(
        db,
        card_type="Application",
        name="Retired Connector",
        user_id=actor.id,
        status="ARCHIVED",
    )
    itc = await create_card(
        db,
        card_type="ITComponent",
        name="PostgreSQL",
        user_id=actor.id,
        lifecycle={"phase": "End of Life"},
        attributes={
            "technology": "PostgreSQL",
            "version": "14",
            "secret": "component-secret",
        },
    )
    tech_category = await create_card(
        db,
        card_type="TechCategory",
        name="Database",
        user_id=actor.id,
    )

    relation_types = (
        ("relAppToBizCtx", "Application", "BusinessContext"),
        ("relPlatformToBusinessProduct", "Platform", "BusinessContext"),
        ("relPlatformToApp", "Platform", "Application"),
        ("relAppToITC", "Application", "ITComponent"),
        ("relPlatformToITC", "Platform", "ITComponent"),
        ("relITCToTechCategory", "ITComponent", "TechCategory"),
    )
    for key, source_type, target_type in relation_types:
        await create_relation_type(
            db,
            key=key,
            label=f"{source_type} to {target_type}",
            source_type_key=source_type,
            target_type_key=target_type,
        )

    relations = []
    for type_key, source, target in (
        ("relAppToBizCtx", app_1, product_1),
        ("relAppToITC", app_1, itc),
        ("relAppToITC", app_2, itc),
        ("relAppToBizCtx", app_2, product_2),
        ("relPlatformToBusinessProduct", platform, product_1),
        ("relPlatformToITC", platform, itc),
        ("relPlatformToApp", platform, app_1),
        ("relAppToITC", hidden_app, itc),
    ):
        relations.append(
            await create_relation(
                db,
                type_key=type_key,
                source_id=source.id,
                target_id=target.id,
                attributes={"usageType": "runtime", "secret": "relation-secret"},
            )
        )
    await create_relation(
        db,
        type_key="relITCToTechCategory",
        source_id=itc.id,
        target_id=tech_category.id,
    )

    return {
        "actor": actor,
        "product_1": product_1,
        "product_2": product_2,
        "platform": platform,
        "physical_platform": physical_platform,
        "app_1": app_1,
        "app_2": app_2,
        "hidden_app": hidden_app,
        "inactive_app": inactive_app,
        "itc": itc,
        "tech_category": tech_category,
        "relations": relations,
    }


async def _read_dependency_graph(context, root_id, **overrides):
    arguments = {
        "allowed_card_types": (
            "BusinessContext",
            "Platform",
            "Application",
            "ITComponent",
        ),
        "allowed_relation_types": (
            "relAppToBizCtx",
            "relPlatformToBusinessProduct",
            "relPlatformToApp",
            "relAppToITC",
            "relPlatformToITC",
        ),
        "max_depth": 3,
        "card_attribute_keys": ("technology", "version"),
        "relation_attribute_keys": ("usageType",),
    }
    arguments.update(overrides)
    return await context.core_query.read_dependency_subgraph(root_id, **arguments)


def _bridge_actor():
    return SimpleNamespace(
        id=uuid.uuid4(),
        email="architect@example.com",
        display_name="Architect",
        role="admin",
    )


def _card(*, card_type, name, subtype=None, lifecycle=None, attributes=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        type=card_type,
        subtype=subtype,
        name=name,
        reference=None,
        lifecycle=lifecycle or {},
        attributes=attributes or {},
        parent_id=None,
        description=None,
    )


def _query_result(*, scalar=None, rows=()):
    return SimpleNamespace(
        scalar_one_or_none=lambda: scalar,
        all=lambda: list(rows),
    )


async def test_dependency_subgraph_projects_visible_bfs_without_database_fixture():
    root = _card(
        card_type="ITComponent",
        name="PostgreSQL",
        lifecycle={"phase": "End of Life"},
        attributes={"technology": "PostgreSQL", "version": "14", "secret": "hidden"},
    )
    application = _card(card_type="Application", name="Backup API")
    product = _card(
        card_type="BusinessContext",
        subtype="businessProduct",
        name="Cloud Backup",
    )
    app_to_itc = SimpleNamespace(
        type="relAppToITC",
        source_id=application.id,
        target_id=root.id,
        attributes={"usageType": "runtime", "secret": "hidden"},
        description=None,
    )
    app_to_product = SimpleNamespace(
        type="relAppToBizCtx",
        source_id=application.id,
        target_id=product.id,
        attributes={"usageType": "support"},
        description=None,
    )
    app_to_itc_type = SimpleNamespace(
        label="Application to IT Component",
        reverse_label="Used by Application",
    )
    app_to_product_type = SimpleNamespace(
        label="Application to Business Product",
        reverse_label="Supported by Application",
    )
    db = SimpleNamespace(
        execute=AsyncMock(
            side_effect=[
                _query_result(scalar=root),
                _query_result(rows=[(app_to_itc, app_to_itc_type)]),
                _query_result(scalar=application),
                _query_result(
                    rows=[
                        (app_to_itc, app_to_itc_type),
                        (app_to_product, app_to_product_type),
                    ]
                ),
                _query_result(scalar=product),
                _query_result(rows=[(app_to_product, app_to_product_type)]),
            ]
        )
    )
    context = build_request_context("technology-what-if", db, _bridge_actor())

    with patch(
        "app.services.extensions.bridges.PermissionService.check_permission",
        new=AsyncMock(return_value=True),
    ):
        graph = await _read_dependency_graph(context, root.id)

    assert graph.partial is False
    assert {node.id for node in graph.nodes} == {root.id, application.id, product.id}
    assert [(edge.source_id, edge.target_id) for edge in graph.edges] == [
        (application.id, product.id),
        (application.id, root.id),
    ]
    root_node = next(node for node in graph.nodes if node.id == root.id)
    assert root_node.lifecycle == {"phase": "End of Life"}
    assert root_node.attributes == {"technology": "PostgreSQL", "version": "14"}
    assert graph.edges[1].attributes == {"usageType": "runtime"}
    assert db.execute.await_count == 6


async def test_dependency_subgraph_marks_permission_filtered_neighbor_partial_without_db():
    root = _card(card_type="ITComponent", name="PostgreSQL")
    hidden = _card(card_type="Application", name="Restricted Connector")
    relation = SimpleNamespace(
        type="relAppToITC",
        source_id=hidden.id,
        target_id=root.id,
        attributes={},
        description=None,
    )
    relation_type = SimpleNamespace(
        label="Application to IT Component",
        reverse_label="Used by Application",
    )
    db = SimpleNamespace(
        execute=AsyncMock(
            side_effect=[
                _query_result(scalar=root),
                _query_result(rows=[(relation, relation_type)]),
                _query_result(scalar=hidden),
            ]
        )
    )
    context = build_request_context("technology-what-if", db, _bridge_actor())

    with patch(
        "app.services.extensions.bridges.PermissionService.check_permission",
        new=AsyncMock(side_effect=[True, False]),
    ):
        graph = await _read_dependency_graph(context, root.id)

    assert graph.partial is True
    assert [node.id for node in graph.nodes] == [root.id]
    assert graph.edges == ()


async def test_dependency_subgraph_validates_before_database_access():
    db = SimpleNamespace(execute=AsyncMock())
    context = build_request_context(
        "technology-what-if",
        db,
        SimpleNamespace(
            id=uuid.uuid4(),
            email="architect@example.com",
            display_name="Architect",
            role="admin",
        ),
    )

    with pytest.raises(ExtensionBridgeError) as raised:
        await _read_dependency_graph(
            context,
            uuid.uuid4(),
            allowed_card_types=("Unknown",),
        )

    assert raised.value.code == "invalid_dependency_query"
    db.execute.assert_not_awaited()


async def test_dependency_subgraph_traverses_many_to_many_graph_deterministically(db):
    env = await _dependency_context(db)
    context = build_request_context("technology-what-if", db, env["actor"])

    graph = await _read_dependency_graph(context, env["itc"].id)

    expected_ids = {
        env[key].id
        for key in (
            "product_1",
            "product_2",
            "platform",
            "app_1",
            "app_2",
            "hidden_app",
            "itc",
        )
    }
    assert graph.root_id == env["itc"].id
    assert graph.partial is False
    assert {node.id for node in graph.nodes} == expected_ids
    assert len(graph.nodes) == len({node.id for node in graph.nodes})
    assert len(graph.edges) == len(
        {(edge.type, edge.source_id, edge.target_id) for edge in graph.edges}
    )
    assert env["tech_category"].id not in {node.id for node in graph.nodes}

    root = next(node for node in graph.nodes if node.id == env["itc"].id)
    assert root.lifecycle == {"phase": "End of Life"}
    assert root.attributes == {"technology": "PostgreSQL", "version": "14"}
    assert all("secret" not in node.attributes for node in graph.nodes)
    assert all(edge.attributes == {"usageType": "runtime"} for edge in graph.edges)
    assert all("secret" not in edge.attributes for edge in graph.edges)

    app_to_itc = next(
        edge
        for edge in graph.edges
        if edge.type == "relAppToITC" and edge.source_id == env["app_1"].id
    )
    assert app_to_itc.target_id == env["itc"].id
    assert list(graph.nodes) == sorted(
        graph.nodes,
        key=lambda node: (node.type, node.name.casefold(), str(node.id)),
    )
    assert list(graph.edges) == sorted(
        graph.edges,
        key=lambda edge: (edge.type, str(edge.source_id), str(edge.target_id)),
    )


async def test_dependency_subgraph_omits_invisible_neighbor_and_marks_partial(db):
    env = await _dependency_context(db)
    context = build_request_context("technology-what-if", db, env["actor"])

    async def visible_except_hidden(_db, _user, _app, card_id, _card_permission):
        return card_id != env["hidden_app"].id

    with patch(
        "app.services.extensions.bridges.PermissionService.check_permission",
        side_effect=visible_except_hidden,
    ):
        graph = await _read_dependency_graph(context, env["itc"].id)

    assert graph.partial is True
    assert env["hidden_app"].id not in {node.id for node in graph.nodes}
    assert all(
        env["hidden_app"].id not in (edge.source_id, edge.target_id)
        for edge in graph.edges
    )


@pytest.mark.parametrize(
    "overrides",
    [
        {"allowed_card_types": ("Unknown",)},
        {"allowed_relation_types": ("unknownRelation",)},
        {"card_attribute_keys": ("secret",)},
        {"relation_attribute_keys": ("secret",)},
        {"max_depth": 0},
        {"max_depth": 4},
    ],
)
async def test_dependency_subgraph_rejects_queries_outside_server_allowlists(db, overrides):
    env = await _dependency_context(db)
    context = build_request_context("technology-what-if", db, env["actor"])

    with pytest.raises(ExtensionBridgeError) as raised:
        await _read_dependency_graph(context, env["itc"].id, **overrides)

    assert raised.value.code == "invalid_dependency_query"


@pytest.mark.parametrize(
    ("root_key", "error_code"),
    [
        ("inactive_app", "reference_not_found"),
        ("tech_category", "reference_type_mismatch"),
        ("physical_platform", "reference_subtype_mismatch"),
    ],
)
async def test_dependency_subgraph_rejects_invalid_roots(db, root_key, error_code):
    env = await _dependency_context(db)
    context = build_request_context("technology-what-if", db, env["actor"])

    with pytest.raises(ExtensionBridgeError) as raised:
        await _read_dependency_graph(context, env[root_key].id)

    assert raised.value.code == error_code


async def test_dependency_subgraph_rejects_invisible_root(db):
    env = await _dependency_context(db)
    context = build_request_context("technology-what-if", db, env["actor"])

    with patch(
        "app.services.extensions.bridges.PermissionService.check_permission",
        new=AsyncMock(return_value=False),
    ):
        with pytest.raises(ExtensionBridgeError) as raised:
            await _read_dependency_graph(context, env["itc"].id)

    assert raised.value.code == "permission_denied"


async def test_product_context_query_merges_applications_with_provenance(db):
    env = await _product_context(db)
    context = build_request_context("swot-analysis", db, env["actor"])

    platforms = await context.core_query.list_product_platforms(env["product"].id)
    assert [(item.id, item.subtype) for item in platforms] == [(env["platform"].id, "digital")]

    applications = await context.core_query.list_product_applications(
        env["product"].id,
        [env["platform"].id],
    )
    by_id = {item.id: item for item in applications}

    assert set(by_id) == {env["direct"].id, env["via"].id, env["both"].id}
    assert by_id[env["direct"].id].provenance == "direct"
    assert by_id[env["direct"].id].via_platform_ids == ()
    assert by_id[env["via"].id].provenance == "via_platform"
    assert by_id[env["via"].id].via_platform_ids == (env["platform"].id,)
    assert by_id[env["both"].id].provenance == "both"
    assert by_id[env["both"].id].via_platform_ids == (env["platform"].id,)


async def test_product_context_rejects_platform_not_linked_to_product(db):
    env = await _product_context(db)
    context = build_request_context("swot-analysis", db, env["actor"])

    try:
        await context.core_query.list_product_applications(
            env["product"].id,
            [env["unlinked_platform"].id],
        )
    except ExtensionBridgeError as exc:
        assert exc.code == "validation_failed"
        assert exc.details["invalid_platform_ids"] == [str(env["unlinked_platform"].id)]
    else:
        raise AssertionError("An unrelated platform must fail closed")


async def test_resolve_cards_validates_subtype_and_filters_snapshot_attributes(db):
    env = await _product_context(db)
    context = build_request_context("swot-analysis", db, env["actor"])

    cards = await context.core_query.resolve_cards(
        [
            CardRef(
                id=env["product"].id,
                expected_type="BusinessContext",
                expected_subtype="businessProduct",
                attribute_keys=("productStage",),
            )
        ]
    )
    assert cards[0].lifecycle == {"phase": "Invest"}
    assert cards[0].attributes == {"productStage": "Growth"}

    try:
        await context.core_query.resolve_cards(
            [
                CardRef(
                    id=env["physical_platform"].id,
                    expected_type="Platform",
                    expected_subtype="digital",
                )
            ]
        )
    except ExtensionBridgeError as exc:
        assert exc.code == "reference_subtype_mismatch"
    else:
        raise AssertionError("A subtype mismatch must fail closed")


async def test_core_query_gateway_fails_closed_without_inventory_permission(db):
    env = await _product_context(db)
    await create_role(db, key="restricted", permissions={})
    restricted = await create_user(
        db,
        role="restricted",
        email="restricted@example.com",
    )
    context = build_request_context("swot-analysis", db, restricted)

    try:
        await context.core_query.list_product_platforms(env["product"].id)
    except ExtensionBridgeError as exc:
        assert exc.code == "permission_denied"
    else:
        raise AssertionError("A user without inventory access must fail closed")


async def test_core_query_gateway_checks_current_actor_stakeholder_role(db):
    env = await _product_context(db)
    db.add(
        Stakeholder(
            card_id=env["product"].id,
            user_id=env["actor"].id,
            role="responsible",
        )
    )
    await db.flush()
    context = build_request_context("swot-analysis", db, env["actor"])

    assert await context.core_query.has_stakeholder_role(
        env["product"].id,
        "responsible",
    )
    assert not await context.core_query.has_stakeholder_role(
        env["product"].id,
        "observer",
    )


async def test_audit_bridge_persists_generic_entity_and_skips_noop(db):
    env = await _product_context(db)
    context = build_request_context("swot-analysis", db, env["actor"])
    analysis_id = uuid.uuid4()

    changed = await context.audit.publish(
        event_type="ext.swot-analysis.analysis.approved",
        entity_type="ext.swot-analysis.analysis",
        entity_id=analysis_id,
        data={"status": "Approved"},
        related_card_id=env["product"].id,
        changed=True,
    )
    unchanged = await context.audit.publish(
        event_type="ext.swot-analysis.analysis.approved",
        entity_type="ext.swot-analysis.analysis",
        entity_id=analysis_id,
        data={"status": "Approved"},
        related_card_id=env["product"].id,
        changed=False,
    )

    assert changed is True
    assert unchanged is False
    rows = (
        (
            await db.execute(
                select(Event).where(
                    Event.entity_type == "ext.swot-analysis.analysis",
                    Event.entity_id == analysis_id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].card_id == env["product"].id
    assert rows[0].user_id == env["actor"].id
    assert rows[0].data["status"] == "Approved"

    count = (
        await db.execute(
            select(func.count(Event.id)).where(
                Event.entity_type == "ext.swot-analysis.analysis",
                Event.entity_id == analysis_id,
            )
        )
    ).scalar_one()
    assert count == 1


async def test_resource_bridge_owns_links_and_files_by_generic_entity(db):
    env = await _product_context(db)
    context = build_request_context("swot-analysis", db, env["actor"])
    analysis_id = uuid.uuid4()
    entity_type = "ext.swot-analysis.analysis"

    link = await context.resources.add_link(
        entity_type=entity_type,
        entity_id=analysis_id,
        name="Market evidence",
        url="https://example.com/market",
        resource_type="web",
        required_permission="ext.swot-analysis.edit",
    )
    attachment = await context.resources.upload_file(
        entity_type=entity_type,
        entity_id=analysis_id,
        name="evidence.pdf",
        mime_type="application/pdf",
        data=b"evidence-bytes",
        category="research",
        required_permission="ext.swot-analysis.edit",
    )

    items = await context.resources.list(
        entity_type=entity_type,
        entity_id=analysis_id,
        required_permission="ext.swot-analysis.view",
    )
    content = await context.resources.read_file(
        attachment.id,
        entity_type=entity_type,
        entity_id=analysis_id,
        required_permission="ext.swot-analysis.view",
    )

    assert {(item.kind, item.name) for item in items} == {
        ("link", "Market evidence"),
        ("file", "evidence.pdf"),
    }
    assert content.data == b"evidence-bytes"
    assert content.mime_type == "application/pdf"

    document_row = (await db.execute(select(Document).where(Document.id == link.id))).scalar_one()
    file_row = (
        await db.execute(select(FileAttachment).where(FileAttachment.id == attachment.id))
    ).scalar_one()
    assert document_row.card_id is None
    assert document_row.entity_type == entity_type
    assert document_row.entity_id == analysis_id
    assert file_row.card_id is None
    assert file_row.entity_type == entity_type
    assert file_row.entity_id == analysis_id

    assert await context.resources.delete(
        link.id,
        kind="link",
        entity_type=entity_type,
        entity_id=analysis_id,
        required_permission="ext.swot-analysis.edit",
    )
    assert await context.resources.delete(
        attachment.id,
        kind="file",
        entity_type=entity_type,
        entity_id=analysis_id,
        required_permission="ext.swot-analysis.edit",
    )
    assert (
        await context.resources.list(
            entity_type=entity_type,
            entity_id=analysis_id,
            required_permission="ext.swot-analysis.view",
        )
        == []
    )
    deletion_events = (
        (
            await db.execute(
                select(Event.event_type).where(
                    Event.entity_type == entity_type,
                    Event.entity_id == analysis_id,
                    Event.event_type.like("ext.swot-analysis.resource.%_deleted"),
                )
            )
        )
        .scalars()
        .all()
    )
    assert set(deletion_events) == {
        "ext.swot-analysis.resource.link_deleted",
        "ext.swot-analysis.resource.file_deleted",
    }


async def test_notification_bridge_filters_recipients_and_is_in_app_only(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(
        db,
        key="reviewer",
        permissions={"ext.swot-analysis.review": True},
    )
    await create_role(db, key="member", permissions={})
    actor = await create_user(db, role="admin", email="actor@example.com")
    reviewer = await create_user(db, role="reviewer", email="reviewer@example.com")
    reviewer.notification_preferences = {
        "in_app": {"ext.swot-analysis.review.requested": True},
        "email": {"ext.swot-analysis.review.requested": True},
    }
    denied = await create_user(db, role="member", email="denied@example.com")
    inactive = await create_user(db, role="reviewer", email="inactive@example.com")
    inactive.is_active = False
    await db.flush()
    context = build_request_context("swot-analysis", db, actor)

    with patch(
        "app.services.email_service.send_notification_email",
        new_callable=AsyncMock,
    ) as send_email:
        created = await context.notifications.send_many(
            notification_type="ext.swot-analysis.review.requested",
            title="SWOT review requested",
            message="Cloud Backup is ready for review",
            link="/ext/swot-analysis/product-swot/analysis-1",
            data={"analysis_id": "analysis-1"},
            explicit_recipient_ids=[
                reviewer.id,
                reviewer.id,
                denied.id,
                inactive.id,
                actor.id,
            ],
            required_permission="ext.swot-analysis.review",
            channel="in_app",
            changed=True,
        )
        send_email.assert_not_awaited()
    unscoped = await context.notifications.send_many(
        notification_type="ext.swot-analysis.review.reminder",
        title="SWOT review reminder",
        message="Cloud Backup still needs review",
        link=None,
        data=None,
        explicit_recipient_ids=[inactive.id, uuid.uuid4(), reviewer.id],
        required_permission=None,
    )
    noop = await context.notifications.send_many(
        notification_type="ext.swot-analysis.review.requested",
        title="SWOT review requested",
        message="Cloud Backup is ready for review",
        link="/ext/swot-analysis/product-swot/analysis-1",
        data={"analysis_id": "analysis-1"},
        explicit_recipient_ids=[reviewer.id],
        required_permission="ext.swot-analysis.review",
        channel="in_app",
        changed=False,
    )

    assert [notification.user_id for notification in created] == [reviewer.id]
    assert [notification.user_id for notification in unscoped] == [reviewer.id]
    assert noop == []
    rows = (
        (
            await db.execute(
                select(Notification).where(
                    Notification.type == "ext.swot-analysis.review.requested"
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].user_id == reviewer.id
    assert rows[0].actor_id == actor.id
    assert rows[0].is_emailed is False


async def test_mutating_bridges_never_commit_the_request_transaction(db):
    env = await _product_context(db)
    context = build_request_context("swot-analysis", db, env["actor"])
    analysis_id = uuid.uuid4()

    with patch.object(db, "commit", new_callable=AsyncMock) as commit:
        await context.audit.publish(
            event_type="ext.swot-analysis.analysis.saved",
            entity_type="ext.swot-analysis.analysis",
            entity_id=analysis_id,
            data={"status": "Draft"},
        )
        await context.resources.add_link(
            entity_type="ext.swot-analysis.analysis",
            entity_id=analysis_id,
            name="Source",
            url="https://example.com/source",
            resource_type="web",
            required_permission="ext.swot-analysis.edit",
        )
        await context.notifications.send_many(
            notification_type="ext.swot-analysis.analysis.saved",
            title="Saved",
            message="Draft saved",
            link=None,
            data=None,
            explicit_recipient_ids=[],
            required_permission=None,
        )

        commit.assert_not_awaited()


async def test_public_extension_context_dependency_exposes_all_bridges(db):
    await create_role(db, key="admin", permissions={"*": True})
    actor = await create_user(db, role="admin")

    factory = getattr(sdk, "extension_context", None)
    assert callable(factory)
    context = await factory("swot-analysis")(db, actor)

    assert isinstance(context, sdk.ExtensionRequestContext)
    assert context.key == "swot-analysis"
    assert context.actor.id == actor.id
    assert context.actor.role_key == "admin"
    assert context.core_query is not None
    assert context.audit is not None
    assert context.resources is not None
    assert context.notifications is not None


async def test_request_context_exposes_request_scoped_permission_checks():
    db = object()
    actor = SimpleNamespace(
        id=uuid.uuid4(),
        email="member@example.com",
        display_name="Member",
        role="member",
    )

    with patch(
        "app.services.extensions.bridges.PermissionService.has_app_permission",
        new_callable=AsyncMock,
        return_value=True,
    ) as has_app_permission:
        context = build_request_context("swot-analysis", db, actor)

        allowed = await context.permissions.has("ext.swot-analysis.review")

    assert allowed is True
    has_app_permission.assert_awaited_once_with(
        db,
        actor,
        "ext.swot-analysis.review",
    )


async def test_audit_bridge_lists_authorized_entity_events_newest_first():
    entity_id = uuid.uuid4()
    actor_id = uuid.uuid4()
    created_at = object()
    row = SimpleNamespace(
        id=uuid.uuid4(),
        event_type="ext.swot-analysis.analysis.approved",
        entity_type="ext.swot-analysis.analysis",
        entity_id=entity_id,
        data={"status": "Approved"},
        user_id=actor_id,
        created_at=created_at,
    )
    execute_result = SimpleNamespace(
        scalars=lambda: SimpleNamespace(all=lambda: [row]),
    )
    db = SimpleNamespace(execute=AsyncMock(return_value=execute_result))
    actor = SimpleNamespace(
        id=uuid.uuid4(),
        email="member@example.com",
        display_name="Member",
        role="member",
    )

    with patch(
        "app.services.extensions.bridges.PermissionService.require_permission",
        new_callable=AsyncMock,
    ) as require_permission:
        context = build_request_context("swot-analysis", db, actor)

        events = await context.audit.list(
            entity_type="ext.swot-analysis.analysis",
            entity_id=entity_id,
            required_permission="ext.swot-analysis.view",
            limit=25,
        )

    assert events == [
        sdk.AuditEvent(
            id=row.id,
            event_type=row.event_type,
            entity_type=row.entity_type,
            entity_id=row.entity_id,
            data={"status": "Approved"},
            actor_id=actor_id,
            created_at=created_at,
        )
    ]
    require_permission.assert_awaited_once_with(
        db,
        actor,
        "ext.swot-analysis.view",
    )
    statement = db.execute.await_args.args[0]
    compiled = statement.compile()
    assert "events.entity_type =" in str(compiled)
    assert "events.entity_id =" in str(compiled)
    assert "ORDER BY events.created_at DESC" in str(compiled)
    assert "ext.swot-analysis.analysis" in compiled.params.values()
    assert entity_id in compiled.params.values()
    assert 25 in compiled.params.values()


async def test_audit_bridge_fails_closed_when_permission_is_denied():
    db = SimpleNamespace(execute=AsyncMock())
    actor = SimpleNamespace(
        id=uuid.uuid4(),
        email="member@example.com",
        display_name="Member",
        role="member",
    )

    with patch(
        "app.services.extensions.bridges.PermissionService.require_permission",
        new_callable=AsyncMock,
        side_effect=HTTPException(403, "Insufficient permissions"),
    ):
        context = build_request_context("swot-analysis", db, actor)

        with pytest.raises(ExtensionBridgeError) as exc_info:
            await context.audit.list(
                entity_type="ext.swot-analysis.analysis",
                entity_id=uuid.uuid4(),
                required_permission="ext.swot-analysis.view",
            )

    assert exc_info.value.code == "permission_denied"
    db.execute.assert_not_awaited()


async def _hierarchy_context(db):
    await create_role(db, key="admin", permissions={"*": True})
    actor = await create_user(db, role="admin")
    await create_card_type(db, key="Organization", label="Organization")
    await create_card_type(db, key="Application", label="Application")

    root = await create_card(db, card_type="Organization", name="Group", user_id=actor.id)
    child_a = await create_card(
        db, card_type="Organization", name="Division A", user_id=actor.id, parent_id=root.id
    )
    child_b = await create_card(
        db, card_type="Organization", name="Division B", user_id=actor.id, parent_id=root.id
    )
    grandchild = await create_card(
        db, card_type="Organization", name="Team", user_id=actor.id, parent_id=child_a.id
    )
    inactive_child = await create_card(
        db,
        card_type="Organization",
        name="Retired Team",
        user_id=actor.id,
        parent_id=root.id,
        status="ARCHIVED",
    )
    unrelated = await create_card(db, card_type="Application", name="Unrelated App", user_id=actor.id)

    return {
        "actor": actor,
        "root": root,
        "child_a": child_a,
        "child_b": child_b,
        "grandchild": grandchild,
        "inactive_child": inactive_child,
        "unrelated": unrelated,
    }


async def test_list_descendant_ids_walks_full_subtree_excluding_root(db):
    env = await _hierarchy_context(db)
    context = build_request_context("organization", db, env["actor"])

    descendants = await context.core_query.list_descendant_ids(
        env["root"].id, expected_type="Organization"
    )

    assert set(descendants) == {env["child_a"].id, env["child_b"].id, env["grandchild"].id}
    assert env["root"].id not in descendants
    assert env["inactive_child"].id not in descendants
    assert list(descendants) == sorted(descendants, key=str)


async def test_list_descendant_ids_rejects_type_outside_allowlist(db):
    env = await _hierarchy_context(db)
    context = build_request_context("organization", db, env["actor"])

    with pytest.raises(ExtensionBridgeError) as raised:
        await context.core_query.list_descendant_ids(
            env["unrelated"].id, expected_type="Application"
        )

    assert raised.value.code == "validation_failed"


async def test_list_descendant_ids_rejects_invisible_root(db):
    env = await _hierarchy_context(db)
    context = build_request_context("organization", db, env["actor"])

    with patch(
        "app.services.extensions.bridges.PermissionService.check_permission",
        new=AsyncMock(return_value=False),
    ):
        with pytest.raises(ExtensionBridgeError) as raised:
            await context.core_query.list_descendant_ids(
                env["root"].id, expected_type="Organization"
            )

    assert raised.value.code == "permission_denied"


async def test_list_descendant_ids_excludes_invisible_branch_without_discovering_its_children(db):
    env = await _hierarchy_context(db)
    context = build_request_context("organization", db, env["actor"])

    async def hide_child_a(_db, _user, _app, card_id, _card_permission):
        return card_id != env["child_a"].id

    with patch(
        "app.services.extensions.bridges.PermissionService.check_permission",
        side_effect=hide_child_a,
    ):
        descendants = await context.core_query.list_descendant_ids(
            env["root"].id, expected_type="Organization"
        )

    assert env["child_a"].id not in descendants
    # grandchild is only reachable via child_a — never discovered once child_a is hidden.
    assert env["grandchild"].id not in descendants
    assert set(descendants) == {env["child_b"].id}
