"""BO Relationship defaults and concurrency guards.

Revision ID: 180
Revises: 179
"""

from __future__ import annotations

import json
import uuid

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "180"
down_revision = "179"
branch_labels = None
depends_on = None

BO_RELATIONSHIP_DIAGRAM_ID = uuid.UUID("b0000000-0000-4000-8000-000000000001")
SUBTYPES = [{"key": "data", "label": "Data"}, {"key": "document", "label": "Document"}]
PAYMENT = {"key": "isPaymentData", "label": "Contains Payment Data", "type": "boolean", "weight": 1}
OWNERSHIP = {
    "key": "dataOwnership",
    "label": "Data Ownership",
    "type": "single_select",
    "options": [{"key": "master", "label": "Master", "built_in": True}],
    "built_in": True,
}
CARDINALITY = {
    "key": "cardinality",
    "label": "Cardinality",
    "type": "single_select",
    "options": [{"key": v, "label": v, "built_in": True} for v in ("1:1", "1:n", "n:1", "n:m")],
    "built_in": True,
}


def _check_compatible(conn):
    """Refuse collisions before touching metadata or creating constraints."""
    er = (
        conn.execute(
            sa.text(
                "SELECT built_in, source_type_key, target_type_key, cardinality, attributes_schema FROM relation_types WHERE key='relDataObjectToDataObject'"
            )
        )
        .mappings()
        .first()
    )
    if er is not None and not er["built_in"]:
        raise RuntimeError("relDataObjectToDataObject is already a custom relation type")
    if er is None:
        orphan = conn.execute(
            sa.text(
                "SELECT source_id, target_id FROM relations WHERE type='relDataObjectToDataObject' LIMIT 1"
            )
        ).first()
        if orphan:
            raise RuntimeError(
                f"relDataObjectToDataObject has orphan relation {orphan[0]} / {orphan[1]}"
            )
    else:
        if (
            er["source_type_key"] != "DataObject"
            or er["target_type_key"] != "DataObject"
            or er["cardinality"] != "n:m"
        ):
            raise RuntimeError(
                "relDataObjectToDataObject has incompatible endpoints or cardinality"
            )
        fields = er["attributes_schema"] or []
        cardinality = next(
            (a for a in fields if isinstance(a, dict) and a.get("key") == "cardinality"), None
        )
        options = cardinality.get("options") if cardinality else None
        if (
            not cardinality
            or cardinality.get("type") != "single_select"
            or not isinstance(options, list)
            or not {"1:1", "1:n", "n:1", "n:m"}.issubset(
                {o.get("key") for o in options if isinstance(o, dict)}
            )
        ):
            raise RuntimeError("relDataObjectToDataObject cardinality attribute is incompatible")
    pair = conn.execute(
        sa.text(
            "SELECT least(source_id, target_id), greatest(source_id, target_id) FROM relations WHERE type='relDataObjectToDataObject' GROUP BY 1, 2 HAVING count(*) > 1 LIMIT 1"
        )
    ).first()
    if pair:
        raise RuntimeError(f"relDataObjectToDataObject has duplicate pair {pair[0]} / {pair[1]}")
    schema = (
        conn.execute(
            sa.text("SELECT attributes_schema FROM relation_types WHERE key='relAppToDataObj'")
        ).scalar_one_or_none()
        or []
    )
    if not isinstance(schema, list):
        raise RuntimeError("relAppToDataObj dataOwnership schema is incompatible")
    definition = next(
        (a for a in schema if isinstance(a, dict) and a.get("key") == "dataOwnership"), None
    )
    options = definition.get("options") if definition else None
    if definition and (
        definition.get("type") != "single_select"
        or not isinstance(options, list)
        or not any(isinstance(o, dict) and o.get("key") == "master" for o in options)
    ):
        raise RuntimeError("relAppToDataObj dataOwnership definition is incompatible")
    masters = conn.execute(
        sa.text(
            "SELECT target_id FROM relations WHERE type='relAppToDataObj' AND attributes->>'dataOwnership'='master' GROUP BY target_id HAVING count(*) > 1 LIMIT 1"
        )
    ).first()
    if masters:
        raise RuntimeError(
            f"relAppToDataObj dataOwnership has multiple Master markers for target {masters[0]}"
        )
    if not definition:
        marker = conn.execute(
            sa.text(
                "SELECT target_id FROM relations WHERE type='relAppToDataObj' AND attributes->>'dataOwnership'='master' LIMIT 1"
            )
        ).first()
        if marker:
            raise RuntimeError(
                f"relAppToDataObj dataOwnership marker for target {marker[0]} has no compatible definition"
            )


