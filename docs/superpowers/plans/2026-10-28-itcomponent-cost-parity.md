# IT Component Cost Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give IT Component the same three cost-breakdown fields and the same
calculated `costTotalAnnual` Application already has (on this instance, as
live admin data only), by migration — so both types are on equal, portable
footing for every install, not just `turbo-ea-aruba`.

**Architecture:** One Alembic migration, Python-side fetch-mutate-update over
`card_types.fields_schema` (JSONB) for `Application` and `ITComponent`
(pattern: `099_backfill_danish_enabled_locale.py`), plus a guarded INSERT into
`calculations`. Two pure helper functions carry the field-schema logic so
they can be unit-tested without a database (pattern:
`152_fix_danish_metamodel_labels.py`, `155_add_value_chain_metamodel.py`).

**Tech Stack:** Python, SQLAlchemy Core (`alembic.op.get_bind()`), Alembic,
pytest (`db` fixture for the DB-backed tests).

**Spec:** `docs/superpowers/specs/2026-10-28-cost-report-sankey-design.md`
(the "Rename Application's... Add to IT Component's..." bullets).

## Global Constraints

- Migration number: **168** (`167_add_archimate_viewpoint_domains.py` is the
  current head). File: `backend/alembic/versions/168_it_component_cost_parity.py`.
- Field keys, exactly as they exist today on Application (verified live via
  `list_card_types`): `softwareLicensingCost`, `applicationManagementServicesCost`,
  `infrastruttureCost`, all `"type": "cost"`.
