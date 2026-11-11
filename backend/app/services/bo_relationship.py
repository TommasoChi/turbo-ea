"""Read and save the private BO drawing and manage Application ownership."""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Collection, Mapping
from dataclasses import dataclass, replace
from typing import Literal, TypeVar, cast

from fastapi import HTTPException
from pydantic import BaseModel, Field, ValidationError, ValidationInfo, field_validator
from sqlalchemy import ColumnElement, any_, bindparam, func, select
from sqlalchemy.dialects.postgresql import ARRAY, UUID, insert
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
    BoApplicationLink,
    BoApplicationPage,
    BoCapabilities,
    BoDraftComparison,
    BoDraftComparisonResult,
    BoDraftResult,
    BoEdge,
    BoEdgeGeometry,
    BoGraph,
    BoInventoryChange,
    BoInventoryChanges,
    BoInventoryItem,
    BoLayoutResult,
    BoLayoutUpdate,
    BoNode,
    BoPosition,
    BoSavedPlacement,
    ConnectorRouting,
)
from app.services.bo_relationship_constants import (
    APPLICATION_RELATION,
    APPLICATION_TYPE,
    BO_RELATIONSHIP_DIAGRAM_ID,
    BO_RELATIONSHIP_KIND,
    BO_TYPE,
    ER_DELETE_RECEIPT,
    ER_RELATION,
    INVENTORY_CARD_DELETE,
    INVENTORY_RELATION_DELETE,
    MASTER,
    OWNERSHIP_KEY,
)
from app.services.card_read_scope import CardReadScope
from app.services.card_search import card_search_filter, card_search_rank
from app.services.card_write_service import (
    _emit_relation_events,
    lock_bo_master,
    lock_relation_endpoints,
    recalculate_and_rescore,
)
from app.services.permission_service import PermissionService


class BoSnapshot(BaseModel):
    snapshot_revision: uuid.UUID | None = None
    nodes: dict[uuid.UUID, BoNode] = Field(default_factory=dict)
    edges: dict[uuid.UUID, BoEdge] = Field(default_factory=dict)
    positions: dict[uuid.UUID, BoPosition] = Field(default_factory=dict)
    application_links: dict[uuid.UUID, BoApplicationLink] = Field(default_factory=dict)
    edge_routes: dict[uuid.UUID, ConnectorRouting] = Field(default_factory=dict)
    edge_geometry: dict[uuid.UUID, BoEdgeGeometry] = Field(default_factory=dict)

    @field_validator("positions", "edge_geometry", mode="before")
    @classmethod
    def validate_saved_geometry(
        cls, raw: object, info: ValidationInfo
    ) -> dict[str | uuid.UUID, BoPosition | BoEdgeGeometry]:
        # Older snapshots allowed coordinates that cannot be rendered safely.
        model = BoPosition if info.field_name == "positions" else BoEdgeGeometry
        valid = {}
        if isinstance(raw, dict):
            for id_, value in raw.items():
                try:
                    valid[id_] = model.model_validate(value)
                except ValidationError:
                    continue
        return valid

    @field_validator("edges", mode="before")
    @classmethod
    def validate_inline_geometry(cls, raw: object) -> object:
        if not isinstance(raw, dict):
            return raw
        edges = raw.copy()
        for id_, edge in raw.items():
            if isinstance(edge, dict) and edge.get("geometry") is not None:
                try:
                    geometry = BoEdgeGeometry.model_validate(edge["geometry"])
                except ValidationError:
                    geometry = None
                edges[id_] = {**edge, "geometry": geometry}
        return edges


@dataclass
class BoInventory:
    # Active values are compared with the drawing. Readable archived endpoints
    # still authorize looking at their saved values and accepting an archive.
    active: BoSnapshot
    objects: set[uuid.UUID]
    applications: set[uuid.UUID]
    edge_ids: set[uuid.UUID]
    application_link_ids: set[uuid.UUID]
    active_applications: dict[uuid.UUID, BoApplication]


class ErDeleteEvidence(BaseModel):
    type: str
    source: uuid.UUID
    target: uuid.UUID


