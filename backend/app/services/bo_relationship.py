"""Read and save the private BO drawing and manage Application ownership."""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from typing import TypeVar

from fastapi import HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.permissions import VIEW_PERMISSION, resolve_cell
from app.models.bo_operation_receipt import BoOperationReceipt
from app.models.card import Card
from app.models.diagram import Diagram
from app.models.relation import Relation
from app.models.stakeholder import Stakeholder
from app.models.tag import Tag
from app.models.user import User
from app.schemas.bo_relationship import (
    BoAcceptedInventoryChange,
    BoApplication,
    BoApplicationGroup,
    BoApplicationPage,
    BoCapabilities,
    BoEdge,
    BoGraph,
    BoInventoryItem,
    BoLayoutResult,
    BoLayoutUpdate,
    BoNode,
    BoPosition,
)
from app.services.bo_relationship_constants import (
    APPLICATION_RELATION,
    APPLICATION_TYPE,
    BO_RELATIONSHIP_DIAGRAM_ID,
    BO_RELATIONSHIP_KIND,
    BO_TYPE,
    ER_DELETE_RECEIPT,
    ER_RELATION,
    MASTER,
    OWNERSHIP_KEY,
)
from app.services.card_read_scope import CardReadScope
from app.services.card_search import card_search_filter, card_search_rank
from app.services.card_write_service import (
    _emit_relation_events,
    lock_bo_master,
    recalculate_and_rescore,
)
from app.services.permission_service import PermissionService


class BoApplicationLink(BaseModel):
    id: uuid.UUID
    object_id: uuid.UUID
    application: BoApplication
    is_master: bool


class BoSnapshot(BaseModel):
    snapshot_revision: uuid.UUID | None = None
    nodes: dict[uuid.UUID, BoNode] = Field(default_factory=dict)
    edges: dict[uuid.UUID, BoEdge] = Field(default_factory=dict)
    positions: dict[uuid.UUID, BoPosition] = Field(default_factory=dict)
    application_links: dict[uuid.UUID, BoApplicationLink] = Field(default_factory=dict)


@dataclass
class BoInventory:
    # Active values are compared with the drawing. Readable archived endpoints
    # still authorize looking at their saved values and accepting an archive.
    active: BoSnapshot
    objects: set[uuid.UUID]
    applications: set[uuid.UUID]
    edge_ids: set[uuid.UUID]
    application_link_ids: set[uuid.UUID]


class ErDeleteEvidence(BaseModel):
    type: str
    source: uuid.UUID
    target: uuid.UUID


async def bo_read_scope(db: AsyncSession, user: User) -> CardReadScope:
    return await CardReadScope.load(db, user, include_subtype_denials=True)


async def can_manage_bo_master(db: AsyncSession, user: User) -> bool:
    """Prove landscape-wide authority without reading an object or its links."""
    for permission in ("boRelationship.edit", "relations.manage"):
        if not await PermissionService.has_app_permission(db, user, permission):
            return False
    scope = await CardReadScope.load(db, user, include_stakeholders=False)
    if scope.wildcard:
        return True
    for type_key in (APPLICATION_TYPE, BO_TYPE):
        if not scope.type_readable(type_key, mode="module"):
            return False
        overrides = await PermissionService.load_type_role_permissions(db, type_key)
        cells = overrides.get(scope.role_key) or {}
        for permission in (VIEW_PERMISSION, "inventory.edit"):
            cell = cells.get(permission)
            subtypes = cell.get("subtypes") if isinstance(cell, dict) else None
            if any(resolve_cell(cell, subtype) is False for subtype in (subtypes or [None])):
                return False
        if not await PermissionService.has_app_permission(
            db, user, "inventory.edit", card_type_key=type_key
        ):
            return False
    return True


async def _bo_diagram(db: AsyncSession, *, lock: bool = False) -> Diagram | None:
    stmt = select(Diagram).where(Diagram.kind == BO_RELATIONSHIP_KIND)
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    row = await db.scalar(stmt)
    if row is None and lock:
        # Upgrades and seed create a placeholder. This also handles an empty
        # database or two simultaneous first writes when it is absent.
        await db.execute(
            insert(Diagram)
            .values(
                id=BO_RELATIONSHIP_DIAGRAM_ID, name="BO Relationship", kind=BO_RELATIONSHIP_KIND
            )
            .on_conflict_do_nothing(index_elements=[Diagram.id])
        )
        row = await db.scalar(stmt)
    return row


