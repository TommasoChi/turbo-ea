"""Card cost items: the catalogue (``cost_item_types``) and the per-card, per-year
amounts (``card_costs``). Tables only; data steps are added separately.

Revision ID: 175
Revises: 174
Create Date: 2026-11-03
"""

import json
import logging
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import text

from alembic import op
from app.services import cost_items_migration as cim
from app.services.cost_value import cost_value
from app.services.fiscal_year import current_fiscal_year

revision: str = "175"
down_revision: Union[str, None] = "174"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _stamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    ]


logger = logging.getLogger("alembic.runtime.migration")


def _data_body(conn) -> None:
    """Sync-connection body so tests can drive it with ``AsyncConnection.run_sync``."""
    if conn.execute(text("SELECT 1 FROM card_costs LIMIT 1")).fetchone() is not None:
        return  # already migrated

    raw = conn.execute(
        text("SELECT general_settings->>'fiscalYearStart' FROM app_settings WHERE id = 'default'")
    ).scalar()
    start = int(raw) if raw and str(raw).isdigit() and 2 <= int(raw) <= 12 else 1
    current = current_fiscal_year(start)

    schemas = {
        r.key: r.fields_schema
        for r in conn.execute(
            text("SELECT key, fields_schema FROM card_types WHERE key = ANY(:k)"),
            {"k": list(cim.MIGRATED_TYPES)},
        )
    }
    legacy = [k for k, _ in cim.LEGACY_ITEMS]
    extra = [
        k for schema in schemas.values() for k in cim.cost_field_keys(schema) if k not in legacy
    ]
    item_keys = legacy + list(dict.fromkeys(extra))

    catalogue = list(cim.LEGACY_ITEMS) + [(k, k) for k in item_keys[len(legacy) :]]
    catalogue.append((cim.OTHER_KEY, cim.OTHER_LABEL))
    for order, (key, label) in enumerate(catalogue):
        conn.execute(
            text(
                "INSERT INTO cost_item_types (id, key, label, sort_order, archived, translations) "
                "VALUES (gen_random_uuid(), :k, :l, :o, false, '{}'::jsonb) "
                "ON CONFLICT (key) DO NOTHING"
            ),
            {"k": key, "l": label, "o": order},
        )

    history: dict[tuple, dict[str, float]] = {}
    for r in conn.execute(
        text("SELECT card_id, fiscal_year, field_key, value FROM card_cost_history")
    ):
        history.setdefault((r.card_id, r.fiscal_year), {})[r.field_key] = r.value

    report: list[dict] = []
    years_by_card: dict = {}
    for card_id, year in history:
        years_by_card.setdefault(card_id, []).append(year)

    insert_cost = text(
        "INSERT INTO card_costs (id, card_id, fiscal_year, items) "
        "VALUES (gen_random_uuid(), :c, :y, CAST(:i AS jsonb))"
    )
    cards = conn.execute(
        text("SELECT id, attributes FROM cards WHERE type = ANY(:k)"),
        {"k": list(cim.MIGRATED_TYPES)},
    ).fetchall()
    for card in cards:
        attrs = card.attributes or {}
        items, tco, changed = cim.build_current_year_items(attrs, item_keys)
        conn.execute(insert_cost, {"c": card.id, "y": current, "i": json.dumps(items)})
        conn.execute(
            text(
                "UPDATE cards SET attributes = COALESCE(attributes, '{}'::jsonb) "
                "|| jsonb_build_object('costTotalAnnual', CAST(:t AS float8)) WHERE id = :c"
            ),
            {"t": tco, "c": card.id},
        )
        if changed:
            old = cost_value(attrs.get(cim.TOTAL_KEY))
            report.append(
                {
                    "card_id": str(card.id),
                    "fiscal_year": current,
                    "old_total": old if old > 0 else None,
                    "new_tco": tco,
                }
            )
        for year in sorted(years_by_card.get(card.id, [])):
            if year == current:
                continue  # the current year is served from attributes
            past = history[(card.id, year)]
            past_items, tco, changed = cim.build_past_year_items(past, item_keys)
            if past_items:
                conn.execute(insert_cost, {"c": card.id, "y": year, "i": json.dumps(past_items)})
            if changed:
                report.append(
                    {
                        "card_id": str(card.id),
                        "fiscal_year": year,
                        "old_total": past.get(cim.TOTAL_KEY),
                        "new_tco": tco,
                    }
                )

    for type_key, schema in schemas.items():
        patched = cim.strip_item_fields(schema, item_keys)
        if patched is not None:
            conn.execute(
                text("UPDATE card_types SET fields_schema = CAST(:s AS jsonb) WHERE key = :k"),
                {"s": json.dumps(patched), "k": type_key},
            )
        for calc in conn.execute(
            text(
                "SELECT id, formula FROM calculations "
                "WHERE target_type_key = :k AND target_field_key = 'costTotalAnnual'"
            ),
            {"k": type_key},
        ).fetchall():
            if cim.formula_sums_only(calc.formula, item_keys):
                conn.execute(text("DELETE FROM calculations WHERE id = :i"), {"i": calc.id})

    for entry in report:
        logger.warning(
            "cost items migration: card %s FY%s old total %s -> new TCO %s",
            entry["card_id"],
            entry["fiscal_year"],
            entry["old_total"],
            entry["new_tco"],
        )
    if report:
        conn.execute(
            text(
                "UPDATE app_settings SET general_settings = COALESCE(general_settings, '{}'::jsonb) "
                "|| jsonb_build_object('cost_items_migration_report', CAST(:r AS jsonb)) "
                "WHERE id = 'default'"
            ),
            {"r": json.dumps(report)},
        )


def upgrade() -> None:
    op.create_table(
        "cost_item_types",
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
        "card_costs",
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
        sa.UniqueConstraint("card_id", "fiscal_year", name="uq_card_costs_card_year"),
    )
    op.create_index("ix_card_costs_card_id", "card_costs", ["card_id"])
    _data_body(op.get_bind())


def downgrade() -> None:
    op.drop_index("ix_card_costs_card_id", table_name="card_costs")
    op.drop_table("card_costs")
    op.drop_table("cost_item_types")
