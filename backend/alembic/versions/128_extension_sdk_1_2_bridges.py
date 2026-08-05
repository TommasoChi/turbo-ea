"""Add generic entity ownership for the extension SDK 1.2 bridges.

The audit bridge can address an extension-owned entity without pretending it
is a native Card.  Documents and file attachments retain their existing Card
ownership contract while gaining the mutually-exclusive generic owner used by
extension evidence.

Revision ID: 128b
Revises: 127

Note: this fork-local migration collided with upstream's own new revision
"128" (128_add_calculation_blanks_as_zero.py, merged from upstream v2.40.0)
— both independently branched off "127". Renumbered to "128b" and kept
chained after "127" (its actual applied position on existing fork
databases); upstream's "128" was rebased to chain after this one instead
of also branching off "127", restoring a single linear head. Filename is
intentionally left as `128_...` so the existing contract test
(`tests/services/test_alembic_128_extension_sdk_bridges.py`) that imports
this file by path keeps working; only the revision id changed.
"""

from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "128b"
down_revision: Union[str, None] = "127"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None

_OWNER_CONDITION = (
    "(card_id IS NOT NULL AND entity_type IS NULL AND entity_id IS NULL) OR "
    "(card_id IS NULL AND entity_type IS NOT NULL AND entity_id IS NOT NULL)"
)


def upgrade() -> None:
    op.add_column("events", sa.Column("entity_type", sa.String(100), nullable=True))
    op.add_column(
        "events",
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_events_entity_type", "events", ["entity_type"])
    op.create_index("ix_events_entity_id", "events", ["entity_id"])

    for table_name in ("documents", "file_attachments"):
        op.alter_column(
            table_name,
            "card_id",
            existing_type=postgresql.UUID(as_uuid=True),
            nullable=True,
        )
        op.add_column(
            table_name,
            sa.Column("entity_type", sa.String(100), nullable=True),
        )
        op.add_column(
            table_name,
            sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
        op.create_index(
            f"ix_{table_name}_entity_type",
            table_name,
            ["entity_type"],
        )
        op.create_index(
            f"ix_{table_name}_entity_id",
            table_name,
            ["entity_id"],
        )
        op.create_check_constraint(
            f"ck_{table_name}_exactly_one_owner",
            table_name,
            _OWNER_CONDITION,
        )


def downgrade() -> None:
    generic_owner_count = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT "
                "(SELECT count(*) FROM documents WHERE card_id IS NULL) + "
                "(SELECT count(*) FROM file_attachments WHERE card_id IS NULL)"
            )
        )
        .scalar_one()
    )
    if generic_owner_count:
        raise RuntimeError(
            "Cannot downgrade SDK 1.2 while generic extension resources exist; "
            "export or delete those resources first"
        )

    for table_name in ("file_attachments", "documents"):
        op.drop_constraint(
            f"ck_{table_name}_exactly_one_owner",
            table_name,
            type_="check",
        )
        op.drop_index(f"ix_{table_name}_entity_id", table_name=table_name)
        op.drop_index(f"ix_{table_name}_entity_type", table_name=table_name)
        op.drop_column(table_name, "entity_id")
        op.drop_column(table_name, "entity_type")
        op.alter_column(
            table_name,
            "card_id",
            existing_type=postgresql.UUID(as_uuid=True),
            nullable=False,
        )

    op.drop_index("ix_events_entity_id", table_name="events")
    op.drop_index("ix_events_entity_type", table_name="events")
    op.drop_column("events", "entity_id")
    op.drop_column("events", "entity_type")
