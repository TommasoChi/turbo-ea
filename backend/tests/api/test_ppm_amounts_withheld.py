"""A user without cost access to an Initiative gets its PPM rows but none of its amounts.

Keys are absent, never ``None`` or zero. The amount-bearing fields are enumerated here
from the response schemas; a field added to one must be listed or the schema test fails.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

import pytest

from app.core.permissions import (
    COST_CONTROLLER_CARD_PERMISSIONS,
    OBSERVER_CARD_PERMISSIONS,
    VIEWER_PERMISSIONS,
)
from app.models.ppm_cost_line import PpmCostLine
from app.models.ppm_invoice import PpmInvoice
from app.models.stakeholder import Stakeholder
from app.schemas.ppm import (
    PpmBudgetLineOut,
    PpmCostLineOut,
    PpmFinancialBudgetOut,
    PpmFinancialCostOut,
    PpmFinancialsOut,
    PpmFinancialSubtotalOut,
    PpmFinancialTotalsOut,
    PpmRollupOut,
)
from tests.conftest import (
    auth_headers,
    create_budget_line,
    create_card,
    create_card_type,
    create_ppm_manager_user,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

BASE = "/api/v1/ppm"

COST_AMOUNTS = {"planned", "actual", "calculated_values"}
BUDGET_AMOUNTS = {"amount", "calculated_values"}
FIN_COST_AMOUNTS = {
    "planned",
    "actual",
    "calculated_values",
    "total_invoiced",
    "remaining_to_invoice",
}
FIN_BUDGET_AMOUNTS = {
    "amount",
    "total_cost_items",
    "remaining_budget",
    "total_invoiced",
    "remaining_to_invoice",
    "calculated_values",
}
FIN_TOTAL_AMOUNTS = {
    "amount",
    "total_cost_items",
    "remaining_budget",
    "total_invoiced",
    "remaining_to_invoice",
}
ROLLUP_AMOUNTS = {
    "capex_planned",
    "capex_actual",
    "opex_planned",
    "opex_actual",
    "total_planned",
    "total_actual",
    "by_year",
}


def test_amount_lists_cover_the_schema_fields():
    """Every amount-bearing schema field is named above (a new one fails here)."""
    assert COST_AMOUNTS <= set(PpmCostLineOut.model_fields)
    assert set(PpmCostLineOut.model_fields) - COST_AMOUNTS == {
        "provider_child_id",
        "provider",
        "provider_child_enabled",
        "reference_display",
        "field_values",
        "budget_line_id",
        "id",
        "initiative_id",
        "description",
        "category",
        "date",
        "created_at",
        "updated_at",
    }
    assert set(PpmBudgetLineOut.model_fields) - BUDGET_AMOUNTS == {
        "reference_display",
        "field_values",
        "id",
        "initiative_id",
        "fiscal_year",
        "category",
        "description",
        "created_at",
        "updated_at",
    }
    assert set(PpmFinancialCostOut.model_fields) - FIN_COST_AMOUNTS == {
        "provider_child_id",
        "provider",
        "provider_child_enabled",
        "reference_display",
        "field_values",
        "id",
        "budget_line_id",
        "description",
        "category",
        "date",
    }
    assert set(PpmFinancialBudgetOut.model_fields) - FIN_BUDGET_AMOUNTS == {
        "provider",
        "provider_child_enabled",
        "reference_display",
        "field_values",
        "id",
        "fiscal_year",
        "category",
        "description",
    }
    assert set(PpmFinancialTotalsOut.model_fields) == FIN_TOTAL_AMOUNTS
    assert set(PpmFinancialSubtotalOut.model_fields) - FIN_TOTAL_AMOUNTS == {
        "fiscal_year",
        "category",
    }
    assert set(PpmFinancialsOut.model_fields) == {
        "field_definitions",
        "initiative_id",
        "budget_lines",
        "budget_subtotals",
        "budget_totals",
        "cost_items",
        "invoice_access",
        "invoices",
        "actual_invoiced",
        "card_comparison",
    }
    assert ROLLUP_AMOUNTS <= set(PpmRollupOut.model_fields)


@pytest.fixture
async def env(db, client):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_card_type(db, key="Initiative", label="Initiative")
    for key, perms in (
        ("observer", OBSERVER_CARD_PERMISSIONS),
        ("costController", COST_CONTROLLER_CARD_PERMISSIONS),
    ):
        await create_stakeholder_role_def(
            db, card_type_key="Initiative", key=key, label=key, permissions=perms
        )
    admin = await create_user(db, email="admin@withheld.test", role="admin")
    card = await create_card(db, card_type="Initiative", name="Parent", user_id=admin.id)
    child = await create_card(
        db, card_type="Initiative", name="Child", user_id=admin.id, parent_id=card.id
    )
    headers = auth_headers(admin)
    for section, calc in (("budget", "data.amount * 2"), ("cost_item", "data.actual * 2")):
        fields = [
            {"key": "qty", "label": "Qty", "kind": "number"},
            {"key": "note", "label": "Note", "kind": "text"},
            {
                "key": "doubled",
                "label": "Doubled",
                "kind": "calculated",
                "calculation": {
                    "result_type": "number",
                    "formula_engine": "core",
                    "expression": calc,
                },
            },
        ]
        resp = await client.put(
            f"/api/v1/settings/pml/financial-fields/{section}",
            json={"fields": fields},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
    budget = await create_budget_line(
        db, initiative_id=card.id, amount=1234, description="Budget row"
    )
    budget.field_values = {"qty": 7, "note": "kept"}
    cost = PpmCostLine(
        initiative_id=card.id,
        budget_line_id=budget.id,
        description="Cost row",
        category="capex",
        planned=555,
        actual=777,
        date=dt.date(2026, 3, 1),
        field_values={"qty": 9, "note": "kept"},
    )
    db.add(cost)
    await db.flush()
    db.add(
        PpmInvoice(
            initiative_id=card.id,
            cost_item_id=cost.id,
            invoice_date=dt.date(2026, 3, 2),
            invoice_id="INV-8",
            amount=321,
        )
    )
    child_budget = await create_budget_line(db, initiative_id=child.id, amount=4321)
    db.add(
        PpmCostLine(
            initiative_id=child.id,
            budget_line_id=child_budget.id,
            description="Child cost",
            category="opex",
            planned=1,
            actual=8765,
            date=dt.date(2026, 4, 1),
        )
    )
    await db.flush()
    return {"admin": admin, "card": card, "child": child}


async def _user(db, env, profile):
    card = env["card"]
    if profile == "viewer":
        return await create_user(db, email="v@withheld.test", role="viewer")
    if profile == "observer":
        user = await create_user(db, email="o@withheld.test", role="viewer")
        role = "observer"
    elif profile == "ppm_manager":
        user = await create_ppm_manager_user(db, email="m@withheld.test")
        role = None
    elif profile == "cost_controller":
        user = await create_ppm_manager_user(db, email="c@withheld.test")
        role = "costController"
    else:
        return env["admin"]
    if role:
        db.add(Stakeholder(card_id=card.id, user_id=user.id, role=role))
        if role == "costController":
            db.add(Stakeholder(card_id=env["child"].id, user_id=user.id, role=role))
        await db.flush()
    return user


WITHHELD = ["viewer", "observer", "ppm_manager"]
FULL = ["cost_controller", "admin"]


async def _get(client, user, path):
    url = path if path.startswith("/api") else f"{BASE}{path}"
    resp = await client.get(url, headers=auth_headers(user))
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.mark.parametrize("profile", WITHHELD)
async def test_costs_keep_rows_and_drop_amounts(client, db, env, profile):
    user = await _user(db, env, profile)
    rows = await _get(client, user, f"/initiatives/{env['card'].id}/costs")
    assert len(rows) == 1
    row = rows[0]
    assert row["description"] == "Cost row"
    assert row["category"] == "capex"
    assert row["date"] == "2026-03-01"
    assert COST_AMOUNTS.isdisjoint(row)
    assert row["field_values"] == {"note": "kept"}


@pytest.mark.parametrize("profile", WITHHELD)
async def test_budgets_keep_rows_and_drop_amounts(client, db, env, profile):
    user = await _user(db, env, profile)
    rows = await _get(client, user, f"/initiatives/{env['card'].id}/budgets")
    assert len(rows) == 1
    row = rows[0]
    assert row["description"] == "Budget row"
    assert row["fiscal_year"] == 2025
    assert BUDGET_AMOUNTS.isdisjoint(row)
    assert row["field_values"] == {"note": "kept"}


@pytest.mark.parametrize("profile", WITHHELD)
async def test_financials_keep_rows_and_drop_amounts(client, db, env, profile):
    user = await _user(db, env, profile)
    data = await _get(client, user, f"/initiatives/{env['card'].id}/financials")
    assert data["invoice_access"] is False
    assert {"invoices", "actual_invoiced", "card_comparison", "budget_totals"}.isdisjoint(data)
    (budget,) = data["budget_lines"]
    assert budget["description"] == "Budget row"
    assert FIN_BUDGET_AMOUNTS.isdisjoint(budget)
    assert budget["field_values"] == {"note": "kept"}
    (cost,) = data["cost_items"]
    assert cost["description"] == "Cost row"
    assert cost["date"] == "2026-03-01"
    assert FIN_COST_AMOUNTS.isdisjoint(cost)
    (sub,) = data["budget_subtotals"]
    assert sub == {"fiscal_year": 2025, "category": "capex"}
    assert all(
        "default" not in f
        for section in data["field_definitions"].values()
        for f in section["fields"]
        if f["kind"] == "number"
    )


@pytest.mark.parametrize("profile", WITHHELD)
async def test_rollup_carries_no_totals(client, db, env, profile):
    user = await _user(db, env, profile)
    data = await _get(client, user, f"/initiatives/{env['card'].id}/rollup")
    assert data["descendant_count"] == 1
    assert ROLLUP_AMOUNTS.isdisjoint(data)


@pytest.mark.parametrize("profile", WITHHELD)
async def test_dashboard_and_gantt_keep_rows_without_amounts(client, db, env, profile):
    user = await _user(db, env, profile)
    dash = await _get(client, user, "/api/v1/reports/ppm/dashboard")
    assert dash["total_initiatives"] == 2
    assert dash["total_budget"] is None and dash["total_actual"] is None
    items = await _get(client, user, "/api/v1/reports/ppm/gantt")
    assert {i["name"] for i in items} == {"Parent", "Child"}
    for item in items:
        assert not item.get("cost_budget") and not item.get("cost_actual")
        for key in ("capex_planned", "capex_actual", "opex_planned", "opex_actual"):
            assert not item.get(key)
        assert not item.get("rollup", {}) or all(
            not (item["rollup"] or {}).get(k)
            for k in ("capex_planned", "capex_actual", "opex_planned", "opex_actual")
        )


@pytest.mark.parametrize("profile", FULL)
async def test_cost_access_sees_everything(client, db, env, profile):
    user = await _user(db, env, profile)
    pid = env["card"].id
    (cost,) = await _get(client, user, f"/initiatives/{pid}/costs")
    assert (cost["planned"], cost["actual"]) == (555, 777)
    assert cost["field_values"] == {"qty": 9, "note": "kept"}
    assert cost["calculated_values"] == {"doubled": "1554.0"}
    (budget,) = await _get(client, user, f"/initiatives/{pid}/budgets")
    assert budget["amount"] == 1234
    assert budget["field_values"] == {"qty": 7, "note": "kept"}
    assert budget["calculated_values"] == {"doubled": "2468.0"}
    data = await _get(client, user, f"/initiatives/{pid}/financials")
    assert data["invoice_access"] is True
    assert Decimal(data["budget_totals"]["amount"]) == 1234
    assert Decimal(data["actual_invoiced"]) == 321
    (fcost,) = data["cost_items"]
    assert (Decimal(fcost["planned"]), Decimal(fcost["actual"])) == (555, 777)
    assert Decimal(fcost["total_invoiced"]) == 321
    (fsub,) = data["budget_subtotals"]
    assert Decimal(fsub["amount"]) == 1234 and Decimal(fsub["remaining_budget"]) == 457
    roll = await _get(client, user, f"/initiatives/{pid}/rollup")
    assert roll["capex_planned"] == 4321 and roll["total_planned"] == 4321
    assert roll["has_budget_lines"] is True
    assert roll["by_year"][0]["capex_budget"] == 4321
