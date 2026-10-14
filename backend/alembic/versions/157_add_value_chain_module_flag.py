"""Value Chain becomes an optional module: ``valueChainEnabled`` defaults on.

Readers already treat an absent ``general_settings -> valueChainEnabled`` as
true, so this backfill changes no behaviour; it only makes the stored state
explicit for installs that already hold a settings row. A fresh install has no
row yet and keeps none (the settings endpoints create it on first write).

The row is patched in Python (fetch, mutate, UPDATE with ``CAST(:s AS jsonb)``)
rather than with ``jsonb_set(...) WHERE general_settings ? 'key'``: the ``?``
operator clashes with SQLAlchemy ``text()`` parameter scanning and the
migration would roll back silently (see migration 099).

An explicit ``false`` is never overwritten. Downgrade drops the key.

Revision ID: 157
Revises: 156
Create Date: 2026-10-14
"""

import json
from typing import Sequence, Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "157"
down_revision: Union[str, None] = "156"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

KEY = "valueChainEnabled"


def _patch(conn, mutate) -> None:
    rows = conn.execute(text("SELECT id, general_settings FROM app_settings")).fetchall()
    for row in rows:
        settings = row.general_settings if row.general_settings is not None else {}
        if not isinstance(settings, dict):
            continue
        patched = mutate(settings)
        if patched is None:
            continue
        conn.execute(
            text("UPDATE app_settings SET general_settings = CAST(:s AS jsonb) WHERE id = :id"),
            {"s": json.dumps(patched), "id": row.id},
        )


def _apply(conn) -> None:
    _patch(conn, lambda s: None if KEY in s else {**s, KEY: True})


def _remove(conn) -> None:
    _patch(conn, lambda s: {k: v for k, v in s.items() if k != KEY} if KEY in s else None)


def upgrade() -> None:
    _apply(op.get_bind())


def downgrade() -> None:
    _remove(op.get_bind())
