"""Add the ArchimateViewpoint catalog and its bridge/example/tab-card tables.

Foundation for the ArchiMate Viewpoint Catalog: ``archimate_viewpoints`` holds
one row per viewpoint (Layered, Application Usage, ...); the three bridge
tables say which enterprise objects a viewpoint allows
(``archimate_viewpoint_objects``), which example diagrams it ships
(``archimate_viewpoint_examples``), and which card type each card detail tab
should suggest creating for it (``archimate_viewpoint_tab_cards``). Also adds
``diagrams.viewpoint_key``, nullable so existing "drawio" diagrams and any
pre-feature "archimate" diagram are left untouched. Additive only. Idempotent
(guards every create_table/add_column, same as 158/159) since this repo's
``001_baseline.py`` bootstrap can leave a DB with these tables already present
via ``Base.metadata.create_all()`` before this migration itself runs.

Revision ID: 161
Revises: 160
Create Date: 2026-10-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "161"
down_revision: Union[str, None] = "160"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    if not inspector.has_table("archimate_viewpoints"):
        op.create_table(
            "archimate_viewpoints",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("key", sa.String(length=64), nullable=False, unique=True),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("icon", sa.String(length=100), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("layer", sa.String(length=32), nullable=False),
            sa.Column("is_standard", sa.Boolean(), nullable=False),
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

    if not inspector.has_table("archimate_viewpoint_objects"):
        op.create_table(
            "archimate_viewpoint_objects",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "viewpoint_key",
                sa.String(length=64),
                sa.ForeignKey("archimate_viewpoints.key"),
                nullable=False,
            ),
            sa.Column(
                "enterprise_object_key",
                sa.String(length=64),
                sa.ForeignKey("enterprise_objects.key"),
                nullable=False,
            ),
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
            sa.UniqueConstraint(
                "viewpoint_key",
                "enterprise_object_key",
                name="uq_archimate_viewpoint_objects_viewpoint_eo",
            ),
        )

    if not inspector.has_table("archimate_viewpoint_examples"):
        op.create_table(
            "archimate_viewpoint_examples",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "viewpoint_key",
                sa.String(length=64),
                sa.ForeignKey("archimate_viewpoints.key"),
                nullable=False,
            ),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("exchange_xml", sa.Text(), nullable=False),
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

    if not inspector.has_table("archimate_viewpoint_tab_cards"):
        op.create_table(
            "archimate_viewpoint_tab_cards",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "viewpoint_key",
                sa.String(length=64),
                sa.ForeignKey("archimate_viewpoints.key"),
                nullable=False,
            ),
            sa.Column("tab_key", sa.String(length=32), nullable=False),
            sa.Column(
                "card_type_key",
                sa.String(length=100),
                sa.ForeignKey("card_types.key"),
                nullable=False,
            ),
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
            sa.UniqueConstraint(
                "viewpoint_key",
                "tab_key",
                "card_type_key",
                name="uq_archimate_viewpoint_tab_cards_viewpoint_tab_type",
            ),
        )

    if "viewpoint_key" not in [c["name"] for c in inspector.get_columns("diagrams")]:
        op.add_column(
            "diagrams",
            sa.Column(
                "viewpoint_key",
                sa.String(length=64),
                sa.ForeignKey("archimate_viewpoints.key", ondelete="RESTRICT"),
                nullable=True,
            ),
        )


def downgrade() -> None:
    op.drop_column("diagrams", "viewpoint_key")
    op.drop_table("archimate_viewpoint_tab_cards")
    op.drop_table("archimate_viewpoint_examples")
    op.drop_table("archimate_viewpoint_objects")
    op.drop_table("archimate_viewpoints")
