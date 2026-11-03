"""Card cost items: the catalogue (``cost_item_types``) and the per-card, per-year
amounts (``card_costs``). Tables only; data steps are added separately.

Revision ID: 175
Revises: 174
Create Date: 2026-11-03
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "175"
down_revision: Union[str, None] = "174"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _stamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "cost_item_types",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(length=64), nullable=False, unique=True),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "translations",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        *_stamps(),
    )
    op.create_table(
        "card_costs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "card_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("fiscal_year", sa.Integer(), nullable=False),
        sa.Column(
            "items", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"
        ),
        *_stamps(),
        sa.UniqueConstraint("card_id", "fiscal_year", name="uq_card_costs_card_year"),
    )
    op.create_index("ix_card_costs_card_id", "card_costs", ["card_id"])


def downgrade() -> None:
    op.drop_index("ix_card_costs_card_id", table_name="card_costs")
    op.drop_table("card_costs")
    op.drop_table("cost_item_types")
