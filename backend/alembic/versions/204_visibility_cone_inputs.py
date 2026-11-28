"""Persist Organization chart inputs and write-deny cells.

Revision ID: 204
Revises: 203
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision = "204"
down_revision = "203"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "stakeholder_role_definitions",
        sa.Column("is_position_role", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("cards", sa.Column("organization_cone_state", sa.String(30), nullable=True))
    connection = op.get_bind()
    roles = sa.table("roles", sa.column("key", sa.String()))
    types = sa.table(
        "card_types", sa.column("key", sa.String()), sa.column("role_permissions", JSONB())
    )
    definitions = sa.table(
        "stakeholder_role_definitions",
        sa.column("card_type_key", sa.String()),
        sa.column("key", sa.String()),
        sa.column("is_position_role", sa.Boolean()),
    )
    cards = sa.table(
        "cards",
        sa.column("id", UUID(as_uuid=True)),
        sa.column("type", sa.String()),
        sa.column("parent_id", UUID(as_uuid=True)),
        sa.column("organization_cone_state", sa.String()),
    )
    connection.execute(
        definitions.update()
        .where(definitions.c.card_type_key == "Organization", definitions.c.key == "responsible")
        .values(is_position_role=True)
    )
    connection.execute(
        cards.update()
        .where(cards.c.type == "Organization", cards.c.parent_id.is_(None))
        .values(organization_cone_state="unconfirmed_root")
    )
    connection.execute(
        cards.update()
        .where(cards.c.type == "Organization", cards.c.parent_id.is_not(None))
        .values(organization_cone_state="connected")
    )
    row = connection.execute(
        sa.select(types.c.role_permissions).where(types.c.key == "Organization")
    ).one_or_none()
    if row is not None:
        matrix = {key: dict(cells) for key, cells in (row.role_permissions or {}).items()}
        for key in connection.execute(sa.select(roles.c.key)).scalars():
            if key != "admin":
                cells = matrix.setdefault(key, {})
                cells.update(
                    {"inventory.create": False, "inventory.edit": False, "inventory.delete": False}
                )
        connection.execute(
            types.update().where(types.c.key == "Organization").values(role_permissions=matrix)
        )


def downgrade():
    # The previous matrix values are not known; retain the write denies.
    op.drop_column("cards", "organization_cone_state")
    op.drop_column("stakeholder_role_definitions", "is_position_role")
