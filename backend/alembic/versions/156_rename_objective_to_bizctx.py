"""Rename ObjectiveToBusinessContext -> relObjectiveToBizCtx.

The key was created by hand on an instance and breaks the core naming
convention (relXxxToYyy). `relations.type` is a denormalised copy of
relation_types.key with no FK constraint, and the key is also stored inside
saved-report configs, bookmark filters, survey filters, portal configs,
diagram payloads and calculation formulas — so each of those is swept too. A
textual REPLACE is safe here because the old key is a distinctive string that
collides with no other key (pinned by a test).

Revision ID: 156
Revises: 155
Create Date: 2026-10-14
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "156"
down_revision: Union[str, None] = "155"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD_KEY = "ObjectiveToBusinessContext"
NEW_KEY = "relObjectiveToBizCtx"

JSONB_TARGETS = [
    ("saved_reports", "config"),
    ("bookmarks", "filters"),
    ("surveys", "target_filters"),
    ("web_portals", "filters"),
    ("web_portals", "card_config"),
    ("diagrams", "data"),
]
TEXT_TARGETS = [("calculations", "formula")]


def _replace_everywhere(conn, old: str, new: str) -> None:
    """Textually replace ``old`` with ``new`` in every JSONB and text target."""
    for table, column in JSONB_TARGETS:
        conn.execute(
            sa.text(
                f"UPDATE {table} SET {column} = "
                f"CAST(REPLACE({column}::text, :old, :new) AS jsonb) "
                f"WHERE {column}::text LIKE :like"
            ),
            {"old": old, "new": new, "like": f"%{old}%"},
        )
    for table, column in TEXT_TARGETS:
        conn.execute(
            sa.text(
                f"UPDATE {table} SET {column} = REPLACE({column}, :old, :new) "
                f"WHERE {column} LIKE :like"
            ),
            {"old": old, "new": new, "like": f"%{old}%"},
        )


def _sweep(conn, old: str, new: str) -> None:
    # The seeded relation type may already exist (155 inserted it); in that
    # case the hand-made row is dropped and its relations re-pointed.
    conn.execute(
        sa.text(
            "DELETE FROM relation_types WHERE key = :old AND EXISTS "
            "(SELECT 1 FROM relation_types WHERE key = :new)"
        ),
        {"old": old, "new": new},
    )
    conn.execute(
        sa.text("UPDATE relation_types SET key = :new, built_in = true WHERE key = :old"),
        {"old": old, "new": new},
    )
    # When the seeded row survived the DELETE above it was not renamed, so make
    # sure it is built-in too.
    conn.execute(
        sa.text("UPDATE relation_types SET built_in = true WHERE key = :new"),
        {"new": new},
    )
    conn.execute(
        sa.text("UPDATE relations SET type = :new WHERE type = :old"),
        {"old": old, "new": new},
    )
    _replace_everywhere(conn, old, new)
    # relBusinessContextSuccessor already follows the convention
    # (cf. relDataObjectSuccessor): promote it, never rename it.
    conn.execute(
        sa.text(
            "UPDATE relation_types SET built_in = true WHERE key = 'relBusinessContextSuccessor'"
        )
    )


def _unsweep(conn, old: str, new: str) -> None:
    # Exact inverse of the rename. If the upgrade took the "new key already
    # existed" branch the dropped hand-made row cannot be resurrected, so the
    # surviving row is renamed back to the old key instead.
    conn.execute(
        sa.text("UPDATE relation_types SET key = :old, built_in = false WHERE key = :new"),
        {"old": old, "new": new},
    )
    conn.execute(
        sa.text("UPDATE relations SET type = :old WHERE type = :new"),
        {"old": old, "new": new},
    )
    _replace_everywhere(conn, new, old)


def upgrade() -> None:
    _sweep(op.get_bind(), OLD_KEY, NEW_KEY)


def downgrade() -> None:
    _unsweep(op.get_bind(), OLD_KEY, NEW_KEY)
