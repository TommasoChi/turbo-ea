"""Request-scoped implementations of the public backend extension bridges."""

from __future__ import annotations

from collections import deque
from typing import Any, Sequence
from uuid import UUID

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType
from app.models.diagram import Diagram, diagram_cards
from app.models.diagram_group import DiagramGroup, diagram_group_members
from app.models.document import Document
from app.models.event import Event
from app.models.file_attachment import FileAttachment
from app.models.process_element import ProcessElement, ProcessElementOrganization
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.stakeholder import Stakeholder
from app.models.user import User
from app.schemas.common import DocumentCreate
from app.services.card_logo_service import logo_updated_map
from app.services.event_bus import event_bus
from app.services.extensions.sdk import (
    ApplicationCandidate,
    AuditEvent,
    CardHierarchy,
    CardRef,
    CardTypeDefinition,
    DependencyEdge,
    DependencyNode,
    DependencySubgraph,
    DiagramArtifactGateway,
    DiagramGroupRef,
    DiagramRef,
    ExtensionActor,
    ExtensionBridgeError,
    ExtensionRequestContext,
    NotificationReceipt,
    OrganizationLink,
    OrganizationLinks,
    OrganizationStepLink,
    ResolvedCard,
    ResourceFile,
    ResourceItem,
)
from app.services.notification_service import create_notification
from app.services.permission_service import PermissionService
from app.services.resource_service import ResourcePolicyError, validate_file_upload

_ALLOWED_CARD_TYPES: dict[str, frozenset[str] | None] = {
    "BusinessContext": frozenset({"businessProduct"}),
    "Platform": frozenset({"digital"}),
    "Application": None,
    "ITComponent": None,
    "TechCategory": None,
    "Provider": None,
    "BusinessProcess": None,
    "BusinessCapability": None,
    "Objective": frozenset({"businessGoal", "valueGate"}),
}


_DEPENDENCY_CARD_TYPES = frozenset(
    {
        "BusinessContext",
        "Platform",
        "Application",
        "ITComponent",
        "Interface",
        "DataObject",
        "BusinessProcess",
    }
)
_DEPENDENCY_RELATION_TYPES = frozenset(
    {
        "relAppToBizCtx",
        "relPlatformToBusinessProduct",
        "relPlatformToApp",
        "relAppToITC",
        "relPlatformToITC",
        "relITCToDataObj",
        "ITComponentToDataObject",
        "relAppToDataObj",
        "relAppToInterface",
        "relInterfaceToDataObj",
        "relInterfaceToITC",
        "relProcessToBizCtx",
        "relProcessToApp",
        "relProcessToITC",
        "relProcessToDataObj",
    }
)
_DEPENDENCY_CARD_ATTRIBUTE_KEYS = frozenset(
    {
        "product",
        "technology",
        "version",
        "provider",
        "deploymentModel",
        "endOfLife",
        "description",
    }
)
_DEPENDENCY_RELATION_ATTRIBUTE_KEYS = frozenset({"flowDirection", "usageType", "supportType"})

_HIERARCHY_CARD_TYPES = frozenset({"Organization"})
_ORGANIZATION_RELATION_TYPES = frozenset({"relProcessToOrg", "relOrgToApp", "relOrgToDataObj"})