class CardDeleteEvidence(BaseModel):
    type: str
    subtype: str | None


@dataclass(frozen=True)
class SavedDraft:
    operation: BoInventoryItem
    result_id: uuid.UUID
    available: bool
    published: bool


def _uuid_array(ids: Collection[uuid.UUID]) -> ColumnElement[list[uuid.UUID]]:
    # Workspace-sized sets can exceed asyncpg's limit on bind parameters.
    return bindparam(None, list(ids), type_=ARRAY(UUID(as_uuid=True)))


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
                Relation.target_id == any_(_uuid_array(objects)),
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
    return BoInventory(snapshot, objects, applications, edge_ids, application_link_ids, active_apps)


def _group_links(links: list[BoApplicationLink]) -> BoApplicationGroup:
    links.sort(key=lambda link: (link.application.name.casefold(), link.application.id))
    master = next((link.application for link in links if link.is_master), None)
    applications = {link.application.id: link.application for link in links}
    if master is None:
        return BoApplicationGroup(unclassified=list(applications.values()))
    return BoApplicationGroup(
        master=master, slaves=[app for app in applications.values() if app.id != master.id]
    )


def _styled_edge(snapshot: BoSnapshot, edge: BoEdge) -> BoEdge:
    return edge.model_copy(
        update={
            "routing": snapshot.edge_routes.get(edge.id),
            "geometry": snapshot.edge_geometry.get(edge.id),
        }
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
            _styled_edge(snapshot, edge)
            for edge in snapshot.edges.values()
            if edge.source in nodes and edge.target in nodes
        ],
        positions={id_: value for id_, value in snapshot.positions.items() if id_ in nodes},
        applications={id_: _group_links(links) for id_, links in app_links.items()},
        snapshot_revision=snapshot.snapshot_revision,
        capabilities=BoCapabilities(can_manage_master=can_manage_master),
    )


def _saved_item_readable(
    snapshot: BoSnapshot, inventory: BoInventory, kind: str, id_: uuid.UUID
) -> bool:
    if kind == "node":
        return id_ not in snapshot.nodes or id_ in inventory.objects
    if kind == "edge":
        edge = snapshot.edges.get(id_)
        return edge is None or {edge.source, edge.target} <= inventory.objects
    link = snapshot.application_links.get(id_)
    return link is None or (
        link.object_id in inventory.objects and link.application.id in inventory.applications
    )


async def get_bo_graph(db: AsyncSession, user: User) -> BoGraph:
    can_manage_master = await can_manage_bo_master(db, user)
    scope = await bo_read_scope(db, user)
    inventory = await load_bo_inventory(db, scope)
    diagram = await _bo_diagram(db)
    snapshot = BoSnapshot.model_validate(diagram.data or {}) if diagram else BoSnapshot()
    if snapshot.snapshot_revision is None:
        snapshot = inventory.active
    else:
        await _authorize_deleted_snapshot_items(db, user, snapshot, inventory)
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


async def lock_bo_master_endpoints(
    db: AsyncSession,
    scope: CardReadScope,
    object_id: uuid.UUID,
    *,
    new_application_id: uuid.UUID | None = None,
) -> None:
    """With the ownership advisory held, lock cards before ownership relations."""
    applications = await db.scalars(
        select(Card.id)
        .join(Relation, Card.id == Relation.source_id)
        .where(
            Relation.type == APPLICATION_RELATION,
            Relation.target_id == object_id,
            Card.type == APPLICATION_TYPE,
            *scope.where(Card, mode="module"),
        )
    )
    endpoints = {object_id, *applications}
    if new_application_id is not None:
        endpoints.add(new_application_id)
    if object_id not in await lock_relation_endpoints(db, endpoints):
        raise HTTPException(404, "Card not found")


async def set_bo_master(
    db: AsyncSession, user: User, object_id: uuid.UUID, application_id: uuid.UUID | None
) -> BoApplicationGroup:
    if not await can_manage_bo_master(db, user):
        raise HTTPException(403, "Insufficient permissions")
    scope = await bo_read_scope(db, user)
    await lock_bo_master(db, object_id)
    target = await get_bo_card(db, scope, object_id)
    await lock_bo_master_endpoints(db, scope, object_id)
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


