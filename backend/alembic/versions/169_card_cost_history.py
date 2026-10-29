"""Add card_cost_history table."""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "169"
down_revision = "168"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "card_cost_history",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "card_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("fiscal_year", sa.Integer, nullable=False),
        sa.Column("field_key", sa.Text, nullable=False),
        sa.Column("value", sa.Float, default=0),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    op.create_unique_constraint(
        "uq_card_cost_history_card_fy_field",
        "card_cost_history",
        ["card_id", "fiscal_year", "field_key"],
    )


def downgrade() -> None:
    op.drop_table("card_cost_history")