class _CoreQueryBridge:
    def __init__(self, db: AsyncSession, user: Any) -> None:
        self._db = db
        self._user = user

    async def list_card_type_definitions(
        self,
        type_keys: Sequence[str],
    ) -> tuple[CardTypeDefinition, ...]:
        requested = tuple(dict.fromkeys(str(key) for key in type_keys if str(key)))
        if not requested:
            return ()
        rows = (
            (
                await self._db.execute(
                    select(CardType)
                    .where(CardType.key.in_(requested), CardType.is_hidden == False)  # noqa: E712
                    .order_by(CardType.sort_order.asc(), CardType.key.asc())
                )
            )
            .scalars()
            .all()
        )
        definitions = []
        for card_type in rows:
            subtypes = tuple(
                (str(item["key"]), str(item.get("label") or item["key"]))
                for item in (card_type.subtypes or [])
                if isinstance(item, dict) and isinstance(item.get("key"), str)
            )
            definitions.append(
                CardTypeDefinition(
                    key=card_type.key,
                    label=card_type.label,
                    subtypes=subtypes,
                )
            )
        return tuple(definitions)

    async def _require_card(
        self,
        card_id: UUID,
        *,
        expected_type: str,
        expected_subtype: str | None = None,
    ) -> Card:
        card = (
            await self._db.execute(select(Card).where(Card.id == card_id, Card.status == "ACTIVE"))
        ).scalar_one_or_none()
        if card is None:
            raise ExtensionBridgeError(
                "reference_not_found",
                "The referenced card does not exist or is not active",
                details={"card_id": str(card_id)},
            )
        if not await PermissionService.check_permission(
            self._db,
            self._user,
            "inventory.view",
            card.id,
            "card.view",
        ):
            raise ExtensionBridgeError(
                "permission_denied",
                "The current actor cannot view the referenced card",
                details={"card_id": str(card_id)},
            )
        if card.type != expected_type:
            raise ExtensionBridgeError(
                "reference_type_mismatch",
                "The referenced card has an unexpected type",
                details={
                    "card_id": str(card_id),
                    "expected_type": expected_type,
                    "actual_type": card.type,
                },
            )
        if expected_subtype is not None and card.subtype != expected_subtype:
            raise ExtensionBridgeError(
                "reference_subtype_mismatch",
                "The referenced card has an unexpected subtype",
                details={
                    "card_id": str(card_id),
                    "expected_subtype": expected_subtype,
                    "actual_subtype": card.subtype,
                },
            )
        return card

    @staticmethod
    def _summary(
        card: Card,
        attribute_keys: tuple[str, ...] = (),
    ) -> ResolvedCard:
        source_attributes = dict(card.attributes or {})
        return ResolvedCard(
            id=card.id,
            type=card.type,
            subtype=card.subtype,
            name=card.name,
            reference=card.reference,
            lifecycle=dict(card.lifecycle or {}),
            attributes={
                key: source_attributes[key] for key in attribute_keys if key in source_attributes
            },
        )

    async def resolve_cards(self, refs: Sequence[CardRef]) -> list[ResolvedCard]:
        resolved: list[ResolvedCard] = []
        for ref in refs:
            allowed_subtypes = _ALLOWED_CARD_TYPES.get(ref.expected_type)
            if ref.expected_type not in _ALLOWED_CARD_TYPES or (
                allowed_subtypes is not None and ref.expected_subtype not in allowed_subtypes
            ):
                raise ExtensionBridgeError(
                    "validation_failed",
                    "The requested card type or subtype is not exposed by this SDK gateway",
                    details={
                        "expected_type": ref.expected_type,
                        "expected_subtype": ref.expected_subtype,
                    },
                )
            card = await self._require_card(
                ref.id,
                expected_type=ref.expected_type,
                expected_subtype=ref.expected_subtype,
            )
            resolved.append(self._summary(card, ref.attribute_keys))
        return resolved

    @staticmethod
    def _validate_dependency_subset(
        values: Sequence[str],
        *,
        allowed: frozenset[str],
        field: str,
        allow_empty: bool = False,
    ) -> tuple[str, ...]:
        if isinstance(values, (str, bytes)):
            requested: tuple[str, ...] = ()
        else:
            try:
                requested = tuple(values)
            except TypeError:
                requested = ()

        normalized = tuple(
            dict.fromkeys(
                value.strip() for value in requested if isinstance(value, str) and value.strip()
            )
        )
        if (
            (not normalized and not allow_empty)
            or len(normalized) != len(requested)
            or not set(normalized).issubset(allowed)
        ):
            raise ExtensionBridgeError(
                "invalid_dependency_query",
                "The dependency query is outside the public SDK allowlists",
                details={"field": field},
            )
        return normalized

    @staticmethod
    def _dependency_node(
        card: Card,
        attribute_keys: tuple[str, ...],
        *,
        logo_updated_at: str | None = None,
    ) -> DependencyNode:
        source_attributes = dict(card.attributes or {})
        attributes = {
            key: source_attributes[key]
            for key in attribute_keys
            if key != "description" and key in source_attributes
        }
        if "description" in attribute_keys and card.description is not None:
            attributes["description"] = card.description
        return DependencyNode(
            id=card.id,
            name=card.name,
            type=card.type,
            subtype=card.subtype,
            reference=card.reference,
            lifecycle=dict(card.lifecycle or {}),
            attributes=attributes,
            parent_id=card.parent_id,
            logo_updated_at=logo_updated_at,
        )

    @staticmethod
    def _dependency_subtype_is_allowed(card: Card) -> bool:
        allowed_subtypes = _ALLOWED_CARD_TYPES.get(card.type)
        return allowed_subtypes is None or card.subtype in allowed_subtypes

    async def read_dependency_subgraph(
        self,
        root_card_id: UUID,
        *,
        allowed_card_types: Sequence[str],
        allowed_relation_types: Sequence[str],
        max_depth: int = 3,
        card_attribute_keys: Sequence[str] = (),
        relation_attribute_keys: Sequence[str] = (),
    ) -> DependencySubgraph:
        card_types = self._validate_dependency_subset(
            allowed_card_types,
            allowed=_DEPENDENCY_CARD_TYPES,
            field="allowed_card_types",
        )
        relation_types = self._validate_dependency_subset(
            allowed_relation_types,
            allowed=_DEPENDENCY_RELATION_TYPES,
            field="allowed_relation_types",
        )
        card_attributes = self._validate_dependency_subset(
            card_attribute_keys,
            allowed=_DEPENDENCY_CARD_ATTRIBUTE_KEYS,
            field="card_attribute_keys",
            allow_empty=True,
        )
        relation_attributes = self._validate_dependency_subset(
            relation_attribute_keys,
            allowed=_DEPENDENCY_RELATION_ATTRIBUTE_KEYS,
            field="relation_attribute_keys",
            allow_empty=True,
        )
        if isinstance(max_depth, bool) or not isinstance(max_depth, int) or not 1 <= max_depth <= 3:
            raise ExtensionBridgeError(
                "invalid_dependency_query",
                "Dependency query depth must be between 1 and 3",
                details={"field": "max_depth"},
            )

        root = (
            await self._db.execute(
                select(Card).where(
                    Card.id == root_card_id,
                    Card.status == "ACTIVE",
                )
            )
        ).scalar_one_or_none()
        if root is None:
            raise ExtensionBridgeError(
                "reference_not_found",
                "The referenced card does not exist or is not active",
                details={"card_id": str(root_card_id)},
            )
        if not await PermissionService.check_permission(
            self._db,
            self._user,
            "inventory.view",
            root.id,
            "card.view",
        ):
            raise ExtensionBridgeError(
                "permission_denied",
                "The current actor cannot view the referenced card",
                details={"card_id": str(root_card_id)},
            )
        if root.type not in card_types:
            raise ExtensionBridgeError(
                "reference_type_mismatch",
                "The dependency root has an unexpected type",
                details={
                    "card_id": str(root_card_id),
                    "expected_types": sorted(card_types),
                    "actual_type": root.type,
                },
            )
        if not self._dependency_subtype_is_allowed(root):
            allowed_subtypes = _ALLOWED_CARD_TYPES[root.type]
            raise ExtensionBridgeError(
                "reference_subtype_mismatch",
                "The dependency root has an unexpected subtype",
                details={
                    "card_id": str(root_card_id),
                    "expected_subtypes": sorted(allowed_subtypes or ()),
                    "actual_subtype": root.subtype,
                },
            )

        visible_cards: dict[UUID, Card] = {root.id: root}
        filtered_ids: set[UUID] = set()
        nodes: dict[UUID, DependencyNode] = {root.id: self._dependency_node(root, card_attributes)}
        edges: dict[tuple[str, UUID, UUID], DependencyEdge] = {}
        visited: set[UUID] = {root.id}
        frontier: deque[tuple[Card, int]] = deque([(root, 0)])
        partial = False

        while frontier:
            current, depth = frontier.popleft()
            if depth >= max_depth:
                continue

            rows = (
                await self._db.execute(
                    select(Relation, RelationType)
                    .join(RelationType, RelationType.key == Relation.type)
                    .where(
                        Relation.type.in_(relation_types),
                        or_(
                            Relation.source_id == current.id,
                            Relation.target_id == current.id,
                        ),
                    )
                )
            ).all()

            for relation, relation_type in rows:
                other_id = (
                    relation.target_id if relation.source_id == current.id else relation.source_id
                )
                if other_id in filtered_ids:
                    partial = True
                    continue

                other = visible_cards.get(other_id)
                if other is None:
                    other = (
                        await self._db.execute(
                            select(Card).where(
                                Card.id == other_id,
                                Card.status == "ACTIVE",
                            )
                        )
                    ).scalar_one_or_none()
                    if (
                        other is None
                        or other.type not in card_types
                        or not self._dependency_subtype_is_allowed(other)
                    ):
                        filtered_ids.add(other_id)
                        partial = True
                        continue
                    if not await PermissionService.check_permission(
                        self._db,
                        self._user,
                        "inventory.view",
                        other.id,
                        "card.view",
                    ):
                        filtered_ids.add(other_id)
                        partial = True
                        continue
                    visible_cards[other.id] = other
                    nodes[other.id] = self._dependency_node(other, card_attributes)

                edge_key = (relation.type, relation.source_id, relation.target_id)
                if edge_key not in edges:
                    source_attributes = dict(relation.attributes or {})
                    edges[edge_key] = DependencyEdge(
                        source_id=relation.source_id,
                        target_id=relation.target_id,
                        type=relation.type,
                        label=relation_type.label,
                        reverse_label=relation_type.reverse_label,
                        description=relation.description,
                        attributes={
                            key: source_attributes[key]
                            for key in relation_attributes
                            if key in source_attributes
                        },
                    )

                if other.id not in visited:
                    visited.add(other.id)
                    frontier.append((other, depth + 1))

        logo_updates = await logo_updated_map(self._db, list(visible_cards.values()))
        nodes = {
            card_id: self._dependency_node(
                card,
                card_attributes,
                logo_updated_at=(
                    logo_updates[card_id].isoformat() if card_id in logo_updates else None
                ),
            )
            for card_id, card in visible_cards.items()
        }

        return DependencySubgraph(
            root_id=root.id,
            nodes=tuple(
                sorted(
                    nodes.values(),
                    key=lambda node: (node.type, node.name.casefold(), str(node.id)),
                )
            ),
            edges=tuple(
                sorted(
                    edges.values(),
                    key=lambda edge: (
                        edge.type,
                        str(edge.source_id),
                        str(edge.target_id),
                    ),
                )
            ),
            partial=partial,
        )

    async def read_card_hierarchy(
        self,
        card_id: UUID,
        *,
        allowed_card_types: Sequence[str],
        card_attribute_keys: Sequence[str] = (),
    ) -> CardHierarchy:
        card_types = self._validate_dependency_subset(
            allowed_card_types,
            allowed=_DEPENDENCY_CARD_TYPES,
            field="allowed_card_types",
        )
        card_attributes = self._validate_dependency_subset(
            card_attribute_keys,
            allowed=_DEPENDENCY_CARD_ATTRIBUTE_KEYS,
            field="card_attribute_keys",
            allow_empty=True,
        )
        root = (
            await self._db.execute(select(Card).where(Card.id == card_id, Card.status == "ACTIVE"))
        ).scalar_one_or_none()
        if root is None:
            raise ExtensionBridgeError(
                "reference_not_found",
                "The referenced card does not exist or is not active",
                details={"card_id": str(card_id)},
            )
        if root.type not in card_types or not self._dependency_subtype_is_allowed(root):
            raise ExtensionBridgeError(
                "reference_type_mismatch",
                "The hierarchy root has an unexpected type or subtype",
                details={"card_id": str(card_id)},
            )
        if not await PermissionService.check_permission(
            self._db, self._user, "inventory.view", root.id, "card.view"
        ):
            raise ExtensionBridgeError(
                "permission_denied",
                "The current actor cannot view the referenced card",
                details={"card_id": str(card_id)},
            )

        partial = False
        parent_card: Card | None = None
        if root.parent_id is not None:
            candidate_parent = (
                await self._db.execute(
                    select(Card).where(Card.id == root.parent_id, Card.status == "ACTIVE")
                )
            ).scalar_one_or_none()
            if (
                candidate_parent is None
                or candidate_parent.type not in card_types
                or not self._dependency_subtype_is_allowed(candidate_parent)
            ):
                partial = True
            elif not await PermissionService.check_permission(
                self._db, self._user, "inventory.view", candidate_parent.id, "card.view"
            ):
                partial = True
            else:
                parent_card = candidate_parent

        child_rows = (
            (
                await self._db.execute(
                    select(Card)
                    .where(Card.parent_id == root.id, Card.status == "ACTIVE")
                    .order_by(Card.id)
                )
            )
            .scalars()
            .all()
        )
        visible_children: list[Card] = []
        for child in child_rows:
            if child.type not in card_types or not self._dependency_subtype_is_allowed(child):
                partial = True
                continue
            if not await PermissionService.check_permission(
                self._db, self._user, "inventory.view", child.id, "card.view"
            ):
                partial = True
                continue
            visible_children.append(child)

        hierarchy_cards = [root]
        if parent_card is not None:
            hierarchy_cards.append(parent_card)
        hierarchy_cards.extend(visible_children)
        logo_updates = await logo_updated_map(self._db, hierarchy_cards)

        def node_with_logo(card: Card) -> DependencyNode:
            updated_at = logo_updates.get(card.id)
            return self._dependency_node(
                card,
                card_attributes,
                logo_updated_at=updated_at.isoformat() if updated_at else None,
            )

        return CardHierarchy(
            root=node_with_logo(root),
            parent=node_with_logo(parent_card) if parent_card is not None else None,
            children=tuple(node_with_logo(child) for child in visible_children),
            partial=partial,
        )

    async def list_product_platforms(self, product_id: UUID) -> list[ResolvedCard]:
        await self._require_card(
            product_id,
            expected_type="BusinessContext",
            expected_subtype="businessProduct",
        )
        rows = (
            (
                await self._db.execute(
                    select(Card)
                    .join(Relation, Relation.source_id == Card.id)
                    .join(RelationType, RelationType.key == Relation.type)
                    .where(
                        Relation.target_id == product_id,
                        RelationType.source_type_key == "Platform",
                        RelationType.target_type_key == "BusinessContext",
                        Card.type == "Platform",
                        Card.subtype == "digital",
                        Card.status == "ACTIVE",
                    )
                    .order_by(func.lower(Card.name), Card.id)
                )
            )
            .scalars()
            .unique()
            .all()
        )
        visible: list[ResolvedCard] = []
        for card in rows:
            if await PermissionService.check_permission(
                self._db,
                self._user,
                "inventory.view",
                card.id,
                "card.view",
            ):
                visible.append(self._summary(card))
        return visible

    async def list_product_applications(
        self,
        product_id: UUID,
        platform_ids: Sequence[UUID],
    ) -> list[ApplicationCandidate]:
        await self._require_card(
            product_id,
            expected_type="BusinessContext",
            expected_subtype="businessProduct",
        )
        allowed_platforms = {
            platform.id for platform in await self.list_product_platforms(product_id)
        }
        selected_platforms = set(platform_ids)
        invalid_platforms = sorted(selected_platforms - allowed_platforms, key=str)
        if invalid_platforms:
            raise ExtensionBridgeError(
                "validation_failed",
                "One or more selected platforms are not linked to the product",
                details={
                    "invalid_platform_ids": [str(platform_id) for platform_id in invalid_platforms]
                },
            )

        direct_cards = (
            (
                await self._db.execute(
                    select(Card)
                    .join(Relation, Relation.source_id == Card.id)
                    .join(RelationType, RelationType.key == Relation.type)
                    .where(
                        Relation.target_id == product_id,
                        RelationType.source_type_key == "Application",
                        RelationType.target_type_key == "BusinessContext",
                        Card.type == "Application",
                        Card.status == "ACTIVE",
                    )
                )
            )
            .scalars()
            .unique()
            .all()
        )

        via_rows: list[tuple[Card, UUID]] = []
        if selected_platforms:
            via_rows = [
                (row[0], row[1])
                for row in (
                    await self._db.execute(
                        select(Card, Relation.source_id)
                        .join(Relation, Relation.target_id == Card.id)
                        .join(RelationType, RelationType.key == Relation.type)
                        .where(
                            Relation.source_id.in_(selected_platforms),
                            RelationType.source_type_key == "Platform",
                            RelationType.target_type_key == "Application",
                            Card.type == "Application",
                            Card.status == "ACTIVE",
                        )
                    )
                ).all()
            ]

        direct_ids = {card.id for card in direct_cards}
        cards_by_id = {card.id: card for card in direct_cards}
        platform_ids_by_app: dict[UUID, set[UUID]] = {}
        for card, platform_id in via_rows:
            cards_by_id[card.id] = card
            platform_ids_by_app.setdefault(card.id, set()).add(platform_id)

        candidates: list[ApplicationCandidate] = []
        for card in sorted(
            cards_by_id.values(), key=lambda row: (row.name.casefold(), str(row.id))
        ):
            if not await PermissionService.check_permission(
                self._db,
                self._user,
                "inventory.view",
                card.id,
                "card.view",
            ):
                continue
            is_direct = card.id in direct_ids
            via_platform_ids = tuple(sorted(platform_ids_by_app.get(card.id, set()), key=str))
            provenance = (
                "both"
                if is_direct and via_platform_ids
                else "direct"
                if is_direct
                else "via_platform"
            )
            candidates.append(
                ApplicationCandidate(
                    id=card.id,
                    name=card.name,
                    reference=card.reference,
                    provenance=provenance,
                    via_platform_ids=via_platform_ids,
                )
            )
        return candidates

    async def has_stakeholder_role(
        self,
        card_id: UUID,
        role_key: str,
    ) -> bool:
        normalized_role = str(role_key).strip()
        if not normalized_role:
            raise ExtensionBridgeError(
                "validation_failed",
                "Stakeholder role key must not be empty",
            )
        card = (
            await self._db.execute(
                select(Card).where(
                    Card.id == card_id,
                    Card.status == "ACTIVE",
                )
            )
        ).scalar_one_or_none()
        if card is None:
            raise ExtensionBridgeError(
                "reference_not_found",
                "The referenced card does not exist or is not active",
                details={"card_id": str(card_id)},
            )
        if not await PermissionService.check_permission(
            self._db,
            self._user,
            "inventory.view",
            card.id,
            "card.view",
        ):
            raise ExtensionBridgeError(
                "permission_denied",
                "The current actor cannot view the referenced card",
                details={"card_id": str(card_id)},
            )
        assignment = (
            await self._db.execute(
                select(Stakeholder.id).where(
                    Stakeholder.card_id == card.id,
                    Stakeholder.user_id == self._user.id,
                    Stakeholder.role == normalized_role,
                )
            )
        ).scalar_one_or_none()
        return assignment is not None

    async def list_descendant_ids(
        self,
        root_id: UUID,
        *,
        expected_type: str,
    ) -> list[UUID]:
        if expected_type not in _HIERARCHY_CARD_TYPES:
            raise ExtensionBridgeError(
                "validation_failed",
                "The requested card type is not exposed by the hierarchy gateway",
                details={"expected_type": expected_type},
            )
        root = await self._require_card(root_id, expected_type=expected_type)

        descendants: set[UUID] = set()
        frontier: deque[Card] = deque([root])
        while frontier:
            current = frontier.popleft()
            rows = (
                (
                    await self._db.execute(
                        select(Card).where(
                            Card.parent_id == current.id,
                            Card.status == "ACTIVE",
                        )
                    )
                )
                .scalars()
                .all()
            )
            for child in rows:
                if child.id in descendants:
                    continue
                if not await PermissionService.check_permission(
                    self._db,
                    self._user,
                    "inventory.view",
                    child.id,
                    "card.view",
                ):
                    continue
                descendants.add(child.id)
                frontier.append(child)

        return sorted(descendants, key=str)

    async def read_organization_links(
        self,
        org_ids: Sequence[UUID],
    ) -> OrganizationLinks:
        requested_ids = list(dict.fromkeys(org_ids))
        if not requested_ids:
            return OrganizationLinks(links=(), step_links=(), partial=False)

        org_rows = (
            (
                await self._db.execute(
                    select(Card).where(
                        Card.id.in_(requested_ids),
                        Card.type == "Organization",
                        Card.status == "ACTIVE",
                    )
                )
            )
            .scalars()
            .all()
        )
        partial = len(org_rows) != len(requested_ids)

        visible_org_ids: set[UUID] = set()
        for org in org_rows:
            if await PermissionService.check_permission(
                self._db,
                self._user,
                "inventory.view",
                org.id,
                "card.view",
            ):
                visible_org_ids.add(org.id)
            else:
                partial = True

        if not visible_org_ids:
            return OrganizationLinks(links=(), step_links=(), partial=partial)

        links_result = await self._read_organization_relation_links(visible_org_ids)
        if links_result.partial:
            partial = True

        step_links, step_partial = await self._read_organization_step_links(visible_org_ids)
        if step_partial:
            partial = True

        return OrganizationLinks(
            links=links_result.links,
            step_links=step_links,
            partial=partial,
        )

    async def _read_organization_relation_links(
        self,
        visible_org_ids: set[UUID],
    ) -> OrganizationLinks:
        rows = (
            (
                await self._db.execute(
                    select(Relation).where(
                        Relation.type.in_(_ORGANIZATION_RELATION_TYPES),
                        or_(
                            Relation.source_id.in_(visible_org_ids),
                            Relation.target_id.in_(visible_org_ids),
                        ),
                    )
                )
            )
            .scalars()
            .all()
        )

        partial = False
        other_ids: set[UUID] = set()
        pending: list[tuple[Relation, UUID, UUID]] = []
        for relation in rows:
            if relation.source_id in visible_org_ids:
                org_id, other_id = relation.source_id, relation.target_id
            elif relation.target_id in visible_org_ids:
                org_id, other_id = relation.target_id, relation.source_id
            else:
                continue
            pending.append((relation, org_id, other_id))
            other_ids.add(other_id)

        other_cards: dict[UUID, Card] = {}
        if other_ids:
            other_rows = (
                (
                    await self._db.execute(
                        select(Card).where(
                            Card.id.in_(other_ids),
                            Card.status == "ACTIVE",
                        )
                    )
                )
                .scalars()
                .all()
            )
            other_cards = {card.id: card for card in other_rows}

        links: list[OrganizationLink] = []
        for relation, org_id, other_id in pending:
            other = other_cards.get(other_id)
            if other is None:
                partial = True
                continue
            if not await PermissionService.check_permission(
                self._db,
                self._user,
                "inventory.view",
                other.id,
                "card.view",
            ):
                partial = True
                continue
            links.append(
                OrganizationLink(
                    organization_id=org_id,
                    relation_type=relation.type,
                    card=self._summary(other),
                    attributes=dict(relation.attributes or {}),
                )
            )

        links.sort(
            key=lambda link: (
                str(link.organization_id),
                link.card.type,
                link.card.name.casefold(),
                str(link.card.id),
            )
        )
        return OrganizationLinks(links=tuple(links), step_links=(), partial=partial)

    async def _read_organization_step_links(
        self,
        visible_org_ids: set[UUID],
    ) -> tuple[tuple[OrganizationStepLink, ...], bool]:
        rows = (
            await self._db.execute(
                select(ProcessElement, ProcessElementOrganization.organization_id)
                .join(
                    ProcessElementOrganization,
                    ProcessElementOrganization.element_id == ProcessElement.id,
                )
                .where(ProcessElementOrganization.organization_id.in_(visible_org_ids))
                .order_by(ProcessElement.process_id, ProcessElement.sequence_order)
            )
        ).all()
        if not rows:
            return (), False

        try:
            await PermissionService.require_permission(self._db, self._user, "bpm.view")
        except HTTPException as exc:
            raise ExtensionBridgeError(
                "permission_denied",
                "The current actor cannot read per-step BPM organization links",
            ) from exc

        process_ids = {element.process_id for element, _org_id in rows}
        process_rows = (
            (
                await self._db.execute(
                    select(Card).where(
                        Card.id.in_(process_ids),
                        Card.status == "ACTIVE",
                    )
                )
            )
            .scalars()
            .all()
        )
        processes_by_id = {process.id: process for process in process_rows}
        partial = len(processes_by_id) != len(process_ids)

        visible_process_ids: set[UUID] = set()
        for process in process_rows:
            if await PermissionService.check_permission(
                self._db,
                self._user,
                "inventory.view",
                process.id,
                "card.view",
            ):
                visible_process_ids.add(process.id)
            else:
                partial = True

        step_links = tuple(
            OrganizationStepLink(
                organization_id=org_id,
                process_id=element.process_id,
                process_name=processes_by_id[element.process_id].name,
                element_id=element.id,
                element_name=element.name or "",
                element_type=element.element_type,
            )
            for element, org_id in rows
            if element.process_id in visible_process_ids
        )
        return step_links, partial