def _returning_node_placements(
    snapshot: BoSnapshot, inventory: BoInventory
) -> dict[uuid.UUID, BoSavedPlacement]:
    returning = (inventory.active.nodes.keys() - snapshot.nodes.keys()) & snapshot.positions.keys()
    if not returning:
        return {}
    edges: dict[uuid.UUID, list[BoEdge]] = {id_: [] for id_ in returning}
    links: dict[uuid.UUID, list[BoApplicationLink]] = {id_: [] for id_ in returning}
    for edge in snapshot.edges.values():
        endpoints = {edge.source, edge.target}
        returning_endpoints = endpoints & returning
        if not returning_endpoints or not endpoints <= inventory.objects:
            continue
        styled = _styled_edge(snapshot, edge)
        for id_ in returning_endpoints:
            edges[id_].append(styled)
    for link in snapshot.application_links.values():
        if link.object_id in returning and link.application.id in inventory.applications:
            links[link.object_id].append(link)
    return {
        id_: BoSavedPlacement(
            position=snapshot.positions[id_],
            edges=edges[id_],
            applications=_group_links(links[id_]),
        )
        for id_ in returning
    }


async def compare_bo_inventory(
    db: AsyncSession,
    user: User,
    removed_relation_ids: set[uuid.UUID] | None = None,
    *,
    inventory: BoInventory | None = None,
) -> BoInventoryChanges:
    if inventory is None:
        scope = await bo_read_scope(db, user)
        inventory = await load_bo_inventory(db, scope)
    diagram = await _bo_diagram(db)
    snapshot = BoSnapshot.model_validate(diagram.data or {}) if diagram else BoSnapshot()
    if snapshot.snapshot_revision is None:
        snapshot = inventory.active
    else:
        await _authorize_deleted_snapshot_items(db, user, snapshot, inventory)

    changes: list[BoInventoryChange] = []
    if removed_relation_ids is not None:
        for id_ in sorted(removed_relation_ids & inventory.active.edges.keys()):
            if not _saved_item_readable(snapshot, inventory, "edge", id_):
                continue
            item = BoInventoryItem(kind="edge", id=id_)
            current = inventory.active.edges[id_]
            changes.append(
                BoInventoryChange(
                    **item.model_dump(),
                    change="added",
                    before=None,
                    after=_styled_edge(snapshot, current),
                    revision=inventory_item_revision(item, snapshot.edges.get(id_), current),
                )
            )
        return BoInventoryChanges(changes=changes)

    placements = _returning_node_placements(snapshot, inventory)
    for kind, saved, live, readable in (
        ("node", snapshot.nodes, inventory.active.nodes, inventory.objects),
        ("edge", snapshot.edges, inventory.active.edges, inventory.edge_ids),
        (
            "application_link",
            snapshot.application_links,
            inventory.active.application_links,
            inventory.application_link_ids,
        ),
    ):
        for id_ in sorted((saved.keys() | live.keys()) & readable):
            if not _saved_item_readable(snapshot, inventory, kind, id_):
                continue
            before, after = saved.get(id_), live.get(id_)
            if before == after:
                continue
            item = BoInventoryItem(
                kind=cast(Literal["node", "edge", "application_link"], kind), id=id_
            )
            changes.append(
                BoInventoryChange(
                    **item.model_dump(),
                    change="added" if before is None else "removed" if after is None else "updated",
                    before=before,
                    after=_styled_edge(snapshot, after) if isinstance(after, BoEdge) else after,
                    revision=inventory_item_revision(item, before, after),
                    placement=placements.get(id_) if kind == "node" else None,
                )
            )
    return BoInventoryChanges(changes=changes)


