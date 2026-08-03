"""Request-scoped implementations of the public backend extension bridges."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.document import Document
from app.models.event import Event
from app.models.file_attachment import FileAttachment
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.stakeholder import Stakeholder
from app.models.user import User
from app.schemas.common import DocumentCreate
from app.services.event_bus import event_bus
from app.services.extensions.sdk import (
    ApplicationCandidate,
    AuditEvent,
    CardRef,
    ExtensionActor,
    ExtensionBridgeError,
    ExtensionRequestContext,
    NotificationReceipt,
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
    "BusinessProcess": None,
    "BusinessCapability": None,
    "Objective": frozenset({"businessGoal", "valueGate"}),
}


class _CoreQueryBridge:
    def __init__(self, db: AsyncSession, user: Any) -> None:
        self._db = db
        self._user = user

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

    async def resolve_cards(self, refs: list[CardRef]) -> list[ResolvedCard]:
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
        platform_ids: list[UUID],
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
            via_rows = list(
                (
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
            )

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
        return [
            AuditEvent(
                id=row.id,
                event_type=row.event_type,
                entity_type=row.entity_type,
                entity_id=row.entity_id,
                data=dict(row.data or {}),
                actor_id=row.user_id,
                created_at=row.created_at,
            )
            for row in rows
        ]


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
        model = {"link": Document, "file": FileAttachment}.get(kind)
        if model is None:
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
        explicit_recipient_ids: list[UUID],
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
    )