- Application's `applicationManagementServicesCost` label carries a leading
  space today (`" Application Management Services Cost"`) — a data bug, not
  intentional. Fix it to `"Application Management Services Cost"` as part of
  this migration (on Application's own row), not just when cloning onto IT
  Component.
- English labels to use for the three fields on **both** types:
  `"Software Licensing Cost"`, `"Application Management Services Cost"`,
  `"Infrastrutture Cost (Hosting & Cloud)"`.
- New fields on IT Component carry **only** an `"en"` translation (matches
  Application's own three fields today — admin-created custom fields ship
  with an empty/English-only `translations` map per
  `.claude/rules/i18n-locales.md`). Do not invent translations for the other
  8 locales.
- Section rename: Application's `"Cost & Ownership"` → `"Cost"`. Use the
  **existing seeded translations for `"Cost"`** already on IT Component's
  section (`backend/app/services/seed.py:3917`, full 9-locale set) — do not
  write new translation strings, copy that exact dict.
- Calculation row: `name="Total Annual Cost"`, `target_type_key="ITComponent"`,
  `target_field_key="costTotalAnnual"`, `is_active=True`, `blanks_as_zero=True`,
  `execution_order=0`,
  `formula="present = data.softwareLicensingCost+data.applicationManagementServicesCost+data.infrastruttureCost"`
  (same shape as Application's own calculation, field keys already point at
  IT Component's own fields since the keys are identical).
- Guarded, idempotent, additive-only — every write checks the row's current
  state first (per `.claude/rules/settings-and-seed.md`: "a guarded `UPDATE`
  that only rewrites rows still carrying the drifted-from value"). An admin
  who already renamed the section, added one of the fields by hand, or wrote
  their own calculation is left alone on that piece.

## Review Focus

- An install where `ITComponent`'s `"Cost"` section does not exist at all
  (never seeded, or renamed by an admin) — the fields must not be silently
  dropped or crash the migration; guard on section presence, not just field
  presence.
- An install where `Application`'s section is already named `"Cost"` (ran
  this migration once, or an admin already renamed it by hand) — rename
  step must no-op, not double-apply or error on a duplicate.
- An install where one of the three fields already exists on IT Component
  (partial manual setup) — only add the missing ones, never duplicate a key.
- An install where a `Calculation` row already targets
  `(ITComponent, costTotalAnnual)` — skip the insert entirely, never create
  a second calculation targeting the same field.
- `downgrade()` must not destroy an admin's own data entered after the
  migration ran (e.g. values typed into the three new fields) — it only
  undoes the schema/calculation additions, never touches `cards.attributes`.

---

### Task 1: Migration 168 — IT Component cost-field and calculation parity

**Files:**
- Create: `backend/alembic/versions/168_it_component_cost_parity.py`
- Test: `backend/tests/services/test_alembic_168_it_component_cost_parity.py`

**Interfaces:**
- Produces (for the test file and for `downgrade()` to reuse):
  - `_fix_application_cost_section(fields_schema: list) -> list | None` — pure.
    Returns a new list with the `"Cost & Ownership"` section renamed to
    `"Cost"` (section `translations` replaced with the seeded 9-locale dict)
    and the leading space stripped from `applicationManagementServicesCost`'s
    `label`, or `None` if neither change applies (section already `"Cost"`
    and the label already clean) — the caller skips the UPDATE on `None`.
  - `_add_itcomponent_cost_fields(fields_schema: list) -> list | None` — pure.
    Returns a new list with any of the three field dicts missing from the
    `"Cost"` section appended to its `"fields"` array, or `None` if the
    section is missing entirely or all three keys are already present.
  - `COST_FIELD_DEFS: list[dict]` — the three field dicts (key, label, type,
    translations), module-level constant, reused by both the migration body
    and the test file's assertions.

- [ ] **Step 1: Write the failing pure-function tests**

```python
# backend/tests/services/test_alembic_168_it_component_cost_parity.py
from __future__ import annotations

import copy
import importlib.util
from pathlib import Path

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic" / "versions" / "168_it_component_cost_parity.py"
)
_spec = importlib.util.spec_from_file_location("mig168", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def _application_cost_section(label_has_leading_space: bool = True) -> list:
    return [
        {
            "section": "Cost & Ownership",
            "translations": {"en": "Cost & Ownership", "de": "Kosten & Eigentümerschaft"},
            "fields": [
                {"key": "costTotalAnnual", "label": "Total Annual Cost", "type": "cost"},
                {
                    "key": "applicationManagementServicesCost",
                    "label": " Application Management Services Cost" if label_has_leading_space else "Application Management Services Cost",
                    "type": "cost",
                },
            ],
        }
    ]


def test_renames_the_section_and_fixes_the_label():
    result = mig._fix_application_cost_section(_application_cost_section())
    assert result[0]["section"] == "Cost"
    assert result[0]["translations"] == mig.COST_SECTION_TRANSLATIONS
    fields_by_key = {f["key"]: f for f in result[0]["fields"]}
    assert fields_by_key["applicationManagementServicesCost"]["label"] == "Application Management Services Cost"


def test_is_a_noop_when_already_fixed():
    already_fixed = [
        {
            "section": "Cost",
            "translations": mig.COST_SECTION_TRANSLATIONS,
            "fields": [
                {"key": "costTotalAnnual", "label": "Total Annual Cost", "type": "cost"},
                {"key": "applicationManagementServicesCost", "label": "Application Management Services Cost", "type": "cost"},
            ],
        }
    ]
    assert mig._fix_application_cost_section(already_fixed) is None


def test_does_not_mutate_its_input():
    original = _application_cost_section()
    snapshot = copy.deepcopy(original)
    mig._fix_application_cost_section(original)
    assert original == snapshot


def _itcomponent_cost_section(existing_keys: tuple[str, ...] = ("costTotalAnnual",)) -> list:
    return [
        {
            "section": "Cost",
            "translations": mig.COST_SECTION_TRANSLATIONS,
            "fields": [
                {"key": k, "label": "Total Annual Cost", "type": "cost"} for k in existing_keys
            ],
        }
    ]


def test_appends_the_missing_fields():
    result = mig._add_itcomponent_cost_fields(_itcomponent_cost_section())
    keys = {f["key"] for f in result[0]["fields"]}
    assert keys == {"costTotalAnnual"} | {f["key"] for f in mig.COST_FIELD_DEFS}


def test_is_idempotent_once_all_three_are_present():
    all_keys = ("costTotalAnnual", *[f["key"] for f in mig.COST_FIELD_DEFS])
    assert mig._add_itcomponent_cost_fields(_itcomponent_cost_section(all_keys)) is None


def test_adds_only_the_missing_subset():
    one_present = ("costTotalAnnual", mig.COST_FIELD_DEFS[0]["key"])
    result = mig._add_itcomponent_cost_fields(_itcomponent_cost_section(one_present))
    keys = {f["key"] for f in result[0]["fields"]}
    assert keys == {"costTotalAnnual"} | {f["key"] for f in mig.COST_FIELD_DEFS}


def test_is_none_when_the_cost_section_is_missing():
    no_cost_section = [{"section": "Other", "translations": {"en": "Other"}, "fields": []}]
    assert mig._add_itcomponent_cost_fields(no_cost_section) is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/services/test_alembic_168_it_component_cost_parity.py -v`
Expected: FAIL / collection error — `168_it_component_cost_parity.py` does not exist yet.

- [ ] **Step 3: Implement the migration**

```python
# backend/alembic/versions/168_it_component_cost_parity.py
"""..."""
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
    "en": "Cost", "de": "Kosten", "fr": "Coûts", "es": "Costes", "it": "Costi",
    "pt": "Custos", "zh": "成本", "ru": "Стоимость", "da": "Omkostninger", "ar": "التكلفة",
}

COST_FIELD_DEFS = [
    {"key": "softwareLicensingCost", "label": "Software Licensing Cost", "type": "cost",
     "weight": 1, "options": [], "required": False,
     "translations": {"en": "Software Licensing Cost"}},
    {"key": "applicationManagementServicesCost", "label": "Application Management Services Cost",
     "type": "cost", "weight": 1, "options": [], "required": False,
     "translations": {"en": "Application Management Services Cost"}},
    {"key": "infrastruttureCost", "label": "Infrastrutture Cost (Hosting & Cloud)", "type": "cost",
     "weight": 1, "options": [], "required": False,
     "translations": {"en": "Infrastrutture Cost (Hosting & Cloud)"}},
]

CALCULATION_FORMULA = (
    "present = data.softwareLicensingCost+data.applicationManagementServicesCost"
    "+data.infrastruttureCost"
)


def _fix_application_cost_section(fields_schema: list) -> list | None:
    ...  # see Step 1 tests for exact behavior


def _add_itcomponent_cost_fields(fields_schema: list) -> list | None:
    ...  # see Step 1 tests for exact behavior


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


def upgrade() -> None:
    conn = op.get_bind()
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
            {"name": "Total Annual Cost", "formula": CALCULATION_FORMULA},
        )


def _revert_itcomponent_cost_fields(fields_schema: list) -> list | None:
    """Drop exactly the three COST_FIELD_DEFS keys from the "Cost" section,
    leaving any other field (including an admin's own) untouched. None if
    none of the three keys are present."""
    ...  # mirrors _add_itcomponent_cost_fields's guard shape


def _revert_application_cost_section(fields_schema: list) -> list | None:
    """Rename "Cost" back to "Cost & Ownership" ONLY when the section's
    translations still equal COST_SECTION_TRANSLATIONS (an admin who
    customised the translations after upgrade keeps their own section as-is).
    Does not touch the applicationManagementServicesCost label fix — that
    was a bug fix, not reverted."""
    ...


def downgrade() -> None:
    conn = op.get_bind()
    _apply_schema_fix(conn, "ITComponent", _revert_itcomponent_cost_fields)
    _apply_schema_fix(conn, "Application", _revert_application_cost_section)
    conn.execute(
        text(
            "DELETE FROM calculations WHERE target_type_key = 'ITComponent' "
            "AND target_field_key = 'costTotalAnnual' AND formula = :formula"
        ),
        {"formula": CALCULATION_FORMULA},
    )
```

Note the `DELETE ... AND formula = :formula` guard: an admin who edited the
calculation's formula after upgrade keeps their row on downgrade. Neither
downgrade function touches `cards.attributes` — card data is never read or
written by this migration, only `card_types.fields_schema` and `calculations`
rows, so a value an admin typed into one of the three fields survives any
`upgrade()`/`downgrade()` cycle untouched. This is asserted directly in
Step 5's DB-backed test, not just implied.

Follow the two tested pure functions' exact contracts from Step 1 — write
their bodies to match every assertion there, including the `None`-means-noop
convention and the deep-copy-before-mutate rule.

- [ ] **Step 4: Run the pure-function tests to verify they pass**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/services/test_alembic_168_it_component_cost_parity.py -v`
Expected: PASS (the 7 pure-function tests from Step 1).

- [ ] **Step 5: Write the failing DB-backed tests**

Append to the same test file:

```python
import pytest
from sqlalchemy import text as sa_text


@pytest.mark.asyncio
async def test_upgrade_applies_to_a_fresh_db_and_is_idempotent(db):
    # The `db` fixture's schema is built via create_all (see conftest), so
    # Application/ITComponent rows exist with the real seeded fields_schema
    # already. Call mig.upgrade()-equivalent logic directly against `db`'s
    # sync connection, run it twice, assert the second run changes nothing
    # and no duplicate Calculation row exists.
    ...


@pytest.mark.asyncio
async def test_an_admin_renamed_section_is_left_alone(db):
    # Application's section already renamed to "Cost" by hand before the
    # migration runs: the migration must not touch it further, and must
    # still add the three fields to ITComponent.
    ...


@pytest.mark.asyncio
async def test_an_existing_calculation_on_the_same_target_is_not_duplicated(db):
    # Seed a Calculation row for (ITComponent, costTotalAnnual) first,
    # run the migration, assert still exactly one row.
    ...


@pytest.mark.asyncio
async def test_downgrade_never_touches_card_attribute_values(db):
    # Create an ITComponent card, run upgrade(), write a value into
    # attributes["softwareLicensingCost"], run downgrade(), assert the
    # card's `attributes` dict (fetched fresh from `db`) is byte-for-byte
    # unchanged — downgrade only rewrites card_types.fields_schema and
    # calculations, never cards.attributes.
    ...
```

- [ ] **Step 6: Run to verify they fail for the right reason, then implement
  against them until green**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/services/test_alembic_168_it_component_cost_parity.py -v`
Iterate `upgrade()` / `downgrade()` until all tests pass.

- [ ] **Step 7: Lint**

Run: `cd backend && venv/Scripts/python.exe -m ruff check . && venv/Scripts/python.exe -m ruff format --check .`
Expected: clean. If `ruff format` reformats, re-run the tests.

- [ ] **Step 8: Regenerate the OpenAPI spec**

No route changed in this task, but `.claude/rules/api-contracts.md` governs
every PR — confirm `docs/api/openapi.json` is unchanged (`python
scripts/dump_openapi.py --check` or equivalent) before committing, since a
drifted spec fails CI on an unrelated later PR otherwise.

- [ ] **Step 9: Commit**

```bash
git add backend/alembic/versions/168_it_component_cost_parity.py backend/tests/services/test_alembic_168_it_component_cost_parity.py
git commit -m "feat(metamodel): give IT Component the same cost fields and calculation Application has"
```

---

## Next plans

This is the first of six independent plans from the cost-report-Sankey spec
(see spec's dependency order). The Sankey/group_by/aggregate-removal plan
depends on this one only for having real numbers on both Application and IT
Component — it is not blocked on code, only on this migration being applied
to a running instance before the Sankey view is demoed.
