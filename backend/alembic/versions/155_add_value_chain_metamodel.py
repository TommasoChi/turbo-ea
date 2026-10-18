"""Add the Value Chain's metamodel to existing installs.

Fields (BusinessContext: isCore/isCross/sortOrder/levelOrder, BusinessProcess:
levelOrder), the Objective subtypes valueGate/businessGoal, has_successors on
BusinessContext, and the two relation types. Additive and idempotent: a key an
admin already created by hand is left exactly as it is.

Revision ID: 155
Revises: 154
Create Date: 2026-10-14

Still chains after "154", but that id now names a different migration since
the fork's merge of upstream on 2026-10-18: this fork's own former "154"
(value-chain permission) was renumbered to "154b" so upstream's own "154"
(audit_log) could take the plain id and sit between "154b" and "155" on the
single line, following the "128"/"128b" precedent
(``128_extension_sdk_1_2_bridges.py``).
"""

from __future__ import annotations

import json
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "155"
down_revision: Union[str, None] = "154"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Literals copied from seed.py at this revision, deliberately: the migration
# must keep describing the DB as of 155 even if the seed moves on.
SECTION_DEF = {
    "section": "Value Chain",
    "translations": {
        "de": "Wertschöpfungskette",
        "fr": "Chaîne de valeur",
        "es": "Cadena de valor",
        "it": "Catena del valore",
        "pt": "Cadeia de valor",
        "zh": "价值链",
        "ru": "Цепочка создания ценности",
        "da": "Værdikæde",
        "ar": "سلسلة القيمة",
    },
    "fields": [],
}

BIZCTX_FIELDS = [
    {
        "key": "isCore",
        "label": "Is Core",
        "type": "boolean",
        "weight": 0,
        "translations": {
            "de": "Ist Kern",
            "fr": "Est cœur de métier",
            "es": "Es nuclear",
            "it": "È core",
            "pt": "É central",
            "zh": "是否核心",
            "ru": "Основной",
            "da": "Er kerne",
            "ar": "أساسي",
        },
    },
    {
        "key": "isCross",
        "label": "Is Cross-Cutting",
        "type": "boolean",
        "weight": 0,
        "translations": {
            "de": "Ist übergreifend",
            "fr": "Est transversal",
            "es": "Es transversal",
            "it": "È trasversale",
            "pt": "É transversal",
            "zh": "是否横向",
            "ru": "Сквозной",
            "da": "Er tværgående",
            "ar": "شامل",
        },
    },
    {
        "key": "sortOrder",
        "label": "Sort Order",
        "type": "number",
        "weight": 0,
        "translations": {
            "de": "Sortierreihenfolge",
            "fr": "Ordre de tri",
            "es": "Orden de clasificación",
            "it": "Ordine di visualizzazione",
            "pt": "Ordem de classificação",
            "zh": "排序顺序",
            "ru": "Порядок сортировки",
            "da": "Sorteringsrækkefølge",
            "ar": "ترتيب الفرز",
        },
    },
    {
        "key": "levelOrder",
        "label": "Level Order",
        "type": "number",
        "weight": 0,
        "translations": {
            "de": "Ebenenreihenfolge",
            "fr": "Ordre de niveau",
            "es": "Orden de nivel",
            "it": "Ordine di livello",
            "pt": "Ordem de nível",
            "zh": "层级顺序",
            "ru": "Порядок уровней",
            "da": "Niveaurækkefølge",
            "ar": "ترتيب المستوى",
        },
    },
]

PROCESS_FIELDS = [
    {
        "key": "levelOrder",
        "label": "Level Order",
        "type": "number",
        "weight": 0,
        "translations": {
            "de": "Ebenenreihenfolge",
            "fr": "Ordre de niveau",
            "es": "Orden de nivel",
            "it": "Ordine di livello",
            "pt": "Ordem de nível",
            "zh": "层级顺序",
            "ru": "Порядок уровней",
            "da": "Niveaurækkefølge",
            "ar": "ترتيب المستوى",
        },
    }
]

OBJECTIVE_SUBTYPES = [
    {
        "key": "valueGate",
        "label": "Value Gate",
        "translations": {
            "de": "Value Gate",
            "fr": "Jalon de valeur",
            "es": "Hito de valor",
            "it": "Value Gate",
            "pt": "Marco de valor",
            "zh": "价值关卡",
            "ru": "Контрольная точка ценности",
            "da": "Værdiport",
            "ar": "بوابة القيمة",
        },
        "hidden_fields": [],
    },
    {
        "key": "businessGoal",
        "label": "Business Goal",
        "translations": {
            "de": "Geschäftsziel",
            "fr": "Objectif métier",
            "es": "Objetivo de negocio",
            "it": "Obiettivo di business",
            "pt": "Objetivo de negócio",
            "zh": "业务目标",
            "ru": "Бизнес-цель",
            "da": "Forretningsmål",
            "ar": "هدف العمل",
        },
        "hidden_fields": [],
    },
]

