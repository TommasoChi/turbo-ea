"""Extension SDK — the semver'd contract between core and backend extensions.

This module (plus ``require_extension`` re-exported below) is the ONLY
supported import surface for extension code. Anything else under
``app.*`` is core-internal and may change between releases without
notice; extensions that reach past the SDK void their compatibility
claim.

An extension bundle's manifest names an entrypoint (``"pkg.module:attr"``)
resolving to an object that satisfies the :class:`TurboExtension`
protocol. The loader instantiates nothing — the attribute IS the
extension instance (module-level singleton, mirroring how migration
source adapters register themselves).

Naming rules enforced at load time:

- permission keys must start with ``ext.{key}.``
- database tables created by extension migrations must be named
  ``ext_{key}_*`` (convention — the migration runner cannot inspect DDL,
  but the authoring lint checks it and code review enforces it)

Versioning: ``SDK_VERSION`` is major.minor. An extension declares the
SDK line it was built for; the loader refuses a different major or a
minor newer than the one provided by core.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

# --- SDK 1.1 — route dependencies (retained for compatibility) ---------------
# Sanctioned FastAPI dependencies for extension route handlers, re-exported so
# existing extensions never import core internals directly:
#
# - ``get_db`` — request-scoped AsyncSession (``db: AsyncSession = Depends(get_db)``).
#   Use it ONLY on the extension's own ``ext_{key}_*`` tables; core tables stay
#   off-limits (no core model imports — see the write-bridge plan for the
#   future sanctioned path to core data).
# - ``get_current_user`` — the authenticated user. New code should prefer the
#   stable actor snapshot exposed by ``extension_context`` below.
# - ``require_permission("ext.{key}.something")`` — dependency factory
#   enforcing an app-level permission. Works with the extension's own
#   ``ext.{key}.*`` keys (registered via ``get_permissions()``) and with core
#   keys (e.g. gate a read on ``adr.view``).
#
# SDK 1.2 adds ``extension_context(key)`` as the preferred request dependency.
# It exposes permission-shaped read-only EA queries plus generic audit,
# resource and in-app notification bridges. All mutating bridge calls join the
# request's AsyncSession and never commit; the extension route owns the
# transaction boundary. There is deliberately no native Card/relation/GRC
# write bridge.
#
# SDK 1.3 adds a read-only predicate for checking whether the current actor has
# an exact stakeholder role on a visible Card. It deliberately returns only a
# boolean and never exposes stakeholder identities or assignments.
#
# Every extension route is additionally gated by ``require_extension(key)`` at
# mount time (enabled + usable entitlement).
from app.api.deps import get_current_user, require_permission  # noqa: F401
from app.database import get_db  # noqa: F401

SDK_VERSION = "1.4"


class ExtensionBridgeError(RuntimeError):
    """Stable, machine-readable failure raised by an SDK bridge."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.details = details or {}


@dataclass(frozen=True)
class CardRef:
    """Expected identity and snapshot projection for one authoritative card."""

    id: UUID
    expected_type: str
    expected_subtype: str | None = None
    attribute_keys: tuple[str, ...] = ()


@dataclass(frozen=True)
class ResolvedCard:
    """Permission-shaped card summary returned by the read-only gateway."""

    id: UUID
    type: str
    subtype: str | None
    name: str
    reference: str | None
    lifecycle: dict[str, Any]
    attributes: dict[str, Any]


@dataclass(frozen=True)
class ApplicationCandidate:
    """Application reachable directly from a product, via platforms, or both."""

    id: UUID
    name: str
    reference: str | None
    provenance: str
    via_platform_ids: tuple[UUID, ...]


@dataclass(frozen=True)
class ResourceItem:
    id: UUID
    kind: str
    name: str
    url: str | None = None
    resource_type: str | None = None
    mime_type: str | None = None
    size: int | None = None
    category: str | None = None


@dataclass(frozen=True)
class ResourceFile:
    id: UUID
    name: str
    mime_type: str
    data: bytes


@dataclass(frozen=True)
class NotificationReceipt:
    id: UUID
    user_id: UUID


@runtime_checkable
class CoreQueryGateway(Protocol):
    async def resolve_cards(
        self,
        refs: Sequence[CardRef],
    ) -> Sequence[ResolvedCard]: ...

    async def list_product_platforms(
        self,
        product_id: UUID,
    ) -> Sequence[ResolvedCard]: ...

    async def list_product_applications(
        self,
        product_id: UUID,
        platform_ids: Sequence[UUID],
    ) -> Sequence[ApplicationCandidate]: ...

    async def has_stakeholder_role(
        self,
        card_id: UUID,
        role_key: str,
    ) -> bool: ...


@dataclass(frozen=True)
class AuditEvent:
    id: UUID
    event_type: str
    entity_type: str
    entity_id: UUID
    data: dict[str, Any]
    actor_id: UUID | None
    created_at: Any


