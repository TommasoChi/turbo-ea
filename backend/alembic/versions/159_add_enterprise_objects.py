"""Add the EnterpriseObject registry and its card-mapping bridge table.

Foundation for the ArchiMate enterprise object work: ``enterprise_objects``
holds one row per ArchiMate element type available to the editor;
``enterprise_object_card_mappings`` is the n:m bridge that says which
card type (and, optionally, subtype) maps to which enterprise object.
Additive only — no existing table is touched. Idempotent.

Revision ID: 159
Revises: 158
Create Date: 2026-10-17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "159"
down_revision: Union[str, None] = "158"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    if not inspector.has_table("enterprise_objects"):
        op.create_table(
            "enterprise_objects",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("key", sa.String(length=64), nullable=False, unique=True),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("icon", sa.String(length=100), nullable=False),
            sa.Column("color", sa.String(length=20), nullable=False),
            sa.Column("layer", sa.String(length=32), nullable=True),
            sa.Column("is_standard", sa.Boolean(), nullable=False),
            sa.Column("is_locked", sa.Boolean(), nullable=False),
            sa.Column("is_hidden", sa.Boolean(), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
        )

    if not inspector.has_table("enterprise_object_card_mappings"):
        op.create_table(
            "enterprise_object_card_mappings",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "enterprise_object_key",
                sa.String(length=64),
                sa.ForeignKey("enterprise_objects.key"),
                nullable=False,
            ),
            sa.Column(
                "card_type_key",
                sa.String(length=100),
                sa.ForeignKey("card_types.key"),
                nullable=False,
            ),
            sa.Column("card_subtype_key", sa.String(length=100), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            # nulls_not_distinct: two "all subtypes" (card_subtype_key=NULL)
            # rows for the same (enterprise_object_key, card_type_key) pair
            # must collide too, not just the concrete-subtype rows.
            sa.UniqueConstraint(
                "enterprise_object_key",
                "card_type_key",
                "card_subtype_key",
                name="uq_enterprise_object_card_mappings_eo_type_subtype",
                postgresql_nulls_not_distinct=True,
            ),
        )


def downgrade() -> None:
    op.drop_table("enterprise_object_card_mappings")
    op.drop_table("enterprise_objects")
