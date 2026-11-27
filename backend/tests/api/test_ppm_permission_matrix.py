"""Who may write to a project: manage routes need ``card.edit``, cost routes
need ``card.edit_costs`` (and the right to see the costs), both on top of the
``ppm.manage`` application permission."""

from __future__ import annotations

import datetime as dt

import pytest

from app.core.permissions import (
    BPM_ADMIN_PERMISSIONS,
    COST_CONTROLLER_CARD_PERMISSIONS,
    MEMBER_PERMISSIONS,
    PPM_MANAGER_APP_PERMISSIONS,
    RESPONSIBLE_CARD_PERMISSIONS,
    VIEWER_PERMISSIONS,
)
from app.models.ppm_cost_line import PpmCostLine
from app.models.ppm_dependency import PpmDependency
from app.models.ppm_invoice import PpmInvoice
from app.models.stakeholder import Stakeholder
from tests.conftest import (
    auth_headers,
    create_budget_line,
    create_card,
    create_card_type,
    create_ppm_manager_user,
    create_ppm_risk,
    create_role,
    create_stakeholder_role_def,
    create_status_report,
    create_task,
    create_user,
    create_wbs,
)

BASE = "/api/v1/ppm"

# (role permissions, stakeholder role on the Initiative or None, manage ok, cost ok)
PROFILES = {
    "ppm_manager_responsible": (PPM_MANAGER_APP_PERMISSIONS, "responsible", True, True),
    "ppm_manager_cost_controller": (PPM_MANAGER_APP_PERMISSIONS, "costController", False, True),
    "ppm_manager_no_stakeholder": (PPM_MANAGER_APP_PERMISSIONS, None, False, False),
    "member": (MEMBER_PERMISSIONS, None, False, False),
    "bpm_admin": (BPM_ADMIN_PERMISSIONS, None, False, False),
    "viewer": (VIEWER_PERMISSIONS, None, False, False),
    "only_view_costs": ({"ppm.view": True, "costs.view": True}, None, False, False),
    "only_edit_costs": ({"ppm.view": True, "costs.edit": True}, None, False, False),
    "manage_and_edit_costs_without_view": (
        {"ppm.view": True, "ppm.manage": True, "costs.edit": True},
        None,
        False,
        False,
    ),
    "manage_and_app_level_costs": (
        {"ppm.view": True, "ppm.manage": True, "costs.view": True, "costs.edit": True},
        None,
        False,
        True,
    ),
}


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_card_type(db, key="Initiative", label="Initiative")
    for key, perms in (
        ("responsible", RESPONSIBLE_CARD_PERMISSIONS),
        ("costController", COST_CONTROLLER_CARD_PERMISSIONS),
    ):
        await create_stakeholder_role_def(
            db, card_type_key="Initiative", key=key, label=key, permissions=perms
        )
    admin = await create_user(db, email="admin@matrix.test", role="admin")
    card = await create_card(db, card_type="Initiative", name="Matrix", user_id=admin.id)
    cid = card.id
    budget = await create_budget_line(db, initiative_id=cid)
    other_budget = await create_budget_line(db, initiative_id=cid, category="opex")
    cost = PpmCostLine(
        initiative_id=cid, budget_line_id=budget.id, description="c", category="capex"
    )
    free_cost = PpmCostLine(
        initiative_id=cid, budget_line_id=budget.id, description="free", category="capex"
    )
    db.add_all([cost, free_cost])
    await db.flush()
    invoice = PpmInvoice(
        initiative_id=cid,
        cost_item_id=cost.id,
        invoice_date=dt.date(2026, 1, 1),
        invoice_id="INV-1",
        amount=1,
    )
    db.add(invoice)
    task = await create_task(db, initiative_id=cid)
    wbs = await create_wbs(db, initiative_id=cid)
    wbs2 = await create_wbs(db, initiative_id=cid, title="Second")
    dep = PpmDependency(initiative_id=cid, kind="FS", pred_wbs_id=wbs.id, succ_wbs_id=wbs2.id)
    db.add(dep)
    await db.flush()
    return {
        "admin": admin,
        "card": card,
        "budget": budget,
        "other_budget": other_budget,
        "cost": cost,
        "free_cost": free_cost,
        "invoice": invoice,
        "task": task,
        "wbs": wbs,
        "wbs2": wbs2,
        "dep": dep,
        "risk": await create_ppm_risk(db, initiative_id=cid),
        "report": await create_status_report(
            db, initiative_id=cid, report_date=dt.date(2026, 1, 1)
        ),
    }


