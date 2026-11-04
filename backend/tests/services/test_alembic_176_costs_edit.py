"""Migration 176 adds costs.edit=false only; costs.view defaults stay as they were."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from app.core.permissions import (
    BPM_ADMIN_PERMISSIONS,
    MEMBER_PERMISSIONS,
    VIEWER_PERMISSIONS,
)

_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "176_costs_edit_permission.py"
)
_spec = importlib.util.spec_from_file_location("mig176", _PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def test_adds_costs_edit_false_and_leaves_costs_view_untouched():
    for view in (True, False):
        out = mig.plan_patch({"costs.view": view, "inventory.view": True})
        assert out == {"costs.view": view, "inventory.view": True, "costs.edit": False}


def test_noop_for_wildcard_existing_key_and_bad_input():
    assert mig.plan_patch({"*": True}) is None
    assert mig.plan_patch({"costs.edit": True}) is None
    assert mig.plan_patch(None) is None


def test_costs_view_defaults_unchanged_and_costs_edit_false_for_every_builtin_role():
    assert BPM_ADMIN_PERMISSIONS["costs.view"] is True
    assert MEMBER_PERMISSIONS["costs.view"] is True
    assert VIEWER_PERMISSIONS["costs.view"] is False
    for perms in (BPM_ADMIN_PERMISSIONS, MEMBER_PERMISSIONS, VIEWER_PERMISSIONS):
        assert perms["costs.edit"] is False
