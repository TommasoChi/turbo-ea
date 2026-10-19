"""Archi tool's native ``.archimate`` model -> ArchiMate Open Group Exchange Format XML.

Archi (archimatetool.com) exports its own desktop-tool schema: elements
nested in a folder tree, ``xsi:type`` values prefixed ``archimate:``, views
as a separate diagram-object tree. Turbo EA's ArchiMate diagram feature
(``POST /archimate/validate``, ``create_archimate_diagram``) only accepts
the Open Group's flat Exchange Format (see
``app.services.archimate.validate``) -- this module bridges the two so a
``.archimate`` file exported from Archi can be imported directly.

Only what the Exchange Format needs is carried over: elements,
relationships, and each view's node/connection layout. Archi's visual-only
extras (Notes, pure visual Groups) have no ArchiMate semantics and are
dropped; a Note's own nested children, if any, are still walked so a real
element nested inside one is not lost.
"""

from __future__ import annotations

import re
from xml.etree.ElementTree import Element, SubElement, fromstring, indent, tostring

ARCHI_NS = "{http://www.archimatetool.com/archimate}"
XSI_TYPE = "{http://www.w3.org/2001/XMLSchema-instance}type"

EXCHANGE_NS = "http://www.opengroup.org/xsd/archimate/3.0/"
XSI_URI = "http://www.w3.org/2001/XMLSchema-instance"

_RELATIONSHIP_SUFFIX_RE = re.compile(r"Relationship$")

# Archi's numeric AccessRelationship.accessType -> the Exchange format's named enum.
_ACCESS_TYPE_CODES = {"0": "Write", "1": "Read", "2": "Access", "3": "ReadWrite"}


def _bare_type(xsi_type: str | None) -> str:
    """Strip the "archimate:" prefix Archi puts on every xsi:type value."""
    return "" if not xsi_type else xsi_type.split(":", 1)[-1]


def _relationship_bare_type(xsi_type: str | None) -> str:
    return _RELATIONSHIP_SUFFIX_RE.sub("", _bare_type(xsi_type))


def _iter_folder_elements(folder: Element):
    """Every <element> under a folder, recursing into nested <folder>s."""
    for child in folder:
        if child.tag == "element":
            yield child
        elif child.tag == "folder":
            yield from _iter_folder_elements(child)


def _set_name(parent: Element, name: str | None) -> None:
    if not name:
        return
    name_el = SubElement(parent, "name")
    name_el.set("xml:lang", "en")
    name_el.text = name


def _convert_element(archi_el: Element, parent: Element) -> None:
    el = SubElement(parent, "element")
    el.set("identifier", archi_el.get("id", ""))
    el.set("xsi:type", _bare_type(archi_el.get(XSI_TYPE)))
    _set_name(el, archi_el.get("name"))


def _convert_relationship(archi_rel: Element, parent: Element) -> None:
    rel = SubElement(parent, "relationship")
    rel.set("identifier", archi_rel.get("id", ""))
    rel.set("source", archi_rel.get("source", ""))
    rel.set("target", archi_rel.get("target", ""))
    rel.set("xsi:type", _relationship_bare_type(archi_rel.get(XSI_TYPE)))
    if (code := archi_rel.get("accessType")) is not None:
        rel.set("accessType", _ACCESS_TYPE_CODES.get(code, code))
    _set_name(rel, archi_rel.get("name"))


def _walk_diagram_children(
    archi_parent: Element, exchange_parent: Element, connections: list[tuple[str, str, str, str]]
) -> None:
    for child in archi_parent.findall("child"):
        element_ref = child.get("archimateElement")
        node_target = exchange_parent
        if element_ref:
            node = SubElement(exchange_parent, "node")
            node.set("identifier", child.get("id", ""))
            node.set("xsi:type", "Element")
            node.set("elementRef", element_ref)
            if (bounds := child.find("bounds")) is not None:
                node.set("x", bounds.get("x", "0"))
                node.set("y", bounds.get("y", "0"))
                node.set("w", bounds.get("width", "0"))
                node.set("h", bounds.get("height", "0"))
            node_target = node
        for conn in child.findall("sourceConnection"):
            if _bare_type(conn.get(XSI_TYPE)) != "Connection":
                continue
            if rel_ref := conn.get("archimateRelationship"):
                connections.append(
                    (conn.get("id", ""), conn.get("source", ""), conn.get("target", ""), rel_ref)
                )
        _walk_diagram_children(child, node_target, connections)


def _convert_view(archi_view: Element, parent: Element) -> None:
    view = SubElement(parent, "view")
    view.set("identifier", archi_view.get("id", ""))
    view.set("xsi:type", "Diagram")
    _set_name(view, archi_view.get("name"))

    connections: list[tuple[str, str, str, str]] = []
    _walk_diagram_children(archi_view, view, connections)
    for conn_id, source, target, rel_ref in connections:
        conn = SubElement(view, "connection")
        conn.set("identifier", conn_id)
        conn.set("xsi:type", "Relationship")
        conn.set("relationshipRef", rel_ref)
        conn.set("source", source)
        conn.set("target", target)


def convert_archi_native_to_exchange(native_xml: str) -> str:
    """Convert an Archi-native ``.archimate`` model to Exchange Format XML.

    Raises ValueError when the root isn't an Archi model (``archimate:model``).
    The result is not re-validated here -- callers that hand it to Turbo EA
    should run it through ``POST /archimate/validate`` first.
    """
    root = fromstring(native_xml)
    if root.tag != f"{ARCHI_NS}model":
        raise ValueError("Not an Archi native model (root must be archimate:model)")

    element_folders: list[Element] = []
    relationship_folders: list[Element] = []
    view_folders: list[Element] = []
    for folder in root.findall("folder"):
        bucket = {"relations": relationship_folders, "diagrams": view_folders}.get(
            folder.get("type") or "", element_folders
        )
        bucket.append(folder)

    out = Element("model")
    out.set("xmlns", EXCHANGE_NS)
    out.set("xmlns:xsi", XSI_URI)
    out.set("identifier", root.get("id", "id-model"))
    _set_name(out, root.get("name"))

    elements_el = SubElement(out, "elements")
    for folder in element_folders:
        for archi_el in _iter_folder_elements(folder):
            _convert_element(archi_el, elements_el)

    rels_el = SubElement(out, "relationships")
    for folder in relationship_folders:
        for archi_rel in _iter_folder_elements(folder):
            _convert_relationship(archi_rel, rels_el)

    if view_folders:
        views_el = SubElement(out, "views")
        diagrams_el = SubElement(views_el, "diagrams")
        for folder in view_folders:
            for archi_view in _iter_folder_elements(folder):
                if _bare_type(archi_view.get(XSI_TYPE)) == "ArchimateDiagramModel":
                    _convert_view(archi_view, diagrams_el)

    indent(out)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + tostring(out, encoding="unicode")


def _main() -> None:
    import argparse
    import sys

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input", help="Archi native .archimate file")
    parser.add_argument("output", nargs="?", help="Output Exchange XML file (default: stdout)")
    args = parser.parse_args()

    with open(args.input, encoding="utf-8") as f:
        exchange_xml = convert_archi_native_to_exchange(f.read())

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(exchange_xml)
    else:
        sys.stdout.write(exchange_xml)


if __name__ == "__main__":
    _main()
