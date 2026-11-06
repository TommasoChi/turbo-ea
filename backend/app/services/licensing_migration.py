"""Pure helpers for migration 178 (the ``licensing`` extension's data -> core licenses).

No database and no app models here, so the migration, ``seed.py`` and the tests can all
import it. The extension stored four ``ext.licensing.multivalue`` fields per card, each a list
of ``{"category": str, "value": number}``; core keeps ``{metric: {license_type_key:
{"licensed", "actual"}}}`` per fiscal year.
"""

from __future__ import annotations

import copy
import math
import re
from collections.abc import Iterable

EXT_KEY = "licensing"
MODEL_KEY = "licensingModel"
GENERAL_SECTION = {
    "Application": "Application Information",
    "ITComponent": "Component Information",
}
MAX_COUNT = 1_000_000_000

# THE one definition of the field (migration 178 and the fresh-install seed both use it).
LICENSING_MODEL_FIELD: dict = {
    "key": MODEL_KEY,
    "label": "Licensing Model",
    "type": "multiple_select",
    "weight": 0,
    "options": [
        {
            "key": "users",
            "label": "Users",
            "translations": {
                "de": "Benutzer",
                "fr": "Utilisateurs",
                "es": "Usuarios",
                "it": "Utenti",
                "pt": "Utilizadores",
                "zh": "用户",
                "ru": "Пользователи",
                "da": "Brugere",
                "ar": "المستخدمون",
            },
        },
        {
            "key": "installations",
            "label": "Installations",
            "translations": {
                "de": "Installationen",
                "fr": "Installations",
                "es": "Instalaciones",
                "it": "Installazioni",
                "pt": "Instalações",
                "zh": "安装",
                "ru": "Установки",
                "da": "Installationer",
                "ar": "التثبيتات",
            },
        },
    ],
    "translations": {
        "de": "Lizenzmodell",
        "fr": "Modèle de licence",
        "es": "Modelo de licencia",
        "it": "Modello di licenza",
        "pt": "Modelo de licenciamento",
        "zh": "许可模式",
        "ru": "Модель лицензирования",
        "da": "Licensmodel",
        "ar": "نموذج الترخيص",
    },
}

# old field key -> (metric, "licensed" | "actual")
OLD_FIELDS: dict[str, tuple[str, str]] = {
    "licensedUsers": ("users", "licensed"),
    "licensedInstallations": ("installations", "licensed"),
    "actualUsers": ("users", "actual"),
    "actualInstallations": ("installations", "actual"),
}
OLD_KEYS = tuple(OLD_FIELDS)


def slug(name: str) -> str | None:
    """Lower-case, runs outside ``[a-z0-9]`` become ``_``, max 64; None when it is empty or
    does not start with a letter."""
    out = re.sub(r"[^a-z0-9]+", "_", str(name).lower()).strip("_")[:64].rstrip("_")
    return out if out and out[0].isalpha() else None


def _norm(name: object) -> str:
    return str(name).strip().casefold()


def assign_keys(names: Iterable[str]) -> dict[str, tuple[str, str]]:
    """``casefolded name -> (key, first-seen label)``; ``type_<n>`` when there is no usable
    slug; a slug already taken gets ``_2``, ``_3`` ..."""
    out: dict[str, tuple[str, str]] = {}
    used: set[str] = set()
    fallback = 0
    for name in names:
        norm = _norm(name)
        if not norm or norm in out:
            continue
        base = slug(name)
        if base is None:
            while True:
                fallback += 1
                if (base := f"type_{fallback}") not in used:
                    break
        key, n = base, 1
        while key in used:
            n += 1
            suffix = f"_{n}"
            key = base[: 64 - len(suffix)] + suffix
        used.add(key)
        out[norm] = (key, str(name).strip()[:100])
    return out


def _count(value: object) -> tuple[int | None, str | None]:
    """``(count, reason)``: a usable integer (with ``rounded`` when it was rounded) or
    ``(None, reason)``."""
    if isinstance(value, bool):
        return None, "not_numeric"
    try:
        num = float(value.strip()) if isinstance(value, str) else float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None, "not_numeric"
    if not math.isfinite(num):
        return None, "not_numeric"
    if num < 0:
        return None, "negative"
    if num > MAX_COUNT:
        return None, "too_large"
    whole = int(math.floor(num + 0.5))
    return whole, None if whole == num else "rounded"


def build_items(attrs: dict, keys: dict) -> tuple[dict, list[dict]]:
    """Core items from one card's attributes, and the values that were skipped or rounded.

    Duplicate categories of one card are summed; a cell with an actual and no licensed gets
    ``licensed`` 0; a cell with a licensed and no actual keeps ``actual`` null.
    """
    cells: dict[str, dict[str, dict]] = {}
    problems: list[dict] = []
    for field, (metric, kind) in OLD_FIELDS.items():
        entries = attrs.get(field)
        for entry in entries if isinstance(entries, list) else []:
            if not isinstance(entry, dict) or entry.get("value") in (None, ""):
                continue
            category, value = entry.get("category"), entry["value"]

            def problem(reason: str) -> None:
                problems.append(
                    {
                        "field": field,
                        "category": str(category),
                        "value": str(value)[:50],
                        "reason": reason,
                    }
                )

            hit = keys.get(_norm(category)) if category is not None else None
            if hit is None:
                problem("no_category")
                continue
            key = hit[0]
            count, reason = _count(value)
            if reason:
                problem(reason)
            if count is None:
                continue
            cell = cells.setdefault(metric, {}).setdefault(key, {"licensed": 0, "actual": None})
            cell[kind] = (cell[kind] or 0) + count
    return cells, problems


def move_model_field(type_key: str, schema: list) -> list | None:
    """The schema with ``licensingModel`` in the type's general section, or None when the type
    has no such section name or already carries a (non-extension) field with that key."""
    section_name = GENERAL_SECTION.get(type_key)
    if section_name is None:
        return None
    for section in schema or []:
        for field in section.get("fields", []) if isinstance(section, dict) else []:
            if isinstance(field, dict) and field.get("key") == MODEL_KEY and not field.get("ext"):
                return None
    out = copy.deepcopy(schema or [])
    field = copy.deepcopy(LICENSING_MODEL_FIELD)
    for section in out:
        if isinstance(section, dict) and section.get("section") == section_name:
            section.setdefault("fields", []).append(field)
            return out
    out.append({"section": section_name, "fields": [field]})
    return out


def citing_calculations(rows: Iterable[tuple[str, str, str]]) -> list[dict]:
    """``(id, name, formula)`` rows whose formula names one of the four old keys, as
    ``[{"id", "name", "keys"}]``. Listed in the migration report, never rewritten."""
    out: list[dict] = []
    for calc_id, name, formula in rows:
        cited = [
            k for k in dict.fromkeys(re.findall(r"data\.(\w+)", formula or "")) if k in OLD_FIELDS
        ]
        if cited:
            out.append({"id": calc_id, "name": name, "keys": cited})
    return out