async def _authorize_deleted_snapshot_items(
    db: AsyncSession, user: User, snapshot: BoSnapshot, inventory: BoInventory
) -> None:
    """Admit absent snapshot items only when durable evidence proves visibility."""
    application_ids = {link.application.id for link in snapshot.application_links.values()}
    endpoints = set(snapshot.nodes) | application_ids
    endpoints.update(edge.source for edge in snapshot.edges.values())
    endpoints.update(edge.target for edge in snapshot.edges.values())
    relation_ids = set(snapshot.edges) | set(snapshot.application_links)
    existing_cards = set(
        await db.scalars(select(Card.id).where(Card.id == any_(_uuid_array(endpoints))))
    )
    existing_relations = set(
        await db.scalars(select(Relation.id).where(Relation.id == any_(_uuid_array(relation_ids))))
    )
    absent_cards = endpoints - existing_cards
    absent_relations = relation_ids - existing_relations
    rows = await db.execute(
        select(
            BoOperationReceipt.kind, BoOperationReceipt.result_id, BoOperationReceipt.fingerprint
        )
        .where(
            BoOperationReceipt.kind.in_((INVENTORY_CARD_DELETE, INVENTORY_RELATION_DELETE)),
            BoOperationReceipt.result_id == any_(_uuid_array(absent_cards | absent_relations)),
        )
        .order_by(BoOperationReceipt.created_at.desc(), BoOperationReceipt.id.desc())
    )
    evidence: dict[tuple[str, uuid.UUID], str] = {}
    for kind, id_, value in rows:
        evidence.setdefault((kind, id_), value)
    # Deleted stakeholder rows cannot establish present-day access.
    scope = await CardReadScope.load(
        db, user, include_subtype_denials=True, include_stakeholders=False
    )
    for id_ in absent_cards:
        try:
            card = CardDeleteEvidence.model_validate_json(evidence[(INVENTORY_CARD_DELETE, id_)])
        except (KeyError, ValidationError):
            continue
        if card.type not in (BO_TYPE, APPLICATION_TYPE) or not scope.readable(
            id_, card.type, mode="module", subtype=card.subtype
        ):
            continue
        if card.type == APPLICATION_TYPE and id_ in snapshot.nodes:
            continue
        if card.type == BO_TYPE and id_ in application_ids:
            continue
        if card.type == BO_TYPE:
            inventory.objects.add(id_)
        else:
            inventory.applications.add(id_)

    for id_ in absent_relations:
        edge = snapshot.edges.get(id_)
        link = snapshot.application_links.get(id_)
        if edge:
            type_, source, target = ER_RELATION, edge.source, edge.target
        else:
            assert link is not None
            type_, source, target = APPLICATION_RELATION, link.application.id, link.object_id
        if target not in inventory.objects or source not in (
            inventory.objects if edge else inventory.applications
        ):
            continue
        fingerprint = evidence.get((INVENTORY_RELATION_DELETE, id_))
        if fingerprint:
            try:
                deleted = ErDeleteEvidence.model_validate_json(fingerprint)
            except ValidationError:
                continue
            if (deleted.type, deleted.source, deleted.target) != (type_, source, target):
                continue
        else:
            continue
        (inventory.edge_ids if edge else inventory.application_link_ids).add(id_)