@runtime_checkable
class AuditGateway(Protocol):
    async def publish(
        self,
        *,
        event_type: str,
        entity_type: str,
        entity_id: UUID,
        data: dict[str, Any],
        related_card_id: UUID | None = None,
        changed: bool = True,
    ) -> bool: ...

    async def list(
        self,
        *,
        entity_type: str,
        entity_id: UUID,
        required_permission: str,
        limit: int = 200,
    ) -> Sequence[AuditEvent]: ...


@runtime_checkable
class PermissionGateway(Protocol):
    async def has(self, permission: str) -> bool: ...


@runtime_checkable
class ResourceGateway(Protocol):
    async def add_link(
        self,
        *,
        entity_type: str,
        entity_id: UUID,
        name: str,
        url: str,
        resource_type: str,
        required_permission: str,
    ) -> ResourceItem: ...

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
    ) -> ResourceItem: ...

    async def list(
        self,
        *,
        entity_type: str,
        entity_id: UUID,
        required_permission: str,
    ) -> Sequence[ResourceItem]: ...

    async def read_file(
        self,
        attachment_id: UUID,
        *,
        entity_type: str,
        entity_id: UUID,
        required_permission: str,
    ) -> ResourceFile: ...

    async def delete(
        self,
        resource_id: UUID,
        *,
        kind: str,
        entity_type: str,
        entity_id: UUID,
        required_permission: str,
    ) -> bool: ...


@runtime_checkable
class NotificationPublisher(Protocol):
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
    ) -> Sequence[NotificationReceipt]: ...


@dataclass(frozen=True)
class ExtensionActor:
    id: UUID
    email: str
    display_name: str
    role_key: str


@dataclass(frozen=True)
class ExtensionRequestContext:
    key: str
    actor: ExtensionActor
    core_query: CoreQueryGateway
    audit: AuditGateway
    permissions: PermissionGateway
    resources: ResourceGateway
    notifications: NotificationPublisher


def extension_context(
    key: str,
) -> Callable[..., Awaitable[ExtensionRequestContext]]:
    """Create the sanctioned request dependency for extension routes."""

    async def dependency(
        db: AsyncSession = Depends(get_db),
        user: Any = Depends(get_current_user),
    ) -> ExtensionRequestContext:
        from app.services.extensions.bridges import build_request_context

        return build_request_context(key, db, user)

    return dependency


@dataclass(frozen=True)
class ExtensionMigration:
    """One sequential schema step. ``version`` starts at 1 and increments.

    ``upgrade`` receives an :class:`AsyncConnection` inside a transaction
    owned by the runner; raise to abort (the extension is marked failed,
    core keeps booting).
    """

    version: int
    name: str
    upgrade: Callable[[AsyncConnection], Awaitable[None]]


@dataclass(frozen=True)
class ExtensionJob:
    """A periodic background job. ``run`` is invoked every
    ``interval_seconds`` while the extension is enabled and licensed —
    lapse or disable pauses the job without a restart."""

    name: str
    interval_seconds: int
    run: Callable[["ExtensionContext"], Awaitable[None]]


@dataclass
class ExtensionContext:
    """Runtime services handed to extension jobs and ``on_startup``."""

    key: str
    session_factory: Callable[[], AsyncSession]
    logger: logging.Logger
    get_setting: Callable[[str], Awaitable[Any]]
    set_setting: Callable[[str, Any], Awaitable[None]]
    settings_namespace: str = ""

    def __post_init__(self) -> None:
        if not self.settings_namespace:
            self.settings_namespace = f"ext.{self.key}."


@runtime_checkable
class TurboExtension(Protocol):
    """The backend extension contract (all hooks optional in effect —
    return ``None`` / empty collections for surfaces you don't use)."""

    key: str
    sdk_version: str

    def get_router(self) -> APIRouter | None:
        """Router mounted under ``/api/v1/ext/{key}/``, request-gated by
        ``require_extension(key)``."""
        ...

    def get_permissions(self) -> dict[str, str]:
        """``{"ext.{key}.something": "description"}`` — merged into the
        app permission registry under the Extensions group."""
        ...

    def get_migrations(self) -> list[ExtensionMigration]:
        """Sequential schema migrations for ``ext_{key}_*`` tables."""
        ...

    def get_jobs(self) -> list[ExtensionJob]:
        """Periodic background jobs."""
        ...

    async def on_startup(self, ctx: ExtensionContext) -> None:
        """One-shot hook after migrations, before jobs start."""
        ...


def sdk_compatible(declared: str) -> bool:
    """Return whether core provides every capability required by ``declared``."""
    try:
        ext_parts = str(declared).split(".")
        core_parts = SDK_VERSION.split(".")
        if len(ext_parts) != 2 or len(core_parts) != 2:
            return False
        ext_major, ext_minor = (int(part) for part in ext_parts)
        core_major, core_minor = (int(part) for part in core_parts)
    except (TypeError, ValueError):
        return False
    return ext_major == core_major and 0 <= ext_minor <= core_minor
