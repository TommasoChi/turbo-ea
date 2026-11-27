"""Record which stakeholder roles edit a card's costs; Member and BPM Admin leave the PPM and costs.

Two changes, both keeping an upgrade faithful to what each role could do before:

- Every stakeholder role definition gets the new card permission ``card.edit_costs``,
  with the value of its ``card.edit`` (costs used to be editable by any role that could
  edit the card; ``false`` when ``card.edit`` is absent). A row that already carries the
  key is left alone, either value, so a re-run never overwrites an admin's choice.
- The built-in app roles ``member`` and ``bpm_admin`` lose ``ppm.manage`` and
  ``costs.view`` (they keep ``ppm.view``). Custom roles and the wildcard admin are not
  touched, and no role gains ``costs.edit`` here.

Downgrade drops ``card.edit_costs`` from the stakeholder maps; the two role permissions
are not restored, since the rows no longer say who held them by default.

The rewrite is Python-side (fetch -> mutate -> ``CAST(:s AS jsonb)``), as in migration 195.

Revision ID: 202
Revises: 201
Create Date: 2026-11-27
"""

import json
from typing import Sequence, Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "202"
down_revision: Union[str, None] = "201"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Literals rather than imports, so the migration keeps describing the database as it was.
EDIT_COSTS_KEY = "card.edit_costs"
LEAVING_ROLES = ("member", "bpm_admin")
REVOKED_PERMISSIONS = ("ppm.manage", "costs.view")


def plan_stakeholder_permissions(permissions) -> dict | None:
    """One stakeholder role's permissions with the key filled in, or ``None`` when unchanged."""
    if permissions is None:
        permissions = {}
    if not isinstance(permissions, dict) or EDIT_COSTS_KEY in permissions:
        return None
    return {**permissions, EDIT_COSTS_KEY: bool(permissions.get("card.edit", False))}


def unplan_stakeholder_permissions(permissions) -> dict | None:
    """One stakeholder role's permissions without the key, or ``None`` when unchanged."""
    if not isinstance(permissions, dict) or EDIT_COSTS_KEY not in permissions:
        return None
    return {k: v for k, v in permissions.items() if k != EDIT_COSTS_KEY}


def plan_role_permissions(role_key: str, permissions) -> dict | None:
    """An app role's permissions after the revocation, or ``None`` when unchanged."""
    if role_key not in LEAVING_ROLES or not isinstance(permissions, dict):
        return None
    if not any(permissions.get(key) for key in REVOKED_PERMISSIONS):
        return None
    return {k: (False if k in REVOKED_PERMISSIONS else v) for k, v in permissions.items()}


_UPDATE_STAKEHOLDER = text(
    "UPDATE stakeholder_role_definitions SET permissions = CAST(:s AS jsonb) WHERE id = :id"
)
_UPDATE_ROLE = text("UPDATE roles SET permissions = CAST(:s AS jsonb) WHERE id = :id")


def _write(conn, statement, row_id, permissions: dict) -> None:
    conn.execute(statement, {"s": json.dumps(permissions), "id": row_id})


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(text("SELECT id, permissions FROM stakeholder_role_definitions")).fetchall()
    for row in rows:
        updated = plan_stakeholder_permissions(row.permissions)
        if updated is not None:
            _write(conn, _UPDATE_STAKEHOLDER, row.id, updated)
    for row in conn.execute(text("SELECT id, key, permissions FROM roles")).fetchall():
        updated = plan_role_permissions(row.key, row.permissions)
        if updated is not None:
            _write(conn, _UPDATE_ROLE, row.id, updated)


def downgrade() -> None:
    """Drop the stakeholder key; the role permissions are not restored."""
    conn = op.get_bind()
    rows = conn.execute(text("SELECT id, permissions FROM stakeholder_role_definitions")).fetchall()
    for row in rows:
        updated = unplan_stakeholder_permissions(row.permissions)
        if updated is not None:
            _write(conn, _UPDATE_STAKEHOLDER, row.id, updated)
