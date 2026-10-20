"""Direct unit tests for the small serialization/stat helpers in
``app/api/v1/surveys.py``.

Flagged by the nightly mutation report (#20): these pure functions were
previously exercised only indirectly through the route handlers, which
mutmut never mutates (every one carries a ``@router`` decorator, and
mutmut skips any decorated function other than ``@staticmethod`` /
``@classmethod``) -- so the fallbacks and defaults inside them had no
test pinning them directly.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1.surveys import (
    _audit_role_labels,
    _get_response_stats,
    _response_to_dict,
    _survey_to_dict,
    _validate_fields,
)
from app.models.survey import SurveyResponse
from tests.api.test_surveys_extended import _create_draft_survey, survey_env  # noqa: F401
from tests.conftest import create_card_type, create_stakeholder_role_def


def _survey_stub(**overrides):
    base = dict(
        id=uuid.uuid4(),
        name="Data Quality Check",
        description="desc",
        message="msg",
        status="draft",
        target_type_key="Application",
        target_filters={"a": 1},
        target_roles=["owner"],
        fields=[{"key": "x"}],
        created_by=uuid.uuid4(),
        creator=SimpleNamespace(display_name="Alice"),
        sent_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        closed_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
        created_at=datetime(2026, 1, 3, tzinfo=timezone.utc),
        updated_at=datetime(2026, 1, 4, tzinfo=timezone.utc),
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class TestSurveyToDict:
    def test_full_survey_serializes_every_field(self):
        s = _survey_stub()
        assert _survey_to_dict(s) == {
            "id": str(s.id),
            "name": "Data Quality Check",
            "description": "desc",
            "message": "msg",
            "status": "draft",
            "target_type_key": "Application",
            "target_filters": {"a": 1},
            "target_roles": ["owner"],
            "fields": [{"key": "x"}],
            "created_by": str(s.created_by),
            "creator_name": "Alice",
            "sent_at": s.sent_at.isoformat(),
            "closed_at": s.closed_at.isoformat(),
            "created_at": s.created_at.isoformat(),
            "updated_at": s.updated_at.isoformat(),
        }

    def test_falsy_optional_fields_fall_back_to_their_defaults(self):
        s = _survey_stub(
            description=None,
            message=None,
            target_filters=None,
            target_roles=None,
            fields=None,
            created_by=None,
            creator=None,
            sent_at=None,
            closed_at=None,
            created_at=None,
            updated_at=None,
        )
        d = _survey_to_dict(s)
        assert d["description"] == ""
        assert d["message"] == ""
        assert d["target_filters"] == {}
        assert d["target_roles"] == []
        assert d["fields"] == []
        assert d["created_by"] is None
        assert d["creator_name"] is None
        assert d["sent_at"] is None
        assert d["closed_at"] is None
        assert d["created_at"] is None
        assert d["updated_at"] is None

    def test_stats_are_merged_in_when_given(self):
        d = _survey_to_dict(_survey_stub(), {"total_responses": 5})
        assert d["total_responses"] == 5

    def test_no_stats_adds_no_extra_keys(self):
        d = _survey_to_dict(_survey_stub())
        assert set(d.keys()) == {
            "id",
            "name",
            "description",
            "message",
            "status",
            "target_type_key",
            "target_filters",
            "target_roles",
            "fields",
            "created_by",
            "creator_name",
            "sent_at",
            "closed_at",
            "created_at",
            "updated_at",
        }


def _response_stub(**overrides):
    base = dict(
        id=uuid.uuid4(),
        survey_id=uuid.uuid4(),
        card_id=uuid.uuid4(),
        card=SimpleNamespace(name="App1", type="Application"),
        user_id=uuid.uuid4(),
        user=SimpleNamespace(display_name="Bob", email="bob@test.com"),
        status="completed",
        responses={"f1": {"new_value": "x"}},
        applied=True,
        responded_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        applied_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
        created_at=datetime(2026, 1, 3, tzinfo=timezone.utc),
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class TestResponseToDict:
    def test_full_response_serializes_every_field(self):
        r = _response_stub()
        assert _response_to_dict(r) == {
            "id": str(r.id),
            "survey_id": str(r.survey_id),
            "card_id": str(r.card_id),
            "card_name": "App1",
            "card_type": "Application",
            "user_id": str(r.user_id),
            "user_display_name": "Bob",
            "user_email": "bob@test.com",
            "status": "completed",
            "responses": {"f1": {"new_value": "x"}},
            "applied": True,
            "responded_at": r.responded_at.isoformat(),
            "applied_at": r.applied_at.isoformat(),
            "created_at": r.created_at.isoformat(),
        }

    def test_missing_card_and_user_and_falsy_fields_fall_back_to_none(self):
        r = _response_stub(
            card=None,
            user=None,
            responses=None,
            responded_at=None,
            applied_at=None,
            created_at=None,
        )
        d = _response_to_dict(r)
        assert d["card_name"] is None
        assert d["card_type"] is None
        assert d["user_display_name"] is None
        assert d["user_email"] is None
        assert d["responses"] == {}
        assert d["responded_at"] is None
        assert d["applied_at"] is None
        assert d["created_at"] is None


class TestGetResponseStats:
    async def test_counts_are_scoped_to_the_survey_and_split_by_status(
        self,
        client,
        db,
        survey_env,  # noqa: F811
    ):
        admin, member, viewer = (
            survey_env["admin"],
            survey_env["member"],
            survey_env["viewer"],
        )
        card_id = survey_env["card"].id

        survey = await _create_draft_survey(client, admin)
        survey_id = uuid.UUID(survey["id"])
        other = await _create_draft_survey(client, admin)
        other_id = uuid.UUID(other["id"])

        db.add_all(
            [
                SurveyResponse(
                    survey_id=survey_id, card_id=card_id, user_id=member.id, status="pending"
                ),
                SurveyResponse(
                    survey_id=survey_id,
                    card_id=card_id,
                    user_id=viewer.id,
                    status="completed",
                    applied=False,
                ),
                SurveyResponse(
                    survey_id=survey_id,
                    card_id=card_id,
                    user_id=admin.id,
                    status="completed",
                    applied=True,
                ),
                # A response on a DIFFERENT survey must not be counted.
                SurveyResponse(
                    survey_id=other_id,
                    card_id=card_id,
                    user_id=admin.id,
                    status="completed",
                    applied=True,
                ),
            ]
        )
        await db.flush()

        stats = await _get_response_stats(db, survey_id)
        assert stats == {
            "total_responses": 3,
            "completed_responses": 2,
            "applied_responses": 1,
        }

    async def test_survey_with_no_responses_is_all_zero(
        self,
        client,
        db,
        survey_env,  # noqa: F811
    ):
        survey = await _create_draft_survey(client, survey_env["admin"])
        stats = await _get_response_stats(db, uuid.UUID(survey["id"]))
        assert stats == {
            "total_responses": 0,
            "completed_responses": 0,
            "applied_responses": 0,
        }


class TestAuditRoleLabels:
    async def test_no_role_keys_is_an_empty_list(self, db):
        assert await _audit_role_labels(db, "Application", None) == []
        assert await _audit_role_labels(db, "Application", []) == []

    async def test_resolves_to_the_live_label_in_order(self, db):
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="responsible", label="Responsible"
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="observer", label="Observer"
        )
        await db.flush()

        labels = await _audit_role_labels(db, "Application", ["observer", "responsible"])
        assert labels == ["Observer", "Responsible"]

    async def test_unknown_role_key_falls_back_to_itself(self, db):
        await create_card_type(db, key="Application", label="Application")
        await db.flush()

        assert await _audit_role_labels(db, "Application", ["ghostRole"]) == ["ghostRole"]

    async def test_role_def_with_no_label_falls_back_to_its_key(self, db):
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(db, card_type_key="Application", key="observer", label="")
        await db.flush()

        assert await _audit_role_labels(db, "Application", ["observer"]) == ["observer"]


class TestValidateFields:
    async def test_valid_fields_pass_silently(self, db):
        await create_card_type(db, key="Application", label="Application")
        await db.flush()
        await _validate_fields(db, "Application", None)
        await _validate_fields(db, "Application", [])

    async def test_invalid_field_raises_400_with_the_field_errors_message(self, db):
        await create_card_type(db, key="Application", label="Application")
        await db.flush()
        with pytest.raises(HTTPException) as exc:
            await _validate_fields(db, "Application", [{"key": "x", "kind": "bogus"}])
        assert exc.value.status_code == 400
        assert exc.value.detail == "Unknown survey field kind: bogus"
