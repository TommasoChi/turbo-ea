import asyncio

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bo_operation_receipt import BoOperationReceipt
from app.models.card import Card
from app.models.card_type import CardType
from app.models.diagram import Diagram
from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.role import Role
from app.models.stakeholder import Stakeholder
from app.models.user import User
from app.models.user_favorite import UserFavorite
from app.schemas.bo_relationship import BoApplication, BoEdge, BoInventoryItem, BoLayoutUpdate
from app.services.bo_relationship import (
    BoApplicationLink,
    ErDeleteEvidence,
    inventory_item_revision,
    save_bo_layout,
)
from app.services.bo_relationship import set_bo_master as assign_master
from app.services.bo_relationship_constants import BO_RELATIONSHIP_KIND, ER_DELETE_RECEIPT
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

pytestmark = pytest.mark.anyio

BASE = "/api/v1/bo-relationship"
ER = "relDataObjectToDataObject"
APP_LINK = "relAppToDataObj"


@pytest.fixture
async def env(db):
    permissions = {"boRelationship.view": True, "boRelationship.edit": True}
    await create_role(db)
    await create_role(db, key="viewer", permissions={"boRelationship.view": True})
    await create_role(db, key="editor", permissions=permissions)
    await create_role(
        db,
        key="partial",
        permissions={**permissions, "relations.manage": True, "inventory.edit": True},
    )
    await create_card_type(db, key="DataObject", subtypes=[{"key": "Data"}, {"key": "Document"}])
    await create_card_type(
        db,
        key="Application",
        subtypes=[{"key": "Restricted"}],
        role_permissions={
            "partial": {"inventory.view": {"value": False, "subtypes": ["Restricted"]}}
        },
    )
    await create_relation_type(
        db, key=ER, source_type_key="DataObject", target_type_key="DataObject"
    )
    await create_relation_type(
        db, key=APP_LINK, source_type_key="Application", target_type_key="DataObject"
    )
    return {
        key: auth_headers(await create_user(db, role=key))
        for key in ("admin", "viewer", "editor", "partial")
    }


async def bo(db, name="Customer"):
    return await create_card(db, card_type="DataObject", subtype="Data", name=name)


async def test_first_read_uses_live_graph_with_stored_subtype_and_direction(client, db, env):
    customer, order = await bo(db), await bo(db, "Order")
    rel = await create_relation(
        db,
        type_key=ER,
        source_id=customer.id,
        target_id=order.id,
        attributes={"cardinality": "1:n"},
    )
    response = await client.get(BASE, headers=env["viewer"])
    assert response.status_code == 200
    graph = response.json()
    assert graph["snapshot_revision"] is None
    assert {(n["name"], n["subtype"]) for n in graph["nodes"]} == {
        ("Customer", "Data"),
        ("Order", "Data"),
    }
    assert graph["edges"] == [
        {
            "id": str(rel.id),
            "source": str(customer.id),
            "target": str(order.id),
            "cardinality": "1:n",
        }
    ]


async def test_viewer_cannot_save_or_search(client, env):
    assert (await client.put(f"{BASE}/layout", json={}, headers=env["viewer"])).status_code == 403
    assert (await client.get(f"{BASE}/applications", headers=env["viewer"])).status_code == 403


async def test_manual_positions_merge_from_stale_revision_and_auto_only_fills(client, db, env):
    a, b = await bo(db), await bo(db, "Order")
    first = await client.put(
        f"{BASE}/layout", json={"positions": {str(a.id): {"x": 1, "y": 1}}}, headers=env["editor"]
    )
    assert first.status_code == 200
    second = await client.put(
        f"{BASE}/layout",
        json={
            "snapshot_revision": None,
            "positions": {str(a.id): {"x": 2, "y": 3}},
            "auto_positions": {str(a.id): {"x": 0, "y": 0}, str(b.id): {"x": 4, "y": 5}},
        },
        headers=env["editor"],
    )
    assert second.status_code == 200
    assert second.json()["positions"] == {str(a.id): {"x": 2, "y": 3}, str(b.id): {"x": 4, "y": 5}}
    third = await client.put(
        f"{BASE}/layout",
        json={"auto_positions": {str(a.id): {"x": 9, "y": 9}}},
        headers=env["editor"],
    )
    assert third.json()["positions"] == second.json()["positions"]


