"""Turn one view of an Archi-native ``.archimate`` file into a Turbo EA
ArchiMate Viewpoint Catalog example (Exchange Format XML).

An Archi export file is one whole *model*: every element, relationship and
view it has ever held, not just the one diagram you care about. A reference
corpus built incrementally (one commit per figure, each adding a view on top
of the last) makes this worse — figure 35's file carries every element from
figures 1-34 too. The backend's own converter
(``app/services/archimate/archi_native_import.py``) converts the whole
model with no way to scope it to one view, so importing a later figure
straight would ship an Exchange document representing almost the entire
source model, not that one figure.

This script trims first: it keeps only the elements and relationships the
chosen view's own nodes and connections reference, drops ``Junction``
elements (a pure diagram routing node with no Exchange Format counterpart --
the backend rejects it as an unknown element type) along with anything that
only connects through one, then hands the now-minimal native XML to the
real backend converter. Nothing here reimplements that conversion; this is
scoping, not a second importer.

Usage (from the repo root, with `backend/` importable -- see below):

    # List every view in the file with its object count, nothing written.
    python scripts/archimate/convert_viewpoint_example.py --list-views model.archimate

    # Convert one view (by exact name) to Exchange Format XML on stdout.
    python scripts/archimate/convert_viewpoint_example.py model.archimate \\
        --view "04 Business Goals Associated with the Driver Profitability (v3.1)"

    # Same, written to a file, plus the standard Viewpoint it best matches.
    python scripts/archimate/convert_viewpoint_example.py model.archimate \\
        --view "Organization View" --output fig09.xml --match-viewpoint

Reads a plain-XML or zip-packaged (Archi's own ``.archimate`` zip export,
with an ``images/`` folder alongside ``model.xml``) file alike.

See ``scripts/archimate/README.md`` for the full worked example of turning
a chosen view into a fixture under
``backend/app/services/archimate/viewpoint_examples/`` and registering it in
``backend/app/services/archimate/viewpoint_example_seed.py``.
"""

from __future__ import annotations

import argparse
import os
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"

ARCHI_NS = "http://www.archimatetool.com/archimate"
XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"
XSI_TYPE = f"{{{XSI_NS}}}type"


def _bare_type(xsi_type: str | None) -> str | None:
    return None if not xsi_type else xsi_type.split(":", 1)[-1]


def read_root(path: Path) -> ET.Element:
    data = path.read_bytes()
    if data[:2] == b"PK":
        with zipfile.ZipFile(path) as z:
            names = [n for n in z.namelist() if n.lower().endswith(".xml")]
            model = next((n for n in names if Path(n).name.lower() == "model.xml"), names[0])
            data = z.read(model)
    return ET.fromstring(data)


def _folder_elements(root: ET.Element, type_filter) -> dict[str, ET.Element]:
    """id -> <element>, for every <element> under a top-level <folder> whose
    ``type`` attribute passes ``type_filter``."""
    out: dict[str, ET.Element] = {}
    for folder in root.findall("folder"):
        if not type_filter(folder.get("type")):
            continue
        for el in folder.iter("element"):
            out[el.get("id")] = el
    return out


def find_view(root: ET.Element, name: str) -> ET.Element | None:
    for folder in root.findall("folder"):
        if folder.get("type") != "diagrams":
            continue
        for el in folder.iter("element"):
            if _bare_type(el.get(XSI_TYPE)) == "ArchimateDiagramModel" and el.get("name") == name:
                return el
    return None


def list_views(root: ET.Element) -> list[tuple[str, int]]:
    out = []
    for folder in root.findall("folder"):
        if folder.get("type") != "diagrams":
            continue
        for el in folder.iter("element"):
            if _bare_type(el.get(XSI_TYPE)) != "ArchimateDiagramModel":
                continue
            n_objects = sum(1 for node in el.iter() if node.get("archimateElement"))
            out.append((el.get("name"), n_objects))
    return out


def _view_refs(view: ET.Element) -> tuple[set[str], set[str]]:
    concept_ids, rel_ids = set(), set()
    for node in view.iter():
        if ae := node.get("archimateElement"):
            concept_ids.add(ae)
        if ar := node.get("archimateRelationship"):
            rel_ids.add(ar)
    return concept_ids, rel_ids


def _prune_view(node: ET.Element, drop_element_ids: set[str], drop_relationship_ids: set[str]) -> None:
    """Remove <child> nodes pointing at a dropped element and
    <sourceConnection> nodes pointing at a dropped relationship, recursively
    (a view can nest shapes inside a Grouping)."""
    for child in list(node):
        if child.tag == "child" and child.get("archimateElement") in drop_element_ids:
            node.remove(child)
            continue
        if child.tag == "sourceConnection" and child.get("archimateRelationship") in drop_relationship_ids:
            node.remove(child)
            continue
        _prune_view(child, drop_element_ids, drop_relationship_ids)


