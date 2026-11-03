"""Pure helpers for migration 175 (cost fields and cost history -> cost items).

No database and no app models here, so the migration can call them and the tests can
exercise them without Alembic. Item shape is ``{key: {"amount": number, "renewal_date": None}}``.
"""

from __future__ import annotations

import copy
import re

MIGRATED_TYPES = ("Application", "ITComponent")
TOTAL_KEY = "costTotalAnnual"
OTHER_KEY = "other"
# Old breakdown fields; the typo in the third key is part of the key and is kept.
LEGACY_ITEMS = (
    ("softwareLicensingCost", "Software licensing"),
    ("applicationManagementServicesCost", "Application management services"),
    ("infrastruttureCost", "Infrastructure (hosting & cloud)"),
)
OTHER_LABEL = "Other costs"


def _num(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _item(amount: float) -> dict:
    return {"amount": amount, "renewal_date": None}


def _details(values: dict, item_keys: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for key in item_keys:
        if key == OTHER_KEY:
            continue
        amount = _num(values.get(key))
        if amount is not None and amount > 0:
            out[key] = _item(amount)
    return out


def _sum(items: dict[str, dict]) -> float:
    return sum(i["amount"] for i in items.values())


def build_current_year_items(
    attributes: dict, item_keys: list[str], total_key: str = TOTAL_KEY
) -> dict[str, dict]:
    """Items for the current fiscal year from card attributes. The positive difference
    between the old total and the details lands in ``other``."""
    items = _details(attributes, item_keys)
    total = _num(attributes.get(total_key)) or 0.0
    residual = total - _sum(items)
    if residual > 0:
        items[OTHER_KEY] = _item(residual)
    return items


def build_past_year_items(
    history: dict[str, float], item_keys: list[str]
) -> tuple[dict[str, dict], float, bool]:
    """Items for one past year from ``card_cost_history`` (field key -> amount).

    Returns ``(items, new_tco, changed)``; ``changed`` when the TCO differs from the old
    total: details exceed the total, or only details were recorded."""
    items = _details(history, item_keys)
    total = _num(history.get(TOTAL_KEY))
    details = _sum(items)
    if total is not None and total - details > 0:
        items[OTHER_KEY] = _item(total - details)
    new_tco = _sum(items)
    changed = bool(items) and (total is None or details > total)
    return items, new_tco, changed


def cost_field_keys(fields_schema: list) -> list[str]:
    """Keys of the cost-typed fields in a schema, except the total, in schema order."""
    keys: list[str] = []
    for section in fields_schema or []:
        for field in section.get("fields", []) if isinstance(section, dict) else []:
            if field.get("type") == "cost" and field.get("key") != TOTAL_KEY:
                keys.append(field["key"])
    return keys


def strip_item_fields(fields_schema: list, item_keys: list[str]) -> list | None:
    """Schema without the item fields; None when nothing was there to remove."""
    drop = set(item_keys)
    patched = copy.deepcopy(fields_schema or [])
    changed = False
    for section in patched:
        if not isinstance(section, dict):
            continue
        kept = [f for f in section.get("fields", []) if f.get("key") not in drop]
        if len(kept) != len(section.get("fields", [])):
            section["fields"] = kept
            changed = True
    return patched if changed else None


def formula_sums_only(formula: str, item_keys: list[str]) -> bool:
    """True when the formula only references ``data.<key>`` of the given keys."""
    refs = re.findall(r"data\.(\w+)", formula or "")
    if not refs or not set(refs) <= set(item_keys):
        return False
    rest = re.sub(r"data\.\w+", "", formula)
    rest = re.sub(r"^\s*present\s*=", "", rest)
    return not re.search(r"[A-Za-z_]", rest)
