"""Unit tests for the "mcp" capability's manifest validation (no DB)."""

from __future__ import annotations

import pytest

from app.services.extensions.bundle import BundleError, read_bundle
from tests.teax_helpers import build_manifest, build_teax, make_keypair, trust_test_key

CORE_VERSION = "1.69.0"

VALID_READ_TOOL = {
    "name": "ext_sample-ext_get_thing",
    "description": "Return a thing.",
    "method": "GET",
    "path": "thing/{thing_id}",
    "input_schema": {
        "type": "object",
        "properties": {"thing_id": {"type": "string", "format": "uuid"}},
        "required": ["thing_id"],
    },
    "annotations": {"readOnlyHint": True},
    "required_permission": "ext.sample-ext.view",
}

VALID_WRITE_TOOL = {
    "name": "ext_sample-ext_apply_thing",
    "description": "Apply a change to a thing.",
    "method": "POST",
    "path": "thing/{thing_id}/apply",
    "input_schema": {
        "type": "object",
        "properties": {
            "thing_id": {"type": "string", "format": "uuid"},
            "dry_run": {"type": "boolean", "default": True},
        },
        "required": ["thing_id"],
    },
    "annotations": {"destructiveHint": True},
    "required_permission": "ext.sample-ext.manage",
    "dry_run_supported": True,
}


@pytest.fixture
def keypair(monkeypatch):
    private, public_b64 = make_keypair()
    trust_test_key(monkeypatch, public_b64)
    return private


def _bundle_with_mcp(keypair, *, tools, sdk_version="1.0", extra_manifest=None):
    manifest = build_manifest(
        key="sample-ext",
        capabilities=["mcp"],
        mcp_sdk_version=sdk_version,
        mcp_tools=tools,
        **(extra_manifest or {}),
    )
    return build_teax(keypair, manifest=manifest)


class TestMcpCapabilityValidation:
    def test_valid_read_and_write_tools_accepted(self, tmp_path, keypair):
        raw = _bundle_with_mcp(keypair, tools=[VALID_READ_TOOL, VALID_WRITE_TOOL])
        path = tmp_path / "bundle.teax"
        path.write_bytes(raw)
        bundle = read_bundle(path, core_version=CORE_VERSION)
        assert bundle.capabilities == ["mcp"]
        assert bundle.manifest["mcp_tools"][0]["name"] == "ext_sample-ext_get_thing"

    def test_missing_mcp_sdk_version_rejected(self, tmp_path, keypair):
        manifest = build_manifest(
            key="sample-ext", capabilities=["mcp"], mcp_tools=[VALID_READ_TOOL]
        )
        raw = build_teax(keypair, manifest=manifest)
        path = tmp_path / "bundle.teax"
        path.write_bytes(raw)
        with pytest.raises(BundleError, match="mcp_sdk_version"):
            read_bundle(path, core_version=CORE_VERSION)

    def test_empty_mcp_tools_rejected(self, tmp_path, keypair):
        raw = _bundle_with_mcp(keypair, tools=[])
        path = tmp_path / "bundle.teax"
        path.write_bytes(raw)
        with pytest.raises(BundleError, match="mcp_tools"):
            read_bundle(path, core_version=CORE_VERSION)

    def test_tool_name_not_namespaced_to_key_rejected(self, tmp_path, keypair):
        bad_tool = {**VALID_READ_TOOL, "name": "get_thing"}
        raw = _bundle_with_mcp(keypair, tools=[bad_tool])
        path = tmp_path / "bundle.teax"
        path.write_bytes(raw)
        with pytest.raises(BundleError, match="name"):
            read_bundle(path, core_version=CORE_VERSION)

    def test_duplicate_tool_name_rejected(self, tmp_path, keypair):
        raw = _bundle_with_mcp(keypair, tools=[VALID_READ_TOOL, dict(VALID_READ_TOOL)])
        path = tmp_path / "bundle.teax"
        path.write_bytes(raw)
        with pytest.raises(BundleError, match="declared more than once"):
            read_bundle(path, core_version=CORE_VERSION)

    def test_write_tool_without_dry_run_supported_rejected(self, tmp_path, keypair):
        bad_tool = {k: v for k, v in VALID_WRITE_TOOL.items() if k != "dry_run_supported"}
        raw = _bundle_with_mcp(keypair, tools=[bad_tool])
        path = tmp_path / "bundle.teax"
        path.write_bytes(raw)
        with pytest.raises(BundleError, match="dry_run_supported"):
            read_bundle(path, core_version=CORE_VERSION)

    def test_unknown_annotation_key_rejected(self, tmp_path, keypair):
        bad_tool = {**VALID_READ_TOOL, "annotations": {"readOnlyHint": True, "bogusHint": True}}
        raw = _bundle_with_mcp(keypair, tools=[bad_tool])
        path = tmp_path / "bundle.teax"
        path.write_bytes(raw)
        with pytest.raises(BundleError, match="annotations"):
            read_bundle(path, core_version=CORE_VERSION)

    def test_path_with_dotdot_rejected(self, tmp_path, keypair):
        bad_tool = {**VALID_READ_TOOL, "path": "../escape"}
        raw = _bundle_with_mcp(keypair, tools=[bad_tool])
        path = tmp_path / "bundle.teax"
        path.write_bytes(raw)
        with pytest.raises(BundleError, match="path"):
            read_bundle(path, core_version=CORE_VERSION)

    def test_mcp_tools_without_mcp_capability_rejected(self, tmp_path, keypair):
        content_bytes = b'{"CardTypes": []}'
        manifest = build_manifest(
            key="sample-ext",
            capabilities=["content"],
            files={"content/pack.json": content_bytes},
            mcp_tools=[VALID_READ_TOOL],
            mcp_sdk_version="1.0",
        )
        raw = build_teax(keypair, manifest=manifest, files={"content/pack.json": content_bytes})
        path = tmp_path / "bundle.teax"
        path.write_bytes(raw)
        with pytest.raises(BundleError, match="mcp capability"):
            read_bundle(path, core_version=CORE_VERSION)