def trim_to_view(root: ET.Element, view_name: str) -> ET.Element:
    """A new ``archimate:model`` carrying only ``view_name`` and the elements
    and relationships it actually references."""
    elements_by_id = _folder_elements(root, lambda t: t not in ("relations", "diagrams"))
    relations_by_id = _folder_elements(root, lambda t: t == "relations")

    view = find_view(root, view_name)
    if view is None:
        available = ", ".join(repr(n) for n, _ in list_views(root))
        raise SystemExit(f"view {view_name!r} not found. Available: {available}")

    concept_ids, rel_ids = _view_refs(view)
    for rid in list(rel_ids):
        if (rel := relations_by_id.get(rid)) is not None:
            concept_ids.add(rel.get("source"))
            concept_ids.add(rel.get("target"))

    kept_elements = [elements_by_id[i] for i in concept_ids if i in elements_by_id]
    kept_relations = [relations_by_id[i] for i in rel_ids if i in relations_by_id]

    # Junction: a diagram routing node (merges/splits relationship lines),
    # not a real ArchiMate concept -- the backend's exchange validator
    # rejects it as an unknown element type.
    junction_ids = {e.get("id") for e in kept_elements if _bare_type(e.get(XSI_TYPE)) == "Junction"}
    if junction_ids:
        kept_elements = [e for e in kept_elements if e.get("id") not in junction_ids]
        dropped_rel_ids = {
            r.get("id") for r in kept_relations
            if r.get("source") in junction_ids or r.get("target") in junction_ids
        }
        kept_relations = [r for r in kept_relations if r.get("id") not in dropped_rel_ids]
        _prune_view(view, junction_ids, dropped_rel_ids)

    out_root = ET.Element(f"{{{ARCHI_NS}}}model")
    out_root.set("name", root.get("name", "trimmed"))
    out_root.set("id", root.get("id", "id-trimmed"))
    out_root.set("version", root.get("version", "5.0.0"))

    els_folder = ET.SubElement(out_root, "folder")
    els_folder.set("name", "Elements")
    els_folder.set("id", "id-trim-els")
    els_folder.set("type", "other")
    for e in kept_elements:
        els_folder.append(e)

    rel_folder = ET.SubElement(out_root, "folder")
    rel_folder.set("name", "Relations")
    rel_folder.set("id", "id-trim-rel")
    rel_folder.set("type", "relations")
    for r in kept_relations:
        rel_folder.append(r)

    views_folder = ET.SubElement(out_root, "folder")
    views_folder.set("name", "Views")
    views_folder.set("id", "id-trim-views")
    views_folder.set("type", "diagrams")
    views_folder.append(view)

    return out_root


def _import_backend():
    """Import the real converter and viewpoint catalog -- scoping stays in
    this script, conversion and the Viewpoint object lists stay the single
    source of truth they already are in the backend."""
    os.environ.setdefault("ENVIRONMENT", "development")
    os.environ.setdefault("POSTGRES_HOST", "localhost")
    os.environ.setdefault("POSTGRES_PORT", "5432")
    os.environ.setdefault("POSTGRES_DB", "turboea")
    os.environ.setdefault("POSTGRES_USER", "turboea")
    os.environ.setdefault("POSTGRES_PASSWORD", "turboea")
    if BACKEND_DIR.is_dir():
        sys.path.insert(0, str(BACKEND_DIR))
    from app.services.archimate.archi_native_import import convert_archi_native_to_exchange
    from app.services.archimate.viewpoint_seed import _VIEWPOINT_DEFS

    return convert_archi_native_to_exchange, _VIEWPOINT_DEFS


def best_viewpoint(type_set: set[str], viewpoint_defs: list[dict]) -> tuple[str, bool]:
    """The standard Viewpoint whose ``objects`` list is the smallest superset
    of ``type_set`` -- same rule the catalog itself expects an example to
    satisfy. Falls back to ``"layered"`` (the ArchiMate standard's own
    all-layers viewpoint) when no single Viewpoint's object list covers the
    mix, which is expected for a figure that deliberately spans layers.
    Grouping is excluded from matching only: it is a layer-agnostic "Other"
    element no standard Viewpoint lists, so it would force every otherwise
    single-layer figure that happens to use one into the "layered" fallback.
    """
    matchable = type_set - {"Grouping"}
    candidates = sorted(
        (len(vp["objects"]), vp["key"]) for vp in viewpoint_defs if matchable <= set(vp["objects"])
    )
    return (candidates[0][1], True) if candidates else ("layered", False)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("input", type=Path, help="Archi-native .archimate file (plain XML or zip)")
    ap.add_argument("--view", help="Exact name of the view to convert")
    ap.add_argument("--output", type=Path, help="Exchange XML output path (default: stdout)")
    ap.add_argument("--list-views", action="store_true", help="List views and object counts, then exit")
    ap.add_argument(
        "--match-viewpoint",
        action="store_true",
        help="Also print the standard Viewpoint the converted view's element types best match",
    )
    args = ap.parse_args()

    root = read_root(args.input)

    if args.list_views:
        for name, n_objects in list_views(root):
            print(f"{n_objects:4d} objects  {name}")
        return 0

    if not args.view:
        ap.error("--view is required unless --list-views is given")

    trimmed_root = trim_to_view(root, args.view)
    native_xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(
        trimmed_root, encoding="unicode"
    )

    convert_archi_native_to_exchange, viewpoint_defs = _import_backend()
    exchange_xml = convert_archi_native_to_exchange(native_xml)

    if args.output:
        args.output.write_text(exchange_xml, encoding="utf-8")
        print(f"Wrote {args.output}", file=sys.stderr)
    else:
        print(exchange_xml)

    if args.match_viewpoint:
        type_set = {
            _bare_type(e.get(XSI_TYPE))
            for e in trimmed_root.find("folder").findall("element")
        }
        key, exact = best_viewpoint(type_set, viewpoint_defs)
        note = "" if exact else "  (no exact match -- types: " + ", ".join(sorted(type_set)) + ")"
        print(f"Best-matching viewpoint: {key}{note}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