MANAGE_ROUTES = [
    "create_report", "update_report", "delete_report",
    "create_risk", "update_risk", "delete_risk",
    "create_task", "update_task", "delete_task", "create_task_comment",
    "create_wbs", "update_wbs", "delete_wbs",
    "move_gantt_row", "create_dependency", "delete_dependency",
]  # fmt: skip
COST_ROUTES = [
    "create_cost_line", "update_cost_line", "move_cost_line_between_budgets", "delete_cost_line",
    "create_budget_line", "update_budget_line", "delete_budget_line",
    "create_invoice", "update_invoice", "delete_invoice",
]  # fmt: skip


def _manage_routes(e):
    r = f"{BASE}/initiatives/{e['card'].id}"
    report = {"report_date": "2026-02-01"}
    return {
        "create_report": ("POST", f"{r}/reports", report),
        "update_report": ("PATCH", f"{BASE}/reports/{e['report'].id}", {"summary": "s"}),
        "delete_report": ("DELETE", f"{BASE}/reports/{e['report'].id}", None),
        "create_risk": ("POST", f"{r}/risks", {"title": "r", "probability": 2, "impact": 2}),
        "update_risk": ("PATCH", f"{BASE}/risks/{e['risk'].id}", {"title": "x"}),
        "delete_risk": ("DELETE", f"{BASE}/risks/{e['risk'].id}", None),
        "create_task": ("POST", f"{r}/tasks", {"title": "t"}),
        "update_task": ("PATCH", f"{BASE}/tasks/{e['task'].id}", {"title": "x"}),
        "delete_task": ("DELETE", f"{BASE}/tasks/{e['task'].id}", None),
        "create_task_comment": ("POST", f"{BASE}/tasks/{e['task'].id}/comments", {"content": "c"}),
        "create_wbs": ("POST", f"{r}/wbs", {"title": "w"}),
        "update_wbs": ("PATCH", f"{BASE}/wbs/{e['wbs'].id}", {"title": "x"}),
        "delete_wbs": ("DELETE", f"{BASE}/wbs/{e['wbs2'].id}", None),
        "move_gantt_row": (
            "POST",
            f"{r}/gantt/move",
            {"kind": "task", "id": str(e["task"].id), "position": 0},
        ),
        "create_dependency": (
            "POST",
            f"{r}/dependencies",
            {
                "pred_kind": "wbs",
                "pred_id": str(e["wbs2"].id),
                "succ_kind": "task",
                "succ_id": str(e["task"].id),
            },
        ),
        "delete_dependency": ("DELETE", f"{BASE}/dependencies/{e['dep'].id}", None),
    }


def _cost_routes(e):
    r = f"{BASE}/initiatives/{e['card'].id}"
    return {
        "create_cost_line": (
            "POST",
            f"{r}/costs",
            {"budget_line_id": str(e["budget"].id), "description": "n", "category": "capex"},
        ),
        "update_cost_line": ("PATCH", f"{BASE}/costs/{e['cost'].id}", {"description": "x"}),
        "move_cost_line_between_budgets": (
            "PATCH",
            f"{BASE}/costs/{e['cost'].id}",
            {"budget_line_id": str(e["other_budget"].id)},
        ),
        "delete_cost_line": ("DELETE", f"{BASE}/costs/{e['free_cost'].id}", None),
        "create_budget_line": (
            "POST",
            f"{r}/budgets",
            {"fiscal_year": 2026, "category": "capex", "amount": 5},
        ),
        "update_budget_line": ("PATCH", f"{BASE}/budgets/{e['budget'].id}", {"description": "x"}),
        "delete_budget_line": ("DELETE", f"{BASE}/budgets/{e['other_budget'].id}", None),
        "create_invoice": (
            "POST",
            f"{r}/invoices",
            {
                "cost_item_id": str(e["cost"].id),
                "invoice_date": "2026-02-01",
                "invoice_id": "INV-2",
                "amount": "3",
            },
        ),
        "update_invoice": ("PATCH", f"{BASE}/invoices/{e['invoice'].id}", {"invoice_id": "X"}),
        "delete_invoice": ("DELETE", f"{BASE}/invoices/{e['invoice'].id}", None),
    }


