"""Add process_element_organizations junction table.

A single BPMN step can involve more than one organizational actor — unlike
the existing application_id/data_object_id/it_component_id columns on
process_elements (all 1:1 per element), Organization needs a proper M:N
junction table. Same shape as risk_cards: composite PK, cascade-deleted in
both directions.

Revision ID: 126
Revises: 125
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "126"
down_revision = "125"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "process_element_organizations",
        sa.Column(
            "element_id",
            UUID(as_uuid=True),
            sa.ForeignKey("process_elements.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint(
            "element_id", "organization_id", name="pk_process_element_organizations"
        ),
    )
    op.create_index(
        "ix_process_element_organizations_element_id",
        "process_element_organizations",
        ["element_id"],
    )
    op.create_index(
        "ix_process_element_organizations_organization_id",
        "process_element_organizations",
        ["organization_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_process_element_organizations_organization_id",
        table_name="process_element_organizations",
    )
    op.drop_index(
        "ix_process_element_organizations_element_id", table_name="process_element_organizations"
    )
    op.drop_table("process_element_organizations")
