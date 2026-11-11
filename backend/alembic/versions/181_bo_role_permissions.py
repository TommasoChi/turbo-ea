"""Grant BO Relationship view to existing seeded roles when unset.

The admin wildcard already grants view and edit. Custom roles and explicit
choices on the seeded roles keep their current permissions.

Revision ID: 181
Revises: 180
"""

from sqlalchemy import String, column, func, table, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Connection

from alembic import op

revision = "181"
down_revision = "180"
branch_labels = None
depends_on = None


def _upgrade_body(conn: Connection) -> None:
    roles = table("roles", column("key", String), column("permissions", JSONB))
    permissions = roles.c.permissions
    conn.execute(
        update(roles)
        .where(
            roles.c.key.in_(("bpm_admin", "member", "viewer")),
            func.jsonb_typeof(permissions) == "object",
            permissions["*"].is_distinct_from(func.to_jsonb(True)),
            ~func.jsonb_exists(permissions, "boRelationship.view"),
        )
        .values(
            permissions=permissions.concat(func.jsonb_build_object("boRelationship.view", True))
        )
    )


def upgrade() -> None:
    _upgrade_body(op.get_bind())


def downgrade() -> None:
    # Revision 180 already exposes these permissions. A view grant added here
    # is indistinguishable from an administrator's grant, so preserve it.
    pass
