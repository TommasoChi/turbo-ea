"""``_user_wants_notification`` and ``_absolute_link`` pinned branch by branch: which channel a
type may use, what an unset preference falls back to, and how a relative link becomes absolute."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.config import settings
from app.models.user import DEFAULT_NOTIFICATION_PREFERENCES
from app.services import notification_service as ns


def _user(prefs="default"):
    if prefs == "default":
        prefs = DEFAULT_NOTIFICATION_PREFERENCES
    return SimpleNamespace(notification_preferences=prefs)


def wants(user, notif_type, channel):
    return ns._user_wants_notification(user, notif_type, channel)


# --- in-app only types ----------------------------------------------------------


def test_an_in_app_only_type_reaches_no_channel_but_the_bell():
    assert "app_updated" in ns.IN_APP_ONLY_TYPES
    on = _user({"in_app": {"app_updated": True}, "email": {"app_updated": True}})
    assert wants(on, "app_updated", "in_app") is True
    assert wants(on, "app_updated", "email") is False
    assert wants(on, "app_updated", "slack") is False
    off = _user({"in_app": {"app_updated": False}})
    assert wants(off, "app_updated", "in_app") is False


# --- a type the user cannot configure -----------------------------------------


def test_a_non_configurable_type_only_ever_shows_in_the_bell():
    assert wants(_user(), "ops_rescue_access", "email") is False
    assert (
        wants(_user({"email": {"ops_rescue_access": True}}), "ops_rescue_access", "email") is False
    )
    assert (
        wants(
            _user({"channels": {"slack": {"ops_rescue_access": True}}}),
            "ops_rescue_access",
            "slack",
        )
        is False
    )
    assert wants(_user(), "ops_rescue_access", "in_app") is True


# --- email-locked types -----------------------------------------------------------


def test_an_email_locked_type_is_always_emailed_whatever_the_user_stored():
    off = _user({"email": {"survey_request": False}, "in_app": {"survey_request": False}})
    assert wants(off, "survey_request", "email") is True
    assert wants(off, "survey_request", "in_app") is False  # the bell stays switchable


# --- stored preference wins, else the type's own default -------------------------


def test_stored_value_wins_on_both_built_in_channels():
    prefs = {"in_app": {"card_updated": False}, "email": {"card_updated": True}}
    assert wants(_user(prefs), "card_updated", "in_app") is False
    assert wants(_user(prefs), "card_updated", "email") is True
    flipped = {"in_app": {"card_updated": True}, "email": {"card_updated": False}}
    assert wants(_user(flipped), "card_updated", "in_app") is True
    assert wants(_user(flipped), "card_updated", "email") is False


def test_an_unset_type_falls_back_to_its_spec_per_channel():
    empty = _user({})
    assert wants(empty, "card_updated", "in_app") is True  # in_app_default
    assert wants(empty, "card_updated", "email") is False  # email_default
    assert wants(empty, "todo_assigned", "email") is True  # email_default=True
    assert wants(_user({"in_app": {}, "email": {}}), "todo_assigned", "email") is True


def test_a_user_without_stored_preferences_gets_the_defaults():
    assert wants(_user(None), "todo_assigned", "email") is True
    assert wants(_user(None), "card_updated", "email") is False
    assert wants(_user(None), "card_updated", "in_app") is True
    assert wants(_user({}), "todo_assigned", "in_app") is True


def test_an_unknown_type_is_bell_on_and_nothing_else():
    empty = _user({})
    assert wants(empty, "made_up_type", "in_app") is True
    assert wants(empty, "made_up_type", "email") is False
    assert wants(_user({"email": {"made_up_type": True}}), "made_up_type", "email") is True
    assert wants(_user({"in_app": {"made_up_type": False}}), "made_up_type", "in_app") is False


def test_extension_channels_are_off_unless_the_user_switched_them_on():
    assert wants(_user({}), "card_updated", "slack") is False
    assert wants(_user(None), "card_updated", "slack") is False
    on = _user({"channels": {"slack": {"card_updated": True}}})
    assert wants(on, "card_updated", "slack") is True
    assert wants(on, "comment_added", "slack") is False  # another type stays off
    assert wants(on, "card_updated", "teams") is False  # another channel stays off
    assert wants(_user({"channels": None}), "card_updated", "slack") is False
    assert wants(_user({"channels": {"slack": None}}), "card_updated", "slack") is False


def test_an_email_value_of_none_for_the_channel_reads_as_unset():
    assert wants(_user({"email": None}), "todo_assigned", "email") is True
    assert wants(_user({"in_app": None}), "card_updated", "in_app") is True


# --- _absolute_link -----------------------------------------------------------


@pytest.fixture
def base(monkeypatch):
    monkeypatch.setattr(settings, "_app_base_url", "https://ea.corp", raising=False)


def test_no_link_is_none():
    assert ns._absolute_link(None) is None
    assert ns._absolute_link("") is None


def test_absolute_links_pass_through_untouched(base):
    assert ns._absolute_link("https://other.example/x") == "https://other.example/x"
    assert ns._absolute_link("http://other.example/x") == "http://other.example/x"


def test_a_relative_link_is_joined_to_the_instance_url(base):
    assert ns._absolute_link("/cards/1") == "https://ea.corp/cards/1"
    # only a real scheme counts as absolute
    assert ns._absolute_link("httpx://nope") == "https://ea.corphttpx://nope"
    assert ns._absolute_link("ftp://nope") == "https://ea.corpftp://nope"


def test_without_a_configured_base_url_it_falls_back_to_localhost(monkeypatch):
    monkeypatch.setattr(settings, "_app_base_url", "", raising=False)
    assert ns._absolute_link("/cards/1") == "http://localhost:8920/cards/1"
    monkeypatch.delattr(settings, "_app_base_url", raising=False)
    assert ns._absolute_link("/cards/1") == "http://localhost:8920/cards/1"
