"""Server-side validation of Open Group ArchiMate Exchange XML (3.x).

The input is hostile by default: size is capped before parsing, DTDs/entities are
refused by defusedxml, output is bounded (MAX_ISSUES issues, values echoed at most
MAX_ECHO chars), and every problem is returned as an issue, never raised."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from itertools import chain, islice
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
MAX_ISSUES = 100
MAX_ECHO = 80
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


def _t(value: str | None) -> str | None:
    """Truncate an attacker-controlled value before echoing it."""
    return None if value is None else value[:MAX_ECHO]


def _issue(code: str, message: str, ref: str | None = None) -> ValidationIssue:
    return ValidationIssue(code, message, _t(ref))


def _collect_elements(root: Element) -> dict[str, str]:
    """{id: type}; elements without an identifier are never registered."""
    elements: dict[str, str] = {}
    for el in root.findall(f"{NS}elements/{NS}element"):
        if ident := el.get("identifier"):
            elements.setdefault(ident, el.get(XSI) or "")
    return elements


def _collect_relationships(root: Element) -> _Rels:
    rels: _Rels = {}
    for r in root.findall(f"{NS}relationships/{NS}relationship"):
        if ident := r.get("identifier"):
            rels.setdefault(ident, (r.get(XSI) or "", r.get("source") or "", r.get("target") or ""))
    return rels


def _check_elements(root: Element) -> Iterator[ValidationIssue]:
    for el in root.findall(f"{NS}elements/{NS}element"):
        ident, etype = el.get("identifier"), el.get(XSI)
        if not ident:
            yield _issue("missing_identifier", "Element without an identifier", etype)
        if etype not in ALL_ELEMENT_TYPES:
            yield _issue("unknown_element_type", f"Unknown element type {_t(etype)!r}", ident)


def _check_relationships(
    root: Element, elements: dict[str, str], rels: _Rels
) -> Iterator[ValidationIssue]:
    for r in root.findall(f"{NS}relationships/{NS}relationship"):
        ident, rtype = r.get("identifier"), r.get(XSI)
        src, tgt = r.get("source") or "", r.get("target") or ""
        if not ident:
            yield _issue("missing_identifier", "Relationship without an identifier", rtype)
        known = rtype in RELATIONSHIP_TYPES
        if not known:
            yield _issue(
                "unknown_relationship_type", f"Unknown relationship type {_t(rtype)!r}", ident
            )
        access = r.get("accessType")
        if access is not None and access not in ACCESS_TYPES:
            yield _issue("unknown_access_type", f"Unknown accessType {_t(access)!r}", ident)
        ends_ok = True
        for code, ref in (("dangling_source", src), ("dangling_target", tgt)):
            if ref not in elements and ref not in rels:
                yield _issue(code, f"Relationship endpoint {_t(ref)!r} not found", ident)
                ends_ok = False
        if ident and ident in (src, tgt):
            yield _issue(
                "relationship_not_allowed", "A relationship cannot connect to itself", ident
            )
            continue
        if not (known and ends_ok):
            continue
        if src in elements and tgt in elements:
            if {elements[src], elements[tgt]} <= ALL_ELEMENT_TYPES and not is_relationship_allowed(
                elements[src], elements[tgt], rtype
            ):
                yield _issue(
                    "relationship_not_allowed",
                    f"{rtype} not allowed from {elements[src]} to {elements[tgt]}",
                    ident,
                )
        elif rtype not in _RELATIONSHIP_TARGETABLE:
            yield _issue(
                "relationship_not_allowed", f"{rtype} cannot connect to a relationship", ident
            )


def _check_views(root: Element, elements: dict[str, str], rels: _Rels) -> Iterator[ValidationIssue]:
    for view in root.findall(f"{NS}views/{NS}diagrams/{NS}view"):
        # diagram object id -> the model id it shows (None for labels/groups without a ref)
        shows: dict[str, str | None] = {}
        for node in view.iterfind(f".//{NS}node"):
            ident, ref = node.get("identifier"), node.get("elementRef")
            if ident:
                shows[ident] = ref
            if ref is not None and ref not in elements:
                yield _issue("dangling_element_ref", f"elementRef {_t(ref)!r} not found", ident)
        conns = list(view.iterfind(f".//{NS}connection"))
        for c in conns:
            if ident := c.get("identifier"):
                shows[ident] = c.get("relationshipRef")
        for c in conns:
            ident, ref = c.get("identifier"), c.get("relationshipRef")
            if ref is None:
                continue
            if ref not in rels:
                yield _issue(
                    "dangling_relationship_ref", f"relationshipRef {_t(ref)!r} not found", ident
                )
                continue
            src, tgt = c.get("source"), c.get("target")
            if not src or not tgt or (shows.get(src), shows.get(tgt)) != rels[ref][1:]:
                yield _issue(
                    "connection_endpoint_mismatch",
                    f"Connection ends do not match relationship {_t(ref)!r}",
                    ident,
                )


def _check_duplicates(root: Element) -> Iterator[ValidationIssue]:
    """identifier is xs:ID: unique across every element of the document."""
    seen: set[str] = set()
    for el in root.iter():
        if ident := el.get("identifier"):
            if ident in seen:
                yield _issue("duplicate_identifier", f"Duplicate identifier {_t(ident)!r}", ident)
            seen.add(ident)


def validate_exchange(xml: str) -> list[ValidationIssue]:
    """Validate Exchange XML given as str (a non-str argument is a caller bug).

    Returns [] when valid, else at most MAX_ISSUES issues; never raises on bad input.
    An xsi:type with a QName prefix (e.g. "archimate:Foo") is reported as
    unknown_element_type: unrecognised spellings fail closed."""
    if len(xml.encode("utf-8", "replace")) > MAX_XML_BYTES:
        return [_issue("too_large", f"XML exceeds {MAX_XML_BYTES} bytes")]
    try:
        root = SafeET.fromstring(xml, forbid_dtd=True)
    except DefusedXmlException:
        return [_issue("dtd_forbidden", "DTDs and entities are not allowed")]
    except (ParseError, ValueError) as exc:
        return [_issue("xml_invalid", f"Malformed XML: {_t(str(exc))}")]
    if root.tag != f"{NS}model":
        return [_issue("wrong_root", "Root element must be the ArchiMate 3.x model")]
    elements, rels = _collect_elements(root), _collect_relationships(root)
    # Lazy chain + islice: stop collecting after MAX_ISSUES.
    return list(
        islice(
            chain(
                _check_elements(root),
                _check_duplicates(root),
                _check_relationships(root, elements, rels),
                _check_views(root, elements, rels),
            ),
            MAX_ISSUES,
        )
    )
