"""Widen Goal/Requirements Realization and Technology viewpoints, re-sort 3 examples.

ArchiMate 3.1's own Requirements Realization Viewpoint is defined as showing
how core elements (business services, processes, application components)
fulfil requirements -- the seed's own `objects` list only carried the
motivation-layer "core" concepts (Requirement, Goal, Constraint, Outcome,
Value, Meaning), never the realizing elements the viewpoint's name and
purpose are actually about, so no diagram that actually realizes a
requirement could ever be classified under it; the seed's own fallback
("layered") was all three of these examples could ever match on. Same
issue, smaller, for Goal Realization (missing ApplicationComponent) and
Technology (missing Equipment, a Physical-layer element real Technology
viewpoint diagrams routinely include for e.g. IoT device services).

Widens all three viewpoints' allowed-objects lists and moves the three
seeded examples that were stuck under "layered" purely because of this gap
onto their rightful viewpoint. `viewpoint_example_seed.py` is insert-only on
the natural key (viewpoint_key, name), so editing its `_EXAMPLE_DEFS` tuples
alone would insert new duplicate rows rather than moving the existing ones
-- this migration updates the existing rows in place, the same approach
revision 163 used for the name-prefix rename.

Revision ID: 164
Revises: 163
Create Date: 2026-10-23
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "164"
down_revision: Union[str, None] = "163"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (viewpoint_key, [new enterprise_object_key, ...])
_NEW_OBJECTS: list[tuple[str, list[str]]] = [
    ("goal-realization", ["ApplicationComponent"]),
    (
        "requirements-realization",
        ["ApplicationComponent", "ApplicationService", "Artifact", "BusinessProcess", "Device"],
    ),
    ("technology", ["Equipment"]),
]

# (example name, new viewpoint_key) -- moved off "layered" only.
_RESORTED_EXAMPLES: list[tuple[str, str]] = [
    ("Goal Refinement View for Rationalization Strategy", "goal-realization"),
    ("Requirements Realization View", "requirements-realization"),
    ("IoT Device Services (Target)", "technology"),
]


def upgrade() -> None:
    insert_sql = sa.text(
        "INSERT INTO archimate_viewpoint_objects (id, viewpoint_key, enterprise_object_key) "
        "VALUES (gen_random_uuid(), :viewpoint_key, :enterprise_object_key) "
        "ON CONFLICT ON CONSTRAINT uq_archimate_viewpoint_objects_viewpoint_eo DO NOTHING"
    )
    for viewpoint_key, objects in _NEW_OBJECTS:
        for eo_key in objects:
            op.get_bind().execute(
                insert_sql, {"viewpoint_key": viewpoint_key, "enterprise_object_key": eo_key}
            )

    update_sql = sa.text(
        "UPDATE archimate_viewpoint_examples SET viewpoint_key = :viewpoint_key "
        "WHERE name = :name AND viewpoint_key = 'layered'"
    )
    for name, viewpoint_key in _RESORTED_EXAMPLES:
        op.get_bind().execute(update_sql, {"name": name, "viewpoint_key": viewpoint_key})


def downgrade() -> None:
    # The widened objects and re-sorted examples are intentionally not restorable.
    pass
