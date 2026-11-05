"""Migration 177: license role grants (defaults first, then the extension's true grants)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from app.core.permissions import (
    BPM_ADMIN_PERMISSIONS,
    MEMBER_PERMISSIONS,
    VIEWER_PERMISSIONS,
)

_PATH = Path(__file__).resolve().parents[2] / "alembic" / "versions" / "177_card_licenses.py"
_spec = importlib.util.spec_from_file_location("mig177", _PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)


def test_defaults_added_for_builtin_roles():
    assert mig.plan_defaults("member", {"costs.view": True}) == {
        "costs.view": True,
        "licenses.view": True,
        "licenses.edit": False,
    }
    assert mig.plan_defaults("bpm_admin", {}) == {"licenses.view": True, "licenses.edit": False}
    assert mig.plan_defaults("viewer", {}) == {"licenses.view": False, "licenses.edit": False}


def test_defaults_skip_wildcard_custom_and_present_keys():
    assert mig.plan_defaults("admin", {"*": True}) is None
    assert mig.plan_defaults("auditor", {"inventory.view": True}) is None
    assert mig.plan_defaults("member", {"licenses.view": False, "licenses.edit": True}) is None


def test_copy_only_true_extension_grants_after_defaults():
    assert mig.plan_copy({"ext.licensing.view": True, "licenses.view": False}) == {
        "ext.licensing.view": True,
        "licenses.view": True,
    }
    assert (
        mig.plan_copy({"ext.licensing.manage": True, "licenses.edit": False})["licenses.edit"]
        is True
    )
    assert mig.plan_copy({"ext.licensing.view": False, "licenses.view": True}) is None
    assert mig.plan_copy({"*": True, "ext.licensing.view": True}) is None


def test_code_defaults_match_the_migration():
    assert MEMBER_PERMISSIONS["licenses.view"] is True
    assert BPM_ADMIN_PERMISSIONS["licenses.view"] is True
    assert VIEWER_PERMISSIONS["licenses.view"] is False
    for p in (MEMBER_PERMISSIONS, BPM_ADMIN_PERMISSIONS, VIEWER_PERMISSIONS):
        assert p["licenses.edit"] is False
