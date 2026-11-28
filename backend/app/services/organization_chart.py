"""Authorization boundary for Organization chart mutations."""

from fastapi import HTTPException

from app.models.user import User
from app.services.permission_service import effective_role_key


def require_organization_admin_role(role: str | None, card_type_key: str) -> None:
    if card_type_key == "Organization" and role != "admin":
        raise HTTPException(403, "Not enough permissions")


def require_organization_admin(user: User, card_type_key: str) -> None:
    require_organization_admin_role(effective_role_key(user), card_type_key)
