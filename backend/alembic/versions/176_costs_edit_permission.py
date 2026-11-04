"""Add the costs.edit permission, False on the seeded non-admin roles.

Only ``costs.edit`` is written; ``costs.view`` and every other key are left
exactly as stored. Wildcard roles (admin) and roles that already carry the key
are skipped; custom roles are untouched (a missing key reads as False).

Revision ID: 176
Revises: 175
"""

import json

from sqlalchemy import text

from alembic import op

revision = "176"
down_revision = "175"
branch_labels = None
depends_on = None

_ROLES = ("bpm_admin", "member", "viewer")


def plan_patch(perms):
    """The permissions with ``costs.edit: false`` added, or None for no change."""
    if not isinstance(perms, dict) or perms.get("*") or "costs.edit" in perms:
        return None
    return {**perms, "costs.edit": False}


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        text("SELECT key, permissions FROM roles WHERE key = ANY(:keys)"), {"keys": list(_ROLES)}
    ).all()
    for key, perms in rows:
        patched = plan_patch(perms)
        if patched is not None:
            bind.execute(
                text("UPDATE roles SET permissions = CAST(:p AS jsonb) WHERE key = :key"),
                {"p": json.dumps(patched), "key": key},
            )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        text("UPDATE roles SET permissions = permissions - 'costs.edit' WHERE key = ANY(:keys)"),
        {"keys": list(_ROLES)},
    )