async def load_bo_inventory(db: AsyncSession, scope: CardReadScope) -> BoInventory:
    rows = await db.execute(
        select(Card.id, Card.type, Card.subtype, Card.name, Card.status, Card.attributes).where(
            Card.type.in_((BO_TYPE, APPLICATION_TYPE)), *scope.where(Card, mode="module")
        )
    )
    snapshot = BoSnapshot()
    objects: set[uuid.UUID] = set()
    applications: set[uuid.UUID] = set()
    active_apps: dict[uuid.UUID, BoApplication] = {}
    for id_, type_key, subtype, name, status, attrs in rows:
        if type_key == BO_TYPE:
            objects.add(id_)
            if status != "ARCHIVED":
                snapshot.nodes[id_] = BoNode(
                    id=id_,
                    name=name,
                    subtype=subtype,
                    isPersonalData=(attrs or {}).get("isPersonalData") is True,
                    isPaymentData=(attrs or {}).get("isPaymentData") is True,
                )
        else:
            applications.add(id_)
            if status != "ARCHIVED":
                active_apps[id_] = BoApplication(id=id_, name=name)

    edge_ids: set[uuid.UUID] = set()
    application_link_ids: set[uuid.UUID] = set()
    if objects:
        relations = await db.execute(
            select(
                Relation.id,
                Relation.type,
                Relation.source_id,
                Relation.target_id,
                Relation.attributes,
            ).where(
                Relation.type.in_((ER_RELATION, APPLICATION_RELATION)),
                Relation.target_id.in_(objects),
            )
        )
        for id_, type_key, source, target, attributes in relations:
            attrs = attributes or {}
            if type_key == ER_RELATION and source in objects:
                edge_ids.add(id_)
                if source in snapshot.nodes and target in snapshot.nodes:
                    cardinality = attrs.get("cardinality")
                    snapshot.edges[id_] = BoEdge(
                        id=id_,
                        source=source,
                        target=target,
                        cardinality=cardinality if isinstance(cardinality, str) else None,
                    )
            elif type_key == APPLICATION_RELATION and source in applications:
                application_link_ids.add(id_)
                if source in active_apps and target in snapshot.nodes:
                    snapshot.application_links[id_] = BoApplicationLink(
                        id=id_,
                        object_id=target,
                        application=active_apps[source],
                        is_master=attrs.get(OWNERSHIP_KEY) == MASTER,
                    )
    return BoInventory(snapshot, objects, applications, edge_ids, application_link_ids)


def _group_links(links: list[BoApplicationLink]) -> BoApplicationGroup:
    links.sort(key=lambda link: (link.application.name.casefold(), link.application.id))
    master = next((link.application for link in links if link.is_master), None)
    applications = {link.application.id: link.application for link in links}
    if master is None:
        return BoApplicationGroup(unclassified=list(applications.values()))
    return BoApplicationGroup(
        master=master, slaves=[app for app in applications.values() if app.id != master.id]
    )


def _project_graph(
    snapshot: BoSnapshot, inventory: BoInventory, *, can_manage_master: bool
) -> BoGraph:
    nodes = {id_: node for id_, node in snapshot.nodes.items() if id_ in inventory.objects}
    app_links: dict[uuid.UUID, list[BoApplicationLink]] = {id_: [] for id_ in nodes}
    for link in snapshot.application_links.values():
        if link.object_id in nodes and link.application.id in inventory.applications:
            app_links[link.object_id].append(link)
    return BoGraph(
        nodes=list(nodes.values()),
        edges=[
            edge
            for edge in snapshot.edges.values()
            if edge.source in nodes and edge.target in nodes
        ],
        positions={id_: value for id_, value in snapshot.positions.items() if id_ in nodes},
        applications={id_: _group_links(links) for id_, links in app_links.items()},
        snapshot_revision=snapshot.snapshot_revision,
        capabilities=BoCapabilities(can_manage_master=can_manage_master),
    )


async def get_bo_graph(db: AsyncSession, user: User) -> BoGraph:
    can_manage_master = await can_manage_bo_master(db, user)
    scope = await bo_read_scope(db, user)
    inventory = await load_bo_inventory(db, scope)
    diagram = await _bo_diagram(db)
    snapshot = BoSnapshot.model_validate(diagram.data or {}) if diagram else BoSnapshot()
    if snapshot.snapshot_revision is None:
        snapshot = inventory.active
    return _project_graph(snapshot, inventory, can_manage_master=can_manage_master)


async def get_bo_card(
    db: AsyncSession, scope: CardReadScope, object_id: uuid.UUID, *, detail: bool = False
) -> Card:
    stmt = select(Card).where(
        Card.id == object_id, Card.type == BO_TYPE, *scope.where(Card, mode="module")
    )
    if detail:
        stmt = stmt.options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    card = await db.scalar(stmt)
    if card is None:
        raise HTTPException(404, "Card not found")
    return card


