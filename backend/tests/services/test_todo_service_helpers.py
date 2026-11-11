"""The todo service's small pure pieces pinned one by one: origin, link validation, coercion, the
event payload, the published event and the assignment notification."""

from __future__ import annotations

import uuid
from datetime import date
from types import SimpleNamespace

import pytest

from app.services import todo_service as ts

TID = uuid.UUID("11111111-1111-1111-1111-111111111111")
CID = uuid.UUID("22222222-2222-2222-2222-222222222222")
UID = uuid.UUID("33333333-3333-3333-3333-333333333333")
ACTOR = ts.TodoActor(user_id=UID, display_name="Ada")


def _todo(**over):
    base = {
        "id": TID,
        "card_id": CID,
        "description": "Review the data",
        "status": "open",
        "assigned_to": UID,
        "external_source": "jira",
        "external_ref": "ABC-1",
        "is_system": False,
        "link": None,
        "created_by": UID,
    }
    base.update(over)
    return SimpleNamespace(**base)


# --- errors -------------------------------------------------------------------


def test_error_classes_carry_their_http_status_and_message():
    err = ts.TodoError("boom")
    assert err.message == "boom" and str(err) == "boom" and err.status_code == 400
    assert ts.TodoValidationError("x").status_code == 400
    assert ts.TodoForbiddenError("x").status_code == 403
    assert ts.TodoConflictError("x").status_code == 409
    for cls in (ts.TodoValidationError, ts.TodoForbiddenError, ts.TodoConflictError):
        assert issubclass(cls, ts.TodoError)


# --- origin ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "link,origin",
    [
        ("/ppm/x", "ppm"),
        ("/ea-delivery/risks/1", "risk"),
        ("/ea-delivery/adr/1", "adr"),
        ("/ea-delivery/soaw/1", "soaw"),
        ("/cards/1?tab=process-flow", "bpm"),
    ],
)
def test_a_system_todo_takes_its_origin_from_the_link_shape(link, origin):
    assert ts.derive_origin(_todo(is_system=True, link=link, external_source=None)) == origin


def test_a_user_set_link_never_makes_a_manual_todo_a_system_one():
    todo = _todo(is_system=False, link="/ppm/x", external_source=None)
    assert ts.derive_origin(todo) == "manual"
    assert ts.derive_origin(_todo(is_system=True, link="/other", external_source=None)) == "manual"
    assert ts.derive_origin(_todo(is_system=True, link=None, external_source=None)) == "manual"


def test_extension_origin_needs_an_external_source_and_no_human_creator():
    assert ts.derive_origin(_todo(external_source="jira", created_by=None)) == "extension"
    assert ts.derive_origin(_todo(external_source="jira", created_by=UID)) == "manual"
    assert ts.derive_origin(_todo(external_source=None, created_by=None)) == "manual"
    assert ts.derive_origin(_todo(external_source="", created_by=None)) == "manual"
    # a system risk todo mirrored to a tracker is still Turbo EA work
    mirrored = _todo(is_system=True, link="/ea-delivery/risks/1", external_source="jira")
    assert ts.derive_origin(mirrored) == "risk"


# --- link validation ------------------------------------------------------------


def test_link_validation_accepts_none_empty_and_relative_paths():
    assert ts.validated_link(None) is None
    assert ts.validated_link("") is None
    assert ts.validated_link("/cards/1") == "/cards/1"
    assert ts.validated_link("/") == "/"


@pytest.mark.parametrize("bad", ["https://evil.example", "cards/1", "//evil.example/x", "x", " /a"])
def test_link_validation_refuses_anything_that_leaves_the_app(bad):
    with pytest.raises(ts.TodoValidationError) as exc:
        ts.validated_link(bad)
    assert exc.value.message == "link must be a relative in-app path starting with /"


# --- coercion -------------------------------------------------------------------


