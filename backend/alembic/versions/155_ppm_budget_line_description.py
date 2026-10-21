"""Give a PPM budget line an optional description.

One additive, nullable column, no backfill. Cost lines have always carried a
description; a planned budget line only had fiscal year, category and amount,
so two lines on the same fiscal year + category could not say what each was
for. Several lines per pair stay allowed: deliberately no unique constraint.

Downgrade drops the column, which discards the descriptions.

Revision ID: 155
Revises: 155b
Create Date: 2026-10-19

Repointed onto "155b" by the fork's merge of upstream on 2026-10-21: this
migration's own "155" collided with the fork's existing
``155_add_value_chain_metamodel.py``, which took the lettered id so this one
could keep the canonical number, following the "128"/"128b" precedent.
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "155"
down_revision: Union[str, None] = "155b"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def _columns(table: str) -> set[str]:
    from sqlalchemy import inspect as sa_inspect

    return {c["name"] for c in sa_inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if "description" not in _columns("ppm_budget_lines"):
        op.add_column("ppm_budget_lines", sa.Column("description", sa.Text(), nullable=True))


def downgrade() -> None:
    if "description" in _columns("ppm_budget_lines"):
        op.drop_column("ppm_budget_lines", "description")