async def _user_for(db, env, profile):
    perms, stakeholder, _, _ = PROFILES[profile]
    if perms is PPM_MANAGER_APP_PERMISSIONS:
        user = await create_ppm_manager_user(db, email=f"{profile}@matrix.test")
    else:
        await create_role(db, key=profile, label=profile, permissions=perms)
        user = await create_user(db, email=f"{profile}@matrix.test", role=profile)
    if stakeholder:
        db.add(Stakeholder(card_id=env["card"].id, user_id=user.id, role=stakeholder))
        await db.flush()
    return user


async def _call(client, user, route):
    method, path, body = route
    return await client.request(method, path, json=body, headers=auth_headers(user))


def _ok(status):
    return status in (200, 204)


@pytest.mark.parametrize("profile", list(PROFILES))
@pytest.mark.parametrize("route", MANAGE_ROUTES)
async def test_manage_routes(client, db, env, profile, route):
    user = await _user_for(db, env, profile)
    resp = await _call(client, user, _manage_routes(env)[route])
    if PROFILES[profile][2]:
        assert _ok(resp.status_code), resp.text
    else:
        assert resp.status_code == 403, resp.text


# An invoice is invisible to a user who cannot see the costs: 404, not 403.
INVOICE_HIDDEN = {"ppm_manager_no_stakeholder", "manage_and_edit_costs_without_view"}


@pytest.mark.parametrize("profile", list(PROFILES))
@pytest.mark.parametrize("route", COST_ROUTES)
async def test_cost_routes(client, db, env, profile, route):
    user = await _user_for(db, env, profile)
    resp = await _call(client, user, _cost_routes(env)[route])
    if PROFILES[profile][3]:
        assert _ok(resp.status_code), resp.text
    elif route in ("update_invoice", "delete_invoice") and profile in INVOICE_HIDDEN:
        assert resp.status_code == 404, resp.text
    else:
        assert resp.status_code == 403, resp.text


async def test_cost_routes_are_not_blocked_by_card_edit_alone(client, db, env):
    """card.edit without card.edit_costs does not open the cost routes."""
    await create_role(db, key="editor", label="e", permissions=PPM_MANAGER_APP_PERMISSIONS)
    await create_stakeholder_role_def(
        db,
        card_type_key="Initiative",
        key="editorOnly",
        permissions={"card.view": True, "card.edit": True, "card.view_costs": True},
    )
    user = await create_user(db, email="editor@matrix.test", role="editor")
    db.add(Stakeholder(card_id=env["card"].id, user_id=user.id, role="editorOnly"))
    await db.flush()
    cost = await _call(client, user, _cost_routes(env)["update_cost_line"])
    manage = await _call(client, user, _manage_routes(env)["update_task"])
    assert cost.status_code == 403
    assert manage.status_code == 200


@pytest.mark.parametrize("kind", ["manage", "cost"])
async def test_hidden_initiative_is_404_before_any_403(client, db, env, kind):
    await create_role(
        db,
        key="hidden",
        label="h",
        permissions={**PPM_MANAGER_APP_PERMISSIONS, "costs.view": True, "costs.edit": True},
    )
    user = await create_user(db, email="hidden@matrix.test", role="hidden")
    from sqlalchemy import select

    from app.models.card_type import CardType
    from app.services.permission_service import PermissionService

    ct = (await db.execute(select(CardType).where(CardType.key == "Initiative"))).scalar_one()
    ct.role_permissions = {"hidden": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()
    routes = _manage_routes(env) if kind == "manage" else _cost_routes(env)
    for route in routes.values():
        assert (await _call(client, user, route)).status_code == 404, route


async def test_author_of_a_comment_edits_and_deletes_it_without_manage(client, db, env):
    from app.models.ppm_task_comment import PpmTaskComment

    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    author = await create_user(db, email="author@matrix.test", role="viewer")
    comment = PpmTaskComment(task_id=env["task"].id, user_id=author.id, content="mine")
    db.add(comment)
    await db.flush()
    patched = await client.patch(
        f"{BASE}/task-comments/{comment.id}",
        json={"content": "edited"},
        headers=auth_headers(author),
    )
    assert patched.status_code == 200
    deleted = await client.delete(
        f"{BASE}/task-comments/{comment.id}", headers=auth_headers(author)
    )
    assert deleted.status_code == 204


async def test_route_tables_match_the_parametrised_names(env):
    assert list(_manage_routes(env)) == MANAGE_ROUTES
    assert list(_cost_routes(env)) == COST_ROUTES