def test_coerce_user_id_and_date_pass_native_values_and_parse_strings():
    assert ts._coerce_user_id(None) is None
    assert ts._coerce_user_id(UID) is UID
    assert ts._coerce_user_id(str(UID)) == UID
    with pytest.raises(ValueError):
        ts._coerce_user_id("not-a-uuid")
    day = date(2026, 3, 9)
    assert ts._coerce_date(None) is None
    assert ts._coerce_date(day) is day
    assert ts._coerce_date("2026-03-09") == day
    with pytest.raises(ValueError):
        ts._coerce_date("09/03/2026")


# --- event payload --------------------------------------------------------------


def test_event_payload_is_the_documented_shape():
    assert ts._event_payload(_todo(), ACTOR) == {
        "todo_id": str(TID),
        "card_id": str(CID),
        "description": "Review the data",
        "status": "open",
        "assigned_to": str(UID),
        "external_source": "jira",
        "external_ref": "ABC-1",
    }


def test_event_payload_nulls_and_description_cap():
    out = ts._event_payload(
        _todo(card_id=None, assigned_to=None, description="d" * 250, external_source=None), ACTOR
    )
    assert out["card_id"] is None and out["assigned_to"] is None
    assert out["description"] == "d" * 200
    assert out["external_source"] is None
    exact = ts._event_payload(_todo(description="e" * 200), ACTOR)
    assert exact["description"] == "e" * 200


def test_event_payload_stamps_the_extension_and_merges_extras_over_it():
    ext_actor = ts.TodoActor(user_id=None, display_name="Bot", ext_key="jira-sync")
    out = ts._event_payload(_todo(), ext_actor)
    assert out["ext"] == "jira-sync"
    assert "ext" not in ts._event_payload(_todo(), ACTOR)
    merged = ts._event_payload(_todo(), ext_actor, {"status": "done", "changes": {"a": 1}})
    assert merged["status"] == "done" and merged["changes"] == {"a": 1}
    assert ts._event_payload(_todo(), ACTOR, {}) == ts._event_payload(_todo(), ACTOR, None)


# --- publish and notify ----------------------------------------------------------


async def test_publish_threads_the_card_and_the_actor_into_the_event(monkeypatch):
    seen = {}

    async def fake_publish(event_type, data, **kw):
        seen.update(event_type=event_type, data=data, kw=kw)

    monkeypatch.setattr(ts.event_bus, "publish", fake_publish)
    db = object()
    await ts._publish(db, ACTOR, "todo.updated", _todo(), {"status": "done"})
    assert seen["event_type"] == "todo.updated"
    assert seen["data"]["status"] == "done" and seen["data"]["todo_id"] == str(TID)
    assert seen["kw"] == {"db": db, "card_id": CID, "user_id": UID}


async def test_notify_assigned_names_the_actor_and_clips_the_description(monkeypatch):
    seen = {}

    async def fake_create(db, **kw):
        seen.update(kw)

    monkeypatch.setattr(ts.notification_service, "create_notification", fake_create)
    await ts._notify_assigned(object(), ACTOR, _todo(description="x" * 120))
    assert seen["user_id"] == UID
    assert seen["notif_type"] == "todo_assigned"
    assert seen["title"] == "Todo Assigned"
    assert seen["message"] == f'Ada assigned you a todo: "{"x" * 80}"'
    assert seen["link"] == "/todos"
    assert seen["data"] == {"todo_id": str(TID), "card_id": str(CID)}
    assert seen["card_id"] == CID


async def test_notify_assigned_handles_a_card_less_todo_and_skips_an_unassigned_one(monkeypatch):
    calls = []

    async def fake_create(db, **kw):
        calls.append(kw)

    monkeypatch.setattr(ts.notification_service, "create_notification", fake_create)
    await ts._notify_assigned(object(), ACTOR, _todo(assigned_to=None))
    assert calls == []
    await ts._notify_assigned(object(), ACTOR, _todo(card_id=None))
    assert calls[0]["data"] == {"todo_id": str(TID), "card_id": None}
    assert calls[0]["card_id"] is None
