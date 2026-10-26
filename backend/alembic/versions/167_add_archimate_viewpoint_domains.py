"""Add ArchimateViewpoint.domains (the Viewpoint Catalog's "Domain" column).

Nullable, additive JSONB column: which of the three diagram-creation tabs
(business/application/technology) a viewpoint is tagged under. Stored, not
derived at read time -- an admin can retag a viewpoint independently of
what its allowed objects actually are, through the Viewpoint Catalog's
editable Domain checkboxes.

Backfills every row that exists at migration time with the same
business/application/technology grouping `api/v1/diagrams.py`'s
``TAB_LAYERS`` already uses elsewhere (which of an object's own
``EnterpriseObject.layer`` falls in which tab) -- baked in as a literal
dict below, like migration 160's aspect backfill, so a later edit to
``taxonomy.py``'s ``TAB_LAYERS`` can never rewrite this migration's
history. A fresh install instead gets its initial ``domains`` from
``viewpoint_seed.py``, computed the same way at seed time -- this
migration's backfill only matters for a database that already had
viewpoints and their allowed objects before this column existed.

Revision ID: 167
Revises: 166
Create Date: 2026-10-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "167"
down_revision: Union[str, None] = "166"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TAB_LAYERS: dict[str, set[str]] = {
    "business": {"strategy", "business", "motivation"},
    "application": {"application"},
    "technology": {"technology", "physical"},
}


def upgrade() -> None:
    op.add_column(
        "archimate_viewpoints",
        sa.Column("domains", JSONB, nullable=True),
    )

    conn = op.get_bind()
    viewpoints = sa.table(
        "archimate_viewpoints", sa.column("key", sa.String), sa.column("domains", JSONB)
    )
    viewpoint_objects = sa.table(
        "archimate_viewpoint_objects",
        sa.column("viewpoint_key", sa.String),
        sa.column("enterprise_object_key", sa.String),
    )
    enterprise_objects = sa.table(
        "enterprise_objects", sa.column("key", sa.String), sa.column("layer", sa.String)
    )

    layer_by_object = dict(
        conn.execute(sa.select(enterprise_objects.c.key, enterprise_objects.c.layer)).all()
    )
    objects_by_viewpoint: dict[str, list[str]] = {}
    for viewpoint_key, enterprise_object_key in conn.execute(
        sa.select(viewpoint_objects.c.viewpoint_key, viewpoint_objects.c.enterprise_object_key)
    ).all():
        objects_by_viewpoint.setdefault(viewpoint_key, []).append(enterprise_object_key)

    for (key,) in conn.execute(sa.select(viewpoints.c.key)).all():
        layers = {layer_by_object.get(k) for k in objects_by_viewpoint.get(key, [])}
        layers.discard(None)
        domains = [tab for tab, tab_layers in _TAB_LAYERS.items() if tab_layers & layers]
        conn.execute(viewpoints.update().where(viewpoints.c.key == key).values(domains=domains))


def downgrade() -> None:
    op.drop_column("archimate_viewpoints", "domains")
