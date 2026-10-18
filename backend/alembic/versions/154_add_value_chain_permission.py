"""Add bpm.value_chain to existing roles, drop ext.value-chain.view.

The Value Chain shipped as an extension (`ext.value-chain.view`); it is now a
core feature with its own read-only permission. Roles that could see it keep
seeing it, and the retired key stops lingering in roles.permissions.

Revision ID: 154b
Revises: 153
Create Date: 2026-10-14

Renumbered from "154" to "154b" on the upstream merge of 2026-10-18: upstream's
own "154_audit_log.py" claims the plain "154" id, following the "128"/"128b"
precedent (``128_extension_sdk_1_2_bridges.py``) — the fork's migration takes
the lettered id and keeps its original down_revision, upstream's keeps the
canonical number and gets repointed to chain after the fork's.
"""

from __future__ import annotations

import json
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "154b"
down_revision: Union[str, None] = "153"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_KEY = "bpm.value_chain"
RETIRED_KEY = "ext.value-chain.view"


def plan_role_permissions(permissions: dict) -> dict:
    """Return the role's permission map with the extension key retired and the
    new key granted to roles that could already reach the feature.

    Least privilege: the Value Chain is a read-only view of BPM data, so a role
    qualifies when it already holds `bpm.view`, or held the extension's own
    permission. A role that never saw BPM data is not widened by this
    migration - an admin grants it deliberately from Admin -> Roles. A value
    already stored under the new key (including an explicit False) is kept.
    A wildcard role already has everything."""
    if permissions.get("*") is True:
        return permissions
    planned = {k: v for k, v in permissions.items() if k != RETIRED_KEY}
    had_access = permissions.get("bpm.view") is True or permissions.get(RETIRED_KEY) is True
    if NEW_KEY not in planned and had_access:
        planned[NEW_KEY] = True
    return planned


def _sweep(conn) -> None:
    rows = conn.execute(sa.text("SELECT id, permissions FROM roles")).fetchall()
    for row in rows:
        current = row.permissions or {}
        planned = plan_role_permissions(current)
        if planned != current:
            conn.execute(
                sa.text("UPDATE roles SET permissions = CAST(:p AS jsonb) WHERE id = :i"),
                {"p": json.dumps(planned), "i": row.id},
            )


def upgrade() -> None:
    _sweep(op.get_bind())


def downgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, permissions FROM roles")).fetchall()
    for row in rows:
        current = row.permissions or {}
        if NEW_KEY not in current:
            continue
        reverted = {k: v for k, v in current.items() if k != NEW_KEY}
        conn.execute(
            sa.text("UPDATE roles SET permissions = CAST(:p AS jsonb) WHERE id = :i"),
            {"p": json.dumps(reverted), "i": row.id},
        )
