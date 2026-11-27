from app.core.permissions import (
    ALL_CARD_PERMISSION_KEYS,
    APP_TO_CARD_PERMISSION_MAP,
    BPM_ADMIN_PERMISSIONS,
    COST_CONTROLLER_CARD_PERMISSIONS,
    DEFAULT_CARD_PERMISSIONS_BY_ROLE,
    MEMBER_PERMISSIONS,
    PPM_MANAGER_APP_PERMISSIONS,
    VIEWER_PERMISSIONS,
    with_legacy_edit_cost_grant,
)


def test_card_permission_registry_has_edit_costs():
    assert "card.edit_costs" in ALL_CARD_PERMISSION_KEYS
    assert APP_TO_CARD_PERMISSION_MAP["costs.edit"] == "card.edit_costs"


def test_every_default_role_map_carries_edit_costs_equal_to_card_edit():
    for key, perms in DEFAULT_CARD_PERMISSIONS_BY_ROLE.items():
        if key == "costController":
            continue
        assert perms["card.edit_costs"] == perms["card.edit"], key


def test_cost_controller_card_permissions():
    granted = {"card.view", "card.view_costs", "card.edit_costs", "card.create_comments"}
    assert set(COST_CONTROLLER_CARD_PERMISSIONS) == ALL_CARD_PERMISSION_KEYS
    assert {k for k, v in COST_CONTROLLER_CARD_PERMISSIONS.items() if v} == granted
    assert DEFAULT_CARD_PERMISSIONS_BY_ROLE["costController"] is COST_CONTROLLER_CARD_PERMISSIONS


def test_ppm_manager_app_role():
    on = {"ppm.view", "ppm.manage", "inventory.view"}
    off = {"inventory.edit", "costs.view", "costs.edit"}
    for k in on:
        assert PPM_MANAGER_APP_PERMISSIONS[k] is True, k
    for k in off:
        assert PPM_MANAGER_APP_PERMISSIONS[k] is False, k
    for k, v in VIEWER_PERMISSIONS.items():
        if k not in on | off:
            assert PPM_MANAGER_APP_PERMISSIONS[k] == v, k


def test_member_and_bpm_admin_have_no_ppm_manage_or_costs():
    for perms in (MEMBER_PERMISSIONS, BPM_ADMIN_PERMISSIONS):
        assert perms["ppm.manage"] is False
        assert perms["costs.view"] is False
        assert perms["costs.edit"] is False
        assert perms["ppm.view"] is True


def test_with_legacy_edit_cost_grant():
    assert with_legacy_edit_cost_grant("x", {"card.edit": True})["card.edit_costs"] is True
    assert with_legacy_edit_cost_grant("x", {"card.edit": False})["card.edit_costs"] is False
    assert with_legacy_edit_cost_grant("x", {})["card.edit_costs"] is False
    kept = {"card.edit": True, "card.edit_costs": False}
    assert with_legacy_edit_cost_grant("x", kept) == kept
    assert with_legacy_edit_cost_grant("x", [1]) == [1]
