"""Add the 5 standard ArchiMate 3.1 viewpoints the catalog was missing.

The Open Group's own `ViewpointsEnum` (`archimate3_View.xsd`) names 28
standard viewpoints; `viewpoint_seed.py` only ever seeded 23 -- missing
Value Stream, Application Platform, Application Structure, Goal
Contribution, and Principles entirely. Two of the 28 seeded reference
examples ("Value Stream", "Value Stream and Capability Cross-Mapping")
were stuck under the "layered" catch-all purely because there was no
Value Stream viewpoint to classify them under.

Inserted directly here, by key, rather than left to `seed_viewpoints()`'s
normal startup hook: that hook is insert-only and perfectly happy to pick
up a brand new key on its own next run, but this migration's own example
re-sort UPDATE below needs the `value-stream` row's FK target to exist
*now*, inside this same migration -- not whenever the app's seed step
next happens to run relative to this migration.

Revision ID: 165
Revises: 164
Create Date: 2026-10-23
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "165"
down_revision: Union[str, None] = "164"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (key, name, icon, layer, description, [objects...]) -- same shape and
# register as viewpoint_seed.py's own _VIEWPOINT_DEFS; sort_order values
# are arbitrary but distinct, placed after the existing 23's own range.
_NEW_VIEWPOINTS: list[tuple[str, str, str, str, str, list[str]]] = [
    (
        "application-structure",
        "Application Structure",
        "widgets",
        "application",
        "Shows the internal makeup of one or more applications: their components, interfaces, "
        "functions, and the data they hold.",
        [
            "ApplicationComponent",
            "ApplicationInterface",
            "ApplicationFunction",
            "ApplicationCollaboration",
            "DataObject",
        ],
    ),
    (
        "application-platform",
        "Application Platform",
        "developer_board",
        "technology",
        "Shows the technology infrastructure -- nodes, devices, system software, and services -- "
        "that an application runs on.",
        [
            "ApplicationComponent",
            "Node",
            "Device",
            "SystemSoftware",
            "TechnologyService",
            "TechnologyInterface",
            "Artifact",
            "Path",
            "CommunicationNetwork",
        ],
    ),
    (
        "goal-contribution",
        "Goal Contribution",
        "trending_up",
        "motivation",
        "Shows how goals and drivers help or hinder each other, positively or negatively.",
        ["Driver", "Goal"],
    ),
    (
        "principles",
        "Principles",
        "gavel",
        "motivation",
        "Lists the guiding principles an architecture must follow.",
        ["Principle"],
    ),
    (
        "value-stream",
        "Value Stream",
        "timeline",
        "strategy",
        "Shows a value stream's stages and the stakeholders, capabilities, and resources that "
        "realize them.",
        ["Stakeholder", "ValueStream", "Value", "Capability", "Resource", "Outcome"],
    ),
]

_RESORTED_EXAMPLES: list[tuple[str, str]] = [
    ("Value Stream", "value-stream"),
    ("Value Stream and Capability Cross-Mapping", "value-stream"),
]


def upgrade() -> None:
    bind = op.get_bind()

    viewpoint_insert = sa.text(
        "INSERT INTO archimate_viewpoints "
        "(id, key, name, icon, description, layer, is_standard, is_hidden, sort_order) "
        "VALUES (gen_random_uuid(), :key, :name, :icon, :description, :layer, "
        "true, false, :sort_order) "
        "ON CONFLICT (key) DO NOTHING"
    )
    object_insert = sa.text(
        "INSERT INTO archimate_viewpoint_objects (id, viewpoint_key, enterprise_object_key) "
        "VALUES (gen_random_uuid(), :viewpoint_key, :enterprise_object_key) "
        "ON CONFLICT ON CONSTRAINT uq_archimate_viewpoint_objects_viewpoint_eo DO NOTHING"
    )

    for sort_order, (key, name, icon, layer, description, objects) in enumerate(
        _NEW_VIEWPOINTS, start=1000
    ):
        bind.execute(
            viewpoint_insert,
            {
                "key": key,
                "name": name,
                "icon": icon,
                "description": description,
                "layer": layer,
                "sort_order": sort_order,
            },
        )
        for eo_key in objects:
            bind.execute(object_insert, {"viewpoint_key": key, "enterprise_object_key": eo_key})

    update_sql = sa.text(
        "UPDATE archimate_viewpoint_examples SET viewpoint_key = :viewpoint_key "
        "WHERE name = :name AND viewpoint_key = 'layered'"
    )
    for name, viewpoint_key in _RESORTED_EXAMPLES:
        bind.execute(update_sql, {"name": name, "viewpoint_key": viewpoint_key})


def downgrade() -> None:
    # The new viewpoints and re-sorted examples are intentionally not restorable.
    pass