class _PermissionBridge:
    def __init__(self, db: AsyncSession, user: Any) -> None:
        self._db = db
        self._user = user

    async def has(self, permission: str) -> bool:
        return await PermissionService.has_app_permission(self._db, self._user, permission)


class _AuditBridge:
    def __init__(self, key: str, db: AsyncSession, user: Any) -> None:
        self._prefix = f"ext.{key}."
        self._db = db
        self._user = user

    async def publish(
        self,
        *,
        event_type: str,
        entity_type: str,
        entity_id: UUID,
        data: dict[str, Any],
        related_card_id: UUID | None = None,
        changed: bool = True,
    ) -> bool:
        if not changed:
            return False
        if not event_type.startswith(self._prefix) or not entity_type.startswith(self._prefix):
            raise ExtensionBridgeError(
                "validation_failed",
                "Extension audit identifiers must stay inside the extension namespace",
                details={"required_prefix": self._prefix},
            )
        await event_bus.publish(
            event_type,
            data,
            db=self._db,
            card_id=related_card_id,
            user_id=self._user.id,
            entity_type=entity_type,
            entity_id=entity_id,
        )
        return True

    async def list(
        self,
        *,
        entity_type: str,
        entity_id: UUID,
        required_permission: str,
        limit: int = 200,
    ) -> list[AuditEvent]:
        if not entity_type.startswith(self._prefix) or not required_permission.startswith(
            self._prefix
        ):
            raise ExtensionBridgeError(
                "validation_failed",
                "Audit ownership and permissions must stay in the extension namespace",
                details={"required_prefix": self._prefix},
            )
        if not 1 <= limit <= 200:
            raise ExtensionBridgeError(
                "validation_failed",
                "Audit list limit must be between 1 and 200",
                details={"limit": limit},
            )
        try:
            await PermissionService.require_permission(
                self._db,
                self._user,
                required_permission,
            )
        except HTTPException as exc:
            raise ExtensionBridgeError(
                "permission_denied",
                "The current actor cannot read this audit history",
            ) from exc

        rows = (
            (
                await self._db.execute(
                    select(Event)
                    .where(
                        Event.entity_type == entity_type,
                        Event.entity_id == entity_id,
                    )
                    .order_by(Event.created_at.desc())
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )
        events: list[AuditEvent] = []
        for row in rows:
            assert row.entity_type is not None
            assert row.entity_id is not None
            events.append(
                AuditEvent(
                    id=row.id,
                    event_type=row.event_type,
                    entity_type=row.entity_type,
                    entity_id=row.entity_id,
                    data=dict(row.data or {}),
                    actor_id=row.user_id,
                    created_at=row.created_at,
                )
            )
        return events


class _ResourceBridge:
    def __init__(
        self,
        key: str,
        db: AsyncSession,
        user: Any,
        audit: _AuditBridge,
    ) -> None:
        self._prefix = f"ext.{key}."
        self._db = db
        self._user = user
        self._audit = audit

    async def _require(
        self,
        *,
        entity_type: str,
        required_permission: str,
    ) -> None:
        if not entity_type.startswith(self._prefix) or not required_permission.startswith(
            self._prefix
        ):
            raise ExtensionBridgeError(
                "validation_failed",
                "Resource ownership and permissions must stay in the extension namespace",
                details={"required_prefix": self._prefix},
            )
        try:
            await PermissionService.require_permission(
                self._db,
                self._user,
                required_permission,
            )
        except HTTPException as exc:
            raise ExtensionBridgeError(
                "permission_denied",
                "The current actor cannot access this resource",
            ) from exc

    async def add_link(
        self,
        *,
        entity_type: str,
        entity_id: UUID,
        name: str,
        url: str,
        resource_type: str,
        required_permission: str,
    ) -> ResourceItem:
        await self._require(
            entity_type=entity_type,
            required_permission=required_permission,
        )
        try:
            validated = DocumentCreate(name=name, url=url, type=resource_type)
        except ValidationError as exc:
            raise ExtensionBridgeError(
                "validation_failed",
                "The resource link is invalid",
                details={"errors": exc.errors(include_url=False)},
            ) from exc
        row = Document(
            card_id=None,
            entity_type=entity_type,
            entity_id=entity_id,
            name=validated.name,
            url=validated.url,
            type=validated.type,
            created_by=self._user.id,
        )
        self._db.add(row)
        await self._db.flush()
        await self._audit.publish(
            event_type=f"{self._prefix}resource.link_added",
            entity_type=entity_type,
            entity_id=entity_id,
            data={"document_id": str(row.id), "name": row.name, "url": row.url},
        )
        return ResourceItem(
            id=row.id,
            kind="link",
            name=row.name,
            url=row.url,
            resource_type=row.type,
        )

    async def upload_file(
        self,
        *,
        entity_type: str,
        entity_id: UUID,
        name: str,
        mime_type: str,
        data: bytes,
        category: str | None,
        required_permission: str,
    ) -> ResourceItem:
        await self._require(
            entity_type=entity_type,
            required_permission=required_permission,
        )
        try:
            await validate_file_upload(self._db, mime_type=mime_type, data=data)
        except ResourcePolicyError as exc:
            raise ExtensionBridgeError(
                "validation_failed" if exc.status_code == 400 else "permission_denied",
                exc.detail,
            ) from exc
        row = FileAttachment(
            card_id=None,
            entity_type=entity_type,
            entity_id=entity_id,
            name=name or "untitled",
            mime_type=mime_type,
            size=len(data),
            data=data,
            category=category,
            created_by=self._user.id,
        )
        self._db.add(row)
        await self._db.flush()
        await self._audit.publish(
            event_type=f"{self._prefix}resource.file_uploaded",
            entity_type=entity_type,
            entity_id=entity_id,
            data={
                "attachment_id": str(row.id),
                "name": row.name,
                "mime_type": row.mime_type,
                "size": row.size,
            },
        )
        return ResourceItem(
            id=row.id,
            kind="file",
            name=row.name,
            mime_type=row.mime_type,
            size=row.size,
            category=row.category,
        )

    async def list(
        self,
        *,
        entity_type: str,
        entity_id: UUID,
        required_permission: str,
    ) -> list[ResourceItem]:
        await self._require(
            entity_type=entity_type,
            required_permission=required_permission,
        )
        links = (
            (
                await self._db.execute(
                    select(Document).where(
                        Document.entity_type == entity_type,
                        Document.entity_id == entity_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        files = (
            (
                await self._db.execute(
                    select(FileAttachment).where(
                        FileAttachment.entity_type == entity_type,
                        FileAttachment.entity_id == entity_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        return [
            *[
                ResourceItem(
                    id=row.id,
                    kind="link",
                    name=row.name,
                    url=row.url,
                    resource_type=row.type,
                )
                for row in links
            ],
            *[
                ResourceItem(
                    id=row.id,
                    kind="file",
                    name=row.name,
                    mime_type=row.mime_type,
                    size=row.size,
                    category=row.category,
                )
                for row in files
            ],
        ]

    async def read_file(
        self,
        attachment_id: UUID,
        *,
        entity_type: str,
        entity_id: UUID,
        required_permission: str,
    ) -> ResourceFile:
        await self._require(
            entity_type=entity_type,
            required_permission=required_permission,
        )
        row = (
            await self._db.execute(
                select(FileAttachment).where(
                    FileAttachment.id == attachment_id,
                    FileAttachment.entity_type == entity_type,
                    FileAttachment.entity_id == entity_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise ExtensionBridgeError(
                "reference_not_found",
                "The requested file does not exist for this entity",
                details={"attachment_id": str(attachment_id)},
            )
        return ResourceFile(
            id=row.id,
            name=row.name,
            mime_type=row.mime_type,
            data=row.data,
        )

    async def delete(
        self,
        resource_id: UUID,
        *,
        kind: str,
        entity_type: str,
        entity_id: UUID,
        required_permission: str,
    ) -> bool:
        await self._require(
            entity_type=entity_type,
            required_permission=required_permission,
        )
        model: type[Document] | type[FileAttachment]
        if kind == "link":
            model = Document
        elif kind == "file":
            model = FileAttachment
        else:
            raise ExtensionBridgeError(
                "validation_failed",
                "Resource kind must be 'link' or 'file'",
                details={"kind": kind},
            )
        row = (
            await self._db.execute(
                select(model).where(
                    model.id == resource_id,
                    model.entity_type == entity_type,
                    model.entity_id == entity_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise ExtensionBridgeError(
                "reference_not_found",
                "The requested resource does not exist for this entity",
                details={"resource_id": str(resource_id), "kind": kind},
            )
        await self._db.delete(row)
        await self._db.flush()
        await self._audit.publish(
            event_type=f"{self._prefix}resource.{kind}_deleted",
            entity_type=entity_type,
            entity_id=entity_id,
            data={"resource_id": str(resource_id), "kind": kind},
        )
        return True


class _NotificationBridge:
    def __init__(self, key: str, db: AsyncSession, user: Any) -> None:
        self._prefix = f"ext.{key}."
        self._db = db
        self._user = user

    async def send_many(
        self,
        *,
        notification_type: str,
        title: str,
        message: str,
        link: str | None,
        data: dict[str, Any] | None,
        explicit_recipient_ids: Sequence[UUID],
        required_permission: str | None,
        related_card_id: UUID | None = None,
        channel: str = "in_app",
        changed: bool = True,
    ) -> list[NotificationReceipt]:
        if not changed:
            return []
        if channel != "in_app":
            raise ExtensionBridgeError(
                "validation_failed",
                "The extension notification bridge supports in-app delivery only",
                details={"channel": channel},
            )
        if not notification_type.startswith(self._prefix) or (
            required_permission is not None and not required_permission.startswith(self._prefix)
        ):
            raise ExtensionBridgeError(
                "validation_failed",
                "Notification identifiers must stay inside the extension namespace",
                details={"required_prefix": self._prefix},
            )

        recipient_ids: list[UUID] = []
        seen: set[UUID] = set()
        for recipient_id in explicit_recipient_ids:
            if recipient_id == self._user.id or recipient_id in seen:
                continue
            seen.add(recipient_id)
            recipient_ids.append(recipient_id)

        receipts: list[NotificationReceipt] = []
        for recipient_id in recipient_ids:
            if required_permission is not None:
                recipient = (
                    await self._db.execute(select(User).where(User.id == recipient_id))
                ).scalar_one_or_none()
                if recipient is None or not recipient.is_active:
                    continue
                if not await PermissionService.has_app_permission(
                    self._db,
                    recipient,
                    required_permission,
                ):
                    continue
            notification = await create_notification(
                self._db,
                user_id=recipient_id,
                notif_type=notification_type,
                title=title,
                message=message,
                link=link,
                data=data,
                card_id=related_card_id,
                actor_id=self._user.id,
                send_email=False,
            )
            if notification is not None:
                receipts.append(
                    NotificationReceipt(
                        id=notification.id,
                        user_id=notification.user_id,
                    )
                )
        return receipts


class _DiagramArtifactBridge(DiagramArtifactGateway):
    """Transaction-scoped, permission-gated Core diagram artifact bridge."""

    def __init__(self, db: AsyncSession, user: User) -> None:
        self._db = db
        self._user = user

    async def _require_manage(self) -> None:
        await PermissionService.require_permission(self._db, self._user, "diagrams.manage")

    @staticmethod
    def _group_ref(group: DiagramGroup) -> DiagramGroupRef:
        return DiagramGroupRef(id=group.id, name=group.name)

    async def _diagram_ref(self, diagram: Diagram) -> DiagramRef:
        cards = await self._db.execute(
            select(diagram_cards.c.card_id).where(diagram_cards.c.diagram_id == diagram.id)
        )
        groups = await self._db.execute(
            select(diagram_group_members.c.group_id).where(
                diagram_group_members.c.diagram_id == diagram.id
            )
        )
        return DiagramRef(
            id=diagram.id,
            name=diagram.name,
            card_ids=tuple(row[0] for row in cards.all()),
            group_ids=tuple(row[0] for row in groups.all()),
        )

    async def get_group(self, group_id: UUID) -> DiagramGroupRef | None:
        await self._require_manage()
        group = await self._db.get(DiagramGroup, group_id)
        return self._group_ref(group) if group is not None else None

    async def create_group(self, name: str) -> DiagramGroupRef:
        await self._require_manage()
        normalized = name.strip()
        if not normalized:
            raise ExtensionBridgeError("invalid_diagram_group", "Diagram group name is required")
        group = DiagramGroup(name=normalized, created_by=self._user.id)
        self._db.add(group)
        await self._db.flush()
        return self._group_ref(group)

    async def rename_group(self, group_id: UUID, name: str) -> DiagramGroupRef:
        await self._require_manage()
        normalized = name.strip()
        if not normalized:
            raise ExtensionBridgeError("invalid_diagram_group", "Diagram group name is required")
        group = await self._db.get(DiagramGroup, group_id)
        if group is None:
            raise ExtensionBridgeError("diagram_group_not_found", "Diagram group was not found")
        group.name = normalized
        await self._db.flush()
        return self._group_ref(group)

    async def get_diagram(self, diagram_id: UUID) -> DiagramRef | None:
        await self._require_manage()
        diagram = await self._db.get(Diagram, diagram_id)
        return await self._diagram_ref(diagram) if diagram is not None else None

    async def create_diagram(
        self,
        name: str,
        data: dict[str, Any],
        card_ids: tuple[UUID, ...],
        group_id: UUID,
    ) -> DiagramRef:
        await self._require_manage()
        normalized = name.strip()
        if not normalized:
            raise ExtensionBridgeError("invalid_diagram", "Diagram name is required")
        if await self._db.get(DiagramGroup, group_id) is None:
            raise ExtensionBridgeError("diagram_group_not_found", "Diagram group was not found")
        unique_card_ids = tuple(dict.fromkeys(card_ids))
        if unique_card_ids:
            visible = (
                (
                    await self._db.execute(
                        select(Card.id).where(Card.id.in_(unique_card_ids), Card.status == "ACTIVE")
                    )
                )
                .scalars()
                .all()
            )
            if set(visible) != set(unique_card_ids):
                raise ExtensionBridgeError("diagram_card_not_found", "A diagram Card was not found")
            for card_id in unique_card_ids:
                if not await PermissionService.check_permission(
                    self._db, self._user, "inventory.view", card_id, "card.view"
                ):
                    raise ExtensionBridgeError(
                        "permission_denied", "The current actor cannot view a diagram Card"
                    )
        diagram = Diagram(name=normalized, data=dict(data), created_by=self._user.id)
        self._db.add(diagram)
        await self._db.flush()
        if unique_card_ids:
            await self._db.execute(
                diagram_cards.insert(),
                [{"diagram_id": diagram.id, "card_id": card_id} for card_id in unique_card_ids],
            )
        await self._db.execute(
            diagram_group_members.insert().values(diagram_id=diagram.id, group_id=group_id)
        )
        return await self._diagram_ref(diagram)

    async def rename_diagram(self, diagram_id: UUID, name: str) -> DiagramRef:
        await self._require_manage()
        normalized = name.strip()
        if not normalized:
            raise ExtensionBridgeError("invalid_diagram", "Diagram name is required")
        diagram = await self._db.get(Diagram, diagram_id)
        if diagram is None:
            raise ExtensionBridgeError("diagram_not_found", "Diagram was not found")
        diagram.name = normalized
        await self._db.flush()
        return await self._diagram_ref(diagram)

    async def delete_diagram(self, diagram_id: UUID) -> bool:
        await self._require_manage()
        diagram = await self._db.get(Diagram, diagram_id)
        if diagram is None:
            return False
        await self._db.delete(diagram)
        await self._db.flush()
        return True


def build_request_context(
    key: str,
    db: AsyncSession,
    user: User,
) -> ExtensionRequestContext:
    audit = _AuditBridge(key, db, user)
    return ExtensionRequestContext(
        key=key,
        actor=ExtensionActor(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            role_key=user.role,
        ),
        core_query=_CoreQueryBridge(db, user),
        audit=audit,
        permissions=_PermissionBridge(db, user),
        resources=_ResourceBridge(key, db, user, audit),
        notifications=_NotificationBridge(key, db, user),
        diagrams=_DiagramArtifactBridge(db, user),
    )
