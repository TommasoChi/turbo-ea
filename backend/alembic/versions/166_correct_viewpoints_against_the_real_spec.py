"""Correct viewpoint object lists and 3 examples against the real ArchiMate 3.2 spec text.

Migrations 164 and 165 widened/added several viewpoints from inference and
from the seeded examples' own element usage, without the actual Open Group
specification text in hand (pubs.opengroup.org is login-gated). Read
directly against the spec now (Appendix C), several of those guesses were
wrong:

- Goal Realization does NOT have a "core element" allowance in the spec
  (unlike Requirements Realization) -- ``ApplicationComponent`` (164) was
  wrong, removed. Its one seeded example (fig06) no longer fits any single
  viewpoint and moves back to "layered".
- Technology Viewpoint's element list does not include ``Equipment`` --
  that belongs to the (separate, already-correct) Physical Viewpoint only.
  ``Equipment`` (164) removed from Technology; its one seeded example
  (fig32) moves back to "layered".
- Application Structure Viewpoint's spec list has no ``ApplicationFunction``
  (165) -- removed.
- Value Stream Viewpoint's spec list is exactly {ValueStream, Capability,
  Outcome, Stakeholder} -- ``Value`` and ``Resource`` (165) were not in it,
  removed. fig11 ("Value Stream", which uses Value) no longer fits and
  moves back to "layered"; fig13 (Capability + ValueStream only) still
  fits and stays.
- "Application Platform" (165) is not a distinct viewpoint in the spec's
  Appendix C at all -- it is the ArchiMate 3.0-era name for what the
  current spec calls the Implementation and Deployment Viewpoint, already
  seeded under that key. Deleted as a duplicate.
- Goal Contribution's spec summary is "goals (and requirements)
  influencing each other", not goals and drivers -- {Driver, Goal} (165)
  corrected to {Goal, Requirement}.
- Principles' spec summary explicitly includes "the goals that motivate
  these principles" -- {Principle} (165) widened to {Principle, Goal}.
- Requirements Realization's spec list also explicitly names Principle,
  Course of action, Resource, Capability, and Value stream, missed in 164's
  widening -- added (kept alongside 164's evidenced "core element" extras,
  which the spec's own wildcard for this one viewpoint does legitimize).
- Strategy and Outcome Realization were both already missing ``ValueStream``
  from their own spec lists (pre-existing gap, not from 164/165) -- added
  while here, since the real text is now in hand.
- Project was missing ``Outcome`` (pre-existing gap) -- added.

Revision ID: 166
Revises: 165
Create Date: 2026-10-26
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "166"
down_revision: Union[str, None] = "165"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_REMOVE_OBJECTS: list[tuple[str, str]] = [
    ("goal-realization", "ApplicationComponent"),
    ("technology", "Equipment"),
    ("application-structure", "ApplicationFunction"),
    ("value-stream", "Value"),
    ("value-stream", "Resource"),
    ("goal-contribution", "Driver"),
]

_ADD_OBJECTS: list[tuple[str, str]] = [
    ("goal-contribution", "Requirement"),
    ("principles", "Goal"),
    ("requirements-realization", "Principle"),
    ("requirements-realization", "CourseOfAction"),
    ("requirements-realization", "Resource"),
    ("requirements-realization", "Capability"),
    ("requirements-realization", "ValueStream"),
    ("strategy", "ValueStream"),
    ("outcome-realization", "ValueStream"),
    ("project", "Outcome"),
]

_REVERT_TO_LAYERED: list[str] = [
    "Goal Refinement View for Rationalization Strategy",
    "Value Stream",
    "IoT Device Services (Target)",
]


def upgrade() -> None:
    bind = op.get_bind()

    remove_sql = sa.text(
        "DELETE FROM archimate_viewpoint_objects "
        "WHERE viewpoint_key = :viewpoint_key AND enterprise_object_key = :enterprise_object_key"
    )
    for viewpoint_key, eo_key in _REMOVE_OBJECTS:
        bind.execute(remove_sql, {"viewpoint_key": viewpoint_key, "enterprise_object_key": eo_key})

    add_sql = sa.text(
        "INSERT INTO archimate_viewpoint_objects (id, viewpoint_key, enterprise_object_key) "
        "VALUES (gen_random_uuid(), :viewpoint_key, :enterprise_object_key) "
        "ON CONFLICT ON CONSTRAINT uq_archimate_viewpoint_objects_viewpoint_eo DO NOTHING"
    )
    for viewpoint_key, eo_key in _ADD_OBJECTS:
        bind.execute(add_sql, {"viewpoint_key": viewpoint_key, "enterprise_object_key": eo_key})

    # "Application Platform" is a duplicate of "implementation-and-deployment"
    # (see module docstring) -- drop its objects, then the viewpoint row itself.
    bind.execute(
        sa.text(
            "DELETE FROM archimate_viewpoint_objects WHERE viewpoint_key = 'application-platform'"
        )
    )
    bind.execute(sa.text("DELETE FROM archimate_viewpoints WHERE key = 'application-platform'"))

    revert_sql = sa.text(
        "UPDATE archimate_viewpoint_examples SET viewpoint_key = 'layered' "
        "WHERE name = :name AND viewpoint_key != 'layered'"
    )
    for name in _REVERT_TO_LAYERED:
        bind.execute(revert_sql, {"name": name})


def downgrade() -> None:
    # The corrected object lists and example assignments are intentionally not restorable.
    pass
