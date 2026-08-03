"""Unit tests for dynamic MCP tool registration from extension manifests."""

from __future__ import annotations

import inspect
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from mcp.server.fastmcp import FastMCP

from turbo_ea_mcp import mcp_extensions

READ_TOOL = {
    "name": "ext_sample_get_thing",
    "description": "Return a thing.",
    "method": "GET",
    "path": "thing/{thing_id}",
    "input_schema": {
        "type": "object",
        "properties": {
            "thing_id": {"type": "string"},
            "include_descendants": {"type": "boolean", "default": True},
        },
        "required": ["thing_id"],
    },
    "annotations": {"readOnlyHint": True},
    "required_permission": "ext.sample.view",
}

WRITE_TOOL = {
    "name": "ext_sample_apply_thing",
    "description": "Apply a change.",
    "method": "POST",
    "path": "thing/{thing_id}/apply",
    "input_schema": {
        "type": "object",
        "properties": {
            "thing_id": {"type": "string"},
            "dry_run": {"type": "boolean", "default": True},
        },
        "required": ["thing_id"],
    },
    "annotations": {"destructiveHint": True},
    "required_permission": "ext.sample.manage",
    "dry_run_supported": True,
}

MANIFEST = {
    "key": "sample",
    "version": "1.0.0",
    "mcp_sdk_version": "1.0",
    "mcp_tools": [READ_TOOL, WRITE_TOOL],
}


class TestFetchExtensionMcpManifests:
    def test_returns_parsed_json_on_success(self):
        response = httpx.Response(
            200, json=[MANIFEST], request=httpx.Request("GET", "http://test/x")
        )
        with patch("httpx.get", return_value=response) as mock_get:
            result = mcp_extensions.fetch_extension_mcp_manifests()
        assert result == [MANIFEST]
        assert mock_get.call_args.kwargs["timeout"] == mcp_extensions._DISCOVERY_TIMEOUT_SECONDS

    def test_connection_error_returns_empty_list(self):
        with patch("httpx.get", side_effect=httpx.ConnectError("refused")):
            result = mcp_extensions.fetch_extension_mcp_manifests()
        assert result == []

    def test_non_list_payload_returns_empty_list(self):
        response = httpx.Response(200, json={"not": "a list"})
        with patch("httpx.get", return_value=response):
            result = mcp_extensions.fetch_extension_mcp_manifests()
        assert result == []


class TestBuildSignature:
    def test_required_before_optional_with_correct_types(self):
        sig = mcp_extensions._build_signature(READ_TOOL["input_schema"])
        names = list(sig.parameters)
        assert names == ["thing_id", "include_descendants"]
        assert sig.parameters["thing_id"].annotation is str
        assert sig.parameters["thing_id"].default is inspect.Parameter.empty
        assert sig.parameters["include_descendants"].annotation is bool
        assert sig.parameters["include_descendants"].default is True


class TestRegisterExtensionTools:
    @pytest.fixture(autouse=True)
    def _fake_discovery(self):
        with patch.object(
            mcp_extensions, "fetch_extension_mcp_manifests", return_value=[MANIFEST]
        ):
            yield

    def test_registers_every_valid_tool(self):
        mcp = FastMCP("test")
        count = mcp_extensions.register_extension_tools(
            mcp, get_token=AsyncMock(return_value="tok"), is_writes_disabled=lambda: None
        )
        assert count == 2
        tool_names = {t.name for t in mcp._tool_manager.list_tools()}
        assert {"ext_sample_get_thing", "ext_sample_apply_thing"} <= tool_names

    def test_malformed_tool_is_skipped_not_fatal(self):
        bad_manifest = {
            "key": "sample",
            "mcp_tools": [{"name": "ext_sample_broken"}],  # missing required fields
        }
        with patch.object(
            mcp_extensions, "fetch_extension_mcp_manifests", return_value=[bad_manifest]
        ):
            mcp = FastMCP("test")
            count = mcp_extensions.register_extension_tools(
                mcp, get_token=AsyncMock(return_value="tok"), is_writes_disabled=lambda: None
            )
        assert count == 0

    @pytest.mark.asyncio
    async def test_read_tool_forwards_get_with_resolved_path_and_defaults(self):
        mcp = FastMCP("test")
        mcp_extensions.register_extension_tools(
            mcp, get_token=AsyncMock(return_value="tok"), is_writes_disabled=lambda: None
        )
        tool = mcp._tool_manager.get_tool("ext_sample_get_thing")
        with patch.object(
            mcp_extensions.TurboEAClient, "get", AsyncMock(return_value={"ok": True})
        ) as mock_get:
            result = await tool.fn(thing_id="abc-123")
        mock_get.assert_awaited_once()
        called_path = mock_get.call_args.args[0]
        called_params = mock_get.call_args.args[1]
        assert called_path == "/ext/sample/thing/abc-123"
        assert "thing_id" not in called_params
        assert result == '{\n  "ok": true\n}'

    @pytest.mark.asyncio
    async def test_write_tool_forces_dry_run_true_by_default(self):
        mcp = FastMCP("test")
        mcp_extensions.register_extension_tools(
            mcp, get_token=AsyncMock(return_value="tok"), is_writes_disabled=lambda: None
        )
        tool = mcp._tool_manager.get_tool("ext_sample_apply_thing")
        with patch.object(
            mcp_extensions.TurboEAClient, "post", AsyncMock(return_value={"ok": True})
        ) as mock_post:
            await tool.fn(thing_id="abc-123")
        called_path, called_json = mock_post.call_args.args[0], mock_post.call_args.kwargs.get(
            "json"
        )
        assert called_path == "/ext/sample/thing/abc-123/apply"
        assert called_json["dry_run"] is True

    @pytest.mark.asyncio
    async def test_write_tool_respects_writes_disabled(self):
        mcp = FastMCP("test")
        mcp_extensions.register_extension_tools(
            mcp,
            get_token=AsyncMock(return_value="tok"),
            is_writes_disabled=lambda: "Error: writes disabled",
        )
        tool = mcp._tool_manager.get_tool("ext_sample_apply_thing")
        with patch.object(mcp_extensions.TurboEAClient, "post", AsyncMock()) as mock_post:
            result = await tool.fn(thing_id="abc-123")
        mock_post.assert_not_awaited()
        assert result == "Error: writes disabled"

    @pytest.mark.asyncio
    async def test_read_tool_ignores_writes_disabled(self):
        mcp = FastMCP("test")
        mcp_extensions.register_extension_tools(
            mcp,
            get_token=AsyncMock(return_value="tok"),
            is_writes_disabled=lambda: "Error: writes disabled",
        )
        tool = mcp._tool_manager.get_tool("ext_sample_get_thing")
        with patch.object(
            mcp_extensions.TurboEAClient, "get", AsyncMock(return_value={"ok": True})
        ) as mock_get:
            result = await tool.fn(thing_id="abc-123")
        mock_get.assert_awaited_once()
        assert result != "Error: writes disabled"

    @pytest.mark.asyncio
    async def test_no_token_returns_not_authenticated_error(self):
        mcp = FastMCP("test")
        mcp_extensions.register_extension_tools(
            mcp, get_token=AsyncMock(return_value=None), is_writes_disabled=lambda: None
        )
        tool = mcp._tool_manager.get_tool("ext_sample_get_thing")
        result = await tool.fn(thing_id="abc-123")
        assert "Not authenticated" in result