async def bo_parent_readable(db: AsyncSession, scope: CardReadScope, parent_id: uuid.UUID) -> bool:
    return (
        await db.scalar(
            select(Card.id).where(Card.id == parent_id, *scope.where(Card, mode="module"))
        )
        is not None
    )


async def search_bo_applications(
    db: AsyncSession, user: User, search: str | None, page: int, page_size: int
) -> BoApplicationPage:
    scope = await bo_read_scope(db, user)
    filters = [
        Card.type == APPLICATION_TYPE,
        Card.status != "ARCHIVED",
        *scope.where(Card, mode="module"),
    ]
    order: list[ColumnElement] = [Card.name.asc(), Card.id.asc()]
    if search:
        filters.append(card_search_filter(search))
        order.insert(0, card_search_rank(search).asc())
    total = await db.scalar(select(func.count()).select_from(Card).where(*filters))
    rows = await db.execute(
        select(Card.id, Card.name)
        .where(*filters)
        .order_by(*order)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return BoApplicationPage(
        items=[BoApplication(id=id_, name=name) for id_, name in rows],
        total=total or 0,
    )


async def set_bo_master(
    db: AsyncSession, user: User, object_id: uuid.UUID, application_id: uuid.UUID | None
) -> BoApplicationGroup:
    if not await can_manage_bo_master(db, user):
        raise HTTPException(403, "Insufficient permissions")
    scope = await bo_read_scope(db, user)
    await lock_bo_master(db, object_id)
    target = await get_bo_card(db, scope, object_id)
    rows = await db.execute(
        select(Relation, Card)
        .join(Card, Card.id == Relation.source_id)
        .where(
            Relation.type == APPLICATION_RELATION,
            Relation.target_id == object_id,
            Card.type == APPLICATION_TYPE,
            *scope.where(Card, mode="module"),
        )
        .order_by(Relation.id)
        .with_for_update(of=Relation)
        .execution_options(populate_existing=True)
    )
    linked = rows.all()
    candidates = [
        rel for rel, card in linked if card.id == application_id and card.status != "ARCHIVED"
    ]
    if application_id is not None and not candidates:
        raise HTTPException(404, "Application link not found")
    selected = next(
        (rel for rel in candidates if (rel.attributes or {}).get(OWNERSHIP_KEY) == MASTER),
        candidates[0] if candidates else None,
    )

    changed: list[tuple[Relation, Card]] = []
    for rel, card in linked:
        attrs = rel.attributes or {}
        if rel is not selected and attrs.get(OWNERSHIP_KEY) == MASTER:
            rel.attributes = {k: v for k, v in attrs.items() if k != OWNERSHIP_KEY}
            changed.append((rel, card))
    # The partial unique index is immediate, so demote before promoting.
    await db.flush()
    if selected is not None and (selected.attributes or {}).get(OWNERSHIP_KEY) != MASTER:
        selected.attributes = {**(selected.attributes or {}), OWNERSHIP_KEY: MASTER}
        changed.append((selected, next(card for rel, card in linked if rel is selected)))
    if changed:
        await db.flush()
        for rel, card in changed:
            await recalculate_and_rescore(db, card)
            await _emit_relation_events(
                db,
                event_type="relation.updated",
                rel=rel,
                source_card=card,
                target_card=target,
                actor_id=user.id,
                extra={"fields": ["attributes"]},
            )
        await recalculate_and_rescore(db, target)
    return _group_links(
        [
            BoApplicationLink(
                id=rel.id,
                object_id=object_id,
                application=BoApplication(id=card.id, name=card.name),
                is_master=(rel.attributes or {}).get(OWNERSHIP_KEY) == MASTER,
            )
            for rel, card in linked
            if card.status != "ARCHIVED"
        ]
    )


def inventory_item_revision(
    item: BoInventoryItem, saved: BaseModel | None, live: BaseModel | None
) -> str:
    """The revision checks just the accepted item, independent of drawing positions."""
    values = [
        item.kind,
        str(item.id),
        saved.model_dump(mode="json") if saved is not None else None,
        live.model_dump(mode="json") if live is not None else None,
    ]
    return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()


async def _er_delete_evidence(
    db: AsyncSession, user: User, ids: set[uuid.UUID], objects: set[uuid.UUID]
) -> set[uuid.UUID]:
    if not ids:
        return set()
    rows = await db.execute(
        select(BoOperationReceipt.result_id, BoOperationReceipt.fingerprint).where(
            BoOperationReceipt.actor_id == user.id,
            BoOperationReceipt.kind == ER_DELETE_RECEIPT,
            BoOperationReceipt.result_id.in_(ids),
        )
    )
    proven = set()
    for id_, value in rows:
        try:
            evidence = ErDeleteEvidence.model_validate_json(value)
        except ValidationError:
            continue
        if evidence.type == ER_RELATION and {evidence.source, evidence.target} <= objects:
            proven.add(id_)
    return proven


SnapshotItem = TypeVar("SnapshotItem", bound=BaseModel)


def _apply_inventory_item(
    change: BoAcceptedInventoryChange,
    saved_items: dict[uuid.UUID, SnapshotItem],
    live_items: dict[uuid.UUID, SnapshotItem],
    readable_ids: set[uuid.UUID],
) -> bool:
    """Return false for a stale comparison, without changing the snapshot."""
    id_ = change.id
    if id_ not in readable_ids:
        raise HTTPException(404, "Inventory item not found")
    saved, current = saved_items.get(id_), live_items.get(id_)
    if saved == current and saved is not None:
        return True
    if change.revision != inventory_item_revision(change, saved, current):
        return False
    if current is None:
        saved_items.pop(id_, None)
    else:
        saved_items[id_] = current
    return True


def _apply_inventory_changes(
    snapshot: BoSnapshot,
    inventory: BoInventory,
    body: BoLayoutUpdate,
    deleted_edges: set[uuid.UUID],
) -> list[BoInventoryItem]:
    live = inventory.active
    readable_edges = inventory.edge_ids | deleted_edges
    conflicts: list[BoInventoryItem] = []
    promoted: dict[uuid.UUID, uuid.UUID] = {}
    for change in body.accepted_inventory_changes:
        if change.kind == "node":
            applied = _apply_inventory_item(change, snapshot.nodes, live.nodes, inventory.objects)
        elif change.kind == "edge":
            applied = _apply_inventory_item(change, snapshot.edges, live.edges, readable_edges)
        else:
            applied = _apply_inventory_item(
                change,
                snapshot.application_links,
                live.application_links,
                inventory.application_link_ids,
            )
            current = live.application_links.get(change.id)
            if applied and current is not None and current.is_master:
                promoted[current.object_id] = current.id
        if not applied:
            conflicts.append(BoInventoryItem(kind=change.kind, id=change.id))
    # A promotion is authoritative for its BO. Normalize after checking all
    # tokens so accepting both sides of a transfer is order-independent.
    if promoted:
        for link in snapshot.application_links.values():
            if (
                link.is_master
                and link.object_id in promoted
                and promoted[link.object_id] != link.id
            ):
                link.is_master = False
    return conflicts


async def save_bo_layout(db: AsyncSession, user: User, body: BoLayoutUpdate) -> BoLayoutResult:
    can_manage_master = await can_manage_bo_master(db, user)
    scope = await bo_read_scope(db, user)
    diagram = await _bo_diagram(db, lock=True)
    assert diagram is not None
    snapshot = BoSnapshot.model_validate(diagram.data or {})
    inventory = await load_bo_inventory(db, scope)
    if snapshot.snapshot_revision is None:
        snapshot = (await load_bo_inventory(db, CardReadScope.everything())).active
    prior = snapshot.model_dump(mode="json")
    positions = body.positions.keys() | body.auto_positions.keys()
    if not positions <= inventory.objects:
        raise HTTPException(404, "Card not found")

    accepted_edges = {item.id for item in body.accepted_inventory_changes if item.kind == "edge"}
    evidence_ids = (body.removed_relation_ids | accepted_edges) - inventory.edge_ids
    deleted_edges = await _er_delete_evidence(db, user, evidence_ids, inventory.objects)
    if not body.removed_relation_ids <= inventory.edge_ids | deleted_edges:
        raise HTTPException(404, "Relation not found")
    if not body.restored_relation_ids <= inventory.active.edges.keys():
        raise HTTPException(404, "Relation not found")

    conflicts = _apply_inventory_changes(snapshot, inventory, body, deleted_edges)
    conflicting_edges = {item.id for item in conflicts if item.kind == "edge"}
    for id_ in body.removed_relation_ids:
        snapshot.edges.pop(id_, None)
    for id_ in body.restored_relation_ids - conflicting_edges:
        snapshot.edges.setdefault(id_, inventory.active.edges[id_])
    snapshot.positions.update(body.positions)
    for id_, position in body.auto_positions.items():
        snapshot.positions.setdefault(id_, position)
    if snapshot.snapshot_revision is None or snapshot.model_dump(mode="json") != prior:
        snapshot.snapshot_revision = uuid.uuid4()
        diagram.data = snapshot.model_dump(mode="json")
        await db.flush()
    graph = _project_graph(snapshot, inventory, can_manage_master=can_manage_master)
    return BoLayoutResult(**graph.model_dump(), inventory_conflicts=conflicts)
