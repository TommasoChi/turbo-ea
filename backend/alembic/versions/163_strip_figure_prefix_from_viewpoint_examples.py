"""Strip the leading "Figure N: " prefix from seeded ArchiMate viewpoint example names.

The 28 bundled ArchiSurance/TOGAF walkthrough examples were named after their
source figure number ("Figure 9: Organization View"), which is meaningless to
an end user picking a starter for a new diagram. The seed (``viewpoint_example_
seed.py``) now inserts the bare titles, but it is insert-only on the natural
key (viewpoint_key, name) -- it would never rename a row that already exists,
it would just insert a second, differently-named duplicate. This migration
renames the existing rows in place instead, so every environment ends up with
one row per figure, not two.

Guarded UPDATE: only rows still carrying the old "Figure N: " prefix are
touched, so an admin's own already-renamed row is left alone.

Revision ID: 163
Revises: 162
Create Date: 2026-10-23
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "163"
down_revision: Union[str, None] = "162"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            r"UPDATE archimate_viewpoint_examples "
            r"SET name = regexp_replace(name, '^Figure \d+:\s*', '') "
            r"WHERE name ~ '^Figure \d+:'"
        )
    )


def downgrade() -> None:
    # The original "Figure N:" prefix is intentionally not restorable.
    pass
