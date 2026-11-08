"""Licensing in core: move the ``licensing`` extension's data into ``card_licenses``.

The four ``ext.licensing.multivalue`` values of every Application / IT Component move into
the current fiscal year's row, each distinct category becoming a ``license_types`` entry;
the four keys are stripped from ``cards.attributes``; the extension's contributed fields
leave ``fields_schema`` and ``licensingModel`` becomes a built-in field of both types (also
on instances that never had the extension). The ``extensions`` row is NOT touched.

Revision ID: 178
Revises: 177
Create Date: 2026-11-05
"""

import json
import logging
from typing import Sequence, Union

from sqlalchemy.sql import text

from alembic import op
from app.services import licensing_migration as lm
from app.services.extensions.field_contributions import strip_ext_fields
from app.services.fiscal_year import current_fiscal_year

revision: str = "178"
down_revision: Union[str, None] = "177"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")
REPORT_CAP = 200  # entries kept in general_settings; the total is stored beside them
PROBLEM_CAP = 20  # problems kept per card entry
TYPES = list(lm.GENERAL_SECTION)


def _move_values(conn) -> None:
    raw = conn.execute(
        text("SELECT general_settings->>'fiscalYearStart' FROM app_settings WHERE id = 'default'")
    ).scalar()
    start = int(raw) if raw and str(raw).isdigit() and 2 <= int(raw) <= 12 else 1
    current = current_fiscal_year(start)
    old_keys = list(lm.OLD_KEYS)

    cards = conn.execute(
        text(
            "SELECT id, attributes FROM cards WHERE type = ANY(:t) "
            "AND jsonb_exists_any(attributes, CAST(:k AS text[])) ORDER BY created_at, id"
        ),
        {"t": TYPES, "k": old_keys},
    ).fetchall()

    names: list[str] = []
    for card in cards:
        for field in old_keys:
            entries = (card.attributes or {}).get(field)
            for entry in entries if isinstance(entries, list) else []:
                if isinstance(entry, dict) and entry.get("category") is not None:
                    names.append(str(entry["category"]))
    keys = lm.assign_keys(names)

    first_order = conn.execute(
        text("SELECT COALESCE(MAX(sort_order) + 1, 0) FROM license_types")
    ).scalar()
    for order, (key, label) in enumerate(keys.values(), start=first_order):
        conn.execute(
            text(
                "INSERT INTO license_types (id, key, label, sort_order, archived, translations) "
                "VALUES (gen_random_uuid(), :k, :l, :o, false, '{}'::jsonb) "
                "ON CONFLICT (key) DO NOTHING"
            ),
            {"k": key, "l": label, "o": order},
        )

    entries_out: list[dict] = []
    for card in cards:
        items, problems = lm.build_items(card.attributes or {}, keys)
        if items:
            conn.execute(
                text(
                    "INSERT INTO card_licenses (id, card_id, fiscal_year, items) "
                    "VALUES (gen_random_uuid(), :c, :y, CAST(:i AS jsonb)) "
                    "ON CONFLICT (card_id, fiscal_year) DO NOTHING"
                ),
                {"c": card.id, "y": current, "i": json.dumps(items)},
            )
        # Stripped whatever the outcome: the raw copies must not stay readable without
        # licenses.view.
        conn.execute(
            text("UPDATE cards SET attributes = attributes - CAST(:k AS text[]) WHERE id = :c"),
            {"k": old_keys, "c": card.id},
        )
        if items or problems:
            entries_out.append(
                {
                    "card_id": str(card.id),
                    "fiscal_year": current,
                    "cells": sum(len(cells) for cells in items.values()),
                    "problems": problems[:PROBLEM_CAP],
                }
            )

    calc_rows = [
        (str(r.id), r.name, r.formula)
        for r in conn.execute(text("SELECT id, name, formula FROM calculations"))
    ]
    saved = [
        {"id": str(r.id), "name": r.name, "report_type": r.report_type}
        for r in conn.execute(
            text(
                "SELECT id, name, report_type FROM saved_reports "
                "WHERE report_type LIKE 'ext:licensing:%' ORDER BY name"
            )
        )
    ]
    calculations = lm.citing_calculations(calc_rows)
    if not (entries_out or keys or calculations or saved):
        return
    report = {
        "total": len(entries_out),
        "entries": entries_out[:REPORT_CAP],
        "license_types": [{"key": k, "label": label} for k, label in keys.values()][:REPORT_CAP],
        "calculations": calculations[:REPORT_CAP],
        "saved_reports": saved[:REPORT_CAP],
    }
    if entries_out:
        logger.warning(
            "licensing migration: %d card(s) moved (details in "
            "general_settings.licensing_migration_report)",
            len(entries_out),
        )
    conn.execute(
        text(
            "UPDATE app_settings SET general_settings = COALESCE(general_settings, '{}'::jsonb) "
            "|| jsonb_build_object('licensing_migration_report', CAST(:r AS jsonb)) "
            "WHERE id = 'default'"
        ),
        {"r": json.dumps(report)},
    )


def _move_schema(conn) -> None:
    for row in conn.execute(
        text("SELECT key, fields_schema, section_config FROM card_types WHERE key = ANY(:t)"),
        {"t": TYPES},
    ).fetchall():
        before = row.fields_schema or []
        schema, config, _ = strip_ext_fields(before, row.section_config, lm.EXT_KEY)
        moved = lm.move_model_field(row.key, schema)
        if moved is not None:
            schema = moved
        if schema == before:
            continue
        conn.execute(
            text(
                "UPDATE card_types SET fields_schema = CAST(:s AS jsonb), "
                "section_config = CAST(:c AS jsonb) WHERE key = :k"
            ),
            {"s": json.dumps(schema), "c": json.dumps(config or {}), "k": row.key},
        )


def _data_body(conn) -> None:
    """Sync-connection body so tests can drive it with ``AsyncConnection.run_sync``."""
    if conn.execute(text("SELECT 1 FROM card_licenses LIMIT 1")).fetchone() is None:
        _move_values(conn)  # a re-run (rows exist) moves nothing
    _move_schema(conn)


def upgrade() -> None:
    _data_body(op.get_bind())


def downgrade() -> None:
    """One-way for the data: the moved values, the stripped attribute keys and the removed
    extension fields are not restored."""
