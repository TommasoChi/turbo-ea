"""End-to-end check that extension-declared MCP tools are actually wired
into the real server.py FastMCP instance at import time."""

from __future__ import annotations

import importlib
import sys
from unittest.mock import patch

import httpx


MANIFEST = {
    "key": "sample",
    "version": "1.0.0",
    "mcp_sdk_version": "1.0",
    "mcp_tools": [
        {
            "name": "ext_sample_get_thing",
            "description": "Return a thing.",
            "method": "GET",
            "path": "thing/{thing_id}",
            "input_schema": {
                "type": "object",
                "properties": {"thing_id": {"type": "string"}},
                "required": ["thing_id"],
            },
            "annotations": {"readOnlyHint": True},
            "required_permission": "ext.sample.view",
        }
    ],
}


def test_extension_tool_registered_on_real_server_module():
    """Reload server.py with discovery mocked, then assert the extension's
    tool shows up alongside the static core tools on the same
    module-level `mcp` FastMCP instance the ASGI app serves."""
    response = httpx.Response(
        200, json=[MANIFEST], request=httpx.Request("GET", "http://test/x")
    )
    # The re-import must be undone before the next test file runs. Every module
    # left here is a SECOND copy of the package: a sibling file that imported
    # `api_client` at collection time then patches a class the freshly imported
    # `oauth` does not use, so its mock is bypassed and the call goes to the
    # real backend ("All connection attempts failed", and two model classes
    # that no longer compare equal).
    saved = {n: m for n, m in sys.modules.items() if n.startswith("turbo_ea_mcp")}
    try:
        with patch("httpx.get", return_value=response):
            for name in saved:
                del sys.modules[name]
            server = importlib.import_module("turbo_ea_mcp.server")

        tool_names = {t.name for t in server.mcp._tool_manager.list_tools()}
        assert "ext_sample_get_thing" in tool_names
        # Sanity check the static core tools are still there too — this
        # registration must be additive, never a replacement.
        assert "search_cards" in tool_names
    finally:
        for name in [n for n in sys.modules if n.startswith("turbo_ea_mcp")]:
            del sys.modules[name]
        sys.modules.update(saved)
