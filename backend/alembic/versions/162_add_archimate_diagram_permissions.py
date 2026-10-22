"""Add the per-layer ``archimatediagrams.*`` permissions to existing roles.

ArchiMate diagrams were gated on the plain ``diagrams.view`` / ``diagrams.manage``
keys; they now have their own view/manage/publish triple per layer tab
(business / application / technology). So that nobody's effective access changes
on upgrade, every role gets each new key set to whatever it already holds for the
matching ``diagrams.<action>`` key, on all three layers. A value already stored
under a new key (including an explicit False) is kept; a wildcard role already
has everything. Idempotent.

Revision ID: 162
Revises: 161
Create Date: 2026-10-22
"""

from __future__ import annotations

import json
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "162"
down_revision: Union[str, None] = "161"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LAYERS = ("business", "application", "technology")
ACTIONS = ("view", "manage", "publish")
NEW_KEYS = [f"archimatediagrams.{layer}.{action}" for layer in LAYERS for action in ACTIONS]


def plan_role_permissions(permissions: dict) -> dict:
    """The role's permission map with every missing new key copied from ``diagrams.<action>``."""
    if not isinstance(permissions, dict) or permissions.get("*") is True:
        return permissions
    planned = dict(permissions)
    for layer in LAYERS:
        for action in ACTIONS:
            planned.setdefault(
                f"archimatediagrams.{layer}.{action}",
                permissions.get(f"diagrams.{action}") is True,
            )
    return planned


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, permissions FROM roles")).fetchall()
    for row in rows:
        current = row.permissions or {}
        planned = plan_role_permissions(current)
        if planned != current:
            conn.execute(
                sa.text("UPDATE roles SET permissions = CAST(:p AS jsonb) WHERE id = :i"),
                {"p": json.dumps(planned), "i": row.id},
            )


def downgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, permissions FROM roles")).fetchall()
    for row in rows:
        current = row.permissions or {}
        if not isinstance(current, dict) or not set(NEW_KEYS) & current.keys():
            continue
        reverted = {k: v for k, v in current.items() if k not in NEW_KEYS}
        conn.execute(
            sa.text("UPDATE roles SET permissions = CAST(:p AS jsonb) WHERE id = :i"),
            {"p": json.dumps(reverted), "i": row.id},
        )
