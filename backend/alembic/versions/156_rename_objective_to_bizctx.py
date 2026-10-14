"""Rename ObjectiveToBusinessContext -> relObjectiveToBizCtx.

The key was created by hand on an instance and breaks the core naming
convention (relXxxToYyy). `relations.type` is a denormalised copy of
relation_types.key with no FK constraint, and the key is also stored inside
saved-report configs, bookmark filters, survey filters, survey questions
(`surveys.fields` holds `rel:<key>:outgoing` field keys and a
`relation_type_key`) and their responses (keyed by the same field key), portal
configs, diagram payloads and calculation formulas — so each of those is swept
too. A textual REPLACE is safe here because the old key is a distinctive string
that collides with no seeded key (pinned by a test); it keeps a question's field
key and its responses' keys in sync. A custom key that merely CONTAINS the old
key would be rewritten inside those payloads while its own rows stay unchanged,
so `_check_compatible` refuses (RuntimeError, nothing written) when one exists.

What actually happens on upgrade. Migration 155 inserted the seeded
`relObjectiveToBizCtx` with ON CONFLICT DO NOTHING, and the old key never
conflicts with it, so every database reaching 156 holds BOTH rows. The hand-made
row is therefore DROPPED and its relations re-pointed to the seeded row; the
seeded row's labels, translations and flags win. Because that discards the
hand-made row, `_check_compatible` runs first and refuses (RuntimeError, nothing
written) when the two rows disagree on orientation (source/target type; a
silent inversion otherwise, cf. migration 153) or carry different non-empty
attributes_schema. A hand-made attributes_schema is copied onto the seeded row
when that one is empty, so relation attribute values stay editable. Renaming the
hand-made row in place only happens on a database where the seeded row is
absent.

`built_in` promotions (the surviving relObjectiveToBizCtx and
relBusinessContextSuccessor) are unconditional.

Downgrade limits: it cannot resurrect the dropped hand-made row's metadata (the
seeded row is renamed back and marked custom instead); it does not demote
relBusinessContextSuccessor; and on an install that never had the old key it
would turn the seeded built-in relObjectiveToBizCtx into a custom-looking
ObjectiveToBusinessContext.

Revision ID: 156
Revises: 155
Create Date: 2026-10-14
"""

from __future__ import annotations

import json
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
    ("surveys", "fields"),
    ("survey_responses", "responses"),
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


def _check_compatible(conn, old: str, new: str) -> list | None:
    """Refuse, before anything is written, a merge that would lose or invert
    meaning. Returns the attributes_schema to copy onto the surviving row, or
    None. The row comparison runs only when BOTH rows exist; the substring
    guard always runs."""
    like = {"like": f"%{old}%", "old": old, "new": new}
    colliding = [
        *conn.execute(
            sa.text(
                "SELECT key FROM relation_types WHERE key LIKE :like AND key NOT IN (:old, :new)"
            ),
            like,
        ).scalars(),
        *conn.execute(
            sa.text(
                "SELECT DISTINCT type FROM relations "
                "WHERE type LIKE :like AND type NOT IN (:old, :new)"
            ),
            like,
        ).scalars(),
    ]
    if colliding:
        raise RuntimeError(
            f"Cannot rename relation type {old!r} to {new!r}: other keys contain it "
            f"({sorted(set(colliding))!r}). The textual sweep would rewrite them inside "
            "saved reports, filters and formulas while their own rows stay unchanged. "
            "Rename those keys first."
        )
    rows = {
        r.key: r
        for r in conn.execute(
            sa.text(
                "SELECT key, source_type_key, target_type_key, attributes_schema "
                "FROM relation_types WHERE key IN (:old, :new)"
            ),
            {"old": old, "new": new},
        )
    }
    if old not in rows or new not in rows:
        return None
    hand, seeded = rows[old], rows[new]
    if (hand.source_type_key, hand.target_type_key) != (
        seeded.source_type_key,
        seeded.target_type_key,
    ):
        raise RuntimeError(
            f"Cannot merge relation type {old!r} into {new!r}: orientation differs "
            f"({old}: {hand.source_type_key} -> {hand.target_type_key}; "
            f"{new}: {seeded.source_type_key} -> {seeded.target_type_key}). Re-pointing its "
            "relations would invert their meaning. Fix or delete the hand-made type first."
        )
    hand_attrs = hand.attributes_schema or []
    seeded_attrs = seeded.attributes_schema or []
    if hand_attrs and seeded_attrs and hand_attrs != seeded_attrs:
        raise RuntimeError(
            f"Cannot merge relation type {old!r} into {new!r}: their attributes_schema "
            f"differ and both are non-empty ({old}: {hand_attrs!r}; {new}: {seeded_attrs!r}). "
            "Reconcile them by hand first."
        )
    return hand_attrs if hand_attrs and not seeded_attrs else None


def _sweep(conn, old: str, new: str) -> None:
    # All checks come before the first write, so a refusal leaves the DB untouched.
    attrs_to_copy = _check_compatible(conn, old, new)
    if attrs_to_copy is not None:
        conn.execute(
            sa.text(
                "UPDATE relation_types SET attributes_schema = CAST(:a AS jsonb) WHERE key = :new"
            ),
            {"a": json.dumps(attrs_to_copy), "new": new},
        )
    # The seeded relation type normally exists already (155 inserted it); then
    # the hand-made row is dropped and its relations re-pointed.
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