async def test_explicit_disjoint_removals_merge_without_inventory_delete(client, db, env):
    a, b, c = await bo(db), await bo(db, "Order"), await bo(db, "Address")
    first = await create_relation(db, type_key=ER, source_id=a.id, target_id=b.id)
    second = await create_relation(db, type_key=ER, source_id=a.id, target_id=c.id)
    initial = await client.put(f"{BASE}/layout", json={}, headers=env["editor"])
    assert initial.status_code == 200
    revision = initial.json()["snapshot_revision"]
    for rel in (first, second):
        result = await client.put(
            f"{BASE}/layout",
            json={"snapshot_revision": revision, "removed_relation_ids": [str(rel.id)]},
            headers=env["editor"],
        )
        assert result.status_code == 200
    assert result.json()["edges"] == []
    assert await db.get(Relation, first.id) and await db.get(Relation, second.id)


async def test_layout_rejects_nonfinite_coordinates_and_non_bo_ids(client, db, env):
    node = await bo(db)
    app = await create_card(db)
    for id_, x, status in ((node.id, "Infinity", 422), (app.id, 1, 404)):
        response = await client.put(
            f"{BASE}/layout",
            json={"positions": {str(id_): {"x": x, "y": 0}}},
            headers=env["editor"],
        )
        assert response.status_code == status


