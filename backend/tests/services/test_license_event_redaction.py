"""License values in event feeds: who loses them, the summary text, the rollback decline."""

from __future__ import annotations

import uuid

from app.models.event import Event
from app.services import card_licenses as cl
from app.services import cost_event_redaction as red
from app.services import license_types, rollback_service
from tests.conftest import create_card, create_card_type, create_role, create_user


def _legacy_diff():
    return {
        "changes": {
            "attributes": {
                "old": {"licensedUsers": 5, "name": "x"},
                "new": {"licensedUsers": 9, "name": "x"},
            },
            "actualInstallations": {"old": 1, "new": 2},
            "description": {"old": "a", "new": "b"},
        }
    }


def _types_list():
    return {"fiscal_year": 2026, "changes": {cl.LIST_KEY: {"old": [], "new": ["admin"]}}}


async def _card_and_user(db, permissions):
    await create_card_type(db, key="Application")
    await create_role(db, key="r_test", permissions=permissions)
    user = await create_user(db, email=f"{uuid.uuid4().hex[:8]}@lic-red.com", role="r_test")
    return await create_card(db), user


async def test_legacy_diff_of_old_keys_redacted_without_license_access(db):
    card, user = await _card_and_user(db, {"costs.view": True})
    out = await red.redact_cost_events(
        db, user, [Event(card_id=card.id, event_type="card.updated")], [_legacy_diff()]
    )
    assert out[0]["changes"] == {
        "attributes": {"old": {"name": "x"}, "new": {"name": "x"}},
        "description": {"old": "a", "new": "b"},
    }
    await create_role(db, key="admin", permissions={"*": True})
    keeper = await create_user(db, email="k@lic-red.com", role="admin")
    kept = await red.redact_cost_events(
        db, keeper, [Event(card_id=card.id, event_type="card.updated")], [_legacy_diff()]
    )
    assert kept[0] == _legacy_diff()


async def test_license_types_list_redacted_without_access(db):
    card, user = await _card_and_user(db, {"licenses.view": True})
    await create_role(db, key="viewer", permissions={"inventory.view": True})
    other = await create_user(db, email="o@lic-red.com", role="viewer")
    ev = Event(card_id=card.id, event_type=cl.LICENSE_EVENT)
    assert (await red.redact_cost_events(db, user, [ev], [_types_list()]))[0] == _types_list()
    out = (await red.redact_cost_events(db, other, [ev], [_types_list()]))[0]
    assert out == {"fiscal_year": 2026, "changes": {}}


async def test_cost_keys_redacted_for_a_license_only_reader(db):
    card, user = await _card_and_user(db, {"licenses.view": True})
    payload = {"changes": {"costTotalAnnual": {"old": 1, "new": 2}, "cost_items": {"new": ["a"]}}}
    out = await red.redact_cost_events(
        db, user, [Event(card_id=card.id, event_type="card.costs_updated")], [payload]
    )
    assert out[0]["changes"] == {}


async def test_summary_names_year_and_labels(db):
    await license_types.create_item(db, "admin", "Admin users")
    await license_types.create_item(db, "prod", "Production")
    full = {
        "fiscal_year": 2026,
        "changes": {cl.LIST_KEY: {"old": ["admin"], "new": ["admin", "prod"]}},
    }
    redacted = {"fiscal_year": 2026, "changes": {}}
    out = await red.add_cost_summaries(
        db,
        "ERP",
        [Event(event_type=cl.LICENSE_EVENT), Event(event_type=cl.LICENSE_EVENT)],
        [full, redacted],
    )
    assert (
        out[0]["summary"]
        == "Licensing of ERP changed (FY26; license types: Admin users, Production)"
    )
    assert out[1]["summary"] == "Licensing of ERP changed (FY26)"
    assert "summary" not in full


def test_rollback_declines_license_event():
    plan = rollback_service._plan_inverse(
        Event(
            id=uuid.uuid4(),
            event_type=cl.LICENSE_EVENT,
            data={"changes": {cl.LIST_KEY: {"old": [], "new": ["a"]}}},
        )
    )
    assert plan["op"] == "unsupported"
    assert "edit the licenses instead" in plan["reason"]