async def _er_delete_evidence(
    db: AsyncSession, user: User, ids: set[uuid.UUID], objects: set[uuid.UUID]
) -> set[uuid.UUID]:
    if not ids:
        return set()
    rows = await db.execute(
        select(BoOperationReceipt.result_id, BoOperationReceipt.fingerprint).where(
            BoOperationReceipt.actor_id == user.id,
            BoOperationReceipt.kind == ER_DELETE_RECEIPT,
            BoOperationReceipt.result_id == any_(_uuid_array(ids)),
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
        return False
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


async def _apply_inventory_changes(
    db: AsyncSession,
    user: User,
    snapshot: BoSnapshot,
    inventory: BoInventory,
    body: BoLayoutUpdate,
    deleted_edges: set[uuid.UUID],
) -> list[BoInventoryItem]:
    if not body.accepted_inventory_changes:
        return []

    def removal_kind(change: BoAcceptedInventoryChange) -> str:
        return f"accepted_remove_{change.kind}"

    receipts = {
        (receipt.kind, receipt.draft_id): receipt
        for receipt in await db.scalars(
            select(BoOperationReceipt).where(
                BoOperationReceipt.actor_id == user.id,
                BoOperationReceipt.kind.in_(
                    {removal_kind(change) for change in body.accepted_inventory_changes}
                ),
                BoOperationReceipt.draft_id
                == any_(_uuid_array({change.id for change in body.accepted_inventory_changes})),
            )
        )
    }

    def apply(
        change: BoAcceptedInventoryChange,
        saved_items: dict[uuid.UUID, SnapshotItem],
        live_items: dict[uuid.UUID, SnapshotItem],
        readable_ids: set[uuid.UUID],
    ) -> bool:
        kind = removal_kind(change)
        receipt = receipts.get((kind, change.id))
        absent = change.id not in live_items
        had_saved_item = change.id in saved_items
        # Replaying a removal can only acknowledge the same actor's committed
        # acceptance. It has no effect on inventory or the drawing.
        if absent and not had_saved_item and receipt and receipt.fingerprint == change.revision:
            return True
        if not _apply_inventory_item(change, saved_items, live_items, readable_ids):
            return False
        if absent and had_saved_item:
            if receipt is None:
                db.add(
                    BoOperationReceipt(
                        actor_id=user.id,
                        draft_id=change.id,
                        kind=kind,
                        result_id=change.id,
                        fingerprint=change.revision,
                    )
                )
            else:
                receipt.fingerprint = change.revision
        return True

    live = inventory.active
    readable_edges = inventory.edge_ids | deleted_edges
    conflicts: list[BoInventoryItem] = []
    promoted: dict[uuid.UUID, uuid.UUID] = {}
    for change in body.accepted_inventory_changes:
        if not _saved_item_readable(snapshot, inventory, change.kind, change.id):
            conflicts.append(BoInventoryItem(kind=change.kind, id=change.id))
            continue
        if change.kind == "node":
            applied = apply(change, snapshot.nodes, live.nodes, inventory.objects)
        elif change.kind == "edge":
            applied = apply(change, snapshot.edges, live.edges, readable_edges)
        else:
            applied = apply(
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
    _normalize_saved_masters(snapshot, promoted)
    return conflicts


async def _draft_receipt_results(
    db: AsyncSession, actor_id: uuid.UUID, operations: Collection[tuple[str, uuid.UUID]]
) -> dict[tuple[str, uuid.UUID], uuid.UUID]:
    if not operations:
        return {}
    kinds = {kind for kind, _ in operations}
    rows = await db.execute(
        select(
            BoOperationReceipt.kind, BoOperationReceipt.draft_id, BoOperationReceipt.result_id
        ).where(
            BoOperationReceipt.actor_id == actor_id,
            BoOperationReceipt.kind.in_(kinds | {f"layout_{kind}" for kind in kinds}),
            BoOperationReceipt.draft_id == any_(_uuid_array({id_ for _, id_ in operations})),
        )
    )
    return {(kind, id_): result for kind, id_, result in rows}


async def compare_bo_draft(
    db: AsyncSession, user: User, body: BoDraftComparison
) -> BoDraftComparisonResult:
    requested = {(item.kind, item.id): item for item in body.draft_operations}
    # A receipt committed during this read can be retried safely as pending.
    # Read receipts first so a new receipt cannot outpace its inventory result.
    results = await _draft_receipt_results(db, user.id, requested.keys())
    scope = await bo_read_scope(db, user)
    inventory = await load_bo_inventory(db, scope)
    changes = await compare_bo_inventory(
        db, user, set(body.removed_relation_ids), inventory=inventory
    )
    live: dict[str, Mapping[uuid.UUID, BoNode | BoEdge | BoApplicationLink]] = {
        "node": inventory.active.nodes,
        "edge": inventory.active.edges,
        "application_link": inventory.active.application_links,
    }
    drafts = []
    for (kind, id_), item in requested.items():
        result_id = results.get((kind, id_))
        value = live[kind].get(result_id) if result_id else None
        status: Literal["pending", "unavailable", "saved", "published"] = (
            "pending"
            if result_id is None
            else "unavailable"
            if value is None
            else "published"
            if (f"layout_{kind}", id_) in results
            else "saved"
        )
        drafts.append(BoDraftResult(**item.model_dump(), status=status, value=value))
    return BoDraftComparisonResult(
        changes=changes.changes,
        draft_results=drafts,
        object_ids=[id_ for id_ in dict.fromkeys(body.object_ids) if id_ in inventory.active.nodes],
        applications=[
            inventory.active_applications[id_]
            for id_ in dict.fromkeys(body.application_ids)
            if id_ in inventory.active_applications
        ],
    )


def _normalize_saved_masters(snapshot: BoSnapshot, promoted: dict[uuid.UUID, uuid.UUID]) -> None:
    # Accepting both sides of a transfer must be independent of input order.
    if promoted:
        for link in snapshot.application_links.values():
            if (
                link.is_master
                and link.object_id in promoted
                and promoted[link.object_id] != link.id
            ):
                link.is_master = False


async def _load_saved_drafts(
    db: AsyncSession,
    user: User,
    live: BoSnapshot,
    drafts: list[BoInventoryItem],
) -> list[SavedDraft]:
    requested = {(item.kind, item.id): item for item in drafts}
    results = await _draft_receipt_results(db, user.id, requested.keys())
    live_items: dict[str, Mapping[uuid.UUID, BaseModel]] = {
        "node": live.nodes,
        "edge": live.edges,
        "application_link": live.application_links,
    }
    saved_drafts = []
    for (kind, draft_id), item in requested.items():
        result_id = results.get((kind, draft_id))
        if result_id is None:
            raise HTTPException(404, "Draft result not found")
        saved_drafts.append(
            SavedDraft(
                operation=item,
                result_id=result_id,
                available=result_id in live_items[kind],
                published=(f"layout_{kind}", draft_id) in results,
            )
        )
    return saved_drafts


def _apply_saved_drafts(
    db: AsyncSession,
    user: User,
    snapshot: BoSnapshot,
    live: BoSnapshot,
    drafts: list[SavedDraft],
) -> None:
    promoted: dict[uuid.UUID, uuid.UUID] = {}
    for draft in drafts:
        if not draft.available or draft.published:
            continue
        kind, result_id = draft.operation.kind, draft.result_id
        if kind == "node":
            snapshot.nodes[result_id] = live.nodes[result_id]
        elif kind == "edge":
            snapshot.edges[result_id] = live.edges[result_id]
        else:
            link = live.application_links[result_id]
            snapshot.application_links[result_id] = link
            if link.is_master:
                promoted[link.object_id] = link.id
        # The drawing row is locked. Record publication in the same transaction
        # so a retry after a lost layout response cannot restore a removed line.
        db.add(
            BoOperationReceipt(
                actor_id=user.id,
                draft_id=draft.operation.id,
                kind=f"layout_{kind}",
                result_id=result_id,
                fingerprint=str(result_id),
            )
        )
    _normalize_saved_masters(snapshot, promoted)


async def save_bo_layout(db: AsyncSession, user: User, body: BoLayoutUpdate) -> BoLayoutResult:
    can_manage_master = await can_manage_bo_master(db, user)
    scope = await bo_read_scope(db, user)
    diagram = await _bo_diagram(db, lock=True)
    assert diagram is not None
    snapshot = BoSnapshot.model_validate(diagram.data or {})
    inventory = await load_bo_inventory(db, scope)
    # Authorize visual removals against the scoped inventory before adding deletion evidence.
    unavailable_nodes = body.removed_node_ids - inventory.objects
    if snapshot.snapshot_revision is None:
        snapshot = (await load_bo_inventory(db, CardReadScope.everything())).active
    else:
        await _authorize_deleted_snapshot_items(db, user, snapshot, inventory)
    prior = snapshot.model_dump(mode="json")
    drafts = await _load_saved_drafts(db, user, inventory.active, body.saved_drafts)
    drafts = [
        draft
        if _saved_item_readable(snapshot, inventory, draft.operation.kind, draft.result_id)
        else replace(draft, available=False)
        for draft in drafts
    ]
    unavailable = [draft for draft in drafts if not draft.available]
    unavailable_positions = {
        draft.result_id for draft in unavailable if draft.operation.kind == "node"
    }
    accepted_nodes = {item.id for item in body.accepted_inventory_changes if item.kind == "node"}
    unavailable_positions |= accepted_nodes - inventory.objects
    positions = body.positions.keys() | body.auto_positions.keys()
    skipped_positions = positions - inventory.objects - unavailable_positions
    if skipped_positions and not body.skip_unavailable_positions:
        raise HTTPException(404, "Card not found")
    unavailable_positions |= skipped_positions

    accepted_edges = {item.id for item in body.accepted_inventory_changes if item.kind == "edge"}
    evidence_ids = (body.removed_relation_ids | accepted_edges) - inventory.edge_ids
    deleted_edges = await _er_delete_evidence(db, user, evidence_ids, inventory.objects)
    unavailable_relations = (body.removed_relation_ids - (inventory.edge_ids | deleted_edges)) | (
        body.restored_relation_ids - inventory.active.edges.keys()
    )
    unavailable_relations |= {
        id_
        for id_ in body.removed_relation_ids | body.restored_relation_ids
        if not _saved_item_readable(snapshot, inventory, "edge", id_)
    }
    if unavailable_relations and not body.skip_unavailable_relations:
        raise HTTPException(404, "Relation not found")

    conflicts = await _apply_inventory_changes(db, user, snapshot, inventory, body, deleted_edges)
    _apply_saved_drafts(db, user, snapshot, inventory.active, drafts)
    conflicting_nodes = {item.id for item in conflicts if item.kind == "node"}
    conflicts.extend(
        BoInventoryItem(kind="node", id=id_)
        for id_ in sorted(unavailable_nodes - conflicting_nodes)
    )
    # Projection drops incident lines and Application links with the node.
    # Retain their saved values and position for an explicit re-add through Synch.
    for id_ in body.removed_node_ids - unavailable_nodes:
        snapshot.nodes.pop(id_, None)
    conflicting_edges = {item.id for item in conflicts if item.kind == "edge"}
    conflicts.extend(
        BoInventoryItem(kind="edge", id=id_)
        for id_ in sorted(unavailable_relations - conflicting_edges)
    )
    for id_ in body.removed_relation_ids - unavailable_relations:
        snapshot.edges.pop(id_, None)
    for id_ in body.restored_relation_ids - (conflicting_edges | unavailable_relations):
        snapshot.edges.setdefault(id_, inventory.active.edges[id_])
    for id_ in body.edge_routes.keys() | body.edge_geometry.keys():
        if id_ not in inventory.edge_ids or not _saved_item_readable(
            snapshot, inventory, "edge", id_
        ):
            if id_ not in conflicting_edges and id_ not in unavailable_relations:
                conflicts.append(BoInventoryItem(kind="edge", id=id_))
            continue
        if id_ not in snapshot.edges:
            if id_ not in body.removed_relation_ids and id_ not in conflicting_edges:
                conflicts.append(BoInventoryItem(kind="edge", id=id_))
            continue
        routing = body.edge_routes.get(id_)
        if routing == "orthogonal":
            snapshot.edge_routes[id_] = routing
        elif routing == "straight":
            snapshot.edge_routes.pop(id_, None)
        if id_ in body.edge_geometry:
            geometry = body.edge_geometry[id_]
            if geometry is None:
                snapshot.edge_geometry.pop(id_, None)
            else:
                snapshot.edge_geometry[id_] = geometry
    snapshot.positions.update(
        (id_, position)
        for id_, position in body.positions.items()
        if id_ not in unavailable_positions
    )
    for id_, position in body.auto_positions.items():
        if id_ not in unavailable_positions:
            snapshot.positions.setdefault(id_, position)
    if snapshot.snapshot_revision is None or snapshot.model_dump(mode="json") != prior:
        snapshot.snapshot_revision = uuid.uuid4()
        diagram.data = snapshot.model_dump(mode="json")
        await db.flush()
    graph = _project_graph(snapshot, inventory, can_manage_master=can_manage_master)
    return BoLayoutResult(
        **graph.model_dump(),
        inventory_conflicts=conflicts,
        unavailable_drafts=[draft.operation for draft in unavailable],
        skipped_positions=len(skipped_positions),
    )
