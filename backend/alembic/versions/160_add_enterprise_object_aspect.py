"""Add EnterpriseObject.aspect (ArchiMate's structural aspect).

Passive Structure / Behavior / Active Structure, per the standard's Aspects x
Layers framework. Motivation elements, connectors, and the composite types
(Product, Plateau, Gap, Grouping, Location) have no single aspect and stay
NULL. Nullable, additive. Backfills the standard rows already seeded with the
classification the standard fixes for them (see
app/services/archimate/taxonomy.py's aspect_of(), mirrored in
frontend/src/features/archimate/taxonomy/elements.ts's aspectOf() — the three
lists below are that function's output for ELEMENT_TYPES, baked in rather
than imported so a later taxonomy.py edit can't rewrite this migration's
history). A custom (non-standard) row stays NULL until its admin sets it.

Revision ID: 160
Revises: 159
Create Date: 2026-10-19
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "160"
down_revision: Union[str, None] = "159"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_PASSIVE = (
    "BusinessObject", "Contract", "Representation", "DataObject", "Artifact",
    "Material", "Deliverable",
)
_BEHAVIOR = (
    "Capability", "ValueStream", "CourseOfAction", "BusinessProcess", "BusinessFunction",
    "BusinessInteraction", "BusinessEvent", "BusinessService", "ApplicationFunction",
    "ApplicationInteraction", "ApplicationProcess", "ApplicationEvent", "ApplicationService",
    "TechnologyFunction", "TechnologyProcess", "TechnologyInteraction", "TechnologyEvent",
    "TechnologyService", "WorkPackage", "ImplementationEvent",
)
_ACTIVE = (
    "Resource", "BusinessActor", "BusinessRole", "BusinessCollaboration", "BusinessInterface",
    "ApplicationComponent", "ApplicationCollaboration", "ApplicationInterface", "Node", "Device",
    "SystemSoftware", "TechnologyCollaboration", "TechnologyInterface", "Path",
    "CommunicationNetwork", "Equipment", "Facility", "DistributionNetwork",
)


def upgrade() -> None:
    op.add_column(
        "enterprise_objects",
        sa.Column("aspect", sa.String(length=16), nullable=True),
    )
    conn = op.get_bind()
    enterprise_objects = sa.table(
        "enterprise_objects",
        sa.column("key", sa.String),
        sa.column("aspect", sa.String),
    )
    for aspect, keys in (("passive", _PASSIVE), ("behavior", _BEHAVIOR), ("active", _ACTIVE)):
        conn.execute(
            enterprise_objects.update()
            .where(enterprise_objects.c.key.in_(keys))
            .values(aspect=aspect)
        )


def downgrade() -> None:
    op.drop_column("enterprise_objects", "aspect")
