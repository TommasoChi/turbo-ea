"""The survey-apply readers and parsers pinned one by one: which field shapes count, what an
answer must look like, and exactly which cards / people a field reads back."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from app.models.relation import Relation
from app.models.stakeholder import Stakeholder
from app.models.survey import SurveyResponse
from app.services import card_write_service
from app.services import survey_apply as sa
from app.services.bo_relationship_constants import ER_RELATION
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_stakeholder_role_def,
    create_user,
)

# --- field shape predicates ---------------------------------------------------


def test_relation_field_needs_kind_type_and_a_known_direction():
    ok = {"kind": "relation", "relation_type_key": "r", "direction": "outgoing"}
    assert sa.is_relation_field(ok) is True
    assert sa.is_relation_field({**ok, "direction": "incoming"}) is True
    assert sa.is_relation_field({**ok, "direction": "sideways"}) is False
    assert sa.is_relation_field({**ok, "direction": None}) is False
    assert sa.is_relation_field({**ok, "relation_type_key": ""}) is False
    assert sa.is_relation_field({**ok, "relation_type_key": None}) is False
    assert sa.is_relation_field({**ok, "kind": "attribute"}) is False
    assert sa.is_relation_field({"relation_type_key": "r", "direction": "outgoing"}) is False
    assert sa.is_relation_field("relation") is False
    assert sa.is_relation_field(None) is False


@pytest.mark.parametrize("phase", ["plan", "phaseIn", "active", "phaseOut", "endOfLife"])
def test_lifecycle_field_accepts_every_known_phase(phase):
    assert sa.is_lifecycle_field({"kind": "lifecycle", "phase": phase}) is True


def test_lifecycle_field_refuses_unknown_phase_kind_and_non_dicts():
    assert sa.is_lifecycle_field({"kind": "lifecycle", "phase": "retired"}) is False
    assert sa.is_lifecycle_field({"kind": "lifecycle"}) is False
    assert sa.is_lifecycle_field({"kind": "stakeholder", "phase": "plan"}) is False
    assert sa.is_lifecycle_field({"phase": "plan"}) is False
    assert sa.is_lifecycle_field(["lifecycle"]) is False
    assert sa.is_lifecycle_field(None) is False


def test_stakeholder_field_needs_a_non_empty_string_role():
    assert sa.is_stakeholder_field({"kind": "stakeholder", "role": "owner"}) is True
    assert sa.is_stakeholder_field({"kind": "stakeholder", "role": ""}) is False
    assert sa.is_stakeholder_field({"kind": "stakeholder", "role": None}) is False
    assert sa.is_stakeholder_field({"kind": "stakeholder", "role": 7}) is False
    assert sa.is_stakeholder_field({"kind": "stakeholder"}) is False
    assert sa.is_stakeholder_field({"kind": "relation", "role": "owner"}) is False
    assert sa.is_stakeholder_field({"role": "owner"}) is False
    assert sa.is_stakeholder_field("owner") is False
    assert sa.is_stakeholder_field(None) is False


# --- answer parsers -----------------------------------------------------------


def test_lifecycle_answer_none_clear_or_a_date():
    assert sa.normalise_lifecycle_answer(None) is None
    assert sa.normalise_lifecycle_answer("") == ""
    assert sa.normalise_lifecycle_answer("2026-03-09") == "2026-03-09"
    with pytest.raises(sa.SurveyFieldError) as exc:
        sa.normalise_lifecycle_answer("not a date")
    assert str(exc.value) == "Not a date: not a date"


def test_ref_ids_reads_dicts_and_bare_strings():
    a, b = uuid.uuid4(), uuid.uuid4()
    assert sa.ref_ids([{"id": str(a), "name": "x"}, str(b)]) == {a, b}
    assert sa.ref_ids([a]) == {a}
    assert sa.ref_ids([str(a), {"id": str(a)}]) == {a}  # a set: no duplicates
    assert sa.ref_ids([]) == set()


def test_ref_ids_refuses_anything_that_is_not_a_list_of_ids():
    for bad in ("x", None, {"id": str(uuid.uuid4())}, 5, (str(uuid.uuid4()),)):
        with pytest.raises(sa.SurveyFieldError) as exc:
            sa.ref_ids(bad)
        assert str(exc.value) == "Expected a list of references"
    good = str(uuid.uuid4())
    for junk in ("nope", {"id": "nope"}, {"name": "no id"}, None, 12, {"id": None}):
        with pytest.raises(sa.SurveyFieldError) as exc:
            sa.ref_ids([good, junk])
        rid = junk.get("id") if isinstance(junk, dict) else junk
        assert str(exc.value) == f"Not a reference: {rid!r}"


def test_snapshot_ids_is_none_unless_the_snapshot_is_a_valid_list():
    a = uuid.uuid4()
    assert sa.snapshot_ids([{"id": str(a)}]) == {a}
    assert sa.snapshot_ids([]) == set()
    assert sa.snapshot_ids(None) is None
    assert sa.snapshot_ids("x") is None
    assert sa.snapshot_ids({"id": str(a)}) is None
    assert sa.snapshot_ids([{"id": "bad"}]) is None


def test_provenance_names_the_respondent_not_the_actor():
    survey = SimpleNamespace(id=uuid.uuid4(), name="Q4 review")
    resp = SimpleNamespace(id=uuid.uuid4(), user_id=uuid.uuid4())
    who = SimpleNamespace(display_name="Ada")
    assert sa.provenance(survey, resp, who) == {
        "source": "survey_response",
        "survey_id": str(survey.id),
        "survey_name": "Q4 review",
        "response_id": str(resp.id),
        "respondent_id": str(resp.user_id),
        "respondent_name": "Ada",
    }
    assert sa.provenance(survey, resp, None)["respondent_name"] is None
    assert "user_id" not in sa.provenance(survey, resp, who)


# --- what a card holds today --------------------------------------------------


async def test_relation_peers_follow_the_configured_side_active_cards_only_by_name(db):
    await create_card_type(db, key="Application")
    await create_card_type(db, key="ITComponent")
    await create_relation_type(db, key="app_to_itc")
    app = await create_card(db, card_type="Application", name="App")
    z = await create_card(db, card_type="ITComponent", name="Zeta")
    a = await create_card(db, card_type="ITComponent", name="Alpha")
    gone = await create_card(db, card_type="ITComponent", name="Gone", status="ARCHIVED")
    other = await create_card(db, card_type="Application", name="Other")
    for target in (z, a, gone):
        await create_relation(db, type_key="app_to_itc", source_id=app.id, target_id=target.id)
    await create_relation(db, type_key="app_to_itc", source_id=other.id, target_id=z.id)

    out_field = {"kind": "relation", "relation_type_key": "app_to_itc", "direction": "outgoing"}
    peers = await sa.relation_field_peers(db, app.id, out_field)
    assert peers == [{"id": str(a.id), "name": "Alpha"}, {"id": str(z.id), "name": "Zeta"}]

    in_field = {**out_field, "direction": "incoming"}
    assert await sa.relation_field_peers(db, z.id, in_field) == [
        {"id": str(app.id), "name": "App"},
        {"id": str(other.id), "name": "Other"},
    ]
    assert await sa.relation_field_peers(db, app.id, in_field) == []  # wrong side
    assert await sa.relation_field_peers(db, z.id, out_field) == []
    other_type = {**out_field, "relation_type_key": "nope"}
    assert await sa.relation_field_peers(db, app.id, other_type) == []
    assert await sa.relation_field_peers(db, app.id, {**out_field, "direction": "x"}) == []
    assert await sa.relation_field_peers(db, app.id, {"direction": "outgoing"}) == []
    assert await sa.relation_field_peers(db, app.id, {**out_field, "relation_type_key": ""}) == []


async def test_stakeholder_holders_are_active_people_in_that_role_by_name(db):
    await create_card_type(db, key="Application")
    await create_stakeholder_role_def(db, key="owner")
    await create_stakeholder_role_def(db, key="reviewer")
    card = await create_card(db)
    other_card = await create_card(db, name="Other")
    zed = await create_user(db, email="zed@sa.com", display_name="Zed")
    amy = await create_user(db, email="amy@sa.com", display_name="Amy")
    off = await create_user(db, email="off@sa.com", display_name="Off")
    off.is_active = False
    await db.flush()
    for user, role, c in (
        (zed, "owner", card),
        (amy, "owner", card),
        (off, "owner", card),
        (zed, "reviewer", card),
        (off, "owner", other_card),
    ):
        db.add(Stakeholder(card_id=c.id, user_id=user.id, role=role))
    await db.flush()

    assert await sa.stakeholder_holders(db, card.id, "owner") == [
        {"id": str(amy.id), "display_name": "Amy"},
        {"id": str(zed.id), "display_name": "Zed"},
    ]
    assert await sa.stakeholder_holders(db, card.id, "reviewer") == [
        {"id": str(zed.id), "display_name": "Zed"}
    ]
    assert await sa.stakeholder_holders(db, card.id, "nobody") == []
    assert await sa.stakeholder_holders(db, other_card.id, "owner") == []


async def test_current_value_reads_the_right_source_for_each_kind(db):
    await create_card_type(db, key="Application")
    await create_stakeholder_role_def(db, key="owner")
    card = await create_card(
        db, attributes={"cost": 5, "name2": "n"}, lifecycle={"plan": "2026-01-01"}
    )
    user = await create_user(db, email="own@sa.com", display_name="Own")
    db.add(Stakeholder(card_id=card.id, user_id=user.id, role="owner"))
    await db.flush()

    assert await sa.current_value(db, card, {"key": "cost"}) == 5
    assert await sa.current_value(db, card, {"key": "absent"}) is None
    assert await sa.current_value(db, card, {"kind": "lifecycle", "phase": "plan"}) == "2026-01-01"
    assert await sa.current_value(db, card, {"kind": "lifecycle", "phase": "active"}) is None
    assert await sa.current_value(db, card, {"kind": "stakeholder", "role": "owner"}) == [
        {"id": str(user.id), "display_name": "Own"}
    ]
    bare = SimpleNamespace(id=card.id, attributes=None, lifecycle=None)
    assert await sa.current_value(db, bare, {"key": "cost"}) is None
    assert await sa.current_value(db, bare, {"kind": "lifecycle", "phase": "plan"}) is None


@pytest.mark.parametrize(
    ("fields", "has_response_ids"),
    [
        (None, True),
        ([None, {"key": "other", "relation_type_key": "relOther"}], True),
        ([{"key": "er", "relation_type_key": ER_RELATION}], False),
    ],
)
async def test_lock_survey_er_pairs_skips_batches_without_er_work(fields, has_response_ids):
    db = SimpleNamespace(scalars=AsyncMock())
    survey = SimpleNamespace(id=uuid.uuid4(), fields=fields)
    response_ids = [str(uuid.uuid4())] if has_response_ids else []

    await sa.lock_survey_er_pairs(db, survey, response_ids)

    db.scalars.assert_not_awaited()


async def test_lock_survey_er_pairs_only_locks_pending_er_changes(monkeypatch):
    lock = AsyncMock()
    monkeypatch.setattr("app.services.card_write_service.lock_bo_relation_writes", lock)
    survey = SimpleNamespace(
        id=uuid.uuid4(),
        fields=[
            None,
            *(
                {"key": key, "relation_type_key": ER_RELATION}
                for key in (
                    "er",
                    "second_er",
                    "confirmed",
                    "malformed",
                    "not_a_dict",
                    "missing_value",
                )
            ),
            {"key": "other", "relation_type_key": "relOther"},
        ],
    )
    card, peer, second_peer, ignored_peer = (uuid.uuid4() for _ in range(4))
    ignored = {"new_value": [str(ignored_peer)]}
    responses = [
        SimpleNamespace(card_id=card, status="pending", applied=False, responses={"er": ignored}),
        SimpleNamespace(card_id=card, status="completed", applied=True, responses={"er": ignored}),
        SimpleNamespace(card_id=card, status="completed", applied=False, responses=None),
        SimpleNamespace(
            card_id=card,
            status="completed",
            applied=False,
            responses={
                "other": ignored,
                "confirmed": {**ignored, "confirmed": True},
                "malformed": {"new_value": ["invalid-id", str(ignored_peer)]},
                "missing_value": {"previous_value": [str(ignored_peer)]},
                "not_a_dict": [str(ignored_peer)],
                "er": {"new_value": [str(peer)]},
                "second_er": {"new_value": [{"id": str(second_peer)}]},
            },
        ),
    ]
    db = SimpleNamespace(scalars=AsyncMock(return_value=responses))
    requested = [uuid.uuid4(), uuid.uuid4()]

    await sa.lock_survey_er_pairs(db, survey, [str(item) for item in requested])

    lock.assert_awaited_once_with(db, [(ER_RELATION, card, peer), (ER_RELATION, card, second_peer)])
    db.scalars.assert_awaited_once()
    statement = db.scalars.await_args.args[0]
    assert statement.column_descriptions[0]["entity"] is SurveyResponse
    query = statement.compile()
    assert list(query.params.values()) == [requested, survey.id]
    assert "survey_responses.survey_id =" in str(query)
    assert "ORDER BY survey_responses.id FOR UPDATE" in str(query)


async def test_apply_er_relation_change_keeps_reverse_pair_and_adds_next_peer(db, monkeypatch):
    await create_card_type(db, key="DataObject")
    await create_relation_type(
        db, key=ER_RELATION, source_type_key="DataObject", target_type_key="DataObject"
    )
    actor = await create_user(db)
    card = await create_card(db, card_type="DataObject")
    first = await create_card(db, card_type="DataObject")
    second = await create_card(db, card_type="DataObject")
    existing_peer, new_peer = sorted([first, second], key=lambda item: item.id)
    await create_relation(db, type_key=ER_RELATION, source_id=existing_peer.id, target_id=card.id)
    lock = AsyncMock(wraps=card_write_service.lock_bo_relation_writes)
    monkeypatch.setattr(card_write_service, "lock_bo_relation_writes", lock)

    assert await sa.apply_relation_change(
        db,
        card,
        {"relation_type_key": ER_RELATION, "direction": "outgoing"},
        [str(existing_peer.id), str(new_peer.id)],
        actor.id,
    )

    lock.assert_awaited_once()
    rows = await db.execute(
        select(Relation.source_id, Relation.target_id).where(Relation.type == ER_RELATION)
    )
    assert set(rows) == {(existing_peer.id, card.id), (card.id, new_peer.id)}
