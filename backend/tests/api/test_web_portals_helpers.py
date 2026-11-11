"""The web-portal helpers pinned one by one: the serialised shape, the view and access
validators (messages and the pinned card type), the module defaults and the audit label maps."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1 import web_portals as wp
from app.models.app_settings import AppSettings

WHEN = datetime(2026, 11, 3, 10, 30, tzinfo=timezone.utc)


def _portal(**over):
    base = {
        "id": uuid.UUID("11111111-1111-1111-1111-111111111111"),
        "name": "Apps",
        "slug": "apps",
        "description": "d",
        "card_type": "Application",
        "filters": {"a": 1},
        "display_fields": ["x"],
        "card_config": {"c": 1},
        "is_published": True,
        "view": "ppm_portfolio",
        "access_mode": "sso",
        "allowed_email_domains": ["x.com"],
        "created_by": uuid.UUID("22222222-2222-2222-2222-222222222222"),
        "created_at": WHEN,
        "updated_at": WHEN,
    }
    base.update(over)
    return SimpleNamespace(**base)


def test_portal_dict_is_exactly_the_stored_shape():
    assert wp._portal_to_dict(_portal()) == {
        "id": "11111111-1111-1111-1111-111111111111",
        "name": "Apps",
        "slug": "apps",
        "description": "d",
        "card_type": "Application",
        "filters": {"a": 1},
        "display_fields": ["x"],
        "card_config": {"c": 1},
        "is_published": True,
        "view": "ppm_portfolio",
        "access_mode": "sso",
        "allowed_email_domains": ["x.com"],
        "created_by": "22222222-2222-2222-2222-222222222222",
        "created_at": WHEN.isoformat(),
        "updated_at": WHEN.isoformat(),
    }


def test_portal_dict_defaults_for_a_bare_row():
    out = wp._portal_to_dict(
        _portal(view=None, access_mode=None, created_by=None, created_at=None, updated_at=None)
    )
    assert out["view"] == "cards"
    assert out["access_mode"] == "public"
    assert out["created_by"] is None
    assert out["created_at"] is None and out["updated_at"] is None


# --- the module switches ------------------------------------------------------


async def _settings(db, **flags):
    db.add(AppSettings(id="default", general_settings=flags))
    await db.flush()


async def test_module_defaults_differ_ppm_off_bpm_on(db):
    assert await wp._ppm_enabled(db) is False  # no settings row at all
    assert await wp._bpm_enabled(db) is True
    await _settings(db)  # a row without the keys
    assert await wp._ppm_enabled(db) is False
    assert await wp._bpm_enabled(db) is True


async def test_module_switches_follow_the_stored_flag(db):
    await _settings(db, ppmEnabled=True, bpmEnabled=False)
    assert await wp._ppm_enabled(db) is True
    assert await wp._bpm_enabled(db) is False


# --- _validate_view -----------------------------------------------------------


async def _bad(coro, status, detail):
    with pytest.raises(HTTPException) as exc:
        await coro
    assert exc.value.status_code == status
    assert exc.value.detail == detail


async def test_view_defaults_to_cards_and_keeps_the_requested_card_type(db):
    assert await wp._validate_view(db, None, "Application") == ("cards", "Application")
    assert await wp._validate_view(db, "", None) == ("cards", None)
    assert await wp._validate_view(db, "cards", "X") == ("cards", "X")


async def test_unknown_view_is_400_with_its_repr(db):
    await _bad(wp._validate_view(db, "grid", None), 400, "Invalid view: 'grid'")


async def test_board_views_pin_the_card_type_and_need_their_module(db):
    await _settings(db, ppmEnabled=True, bpmEnabled=True)
    assert await wp._validate_view(db, "ppm_portfolio", "Application") == (
        "ppm_portfolio",
        "Initiative",
    )
    assert await wp._validate_view(db, "process_navigator", "Application") == (
        "process_navigator",
        "BusinessProcess",
    )


async def test_board_views_are_refused_when_their_module_is_off(db):
    await _settings(db, ppmEnabled=False, bpmEnabled=False)
    await _bad(
        wp._validate_view(db, "ppm_portfolio", None),
        400,
        "The PPM module is not enabled. Enable it before creating a portfolio portal.",
    )
    await _bad(
        wp._validate_view(db, "process_navigator", None),
        400,
        "The BPM module is not enabled. Enable it before creating a process portal.",
    )


async def test_each_board_needs_only_its_own_module(db):
    await _settings(db, ppmEnabled=True, bpmEnabled=False)
    assert (await wp._validate_view(db, "ppm_portfolio", None))[0] == "ppm_portfolio"
    await _bad(
        wp._validate_view(db, "process_navigator", None),
        400,
        "The BPM module is not enabled. Enable it before creating a process portal.",
    )
    await _settings_replace(db, ppmEnabled=False, bpmEnabled=True)
    assert (await wp._validate_view(db, "process_navigator", None))[0] == "process_navigator"
    await _bad(
        wp._validate_view(db, "ppm_portfolio", None),
        400,
        "The PPM module is not enabled. Enable it before creating a portfolio portal.",
    )


async def _settings_replace(db, **flags):
    from sqlalchemy import select

    row = (await db.execute(select(AppSettings).where(AppSettings.id == "default"))).scalar_one()
    row.general_settings = flags
    await db.flush()


# --- _validate_access ---------------------------------------------------------


@pytest.fixture
def sso(monkeypatch):
    state = {"enabled": True}

    async def fake(db):
        return dict(state)

    monkeypatch.setattr(wp.sso_service, "get_sso_config", fake)
    return state


async def test_public_access_never_carries_domains(db, sso):
    assert await wp._validate_access(db, None, ["a.com"]) == ("public", None)
    assert await wp._validate_access(db, "public", ["a.com"]) == ("public", None)
    assert await wp._validate_access(db, "", None) == ("public", None)


async def test_unknown_access_mode_is_400_with_its_repr(db, sso):
    await _bad(wp._validate_access(db, "open", None), 400, "Invalid access_mode: 'open'")


async def test_sso_mode_needs_org_sso(db, sso):
    sso["enabled"] = False
    await _bad(
        wp._validate_access(db, "sso", ["a.com"]),
        400,
        "SSO is not enabled. Configure single sign-on before creating an SSO-gated portal.",
    )
    sso.pop("enabled")  # a config that does not say it is enabled counts as off
    await _bad(
        wp._validate_access(db, "sso", None),
        400,
        "SSO is not enabled. Configure single sign-on before creating an SSO-gated portal.",
    )


async def test_sso_domains_are_lowercased_stripped_and_blank_ones_dropped(db, sso):
    assert await wp._validate_access(db, "sso", [" Corp.COM ", "", "   ", "b.org"]) == (
        "sso",
        ["corp.com", "b.org"],
    )
    assert await wp._validate_access(db, "sso", ["", " "]) == ("sso", None)
    assert await wp._validate_access(db, "sso", []) == ("sso", None)
    assert await wp._validate_access(db, "sso", None) == ("sso", None)


# --- small helpers ------------------------------------------------------------


def test_uuid_helpers_ignore_what_is_not_an_id():
    good = uuid.uuid4()
    assert wp._uuid_or_none(f"  {good} ") == good
    assert wp._uuid_or_none("nope") is None
    assert wp._uuids_in([str(good), "bad", "", str(good)]) == [good, good]
    assert wp._uuids_in([]) == []


def test_clip_text_only_touches_strings():
    assert wp._clip_text(5) == 5
    assert wp._clip_text(None) is None
    assert wp._clip_text(["a"]) == ["a"]
    assert wp._clip_text("short") == "short"
    clipped = wp._clip_text("x" * 5000)
    assert isinstance(clipped, str) and len(clipped) < 5000


def test_schema_field_labels_reads_sections_and_keeps_the_first_label():
    schema = [
        {"section": "A", "fields": [{"key": "k1", "label": "One"}, {"key": "k2"}]},
        {"section": "B", "fields": [{"key": "k1", "label": "Again"}, {"key": 3}, "junk"]},
        "not a section",
        {"section": "C"},
    ]
    assert wp._schema_field_labels(schema) == {"k1": "One", "k2": "k2"}
    assert wp._schema_field_labels(None) == {}
    assert wp._schema_field_labels({"fields": []}) == {}


def test_filter_tag_ids_reads_card_filters_first_then_the_legacy_key():
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    assert wp._filter_tag_ids({"card_filters": {"tagFilterIds": [str(a), "bad"]}}) == {a}
    assert wp._filter_tag_ids({"tag_ids": [str(b)]}) == {b}
    # card_filters present: the legacy key is not read
    assert wp._filter_tag_ids({"card_filters": {}, "tag_ids": [str(c)]}) == set()
    assert wp._filter_tag_ids({"tag_ids": "notalist"}, "x", None, {"tag_ids": [str(a)]}) == {a}
    assert wp._filter_tag_ids() == set()


def test_audit_label_maps_translate_known_keys_and_pass_the_rest():
    labels = wp._PortalAuditLabels(
        types={"Application": "Applications"},
        fields={"cost": "Cost"},
        relations={"rel1": "Uses"},
    )
    assert labels.type_label("Application") == "Applications"
    assert labels.type_label("Other") == "Other"
    assert labels.type_label(None) is None
    assert labels.type_label(7) == 7
    assert labels.field_labels(["cost", "zzz", 5]) == ["Cost", "zzz", 5]
    assert labels.field_labels("cost") == "cost"
    items = labels.item_labels()
    assert items["cost"] == "Cost"
    assert items["rel:rel1"] == "Uses"
    assert "rel1" not in items
    for builtin in wp.portal_visibility.BUILT_IN_TOGGLES.values():
        assert items[builtin] == builtin


# --- who may open a portal ------------------------------------------------------


async def _make_portal(db, **over):
    from app.models.web_portal import WebPortal

    base = {"name": "P", "slug": f"p-{uuid.uuid4().hex[:6]}", "card_type": "Application"}
    base.update(over)
    portal = WebPortal(**base)
    db.add(portal)
    await db.flush()
    return portal


class _Request:
    def __init__(self, cookies=None):
        self.cookies = cookies or {}


async def _portal_404(coro):
    with pytest.raises(HTTPException) as exc:
        await coro
    assert exc.value.status_code == 404
    assert exc.value.detail == "Portal not found"


async def test_only_a_published_portal_with_that_slug_loads(db):
    live = await _make_portal(db, is_published=True)
    draft = await _make_portal(db, is_published=False)
    assert (await wp._load_published_portal(live.slug, db)).id == live.id
    await _portal_404(wp._load_published_portal(draft.slug, db))
    await _portal_404(wp._load_published_portal("nope", db))


async def test_navigator_routes_need_the_view_and_the_bpm_module(db):
    nav = SimpleNamespace(view="process_navigator")
    await wp._require_navigator_portal(nav, db)  # BPM defaults to on
    for view in ("cards", "ppm_portfolio", None):
        await _portal_404(wp._require_navigator_portal(SimpleNamespace(view=view), db))
    await _settings(db, bpmEnabled=False)
    await _portal_404(wp._require_navigator_portal(nav, db))


async def test_a_public_portal_needs_no_session(db):
    portal = await _make_portal(db, is_published=True, access_mode="public")
    got = await wp.require_portal_access(portal.slug, _Request(), db)
    assert got.id == portal.id
    legacy = await _make_portal(db, is_published=True, access_mode=None)
    assert (await wp.require_portal_access(legacy.slug, _Request(), db)).id == legacy.id


async def test_an_unpublished_portal_is_404_even_with_a_session(db):
    portal = await _make_portal(db, is_published=False, access_mode="sso")
    await _portal_404(wp.require_portal_access(portal.slug, _Request(), db))


async def test_an_sso_portal_wants_a_session_for_that_very_portal(db):
    from app.core.security import create_portal_token

    portal = await _make_portal(db, is_published=True, access_mode="sso")
    other = await _make_portal(db, is_published=True, access_mode="sso")

    async def locked(request):
        with pytest.raises(HTTPException) as exc:
            await wp.require_portal_access(portal.slug, request, db)
        assert exc.value.status_code == 401
        assert exc.value.detail == "portal_locked"

    await locked(_Request())
    await locked(_Request({wp.PORTAL_COOKIE: ""}))
    await locked(_Request({wp.PORTAL_COOKIE: "garbage"}))
    foreign = create_portal_token(other.id, other.slug, "u@x.com", resource="portal")
    await locked(_Request({wp.PORTAL_COOKIE: foreign}))
    wrong_family = create_portal_token(portal.id, portal.slug, "u@x.com", resource="diagram")
    await locked(_Request({wp.PORTAL_COOKIE: wrong_family}))
    mine = create_portal_token(portal.id, portal.slug, "u@x.com", resource="portal")
    got = await wp.require_portal_access(portal.slug, _Request({wp.PORTAL_COOKIE: mine}), db)
    assert got.id == portal.id
