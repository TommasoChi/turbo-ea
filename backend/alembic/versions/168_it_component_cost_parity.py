"""Give IT Component the same cost fields and calculation Application has.

Application's three cost-breakdown fields (``softwareLicensingCost``,
``applicationManagementServicesCost``, ``infrastruttureCost``) and the
``costTotalAnnual`` calculation that sums them only exist as live admin data
on this instance today — not in ``seed.py``, not in any prior migration.
This migration makes both types portable to a fresh install: it adds the
same three fields to IT Component's existing "Cost" section, adds a matching
``Calculation`` row targeting IT Component, and brings Application's own
section in line with IT Component's name ("Cost & Ownership" -> "Cost",
reusing the section's own already-seeded translations). It also fixes a
leading-space typo found on Application's own
``applicationManagementServicesCost`` label while reading the live data.

Every write is guarded on the row's current state, so an admin who already
renamed the section, added one of the fields, or wrote their own calculation
is left alone on that piece. ``downgrade()`` never touches ``cards``: it
only reverts ``card_types.fields_schema`` and the inserted ``calculations``
row, so a value an admin typed into one of the three fields survives an
upgrade/downgrade cycle untouched.

Revision ID: 168
Revises: 167
Create Date: 2026-10-28
"""

from __future__ import annotations

import copy
import json
from typing import Union

from sqlalchemy.sql import text

from alembic import op

revision: str = "168"
down_revision: Union[str, None] = "167"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None

COST_SECTION_TRANSLATIONS = {
    "en": "Cost",
    "de": "Kosten",
    "fr": "Coûts",
    "es": "Costes",
    "it": "Costi",
    "pt": "Custos",
    "zh": "成本",
    "ru": "Стоимость",
    "da": "Omkostninger",
    "ar": "التكلفة",
}

COST_FIELD_DEFS = [
    {
        "key": "softwareLicensingCost",
        "label": "Software Licensing Cost",
        "type": "cost",
        "weight": 1,
        "options": [],
        "required": False,
        "translations": {"en": "Software Licensing Cost"},
    },
    {
        "key": "applicationManagementServicesCost",
        "label": "Application Management Services Cost",
        "type": "cost",
        "weight": 1,
        "options": [],
        "required": False,
        "translations": {"en": "Application Management Services Cost"},
    },
    {
        "key": "infrastruttureCost",
        "label": "Infrastrutture Cost (Hosting & Cloud)",
        "type": "cost",
        "weight": 1,
        "options": [],
        "required": False,
        "translations": {"en": "Infrastrutture Cost (Hosting & Cloud)"},
    },
]

CALCULATION_NAME = "Total Annual Cost"
CALCULATION_FORMULA = (
    "present = data.softwareLicensingCost+data.applicationManagementServicesCost"
    "+data.infrastruttureCost"
)


def _find_section(fields_schema: list, name: str) -> dict | None:
    for section in fields_schema:
        if isinstance(section, dict) and section.get("section") == name:
            return section
    return None


def _fix_application_cost_section(fields_schema: list) -> list | None:
    """Rename "Cost & Ownership" to "Cost" and strip a leading space off
    applicationManagementServicesCost's label. None when both are already
    fixed (idempotent — the caller skips the UPDATE on None)."""
    section = _find_section(fields_schema, "Cost & Ownership")
    needs_label_fix = False
    if section is None:
        section = _find_section(fields_schema, "Cost")
        if section is None:
            return None
        for field in section.get("fields", []):
            if field.get("key") == "applicationManagementServicesCost" and field.get(
                "label", ""
            ).startswith(" "):
                needs_label_fix = True
                break
        if not needs_label_fix:
            return None
    patched = copy.deepcopy(fields_schema)
    target = _find_section(patched, section["section"])
    target["section"] = "Cost"
    target["translations"] = dict(COST_SECTION_TRANSLATIONS)
    for field in target.get("fields", []):
        if field.get("key") == "applicationManagementServicesCost":
            field["label"] = field.get("label", "").strip()
    return patched


