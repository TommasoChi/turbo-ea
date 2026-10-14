"""Migration 154 grants bpm.value_chain to existing roles and retires the
extension's own permission key in the same sweep."""

from __future__ import annotations

import importlib.util
from pathlib import Path

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "154_add_value_chain_permission.py"
)
_spec = importlib.util.spec_from_file_location("mig154", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)

plan = mig.plan_role_permissions


def test_grants_to_a_role_that_can_already_see_bpm():
    assert plan({"bpm.view": True})["bpm.value_chain"] is True


def test_carries_over_the_extension_grant():
    planned = plan({"ext.value-chain.view": True})
    assert planned["bpm.value_chain"] is True
    assert "ext.value-chain.view" not in planned


def test_does_not_grant_to_a_role_without_bpm_access():
    # Least privilege: a custom role that never saw BPM data must not gain the
    # Value Chain just because the key was introduced.
    assert "bpm.value_chain" not in plan({"inventory.view": True})


def test_an_explicit_false_on_bpm_view_is_not_a_grant():
    assert "bpm.value_chain" not in plan({"bpm.view": False})


def test_drops_the_extension_permission_even_when_it_was_false():
    planned = plan({"ext.value-chain.view": False, "bpm.view": True})
    assert "ext.value-chain.view" not in planned
    assert planned["bpm.value_chain"] is True


def test_wildcard_role_is_left_alone():
    assert plan({"*": True}) == {"*": True}


def test_an_existing_explicit_denial_is_kept():
    assert plan({"bpm.view": True, "bpm.value_chain": False})["bpm.value_chain"] is False


def test_is_idempotent():
    once = plan({"bpm.view": True})
    assert plan(once) == once


def test_does_not_touch_unrelated_grants():
    planned = plan({"bpm.view": True, "inventory.view": True})
    assert planned["inventory.view"] is True
    assert planned["bpm.view"] is True
