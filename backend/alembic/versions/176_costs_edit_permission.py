"""Costs permissions default to the admin role only.

``costs.view`` was granted to ``bpm_admin`` and ``member`` by 069; from now on
only admin holds it (stakeholders still see costs on their own cards). The new
``costs.edit`` key is written as ``false`` on the seeded non-admin roles. Custom
roles are untouched.

Revision ID: 176
Revises: 175
"""

from sqlalchemy import text

from alembic import op

revision = "176"
down_revision = "175"
branch_labels = None
depends_on = None

_ROLES = ("bpm_admin", "member", "viewer")


def upgrade() -> None:
    bind = op.get_bind()
    for key in _ROLES:
        bind.execute(
            text(
                """
                UPDATE roles
                SET permissions = COALESCE(permissions, '{}'::jsonb)
                              || jsonb_build_object('costs.edit', false)
                              || jsonb_build_object('costs.view', false)
                WHERE key = :key
                """
            ),
            {"key": key},
        )


def downgrade() -> None:
    bind = op.get_bind()
    for key in _ROLES:
        bind.execute(
            text("UPDATE roles SET permissions = permissions - 'costs.edit' WHERE key = :key"),
            {"key": key},
        )
    for key in ("bpm_admin", "member"):
        bind.execute(
            text(
                "UPDATE roles SET permissions = permissions || jsonb_build_object('costs.view', true)"
                " WHERE key = :key"
            ),
            {"key": key},
        )
