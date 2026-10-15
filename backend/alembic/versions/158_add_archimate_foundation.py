"""ArchiMate foundation: mapping columns, ``diagrams.kind`` and the default mapping.

Adds ``card_types.archimate_type``, ``relation_types.archimate_type`` /
``archimate_access`` / ``archimate_reversed`` and ``diagrams.kind``
(``drawio`` | ``archimate``, default ``drawio``). Existing built-in types receive
the default mapping; a value an admin already set is NEVER overwritten, and a
subtype that already carries an ``archimate_type`` keeps it. Idempotent.

The default tables are embedded (a migration must not import ``app`` code); a
test pins that they equal ``app.services.archimate.default_mapping``.

Revision ID: 158
Revises: 157
Create Date: 2026-10-16
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.sql import text

from alembic import op

revision: str = "158"
down_revision: Union[str, None] = "157"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# --- embedded copy of app.services.archimate.default_mapping (see the test) ----
CARD_TYPE_DEFAULTS = {
    "Objective": "Goal",
    "Platform": "Grouping",
    "Initiative": "WorkPackage",
    "Organization": "BusinessActor",
    "BusinessCapability": "Capability",
    "BusinessContext": None,
    "BusinessProcess": "BusinessProcess",
    "Application": "ApplicationComponent",
    "Interface": "ApplicationInterface",
    "DataObject": "BusinessObject",
    "ITComponent": "Node",
    "TechCategory": "Grouping",
    "Provider": "BusinessActor",
}

SUBTYPE_DEFAULTS = {
    ("Objective", "businessGoal"): "Goal",
    ("Objective", "valueGate"): "Assessment",
    ("Organization", "region"): "Location",
    ("BusinessContext", "process"): "BusinessProcess",
    ("BusinessContext", "valueStream"): "ValueStream",
    ("BusinessContext", "customerJourney"): "BusinessProcess",
    ("BusinessContext", "businessProduct"): "Product",
    ("BusinessContext", "esgCapability"): "Capability",
    ("BusinessProcess", "category"): "BusinessFunction",
    ("BusinessProcess", "group"): "BusinessFunction",
    ("ITComponent", "software"): "SystemSoftware",
    ("ITComponent", "hardware"): "Device",
    ("ITComponent", "saas"): "TechnologyService",
    ("ITComponent", "paas"): "TechnologyService",
    ("ITComponent", "iaas"): "TechnologyService",
    ("ITComponent", "service"): "TechnologyService",
    ("ITComponent", "aiModel"): "SystemSoftware",
}

RELATION_DEFAULTS = {
    "relObjectiveToBC": {"type": "Association"},
    "relPlatformToObjective": {"type": "Influence"},
    "relPlatformToApp": {"type": "Aggregation"},
    "relPlatformToITC": {"type": "Aggregation"},
    "relInitiativeToObjective": {"type": "Influence"},
    "relInitiativeToPlatform": {"type": "Association"},
    "relInitiativeToBC": {"type": "Association"},
    "relInitiativeToApp": {"type": "Association"},
    "relInitiativeToInterface": {"type": "Association"},
    "relInitiativeToDataObj": {"type": "Association"},
    "relInitiativeToITC": {"type": "Association"},
    "relOrgToObjective": {"type": "Association"},
    "relOrgToInitiative": {"type": "Assignment"},
    "relOrgToBizCtx": {"type": "Association"},
    "relOrgToApp": {"type": "Serving", "reversed": True},
    "relOrgToITC": {"type": "Association"},
    "relAppToBC": {"type": "Realization"},
    "relAppToBizCtx": {"type": "Association"},
    "relAppToInterface": {"type": "Association"},
    "relAppToDataObj": {"type": "Access", "access": "crud"},
    "relAppToITC": {"type": "Serving", "reversed": True},
    "relITCToTechCat": {"type": "Aggregation", "reversed": True},
    "relITCToPlatform": {"type": "Aggregation", "reversed": True},
    "relInterfaceToDataObj": {"type": "Association"},
    "relInterfaceToITC": {"type": "Association"},
    "relProviderToInitiative": {"type": "Association"},
    "relProviderToApp": {"type": "Association"},
    "relProviderToITC": {"type": "Association"},
    "relBizCtxToBC": {"type": "Association"},
    "relProcessToBC": {"type": "Realization"},
    "relProcessToApp": {"type": "Serving", "reversed": True},
    "relProcessToDataObj": {"type": "Access", "access": "crud"},
    "relProcessToITC": {"type": "Serving", "reversed": True},
    "relProcessDependency": {"type": "Association"},
    "relProcessCalls": {"type": "Triggering"},
    "relProcessToOrg": {"type": "Assignment", "reversed": True},
    "relProcessToInitiative": {"type": "Association"},
    "relProcessToObjective": {"type": "Influence"},
    "relProcessToBizCtx": {"type": "Realization"},
    "relObjectiveToBizCtx": {"type": "Association"},
    "relBusinessContextSuccessor": {"type": "Triggering", "reversed": True},
}
SUCCESSOR_DEFAULT = {"type": "Association"}


def _backfill_card_types(conn) -> None:
    rows = conn.execute(text("SELECT id, key, archimate_type, subtypes FROM card_types")).fetchall()
    for row in rows:
        default = CARD_TYPE_DEFAULTS.get(row.key)
        new_type = row.archimate_type if row.archimate_type is not None else default
        subtypes = row.subtypes if isinstance(row.subtypes, list) else []
        patched, changed = [], False
        for sub in subtypes:
            if isinstance(sub, dict) and not sub.get("archimate_type"):
                wanted = SUBTYPE_DEFAULTS.get((row.key, sub.get("key")))
                if wanted:
                    sub = {**sub, "archimate_type": wanted}
                    changed = True
            patched.append(sub)
        if new_type != row.archimate_type or changed:
            conn.execute(
                text(
                    "UPDATE card_types SET archimate_type = :t, subtypes = CAST(:s AS jsonb) "
                    "WHERE id = :id"
                ),
                {"t": new_type, "s": json.dumps(patched), "id": row.id},
            )


def _backfill_relation_types(conn) -> None:
    rows = conn.execute(
        text("SELECT id, key, archimate_type, archimate_access FROM relation_types")
    ).fetchall()
    for row in rows:
        if row.archimate_type is not None:
            continue
        default = RELATION_DEFAULTS.get(row.key)
        if default is None and row.key.startswith("rel") and row.key.endswith("Successor"):
            default = SUCCESSOR_DEFAULT
        if default is None:
            continue
        conn.execute(
            text(
                "UPDATE relation_types SET archimate_type = :t, archimate_reversed = :r, "
                "archimate_access = :a WHERE id = :id"
            ),
            {
                "t": default["type"],
                "r": bool(default.get("reversed", False)),
                "a": default.get("access"),
                "id": row.id,
            },
        )


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    def add_column(table: str, column: sa.Column) -> None:
        if column.name not in [c["name"] for c in inspector.get_columns(table)]:
            op.add_column(table, column)

    add_column("card_types", sa.Column("archimate_type", sa.String(64), nullable=True))
    add_column("relation_types", sa.Column("archimate_type", sa.String(64), nullable=True))
    add_column("relation_types", sa.Column("archimate_access", sa.String(16), nullable=True))
    add_column(
        "relation_types",
        sa.Column("archimate_reversed", sa.Boolean(), nullable=False, server_default="false"),
    )
    add_column(
        "diagrams",
        sa.Column("kind", sa.String(20), nullable=False, server_default="drawio"),
    )
    if "ix_diagrams_kind" not in [i["name"] for i in inspector.get_indexes("diagrams")]:
        op.create_index("ix_diagrams_kind", "diagrams", ["kind"])
    _backfill_card_types(conn)
    _backfill_relation_types(conn)


def downgrade() -> None:
    op.drop_index("ix_diagrams_kind", table_name="diagrams")
    op.drop_column("diagrams", "kind")
    op.drop_column("relation_types", "archimate_reversed")
    op.drop_column("relation_types", "archimate_access")
    op.drop_column("relation_types", "archimate_type")
    op.drop_column("card_types", "archimate_type")
