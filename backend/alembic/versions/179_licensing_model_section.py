"""``licensingModel`` lives in its own protected ``Licensing`` section.

Moves the field out of the general section of Application / IT Component into a dedicated
``Licensing`` section (created when missing) and restores it, from the one shared definition,
on an instance where an admin deleted it. Card values are never touched. Idempotent.

Revision ID: 179
Revises: 178
Create Date: 2026-11-06
"""

import json
from typing import Sequence, Union

from sqlalchemy.sql import text

from alembic import op
from app.services import licensing_migration as lm

revision: str = "179"
down_revision: Union[str, None] = "178"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _data_body(conn) -> None:
    """Sync-connection body so tests can drive it with ``AsyncConnection.run_sync``."""
    for row in conn.execute(
        text("SELECT key, fields_schema FROM card_types WHERE key = ANY(:t)"),
        {"t": list(lm.LICENSING_TYPES)},
    ).fetchall():
        schema = lm.move_model_field(row.key, row.fields_schema or [])
        if schema is not None:
            conn.execute(
                text("UPDATE card_types SET fields_schema = CAST(:s AS jsonb) WHERE key = :k"),
                {"s": json.dumps(schema), "k": row.key},
            )


def upgrade() -> None:
    _data_body(op.get_bind())


def downgrade() -> None:
    """One-way: the field stays where it is (the previous placement was cosmetic)."""
