"""Guard the extension SDK surface (the semver'd contract).

Backend extensions may import ONLY from ``app.services.extensions.sdk``
(AST-enforced in the vendor repo's CI), so anything an extension route
needs must be re-exported here. These tests pin the SDK 1.1 route
dependencies to the exact core objects — a rename or removal in core
must consciously update the SDK (and its version), never silently break
installed extensions.
"""

from __future__ import annotations

from app.api import deps as core_deps
from app.database import get_db as core_get_db
from app.services.extensions import sdk


def test_sdk_version_is_1_4():
    assert sdk.SDK_VERSION == "1.4"


def test_sdk_reexports_route_dependencies_verbatim():
    # SDK 1.1 — extension route handlers authenticate, check permissions,
    # and open DB sessions exclusively through these re-exports.
    assert sdk.get_current_user is core_deps.get_current_user
    assert sdk.require_permission is core_deps.require_permission
    assert sdk.get_db is core_get_db


def test_sdk_compatibility_requires_supported_major_and_minor():
    # Older additive minors keep loading, but an extension requiring a
    # capability introduced after this core must fail closed.
    assert sdk.sdk_compatible("1.0")
    assert sdk.sdk_compatible("1.1")
    assert sdk.sdk_compatible("1.2")
    assert sdk.sdk_compatible("1.3")
    assert sdk.sdk_compatible("1.4")
    assert not sdk.sdk_compatible("1.5")
    assert not sdk.sdk_compatible("2.0")
    assert not sdk.sdk_compatible("1")
    assert not sdk.sdk_compatible("1.x")


def test_sdk_1_3_exposes_read_only_stakeholder_role_predicate():
    assert callable(getattr(sdk.CoreQueryGateway, "has_stakeholder_role", None))


def test_sdk_1_4_exposes_read_only_audit_and_request_permission_queries():
    assert callable(getattr(sdk.AuditGateway, "list", None))
    assert callable(getattr(sdk.PermissionGateway, "has", None))
    assert "permissions" in sdk.ExtensionRequestContext.__dataclass_fields__
