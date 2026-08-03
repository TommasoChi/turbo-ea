"""Dynamic MCP tool registration for extensions declaring the "mcp" capability.

Resolved ONCE at process startup by fetching the public, unauthenticated
``GET /extensions/mcp-manifest``. Every registered tool is a thin HTTP
forward to the extension's own ``/api/v1/ext/{key}/...`` REST route, built
entirely from the manifest's declarative ``mcp_tools`` array — no
extension code is ever imported or executed in this process.
"""

from __future__ import annotations

import inspect
import json as _json
import logging
import re
from typing import Any, Awaitable, Callable

import httpx
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from turbo_ea_mcp.api_client import TurboEAClient
from turbo_ea_mcp.config import TURBO_EA_URL

logger = logging.getLogger("turbo_ea_mcp.extensions")

_DISCOVERY_TIMEOUT_SECONDS = 5.0

_JSON_TYPE_TO_PYTHON: dict[str, type] = {
    "string": str,
    "boolean": bool,
    "integer": int,
    "number": float,
    "object": dict,
    "array": list,
}

_PLACEHOLDER_RE = re.compile(r"\{(\w+)\}")


def fetch_extension_mcp_manifests() -> list[dict[str, Any]]:
    """Synchronous — called at process (module) import time, before any
    event loop runs. Never raises: a discovery failure (backend
    unreachable, non-200, bad JSON) logs a warning and returns an empty
    list so mcp-server boots with just its core tools, same
    "broken extension never blocks core boot" principle used by the
    backend/frontend extension loaders.
    """
    url = f"{TURBO_EA_URL.rstrip('/')}/api/v1/extensions/mcp-manifest"
    try:
        resp = httpx.get(url, timeout=_DISCOVERY_TIMEOUT_SECONDS)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        logger.warning(
            "Extension MCP tool discovery failed (%s) — continuing with core tools only",
            url,
            exc_info=True,
        )
        return []
    if not isinstance(data, list):
        logger.warning("Extension MCP tool discovery returned a non-list payload — ignoring")
        return []
    return data


def _build_signature(input_schema: dict[str, Any]) -> inspect.Signature:
    """Turn a JSON Schema object into a real Python signature.

    ``inspect.signature()`` (used internally by the MCP SDK's own
    ``func_metadata``) honors a function's ``__signature__`` attribute if
    set, so attaching a signature built from the extension's declared
    schema makes the SDK derive the correct client-facing parameter schema
    with zero forked JSON-Schema-validation code — the SDK's own pydantic
    model IS the validation.
    """
    properties = input_schema.get("properties") or {}
    required = set(input_schema.get("required") or [])
    # Python signatures require every no-default parameter before any
    # defaulted one — required schema properties go first.
    ordered = [n for n in properties if n in required] + [
        n for n in properties if n not in required
    ]
    parameters = []
    for name in ordered:
        prop = properties[name]
        py_type = _JSON_TYPE_TO_PYTHON.get(prop.get("type"), str)
        if name in required:
            parameters.append(
                inspect.Parameter(
                    name, inspect.Parameter.POSITIONAL_OR_KEYWORD, annotation=py_type
                )
            )
        else:
            parameters.append(
                inspect.Parameter(
                    name,
                    inspect.Parameter.POSITIONAL_OR_KEYWORD,
                    annotation=py_type,
                    default=prop.get("default", None),
                )
            )
    return inspect.Signature(parameters, return_annotation=str)


def _make_tool_function(
    ext_key: str,
    tool_spec: dict[str, Any],
    get_token: Callable[[], Awaitable[str | None]],
    is_writes_disabled: Callable[[], str | None],
):
    """Build the generic HTTP-forwarding function for one manifest entry.

    ``get_token``/``is_writes_disabled`` are injected (not imported from
    ``server.py``) so this module has no import-time dependency on it —
    ``server.py`` is the one importing THIS module, so importing back
    would be circular.
    """
    path_template = tool_spec["path"]
    method = tool_spec["method"].upper()
    dry_run_supported = bool(tool_spec.get("dry_run_supported"))
    is_read_only = (tool_spec.get("annotations") or {}).get("readOnlyHint") is True

    async def _tool_impl(**kwargs: Any) -> str:
        token = await get_token()
        if not token:
            return "Error: Not authenticated. Please reconnect."
        if not is_read_only:
            disabled = is_writes_disabled()
            if disabled is not None:
                return disabled

        remaining = dict(kwargs)
        if dry_run_supported and "dry_run" not in remaining:
            remaining["dry_run"] = True

        resolved_path = path_template
        for match in _PLACEHOLDER_RE.finditer(path_template):
            name = match.group(1)
            if name not in remaining:
                return f"Error: missing path parameter '{name}'"
            resolved_path = resolved_path.replace(f"{{{name}}}", str(remaining.pop(name)))

        client = TurboEAClient(token)
        url_path = f"/ext/{ext_key}/{resolved_path}"
        try:
            if method == "GET":
                data = await client.get(url_path, remaining)
            elif method == "POST":
                data = await client.post(url_path, json=remaining)
            elif method == "PATCH":
                data = await client.patch(url_path, json=remaining)
            elif method == "DELETE":
                data = await client.delete(url_path)
            else:  # pragma: no cover — bundle.py rejects unknown methods at install time
                return f"Error: unsupported method '{method}'"
        except httpx.HTTPStatusError as exc:
            return f"Error: {exc}"
        return _json.dumps(data, indent=2, default=str)

    _tool_impl.__name__ = tool_spec["name"]
    _tool_impl.__doc__ = tool_spec["description"]
    _tool_impl.__signature__ = _build_signature(tool_spec.get("input_schema") or {})
    return _tool_impl


def register_extension_tools(
    mcp: FastMCP,
    get_token: Callable[[], Awaitable[str | None]],
    is_writes_disabled: Callable[[], str | None],
) -> int:
    """Register every valid extension-declared tool on ``mcp``.

    Returns the count registered. Quarantines at both levels: one
    malformed extension manifest or one malformed tool spec inside an
    otherwise-fine manifest is skipped with a logged warning — never a
    crash, never blocking the other tools.
    """
    manifests = fetch_extension_mcp_manifests()
    registered = 0
    for manifest in manifests:
        key = manifest.get("key")
        tools = manifest.get("mcp_tools")
        if not key or not isinstance(tools, list):
            logger.warning("Skipping malformed extension MCP manifest: %r", manifest)
            continue
        for tool_spec in tools:
            try:
                annotations = ToolAnnotations(**(tool_spec.get("annotations") or {}))
                fn = _make_tool_function(key, tool_spec, get_token, is_writes_disabled)
                mcp.add_tool(
                    fn,
                    name=tool_spec["name"],
                    description=tool_spec["description"],
                    annotations=annotations,
                )
                registered += 1
            except Exception:
                logger.warning(
                    "Skipping malformed MCP tool %r for extension %r",
                    tool_spec.get("name") if isinstance(tool_spec, dict) else tool_spec,
                    key,
                    exc_info=True,
                )
    return registered
