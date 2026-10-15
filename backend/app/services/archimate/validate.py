"""Server-side validation of Open Group ArchiMate Exchange XML (3.x).

The input is hostile by default: size is capped before parsing, DTDs/entities are
refused by defusedxml, and every problem is returned as an issue, never raised."""

from __future__ import annotations

from dataclasses import dataclass
from xml.etree.ElementTree import Element, ParseError

from defusedxml import ElementTree as SafeET
from defusedxml.common import DefusedXmlException

from app.services.archimate.taxonomy import (
    ACCESS_TYPES,
    ALL_ELEMENT_TYPES,
    RELATIONSHIP_TYPES,
    is_relationship_allowed,
)

MAX_XML_BYTES = 5 * 1024 * 1024
NS = "{http://www.opengroup.org/xsd/archimate/3.0/}"
XSI = "{http://www.w3.org/2001/XMLSchema-instance}type"
# The only relationship types that may point at another relationship (ArchiMate 3.x).
_RELATIONSHIP_TARGETABLE = frozenset({"Association", "Aggregation", "Composition"})

_Rels = dict[str, tuple[str, str, str]]  # id -> (type, source, target)


@dataclass(frozen=True)
class ValidationIssue:
    code: str
    message: str
    ref: str | None = None


def _issue(code: str, message: str, ref: str | None = None) -> ValidationIssue:
    return ValidationIssue(code, message, ref)


def _check_elements(root: Element) -> tuple[dict[str, str], list[ValidationIssue]]:
    """Return {id: type} and the element-level issues."""
    elements: dict[str, str] = {}
    issues: list[ValidationIssue] = []
    for el in root.findall(f"{NS}elements/{NS}element"):
        ident, etype = el.get("identifier"), el.get(XSI)
        if etype not in ALL_ELEMENT_TYPES:
            issues.append(_issue("unknown_element_type", f"Unknown element type {etype!r}", ident))
        if ident is not None:
            elements.setdefault(ident, etype or "")
    return elements, issues


def _relationship_nodes(root: Element) -> tuple[list[Element], _Rels]:
    nodes = root.findall(f"{NS}relationships/{NS}relationship")
    rels: _Rels = {}
    for r in nodes:
        if (ident := r.get("identifier")) is not None:
            rels.setdefault(ident, (r.get(XSI) or "", r.get("source") or "", r.get("target") or ""))
    return nodes, rels


def _check_relationships(root: Element, elements: dict[str, str]) -> list[ValidationIssue]:
    nodes, rels = _relationship_nodes(root)
    issues: list[ValidationIssue] = []
    for r in nodes:
        ident, rtype = r.get("identifier"), r.get(XSI)
        src, tgt = r.get("source") or "", r.get("target") or ""
        known = rtype in RELATIONSHIP_TYPES
        if not known:
            issues.append(
                _issue("unknown_relationship_type", f"Unknown relationship type {rtype!r}", ident)
            )
        access = r.get("accessType")
        if access is not None and access not in ACCESS_TYPES:
            issues.append(_issue("unknown_access_type", f"Unknown accessType {access!r}", ident))
        ends_ok = True
        for code, ref in (("dangling_source", src), ("dangling_target", tgt)):
            if ref not in elements and ref not in rels:
                issues.append(_issue(code, f"Relationship endpoint {ref!r} not found", ident))
                ends_ok = False
        if not (known and ends_ok):
            continue
        if src in elements and tgt in elements:
            if {elements[src], elements[tgt]} <= ALL_ELEMENT_TYPES and not is_relationship_allowed(
                elements[src], elements[tgt], rtype
            ):
                issues.append(
                    _issue(
                        "relationship_not_allowed",
                        f"{rtype} not allowed from {elements[src]} to {elements[tgt]}",
                        ident,
                    )
                )
        elif rtype not in _RELATIONSHIP_TARGETABLE:
            issues.append(
                _issue(
                    "relationship_not_allowed", f"{rtype} cannot connect to a relationship", ident
                )
            )
    return issues


def _check_views(root: Element, elements: dict[str, str]) -> list[ValidationIssue]:
    rels = _relationship_nodes(root)[1]
    issues: list[ValidationIssue] = []
    for view in root.findall(f"{NS}views/{NS}diagrams/{NS}view"):
        # diagram object id -> the model id it shows (None for labels/groups without a ref)
        shows: dict[str, str | None] = {}
        for node in view.iterfind(f".//{NS}node"):
            ref = node.get("elementRef")
            shows[node.get("identifier") or ""] = ref
            if ref is not None and ref not in elements:
                issues.append(
                    _issue(
                        "dangling_element_ref",
                        f"elementRef {ref!r} not found",
                        node.get("identifier"),
                    )
                )
        conns = list(view.iterfind(f".//{NS}connection"))
        for c in conns:
            shows[c.get("identifier") or ""] = c.get("relationshipRef")
        for c in conns:
            ident, ref = c.get("identifier"), c.get("relationshipRef")
            if ref is None:
                continue
            if ref not in rels:
                issues.append(
                    _issue("dangling_relationship_ref", f"relationshipRef {ref!r} not found", ident)
                )
            elif (shows.get(c.get("source") or ""), shows.get(c.get("target") or "")) != rels[ref][
                1:
            ]:
                issues.append(
                    _issue(
                        "connection_endpoint_mismatch",
                        f"Connection ends do not match relationship {ref!r}",
                        ident,
                    )
                )
    return issues


def _check_duplicates(root: Element) -> list[ValidationIssue]:
    seen: set[str] = set()
    issues: list[ValidationIssue] = []
    for path in (f"{NS}elements/{NS}element", f"{NS}relationships/{NS}relationship"):
        for el in root.findall(path):
            ident = el.get("identifier")
            if ident is None:
                continue
            if ident in seen:
                issues.append(
                    _issue("duplicate_identifier", f"Duplicate identifier {ident!r}", ident)
                )
            seen.add(ident)
    return issues


def validate_exchange(xml: str) -> list[ValidationIssue]:
    """Validate Exchange XML. Returns [] when valid; never raises on bad input."""
    if len(xml.encode("utf-8", "replace")) > MAX_XML_BYTES:
        return [_issue("too_large", f"XML exceeds {MAX_XML_BYTES} bytes")]
    try:
        root = SafeET.fromstring(xml, forbid_dtd=True)
    except DefusedXmlException:
        return [_issue("dtd_forbidden", "DTDs and entities are not allowed")]
    except (ParseError, ValueError) as exc:
        return [_issue("xml_invalid", f"Malformed XML: {exc}")]
    if root.tag != f"{NS}model":
        return [_issue("wrong_root", "Root element must be the ArchiMate 3.x model")]
    elements, issues = _check_elements(root)
    return (
        issues
        + _check_duplicates(root)
        + _check_relationships(root, elements)
        + _check_views(root, elements)
    )