def _upgrade_body(conn):
    _check_compatible(conn)
    row = (
        conn.execute(
            sa.text("SELECT id, subtypes, fields_schema FROM card_types WHERE key = 'DataObject'")
        )
        .mappings()
        .first()
    )
    if row:
        subtypes = list(row["subtypes"] or [])
        subtypes.extend(x for x in SUBTYPES if x["key"] not in {v.get("key") for v in subtypes})
        sections = list(row["fields_schema"] or [])
        if not any(f.get("key") == "isPaymentData" for s in sections for f in s.get("fields", [])):
            section = next((s for s in sections if s.get("section") == "Data Information"), None)
            if section is None:
                section = {"section": "Data Information", "fields": []}
                sections.append(section)
            section.setdefault("fields", []).append(PAYMENT)
        conn.execute(
            sa.text(
                "UPDATE card_types SET subtypes=CAST(:subtypes AS jsonb), fields_schema=CAST(:fields AS jsonb) WHERE id=:id"
            ),
            {"subtypes": json.dumps(subtypes), "fields": json.dumps(sections), "id": row["id"]},
        )
    row = (
        conn.execute(
            sa.text("SELECT id, attributes_schema FROM relation_types WHERE key='relAppToDataObj'")
        )
        .mappings()
        .first()
    )
    if row:
        attrs = list(row["attributes_schema"] or [])
        definition = next((x for x in attrs if x.get("key") == "dataOwnership"), None)
        if definition is None:
            attrs.append(OWNERSHIP)
        else:
            definition["built_in"] = True
            next(o for o in definition["options"] if o.get("key") == "master")["built_in"] = True
        conn.execute(
            sa.text(
                "UPDATE relation_types SET attributes_schema=CAST(:attrs AS jsonb) WHERE id=:id"
            ),
            {"attrs": json.dumps(attrs), "id": row["id"]},
        )
    conn.execute(
        sa.text("""INSERT INTO relation_types (id, key, label, reverse_label, source_type_key, target_type_key, cardinality, attributes_schema, built_in, is_hidden, sort_order, translations)
        VALUES (:id, 'relDataObjectToDataObject', 'relates to', 'relates to', 'DataObject', 'DataObject', 'n:m', CAST(:attrs AS jsonb), true, false, 0, '{}'::jsonb) ON CONFLICT (key) DO NOTHING"""),
        {"id": uuid.uuid4(), "attrs": json.dumps([CARDINALITY])},
    )
    conn.execute(
        sa.text("""INSERT INTO diagrams (id, name, kind, data, is_published, access_mode)
        SELECT :id, 'BO Relationship', 'boRelationship', '{"positions": {}}'::jsonb, false, 'public'
        WHERE NOT EXISTS (SELECT 1 FROM diagrams WHERE kind='boRelationship') ON CONFLICT (id) DO NOTHING"""),
        {"id": BO_RELATIONSHIP_DIAGRAM_ID},
    )


def upgrade():
    _check_compatible(op.get_bind())
    op.create_table(
        "bo_operation_receipts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("draft_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("result_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("fingerprint", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("actor_id", "draft_id", "kind", name="uq_bo_receipt_actor_draft_kind"),
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_bo_er_pair ON relations (least(source_id, target_id), greatest(source_id, target_id)) WHERE type = 'relDataObjectToDataObject'"
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_bo_master ON relations (target_id) WHERE type = 'relAppToDataObj' AND attributes->>'dataOwnership' = 'master'"
    )
    _upgrade_body(op.get_bind())


def downgrade():
    op.execute("DROP INDEX uq_bo_master")
    op.execute("DROP INDEX uq_bo_er_pair")
    op.drop_table("bo_operation_receipts")
