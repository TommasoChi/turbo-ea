"""Unit tests for ``app/services/stakeholder_service.py``."""

from __future__ import annotations

import uuid

from app.models.stakeholder import Stakeholder
from app.services import stakeholder_service
from tests.conftest import (
    create_card,
    create_card_type,
    create_stakeholder_role_def,
    create_user,
)


class TestRolesForType:
    async def test_definitions_ordered_active_only_with_exact_shape(self, db):
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="Other", label="Other")
        b = await create_stakeholder_role_def(
            db, card_type_key="Application", key="bRole", label="B", sort_order=1, color="#111111"
        )
        b.translations = {"it": "Bi"}
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="aRole", label="A", sort_order=2, color="#222222"
        )
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="gone", label="G", sort_order=0, is_archived=True
        )
        await create_stakeholder_role_def(
            db, card_type_key="Other", key="elsewhere", label="E", sort_order=0
        )
        await db.flush()

        roles = await stakeholder_service.roles_for_type(db, "Application")
        assert roles == [
            {"key": "bRole", "label": "B", "color": "#111111", "translations": {"it": "Bi"}},
            {"key": "aRole", "label": "A", "color": "#222222", "translations": {}},
        ]

    async def test_falls_back_to_legacy_jsonb_when_no_definitions(self, db):
        legacy = [{"key": "custom", "label": "Custom"}]
        await create_card_type(db, key="Application", label="Application", stakeholder_roles=legacy)
        assert await stakeholder_service.roles_for_type(db, "Application") == legacy

    async def test_all_archived_falls_back_to_legacy(self, db):
        legacy = [{"key": "custom", "label": "Custom"}]
        await create_card_type(db, key="Application", label="Application", stakeholder_roles=legacy)
        await create_stakeholder_role_def(
            db, card_type_key="Application", key="old", label="Old", is_archived=True
        )
        assert await stakeholder_service.roles_for_type(db, "Application") == legacy

    async def test_builtin_defaults_when_nothing_defined(self, db):
        await create_card_type(db, key="Application", label="Application", stakeholder_roles=[])
        expected = [
            {"key": "responsible", "label": "Responsible"},
            {"key": "observer", "label": "Observer"},
        ]
        assert await stakeholder_service.roles_for_type(db, "Application") == expected
        assert await stakeholder_service.roles_for_type(db, "NoSuchType") == expected


def test_role_labels_maps_key_to_label():
    roles = [{"key": "a", "label": "A"}, {"key": "b", "label": "B", "color": "x"}]
    assert stakeholder_service.role_labels(roles) == {"a": "A", "b": "B"}
    assert stakeholder_service.role_labels([]) == {}


class _Bus:
    def __init__(self):
        self.calls = []

    async def publish(self, event_type, payload, **kwargs):
        self.calls.append((event_type, payload, kwargs))


class TestPublishStakeholderEvent:
    async def _row(self, db):
        card = await create_card(db, name="App")
        user = await create_user(db, role="member")
        row = Stakeholder(card_id=card.id, user_id=user.id, role="responsible")
        db.add(row)
        await db.flush()
        return card, user, row

    async def test_payload_and_kwargs(self, db, monkeypatch):
        bus = _Bus()
        monkeypatch.setattr(stakeholder_service, "event_bus", bus)
        card, user, row = await self._row(db)
        actor = uuid.uuid4()

        await stakeholder_service.publish_stakeholder_event(
            db,
            "stakeholder.added",
            row,
            role_label="Responsible",
            user_display_name="Ada",
            actor_id=actor,
        )
        [(event_type, payload, kwargs)] = bus.calls
        assert event_type == "stakeholder.added"
        assert payload == {
            "stakeholder_id": str(row.id),
            "user_id": str(user.id),
            "user_display_name": "Ada",
            "role": "responsible",
            "role_label": "Responsible",
            "summary": "Ada · Responsible",
        }
        assert kwargs == {"db": db, "card_id": card.id, "user_id": actor}

    async def test_summary_falls_back_to_user_and_extra_merges(self, db, monkeypatch):
        bus = _Bus()
        monkeypatch.setattr(stakeholder_service, "event_bus", bus)
        _, _, row = await self._row(db)
        await stakeholder_service.publish_stakeholder_event(
            db,
            "stakeholder.role_changed",
            row,
            role_label="Observer",
            user_display_name=None,
            actor_id=None,
            extra={"old_role": "responsible", "role": "overridden"},
        )
        [(_, payload, kwargs)] = bus.calls
        assert payload["summary"] == "User · Observer"
        assert payload["user_display_name"] is None
        assert payload["old_role"] == "responsible"
        assert payload["role"] == "overridden"
        assert kwargs["user_id"] is None

    async def test_empty_extra_changes_nothing(self, db, monkeypatch):
        bus = _Bus()
        monkeypatch.setattr(stakeholder_service, "event_bus", bus)
        _, _, row = await self._row(db)
        await stakeholder_service.publish_stakeholder_event(
            db, "x", row, role_label="R", user_display_name="A", actor_id=None, extra={}
        )
        assert set(bus.calls[0][1]) == {
            "stakeholder_id",
            "user_id",
            "user_display_name",
            "role",
            "role_label",
            "summary",
        }


class TestFindAssignment:
    async def test_matches_only_exact_triple(self, db):
        card = await create_card(db, name="A")
        other_card = await create_card(db, name="B")
        user = await create_user(db, role="member")
        other_user = await create_user(db, role="member")
        row = Stakeholder(card_id=card.id, user_id=user.id, role="responsible")
        db.add(row)
        await db.flush()

        found = await stakeholder_service.find_assignment(db, card.id, user.id, "responsible")
        assert found is not None and found.id == row.id
        assert (
            await stakeholder_service.find_assignment(db, other_card.id, user.id, "responsible")
            is None
        )
        assert (
            await stakeholder_service.find_assignment(db, card.id, other_user.id, "responsible")
            is None
        )
        assert await stakeholder_service.find_assignment(db, card.id, user.id, "observer") is None


async def test_rescore_after_change_rescores_that_card(db, monkeypatch):
    seen = []

    async def fake(db_, ids):
        seen.append((db_, ids))

    monkeypatch.setattr(stakeholder_service, "rescore_cards", fake)
    cid = uuid.uuid4()
    await stakeholder_service.rescore_after_stakeholder_change(db, cid)
    assert seen == [(db, [cid])]
