"""Card licenses: the catalogue (``license_types``), the per-card, per-year counts
(``card_licenses``) and the ``licenses.view`` / ``licenses.edit`` role grants.

Defaults first (built-in roles, absent keys only), then the ``true`` grants of the
``licensing`` extension (``ext.licensing.view`` / ``.manage``) are copied.

Revision ID: 177
Revises: 176
Create Date: 2026-11-05
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import text

from alembic import op

revision: str = "177"
down_revision: Union[str, None] = "176"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DEFAULTS = {
    "bpm_admin": {"licenses.view": True, "licenses.edit": False},
    "member": {"licenses.view": True, "licenses.edit": False},
    "viewer": {"licenses.view": False, "licenses.edit": False},
}
_COPY = {"ext.licensing.view": "licenses.view", "ext.licensing.manage": "licenses.edit"}


def plan_defaults(role_key, perms):
    """The permissions with the license defaults added, or None for no change."""
    defaults = _DEFAULTS.get(role_key)
    if defaults is None or not isinstance(perms, dict) or perms.get("*"):
        return None
    missing = {k: v for k, v in defaults.items() if k not in perms}
    return {**perms, **missing} if missing else None


def plan_copy(perms):
    """The permissions with the extension's ``true`` grants copied, or None for no change."""
    if not isinstance(perms, dict) or perms.get("*"):
        return None
    changes = {
        new: True
        for old, new in _COPY.items()
        if perms.get(old) is True and perms.get(new) is not True
    }
    return {**perms, **changes} if changes else None


def _stamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "license_types",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(length=64), nullable=False, unique=True),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "translations",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        *_stamps(),
    )
    op.create_table(
        "card_licenses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "card_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("fiscal_year", sa.Integer(), nullable=False),
        sa.Column(
            "items", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"
        ),
        *_stamps(),
        sa.UniqueConstraint("card_id", "fiscal_year", name="uq_card_licenses_card_year"),
    )
    op.create_index("ix_card_licenses_card_id", "card_licenses", ["card_id"])

    bind = op.get_bind()
    for key, perms in bind.execute(text("SELECT key, permissions FROM roles")).all():
        patched = plan_defaults(key, perms)
        copied = plan_copy(patched if patched is not None else perms)
        final = copied if copied is not None else patched
        if final is not None:
            bind.execute(
                text("UPDATE roles SET permissions = CAST(:p AS jsonb) WHERE key = :key"),
                {"p": json.dumps(final), "key": key},
            )


def downgrade() -> None:
    op.drop_index("ix_card_licenses_card_id", table_name="card_licenses")
    op.drop_table("card_licenses")
    op.drop_table("license_types")
    op.get_bind().execute(
        text("UPDATE roles SET permissions = permissions - 'licenses.view' - 'licenses.edit'")
    )
