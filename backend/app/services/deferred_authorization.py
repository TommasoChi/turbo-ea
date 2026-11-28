"""Freeze and revalidate the actor of a deferred import."""

from datetime import datetime, timezone
from typing import NamedTuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.role import Role
from app.models.user import User
from app.services.event_bus import request_impersonation
from app.services.permission_service import PermissionService, effective_role_key


class _JobAuthorization(NamedTuple):
    user_id: str
    effective_role: str
    impersonating: bool


def _capture_job_authorization(user: User) -> _JobAuthorization:
    impersonation = request_impersonation.get()
    return _JobAuthorization(
        str(user.id),
        effective_role_key(user),
        impersonation is not None and impersonation[0] == str(user.id),
    )


async def _authorize_job(
    db: AsyncSession,
    user: User,
    context: _JobAuthorization | None,
    permission: str = "admin.import_workspace",
) -> bool:
    now = datetime.now(timezone.utc)
    if not user.is_active or (user.access_expires_at is not None and user.access_expires_at < now):
        return False
    if context is None:
        token = request_impersonation.set(None)
        try:
            return await PermissionService.has_app_permission(db, user, permission, fresh=True)
        finally:
            request_impersonation.reset(token)
    if context.user_id != str(user.id):
        return False
    if context.impersonating:
        role = await db.scalar(
            select(Role)
            .where(Role.key == context.effective_role)
            .execution_options(populate_existing=True)
        )
        if role is None or role.is_archived or context.effective_role in ("admin", user.role):
            return False
        token = request_impersonation.set(None)
        try:
            if not await PermissionService.has_app_permission(
                db, user, "admin.impersonate", fresh=True
            ):
                return False
        finally:
            request_impersonation.reset(token)
        token = request_impersonation.set((str(user.id), context.effective_role))
    else:
        if user.role != context.effective_role:
            return False
        token = request_impersonation.set(None)
    try:
        return await PermissionService.has_app_permission(db, user, permission, fresh=True)
    finally:
        request_impersonation.reset(token)


def _job_impersonation(user: User, context: _JobAuthorization | None):
    if context is None:
        return (str(user.id), "__missing_workspace_authorization__")
    if context.impersonating:
        return (str(user.id), context.effective_role)
    return None
