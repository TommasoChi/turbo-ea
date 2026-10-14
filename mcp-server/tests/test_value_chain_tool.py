"""The Value Chain is queryable from Claude like the other reports."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from turbo_ea_mcp import server


@pytest.fixture
def fake_token(monkeypatch):
    monkeypatch.setattr(server, "_stdio_token", "test-token")
    yield "test-token"


def _patched_get(payload):
    mock = AsyncMock(return_value=payload)
    return patch.object(server.TurboEAClient, "get", mock), mock


class TestGetValueChain:
    @pytest.mark.asyncio
    async def test_chain_endpoint_called_without_params(self, fake_token):
        payload = {"bands": [], "boxes": [], "core_house": None}
        patcher, mock = _patched_get(payload)
        with patcher:
            result = await server.get_value_chain()
        mock.assert_awaited_once_with("/reports/value-chain")
        assert json.loads(result) == payload

    @pytest.mark.asyncio
    async def test_drill_down_passes_related(self, fake_token):
        payload = {"roots": []}
        patcher, mock = _patched_get(payload)
        with patcher:
            result = await server.get_value_chain(category_id="abc", related="applications")
        mock.assert_awaited_once_with(
            "/reports/value-chain/abc", params={"related": "applications"}
        )
        assert json.loads(result) == payload

    @pytest.mark.asyncio
    async def test_drill_down_without_related_sends_no_params(self, fake_token):
        patcher, mock = _patched_get({"roots": []})
        with patcher:
            await server.get_value_chain(category_id="abc")
        mock.assert_awaited_once_with("/reports/value-chain/abc", params={})

    @pytest.mark.asyncio
    async def test_related_without_category_id_is_an_error_and_no_call(self, fake_token):
        patcher, mock = _patched_get({})
        with patcher:
            result = await server.get_value_chain(related="applications")
        assert result == "Error: 'related' needs a category_id."
        mock.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_unauthenticated(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        patcher, mock = _patched_get({})
        with patcher:
            result = await server.get_value_chain()
        assert result == "Error: Not authenticated. Please reconnect."
        mock.assert_not_awaited()

    def test_is_read_only(self):
        tool = server.mcp._tool_manager._tools["get_value_chain"]
        assert tool.annotations.readOnlyHint is True
