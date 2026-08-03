"""Unit tests for teax.py's "mcp" capability lint validation.

teax.py is a standalone script (scripts/extension-tools/teax.py), not an
installed package — loaded via importlib so this test can import it
directly without needing it on sys.path permanently.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

_TEAX_PATH = Path(__file__).resolve().parent.parent / "teax.py"
_spec = importlib.util.spec_from_file_location("teax", _TEAX_PATH)
teax = importlib.util.module_from_spec(_spec)
sys.modules["teax"] = teax
_spec.loader.exec_module(teax)

VALID_READ_TOOL = {
    "name": "ext_sample_get_thing",
    "description": "Return a thing.",
    "method": "GET",
    "path": "thing/{thing_id}",
    "input_schema": {
        "type": "object",
        "properties": {"thing_id": {"type": "string", "format": "uuid"}},
        "required": ["thing_id"],
    },
    "annotations": {"readOnlyHint": True},
    "required_permission": "ext.sample.view",
}


def _write_source_dir(tmp_path: Path, manifest: dict) -> Path:
    src = tmp_path / "ext-src"
    src.mkdir()
    (src / "extension.json").write_text(json.dumps(manifest), encoding="utf-8")
    return src


def _base_manifest(**extra) -> dict:
    manifest = {
        "key": "sample",
        "name": "Sample",
        "version": "1.0.0",
        "core": {"min": "0.0.1"},
        "capabilities": ["mcp"],
    }
    manifest.update(extra)
    return manifest


class TestTeaxMcpLint:
    def test_valid_mcp_manifest_lints_clean(self, tmp_path):
        manifest = _base_manifest(mcp_sdk_version="1.0", mcp_tools=[VALID_READ_TOOL])
        src = _write_source_dir(tmp_path, manifest)
        _, _, problems, _ = teax._lint_source(src)
        assert problems == []

    def test_missing_mcp_sdk_version_flagged(self, tmp_path):
        manifest = _base_manifest(mcp_tools=[VALID_READ_TOOL])
        src = _write_source_dir(tmp_path, manifest)
        _, _, problems, _ = teax._lint_source(src)
        assert any("mcp_sdk_version" in p for p in problems)

    def test_empty_mcp_tools_flagged(self, tmp_path):
        manifest = _base_manifest(mcp_sdk_version="1.0", mcp_tools=[])
        src = _write_source_dir(tmp_path, manifest)
        _, _, problems, _ = teax._lint_source(src)
        assert any("mcp_tools" in p for p in problems)

    def test_bad_name_prefix_flagged(self, tmp_path):
        bad_tool = {**VALID_READ_TOOL, "name": "get_thing"}
        manifest = _base_manifest(mcp_sdk_version="1.0", mcp_tools=[bad_tool])
        src = _write_source_dir(tmp_path, manifest)
        _, _, problems, _ = teax._lint_source(src)
        assert any("name" in p for p in problems)

    def test_write_tool_missing_dry_run_supported_flagged(self, tmp_path):
        write_tool = {
            **VALID_READ_TOOL,
            "name": "ext_sample_apply_thing",
            "method": "POST",
            "annotations": {"destructiveHint": True},
        }
        manifest = _base_manifest(mcp_sdk_version="1.0", mcp_tools=[write_tool])
        src = _write_source_dir(tmp_path, manifest)
        _, _, problems, _ = teax._lint_source(src)
        assert any("dry_run_supported" in p for p in problems)

    def test_mcp_tools_without_capability_flagged(self, tmp_path):
        manifest = _base_manifest(capabilities=["content"], content=[])
        manifest["mcp_tools"] = [VALID_READ_TOOL]
        manifest["mcp_sdk_version"] = "1.0"
        src = _write_source_dir(tmp_path, manifest)
        _, _, problems, _ = teax._lint_source(src)
        assert any("mcp capability" in p for p in problems)
