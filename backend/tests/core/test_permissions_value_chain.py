"""The Value Chain is a read-only view of BPM data, so its permission lives
in the bpm group — one key, no write counterpart, no new top-level group."""

from __future__ import annotations

from app.core.permissions import (
    ALL_APP_PERMISSION_KEYS,
    APP_PERMISSIONS,
    APP_TO_CARD_PERMISSION_MAP,
    BPM_ADMIN_PERMISSIONS,
    MEMBER_PERMISSIONS,
    VIEWER_PERMISSIONS,
)

KEY = "bpm.value_chain"


def test_key_lives_in_the_bpm_group():
    assert KEY in APP_PERMISSIONS["bpm"]["permissions"]


def test_no_new_top_level_group_was_added():
    assert "value_chain" not in APP_PERMISSIONS
    assert "valuechain" not in APP_PERMISSIONS


def test_key_is_registered_for_validation():
    assert KEY in ALL_APP_PERMISSION_KEYS


def test_every_seeded_non_admin_role_can_view():
    for role in (BPM_ADMIN_PERMISSIONS, MEMBER_PERMISSIONS, VIEWER_PERMISSIONS):
        assert role[KEY] is True


def test_it_is_the_only_value_chain_key():
    assert [k for k in ALL_APP_PERMISSION_KEYS if "value_chain" in k] == [KEY]


def test_read_only_permission_has_no_card_level_counterpart():
    # bpm.edit maps to card.bpm_edit because it is a write authority; a view
    # key must not acquire one, or it would start gating per-card writes.
    assert KEY not in APP_TO_CARD_PERMISSION_MAP