def _add_itcomponent_cost_fields(fields_schema: list) -> list | None:
    """Append any of COST_FIELD_DEFS missing from the "Cost" section. None
    when the section is missing entirely, or all three keys are present."""
    section = _find_section(fields_schema, "Cost")
    if section is None:
        return None
    existing_keys = {f.get("key") for f in section.get("fields", [])}
    missing = [f for f in COST_FIELD_DEFS if f["key"] not in existing_keys]
    if not missing:
        return None
    patched = copy.deepcopy(fields_schema)
    target = _find_section(patched, "Cost")
    target.setdefault("fields", []).extend(copy.deepcopy(missing))
    return patched


def _revert_itcomponent_cost_fields(fields_schema: list) -> list | None:
    """Drop exactly the three COST_FIELD_DEFS keys from the "Cost" section,
    leaving any other field untouched. None if none of the three are
    present."""
    section = _find_section(fields_schema, "Cost")
    if section is None:
        return None
    revert_keys = {f["key"] for f in COST_FIELD_DEFS}
    present = [f for f in section.get("fields", []) if f.get("key") in revert_keys]
    if not present:
        return None
    patched = copy.deepcopy(fields_schema)
    target = _find_section(patched, "Cost")
    target["fields"] = [f for f in target.get("fields", []) if f.get("key") not in revert_keys]
    return patched


def _revert_application_cost_section(fields_schema: list) -> list | None:
    """Rename "Cost" back to "Cost & Ownership" only when the section's
    translations still equal COST_SECTION_TRANSLATIONS — an admin who
    customised the translations after upgrade keeps their own section. Does
    not touch the label fix, which was a bug fix, not a revert target."""
    section = _find_section(fields_schema, "Cost")
    if section is None or section.get("translations") != COST_SECTION_TRANSLATIONS:
        return None
    patched = copy.deepcopy(fields_schema)
    target = _find_section(patched, "Cost")
    target["section"] = "Cost & Ownership"
    return patched


def _apply_schema_fix(conn, type_key: str, fixer) -> None:
    row = conn.execute(
        text("SELECT fields_schema FROM card_types WHERE key = :k"), {"k": type_key}
    ).fetchone()
    if row is None:
        return
    patched = fixer(row.fields_schema)
    if patched is None:
        return
    conn.execute(
        text("UPDATE card_types SET fields_schema = CAST(:s AS jsonb) WHERE key = :k"),
        {"s": json.dumps(patched), "k": type_key},
    )


def _upgrade_body(conn) -> None:
    """Takes a sync Connection directly (not op.get_bind() internally) so
    tests can drive it via ``AsyncConnection.run_sync`` against the test
    database, same pattern as migration 155's ``_insert_relation_types``."""
    _apply_schema_fix(conn, "Application", _fix_application_cost_section)
    _apply_schema_fix(conn, "ITComponent", _add_itcomponent_cost_fields)

    exists = conn.execute(
        text(
            "SELECT 1 FROM calculations "
            "WHERE target_type_key = 'ITComponent' AND target_field_key = 'costTotalAnnual'"
        )
    ).fetchone()
    if exists is None:
        conn.execute(
            text(
                "INSERT INTO calculations "
                "(id, name, target_type_key, target_field_key, formula, is_active, "
                " blanks_as_zero, execution_order, created_at, updated_at) "
                "VALUES (gen_random_uuid(), :name, 'ITComponent', 'costTotalAnnual', :formula, "
                " true, true, 0, now(), now())"
            ),
            {"name": CALCULATION_NAME, "formula": CALCULATION_FORMULA},
        )


def _downgrade_body(conn) -> None:
    _apply_schema_fix(conn, "ITComponent", _revert_itcomponent_cost_fields)
    _apply_schema_fix(conn, "Application", _revert_application_cost_section)
    conn.execute(
        text(
            "DELETE FROM calculations WHERE target_type_key = 'ITComponent' "
            "AND target_field_key = 'costTotalAnnual' AND formula = :formula"
        ),
        {"formula": CALCULATION_FORMULA},
    )


def upgrade() -> None:
    _upgrade_body(op.get_bind())


def downgrade() -> None:
    _downgrade_body(op.get_bind())