RELATION_TYPES = [
    {
        "key": "relObjectiveToBizCtx",
        "label": "is goal for",
        "reverse_label": "has goal",
        "source_type_key": "Objective",
        "target_type_key": "BusinessContext",
        "cardinality": "n:m",
        "sort_order": 48,
        "translations": {
            "label": {
                "de": "ist Ziel für",
                "fr": "est un objectif pour",
                "es": "es objetivo de",
                "it": "è obiettivo per",
                "pt": "é objetivo para",
                "zh": "是其目标",
                "ru": "является целью для",
                "da": "er mål for",
                "ar": "هدف لـ",
            },
            "reverse_label": {
                "de": "hat Ziel",
                "fr": "a pour objectif",
                "es": "tiene objetivo",
                "it": "ha obiettivo",
                "pt": "tem objetivo",
                "zh": "具有目标",
                "ru": "имеет цель",
                "da": "har mål",
                "ar": "له هدف",
            },
        },
    },
    {
        "key": "relBusinessContextSuccessor",
        "label": "succeeds",
        "reverse_label": "is succeeded by",
        "source_type_key": "BusinessContext",
        "target_type_key": "BusinessContext",
        "cardinality": "n:m",
        "sort_order": 49,
        "translations": {
            "label": {
                "de": "folgt auf",
                "fr": "succède à",
                "es": "sucede a",
                "it": "succede a",
                "pt": "sucede a",
                "zh": "继承",
                "ru": "следует за",
                "da": "efterfølger",
                "ar": "يخلف",
            },
            "reverse_label": {
                "de": "wird abgelöst durch",
                "fr": "a pour successeur",
                "es": "es sucedido por",
                "it": "ha come successore",
                "pt": "é sucedido por",
                "zh": "被继承",
                "ru": "предшествует",
                "da": "efterfølges af",
                "ar": "يُخلَف بواسطة",
            },
        },
    },
]


def plan_fields(schema: list, field_defs: list, section_def: dict) -> list:
    """Return the fields_schema with every missing field appended inside the
    Value Chain section, creating that section only if needed. A field whose
    key already exists anywhere in the schema is left exactly as it is."""
    planned = [dict(s, fields=list(s.get("fields", []))) for s in schema]
    present = {f.get("key") for s in planned for f in s["fields"]}
    missing = [f for f in field_defs if f["key"] not in present]
    if not missing:
        return planned
    target = next((s for s in planned if s.get("section") == section_def["section"]), None)
    if target is None:
        target = dict(section_def, fields=[])
        planned.append(target)
    target["fields"].extend(missing)
    return planned


def plan_subtypes(subtypes: list, new_subtypes: list) -> list:
    """Append the subtypes whose key is not there yet; existing ones are kept."""
    present = {s.get("key") for s in subtypes}
    return list(subtypes) + [s for s in new_subtypes if s["key"] not in present]


def _update_fields(conn, type_key: str, field_defs: list) -> None:
    row = conn.execute(
        sa.text("SELECT fields_schema FROM card_types WHERE key = :k"), {"k": type_key}
    ).fetchone()
    if row is None or row.fields_schema is None:
        return
    planned = plan_fields(list(row.fields_schema), field_defs, SECTION_DEF)
    conn.execute(
        sa.text("UPDATE card_types SET fields_schema = CAST(:s AS jsonb) WHERE key = :k"),
        {"s": json.dumps(planned), "k": type_key},
    )


def _insert_relation_types(conn) -> None:
    for rt in RELATION_TYPES:
        conn.execute(
            sa.text(
                "INSERT INTO relation_types "
                "(id, key, label, reverse_label, source_type_key, target_type_key, "
                " cardinality, attributes_schema, sort_order, translations, built_in, "
                " is_hidden, created_at, updated_at) "
                "VALUES (gen_random_uuid(), :key, :label, :reverse_label, :src, :tgt, "
                " :card, CAST('[]' AS jsonb), :sort, CAST(:tr AS jsonb), true, false, "
                " now(), now()) "
                "ON CONFLICT (key) DO NOTHING"
            ),
            {
                "key": rt["key"],
                "label": rt["label"],
                "reverse_label": rt["reverse_label"],
                "src": rt["source_type_key"],
                "tgt": rt["target_type_key"],
                "card": rt["cardinality"],
                "sort": rt["sort_order"],
                "tr": json.dumps(rt["translations"]),
            },
        )


def _apply(conn) -> None:
    _update_fields(conn, "BusinessContext", BIZCTX_FIELDS)
    _update_fields(conn, "BusinessProcess", PROCESS_FIELDS)

    row = conn.execute(
        sa.text("SELECT subtypes FROM card_types WHERE key = 'Objective'")
    ).fetchone()
    if row is not None:
        planned = plan_subtypes(list(row.subtypes or []), OBJECTIVE_SUBTYPES)
        conn.execute(
            sa.text("UPDATE card_types SET subtypes = CAST(:s AS jsonb) WHERE key = 'Objective'"),
            {"s": json.dumps(planned)},
        )

    conn.execute(
        sa.text("UPDATE card_types SET has_successors = true WHERE key = 'BusinessContext'")
    )
    _insert_relation_types(conn)


def upgrade() -> None:
    _apply(op.get_bind())


def downgrade() -> None:
    # Intentionally not dropping the fields/subtypes/has_successors: this
    # migration is additive and they may now hold user data. Only the relation
    # types it inserted are removed, and only when no relation uses them.
    conn = op.get_bind()
    for rt in RELATION_TYPES:
        used = conn.execute(
            sa.text("SELECT 1 FROM relations WHERE type = :k LIMIT 1"), {"k": rt["key"]}
        ).fetchone()
        if used is None:
            conn.execute(
                sa.text("DELETE FROM relation_types WHERE key = :k AND built_in = true"),
                {"k": rt["key"]},
            )
