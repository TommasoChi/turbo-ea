"""Member and BPM Admin lose ``stakeholders.manage``.

Assigning stakeholders (the Cost Controller included) is how a card gets cost rights, so
the two built-in app roles ``member`` and ``bpm_admin`` no longer hold it. Only rows still
carrying ``true`` are rewritten; custom roles and the wildcard admin are not touched.

Downgrade does nothing: the rows no longer say who held it by default, so it is not
restored (as in migration 202).

Revision ID: 203
Revises: 202
Create Date: 2026-11-27
"""

import json
from typing import Sequence, Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "203"
down_revision: Union[str, None] = "202"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Literals rather than imports, so the migration keeps describing the database as it was.
LEAVING_ROLES = ("member", "bpm_admin")
REVOKED_PERMISSION = "stakeholders.manage"


def plan_role_permissions(role_key: str, permissions) -> dict | None:
    """An app role's permissions after the revocation, or ``None`` when unchanged."""
    if role_key not in LEAVING_ROLES or not isinstance(permissions, dict):
        return None
    if not permissions.get(REVOKED_PERMISSION):
        return None
    return {**permissions, REVOKED_PERMISSION: False}


def upgrade() -> None:
    conn = op.get_bind()
    for row in conn.execute(text("SELECT id, key, permissions FROM roles")).fetchall():
        updated = plan_role_permissions(row.key, row.permissions)
        if updated is not None:
            conn.execute(
                text("UPDATE roles SET permissions = CAST(:s AS jsonb) WHERE id = :id"),
                {"s": json.dumps(updated), "id": row.id},
            )


def downgrade() -> None:
    """Nothing to undo: the revoked permission is not restored."""