@pytest.mark.parametrize("master", [None, "visible", "hidden"])
async def test_partial_master_permission_does_not_depend_on_designation(client, db, env, master):
    node = await bo(db)
    visible = await create_card(db, name="Visible")
    hidden = await create_card(db, name="Hidden", subtype="Restricted")
    for app, label in ((visible, "visible"), (hidden, "hidden")):
        await create_relation(
            db,
            type_key=APP_LINK,
            source_id=app.id,
            target_id=node.id,
            attributes={"dataOwnership": "master"} if label == master else {},
        )
    graph = await client.get(BASE, headers=env["partial"])
    assert graph.status_code == 200
    assert graph.json()["capabilities"]["can_manage_master"] is False
    grouping = graph.json()["applications"][str(node.id)]
    item = {"id": str(visible.id), "name": "Visible"}
    if master == "visible":
        assert grouping == {"master": item, "slaves": [], "unclassified": []}
    else:
        assert grouping == {"master": None, "slaves": [], "unclassified": [item]}
    response = await client.put(
        f"{BASE}/objects/{node.id}/master",
        json={"application_id": str(visible.id)},
        headers=env["partial"],
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Insufficient permissions"


async def test_master_transfers_and_clears_without_changing_crud(client, db, env):
    node = await bo(db)
    a = await create_card(db, name="Alpha")
    b = await create_card(db, name="Beta")
    ra = await create_relation(
        db, type_key=APP_LINK, source_id=a.id, target_id=node.id, attributes={"create": True}
    )
    rb = await create_relation(
        db, type_key=APP_LINK, source_id=b.id, target_id=node.id, attributes={"update": True}
    )
    for master, slave in ((a, b), (b, a)):
        response = await client.put(
            f"{BASE}/objects/{node.id}/master",
            json={"application_id": str(master.id)},
            headers=env["admin"],
        )
        assert response.status_code == 200
        assert response.json()["master"]["id"] == str(master.id)
        assert [row["id"] for row in response.json()["slaves"]] == [str(slave.id)]
    await db.refresh(ra)
    await db.refresh(rb)
    assert ra.attributes == {"create": True}
    assert rb.attributes == {"update": True, "dataOwnership": "master"}
    response = await client.put(
        f"{BASE}/objects/{node.id}/master", json={"application_id": None}, headers=env["admin"]
    )
    assert response.status_code == 200
    assert response.json()["master"] is None
    assert {row["id"] for row in response.json()["unclassified"]} == {str(a.id), str(b.id)}


async def test_generic_crud_patch_retains_master_and_rejects_marker(client, db, env):
    node = await bo(db)
    app = await create_card(db)
    link = await create_relation(
        db,
        type_key=APP_LINK,
        source_id=app.id,
        target_id=node.id,
        attributes={"dataOwnership": "master", "create": True},
    )
    url = f"/api/v1/relations/{link.id}"
    result = await client.patch(url, json={"attributes": {"update": True}}, headers=env["partial"])
    assert result.status_code == 200
    assert result.json()["attributes"] == {"update": True}
    await db.refresh(link)
    assert link.attributes == {"dataOwnership": "master", "update": True}
    forged = await client.patch(
        url, json={"attributes": {"dataOwnership": None}}, headers=env["partial"]
    )
    assert forged.status_code == 422


async def test_detail_and_picker_apply_module_scope_and_rank_paging(client, db, env):
    node = await bo(db)
    exact = await create_card(db, name="Catalog")
    await create_card(db, name="Catalog Design")
    hidden = await create_card(db, name="Catalog Hidden", subtype="Restricted")
    response = await client.get(f"{BASE}/objects/{node.id}/detail", headers=env["viewer"])
    assert response.status_code == 200
    assert response.json()["card"]["subtype"] == "Data"
    assert response.json()["permissions"]["can_edit"] is False
    response = await client.get(
        f"{BASE}/applications?search=Catalog&page=1&page_size=1", headers=env["partial"]
    )
    assert response.status_code == 200
    assert response.json() == {"items": [{"id": str(exact.id), "name": "Catalog"}], "total": 2}
    assert str(hidden.id) not in response.text


async def test_first_restricted_save_preserves_hidden_snapshot_and_positions(client, db, env):
    visible = await bo(db)
    hidden = await create_card(db, card_type="DataObject", subtype="Document", name="Hidden")
    visible.parent_id = hidden.id
    await create_relation(db, type_key=ER, source_id=visible.id, target_id=hidden.id)
    ct = await db.scalar(select(CardType).where(CardType.key == "DataObject"))
    ct.role_permissions = {"editor": {"inventory.view": {"value": False, "subtypes": ["Document"]}}}
    await db.flush()
    path = f"{BASE}/layout"
    response = await client.put(
        path, json={"positions": {str(visible.id): {"x": 1, "y": 2}}}, headers=env["editor"]
    )
    assert response.status_code == 200
    assert str(hidden.id) not in response.text
    assert response.json()["edges"] == []
    graph = (await client.get(BASE, headers=env["admin"])).json()
    assert {node["subtype"] for node in graph["nodes"]} == {"Data", "Document"}
    assert len(graph["edges"]) == 1
    response = await client.put(
        path, json={"positions": {str(hidden.id): {"x": 5, "y": 8}}}, headers=env["admin"]
    )
    assert response.status_code == 200
    response = await client.put(
        path, json={"positions": {str(hidden.id): {"x": 10, "y": 20}}}, headers=env["editor"]
    )
    assert response.status_code == 404
    assert str(hidden.id) not in (await client.get(BASE, headers=env["editor"])).text
    graph = (await client.get(BASE, headers=env["admin"])).json()
    assert graph["positions"][str(hidden.id)] == {"x": 5, "y": 8}
    response = await client.get(f"{BASE}/objects/{hidden.id}/detail", headers=env["editor"])
    assert response.status_code == 404
    response = await client.get(f"{BASE}/objects/{visible.id}/detail", headers=env["editor"])
    assert response.status_code == 200
    assert response.json()["card"]["parent_id"] is None


async def test_inventory_change_rechecks_current_value_and_keeps_disjoint_positions(
    client, db, env
):
    from app.schemas.bo_relationship import BoNode

    card = await bo(db)
    url = f"{BASE}/layout"
    initial = await client.put(url, json={}, headers=env["editor"])
    assert initial.status_code == 200
    old = BoNode.model_validate(initial.json()["nodes"][0])
    item = BoInventoryItem(kind="node", id=card.id)
    planned = old.model_copy(update={"name": "Renamed"})
    card.name = "Renamed again"
    await db.flush()
    body = {
        "snapshot_revision": initial.json()["snapshot_revision"],
        "positions": {str(card.id): {"x": 30, "y": 40}},
        "accepted_inventory_changes": [
            {
                **item.model_dump(mode="json"),
                "revision": inventory_item_revision(item, old, planned),
            }
        ],
    }
    response = await client.put(url, json=body, headers=env["editor"])
    assert response.status_code == 200
    assert response.json()["inventory_conflicts"] == [item.model_dump(mode="json")]
    assert response.json()["nodes"][0]["name"] == old.name
    assert response.json()["positions"][str(card.id)] == {"x": 30, "y": 40}
    body["positions"] = {}
    body["accepted_inventory_changes"][0]["revision"] = inventory_item_revision(
        item, old, old.model_copy(update={"name": "Renamed again"})
    )
    response = await client.put(url, json=body, headers=env["editor"])
    assert response.status_code == 200
    assert response.json()["inventory_conflicts"] == []
    assert response.json()["nodes"][0]["name"] == "Renamed again"
    assert response.json()["positions"][str(card.id)] == {"x": 30, "y": 40}


async def test_deleted_edge_visual_delta_requires_current_actor_receipt(client, db, env):
    a, b = await bo(db), await bo(db, "Order")
    relation = await create_relation(db, type_key=ER, source_id=a.id, target_id=b.id)
    assert (await client.put(f"{BASE}/layout", json={}, headers=env["admin"])).status_code == 200
    relation_id = relation.id
    await db.delete(relation)
    editor = await db.scalar(select(User).where(User.role == "editor"))
    db.add(
        BoOperationReceipt(
            actor_id=editor.id,
            draft_id=relation_id,
            result_id=relation_id,
            kind=ER_DELETE_RECEIPT,
            fingerprint=ErDeleteEvidence(type=ER, source=a.id, target=b.id).model_dump_json(),
        )
    )
    await db.flush()
    payload = {"removed_relation_ids": [str(relation_id)]}
    result = await client.put(f"{BASE}/layout", json=payload, headers=env["admin"])
    assert result.status_code == 404
    result = await client.put(f"{BASE}/layout", json=payload, headers=env["editor"])
    assert result.status_code == 200
    assert result.json()["edges"] == []


async def test_generic_post_and_bulk_cannot_designate_master(client, db, env):
    node = await bo(db)
    app = await create_card(db)
    attributes = {"dataOwnership": "master"}
    response = await client.post(
        "/api/v1/relations",
        json={
            "type": APP_LINK,
            "source_id": str(app.id),
            "target_id": str(node.id),
            "attributes": attributes,
        },
        headers=env["admin"],
    )
    assert response.status_code == 422
    response = await client.post(
        "/api/v1/relations/bulk",
        json={
            "operations": [
                {
                    "row_index": 0,
                    "type": APP_LINK,
                    "source": {"id": str(app.id)},
                    "target": {"id": str(node.id)},
                    "attributes": attributes,
                }
            ]
        },
        headers=env["admin"],
    )
    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "failed"
    assert await db.scalar(select(Relation.id).where(Relation.type == APP_LINK)) is None


async def test_master_link_delete_leaves_remaining_live_links_unclassified(client, db, env):
    node = await bo(db)
    a, b = await create_card(db, name="Alpha"), await create_card(db, name="Beta")
    link = await create_relation(
        db,
        type_key=APP_LINK,
        source_id=a.id,
        target_id=node.id,
        attributes={"dataOwnership": "master"},
    )
    await create_relation(db, type_key=APP_LINK, source_id=b.id, target_id=node.id)
    response = await client.delete(f"/api/v1/relations/{link.id}", headers=env["admin"])
    assert response.status_code == 204
    graph = await client.get(BASE, headers=env["viewer"])
    assert graph.status_code == 200
    assert graph.json()["applications"][str(node.id)] == {
        "master": None,
        "slaves": [],
        "unclassified": [{"id": str(b.id), "name": "Beta"}],
    }


async def test_dataobject_subtype_view_deny_blocks_full_master_capability(client, db, env):
    role = await db.scalar(select(Role).where(Role.key == "editor"))
    role.permissions = {**role.permissions, "relations.manage": True, "inventory.edit": True}
    type_row = await db.scalar(select(CardType).where(CardType.key == "DataObject"))
    type_row.role_permissions = {
        "editor": {"inventory.view": {"value": False, "subtypes": ["Document"]}}
    }
    await db.flush()
    node = await bo(db)
    graph = await client.get(BASE, headers=env["editor"])
    assert graph.status_code == 200
    assert graph.json()["nodes"][0]["id"] == str(node.id)
    assert graph.json()["capabilities"]["can_manage_master"] is False
    response = await client.put(
        f"{BASE}/objects/{node.id}/master", json={"application_id": None}, headers=env["editor"]
    )
    assert response.status_code == 403


async def test_accepting_visible_promotion_normalizes_a_hidden_saved_master(client, db, env):
    node = await bo(db)
    hidden = await create_card(db, name="Alpha", subtype="Restricted")
    visible = await create_card(db, name="Beta")
    await create_relation(
        db,
        type_key=APP_LINK,
        source_id=hidden.id,
        target_id=node.id,
        attributes={"dataOwnership": "master"},
    )
    link = await create_relation(db, type_key=APP_LINK, source_id=visible.id, target_id=node.id)
    assert (await client.put(f"{BASE}/layout", json={}, headers=env["admin"])).status_code == 200
    response = await client.put(
        f"{BASE}/objects/{node.id}/master",
        json={"application_id": str(visible.id)},
        headers=env["admin"],
    )
    assert response.status_code == 200
    saved = BoApplicationLink(
        id=link.id,
        object_id=node.id,
        application=BoApplication(id=visible.id, name=visible.name),
        is_master=False,
    )
    item = BoInventoryItem(kind="application_link", id=link.id)
    revision = inventory_item_revision(item, saved, saved.model_copy(update={"is_master": True}))
    response = await client.put(
        f"{BASE}/layout",
        headers=env["partial"],
        json={
            "accepted_inventory_changes": [{**item.model_dump(mode="json"), "revision": revision}]
        },
    )
    assert response.status_code == 200
    assert str(hidden.id) not in response.text
    assert response.json()["applications"][str(node.id)]["master"]["id"] == str(visible.id)
    admin_graph = (await client.get(BASE, headers=env["admin"])).json()
    assert admin_graph["applications"][str(node.id)] == {
        "master": {"id": str(visible.id), "name": visible.name},
        "slaves": [{"id": str(hidden.id), "name": hidden.name}],
        "unclassified": [],
    }


async def test_bo_detail_shapes_stakeholder_pii_for_module_readers(client, db, env):
    node = await bo(db)
    owner = await create_user(db, display_name="Owner", email="owner@private.test")
    await create_stakeholder_role_def(db, card_type_key="DataObject", key="data_owner")
    db.add(Stakeholder(card_id=node.id, user_id=owner.id, role="data_owner"))
    await db.flush()
    url = f"{BASE}/objects/{node.id}/detail"
    result = await client.get(url, headers=env["viewer"])
    assert result.status_code == 200
    (stakeholder,) = result.json()["card"]["stakeholders"]
    assert stakeholder["user_display_name"] == "Owner"
    assert stakeholder["user_email"] is None
    assert owner.email not in result.text


async def test_normal_card_save_does_not_return_bo_hidden_references_or_pii(client, db, env):
    parent = await create_card(db, name="Hidden parent", subtype="Restricted")
    node = await create_card(
        db, card_type="DataObject", subtype="Data", name="Customer", parent_id=parent.id
    )
    owner = await create_user(db, display_name="Owner", email="owner@private.test")
    await create_stakeholder_role_def(db, card_type_key="DataObject", key="data_owner")
    db.add(Stakeholder(card_id=node.id, user_id=owner.id, role="data_owner"))
    await db.flush()

    result = await client.patch(
        f"/api/v1/cards/{node.id}",
        json={"description": "Updated from the BO panel"},
        headers=env["partial"],
    )

    assert result.status_code == 200
    body = result.json()
    assert body["description"] == "Updated from the BO panel"
    assert body["parent_id"] is None
    assert body["parent_label"] is None
    (stakeholder,) = body["stakeholders"]
    assert stakeholder["user_display_name"] == "Owner"
    assert stakeholder["user_email"] is None


async def test_generic_relation_api_hides_links_to_denied_application_subtypes(client, db, env):
    node = await bo(db)
    app = await create_card(db, name="Hidden", subtype="Restricted")
    rel = await create_relation(
        db,
        type_key=APP_LINK,
        source_id=app.id,
        target_id=node.id,
        attributes={"dataOwnership": "master"},
    )
    response = await client.get(f"/api/v1/relations?card_id={node.id}", headers=env["partial"])
    assert response.status_code == 200
    assert response.json() == []
    response = await client.patch(
        f"/api/v1/relations/{rel.id}",
        json={"attributes": {"crudRead": True}},
        headers=env["partial"],
    )
    assert response.status_code == 404
    response = await client.post(
        "/api/v1/relations",
        json={"type": APP_LINK, "source_id": str(app.id), "target_id": str(node.id)},
        headers=env["partial"],
    )
    assert response.status_code == 404


async def test_master_history_omits_hidden_and_unknown_subtype_peers(client, db, env):
    role = await db.scalar(select(Role).where(Role.key == "partial"))
    role.permissions = {**role.permissions, "inventory.view": True, "reports.ea_dashboard": True}
    node = await bo(db)
    actor = await db.scalar(select(User).where(User.role == "partial"))
    db.add(UserFavorite(card_id=node.id, user_id=actor.id))
    hidden = await create_card(db, name="Hidden", subtype="Restricted")
    visible = await create_card(db, name="Visible")
    for app in (hidden, visible):
        await create_relation(db, type_key=APP_LINK, source_id=app.id, target_id=node.id)
        response = await client.put(
            f"{BASE}/objects/{node.id}/master",
            json={"application_id": str(app.id)},
            headers=env["admin"],
        )
        assert response.status_code == 200
    url = f"/api/v1/cards/{node.id}/history"
    result = await client.get(url, headers=env["partial"])
    assert result.status_code == 200
    assert {event["data"]["peer_id"] for event in result.json()} == {str(visible.id)}
    for path in ("/api/v1/events/my-cards", "/api/v1/reports/dashboard"):
        response = await client.get(path, headers=env["partial"])
        assert response.status_code == 200
        assert str(visible.id) in response.text
        assert str(hidden.id) not in response.text
    await db.delete(hidden)
    await db.flush()
    result = await client.get(url, headers=env["partial"])
    assert result.status_code == 200
    assert {event["data"]["peer_id"] for event in result.json()} == {str(visible.id)}
    response = await client.get("/api/v1/reports/dashboard", headers=env["partial"])
    assert response.status_code == 200
    assert str(hidden.id) not in response.text


async def test_restoring_present_edge_does_not_refresh_saved_cardinality(client, db, env):
    a, b = await bo(db), await bo(db, "Other")
    edge = await create_relation(
        db, type_key=ER, source_id=a.id, target_id=b.id, attributes={"cardinality": "1:n"}
    )
    url = f"{BASE}/layout"
    initial = await client.put(url, json={}, headers=env["editor"])
    assert initial.status_code == 200
    edge.attributes = {"cardinality": "n:1"}
    await db.flush()
    result = await client.put(
        url, json={"restored_relation_ids": [str(edge.id)]}, headers=env["editor"]
    )
    assert result.status_code == 200
    assert result.json()["edges"][0]["cardinality"] == "1:n"


async def test_edge_restore_respects_same_item_conflict_and_keeps_disjoint_restore(client, db, env):
    a, b, c = await bo(db), await bo(db, "Other"), await bo(db, "Third")
    first = await create_relation(
        db, type_key=ER, source_id=a.id, target_id=b.id, attributes={"cardinality": "1:n"}
    )
    second = await create_relation(db, type_key=ER, source_id=a.id, target_id=c.id)
    url = f"{BASE}/layout"
    hidden = await client.put(
        url,
        json={"removed_relation_ids": [str(first.id), str(second.id)]},
        headers=env["editor"],
    )
    assert hidden.status_code == 200 and hidden.json()["edges"] == []
    item = BoInventoryItem(kind="edge", id=first.id)
    old = BoEdge(id=first.id, source=a.id, target=b.id, cardinality="1:n")
    first.attributes = {"cardinality": "n:1"}
    await db.flush()
    result = await client.put(
        url,
        json={
            "restored_relation_ids": [str(first.id), str(second.id)],
            "accepted_inventory_changes": [
                {
                    **item.model_dump(mode="json"),
                    "revision": inventory_item_revision(item, None, old),
                }
            ],
            "positions": {str(a.id): {"x": 11, "y": 12}},
        },
        headers=env["editor"],
    )
    assert result.status_code == 200
    assert result.json()["inventory_conflicts"] == [item.model_dump(mode="json")]
    assert [edge["id"] for edge in result.json()["edges"]] == [str(second.id)]
    assert result.json()["positions"][str(a.id)] == {"x": 11, "y": 12}


async def test_concurrent_master_transfers_and_layout_saves(test_engine):
    async with AsyncSession(test_engine, expire_on_commit=False) as setup:
        admin = await create_role(setup, key="bo-concurrent-admin")
        actor = await create_user(setup, role=admin.key)
        card_types = [
            await create_card_type(setup, key=key) for key in ("DataObject", "Application")
        ]
        relation_type = await create_relation_type(
            setup, key=APP_LINK, source_type_key="Application", target_type_key="DataObject"
        )
        a, b = await bo(setup), await bo(setup, "Other object")
        apps = [await create_card(setup, name=name) for name in ("Alpha", "Beta")]
        for app in apps:
            await create_relation(setup, type_key=APP_LINK, source_id=app.id, target_id=a.id)
        await setup.commit()
    try:

        async def assign(application_id):
            async with AsyncSession(test_engine) as session, session.begin():
                return await assign_master(session, actor, a.id, application_id)

        async def save(card_id, x):
            async with AsyncSession(test_engine) as session, session.begin():
                return await save_bo_layout(
                    session,
                    actor,
                    BoLayoutUpdate(positions={card_id: {"x": x, "y": x}}, snapshot_revision=None),
                )

        first, second = await asyncio.wait_for(
            asyncio.gather(*(assign(app.id) for app in apps)), timeout=10
        )
        assert [first.master.id, second.master.id] == [app.id for app in apps]
        await asyncio.wait_for(asyncio.gather(save(a.id, 1), save(b.id, 2)), timeout=10)
        async with AsyncSession(test_engine) as first_writer:
            await save_bo_layout(
                first_writer, actor, BoLayoutUpdate(positions={a.id: {"x": 3, "y": 4}})
            )
            second_started = asyncio.Event()

            async def save_second():
                second_started.set()
                return await save(a.id, 5)

            second_writer = asyncio.create_task(save_second())
            await second_started.wait()
            await first_writer.commit()
            await asyncio.wait_for(second_writer, timeout=10)
        async with AsyncSession(test_engine) as verify:
            relations = list(
                (await verify.scalars(select(Relation).where(Relation.target_id == a.id)))
            )
            assert sum(rel.attributes.get("dataOwnership") == "master" for rel in relations) == 1
            diagram = await verify.scalar(
                select(Diagram).where(Diagram.kind == BO_RELATIONSHIP_KIND)
            )
            assert diagram.data["positions"] == {
                str(a.id): {"x": 5, "y": 5},
                str(b.id): {"x": 2, "y": 2},
            }
    finally:
        async with AsyncSession(test_engine) as cleanup, cleanup.begin():
            await cleanup.execute(delete(Event).where(Event.user_id == actor.id))
            await cleanup.execute(
                delete(MutationBatch).where(MutationBatch.actor_user_id == actor.id)
            )
            await cleanup.execute(delete(Diagram).where(Diagram.kind == BO_RELATIONSHIP_KIND))
            await cleanup.execute(
                delete(Card).where(Card.id.in_([a.id, b.id, *(app.id for app in apps)]))
            )
            await cleanup.execute(delete(RelationType).where(RelationType.id == relation_type.id))
            await cleanup.execute(
                delete(CardType).where(CardType.id.in_([ct.id for ct in card_types]))
            )
            await cleanup.execute(delete(User).where(User.id == actor.id))
            await cleanup.execute(delete(Role).where(Role.id == admin.id))
        PermissionService.invalidate_role_cache(admin.key)
        PermissionService.invalidate_type_permission_cache()
