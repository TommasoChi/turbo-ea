"""ArchiMate 3.x taxonomy: element and relationship names are the Open Group
Exchange XSD 3.1 names verbatim. The relation matrix is generated (see
scripts/archimate/generate_taxonomy.py) and read from relation_table.json."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

LAYERS: dict[str, tuple[str, ...]] = {
    "strategy": ("Resource", "Capability", "ValueStream", "CourseOfAction"),
    "business": (
        "BusinessActor",
        "BusinessRole",
        "BusinessCollaboration",
        "BusinessInterface",
        "BusinessProcess",
        "BusinessFunction",
        "BusinessInteraction",
        "BusinessEvent",
        "BusinessService",
        "BusinessObject",
        "Contract",
        "Representation",
        "Product",
    ),
    "application": (
        "ApplicationComponent",
        "ApplicationCollaboration",
        "ApplicationInterface",
        "ApplicationFunction",
        "ApplicationInteraction",
        "ApplicationProcess",
        "ApplicationEvent",
        "ApplicationService",
        "DataObject",
    ),
    "technology": (
        "Node",
        "Device",
        "SystemSoftware",
        "TechnologyCollaboration",
        "TechnologyInterface",
        "Path",
        "CommunicationNetwork",
        "TechnologyFunction",
        "TechnologyProcess",
        "TechnologyInteraction",
        "TechnologyEvent",
        "TechnologyService",
        "Artifact",
    ),
    "physical": ("Equipment", "Facility", "DistributionNetwork", "Material"),
    "implementation": ("WorkPackage", "Deliverable", "ImplementationEvent", "Plateau", "Gap"),
    "motivation": (
        "Stakeholder",
        "Driver",
        "Assessment",
        "Goal",
        "Outcome",
        "Principle",
        "Requirement",
        "Constraint",
        "Meaning",
        "Value",
    ),
}
# The three diagram-creation dashboard tabs / Viewpoint Catalog "Domain" buckets, each mapped to
# the LAYERS / EnterpriseObject.layer keys it covers -- same three groupings as the nav design
# doc's table. Canonical home for this mapping: `app/api/v1/diagrams.py` (the picker and the
# per-tab permission gate) and `viewpoint_seed.py` (a standard viewpoint's seeded `domains`) both
# import it from here rather than keeping their own copy.
TAB_LAYERS: dict[str, frozenset[str]] = {
    "business": frozenset({"strategy", "business", "motivation"}),
    "application": frozenset({"application"}),
    "technology": frozenset({"technology", "physical"}),
}

COMPOSITE_TYPES = ("Grouping", "Location")
CONNECTOR_TYPES = ("AndJunction", "OrJunction")
ELEMENT_TYPES: tuple[str, ...] = tuple(e for names in LAYERS.values() for e in names)
ALL_ELEMENT_TYPES: frozenset[str] = (
    frozenset(ELEMENT_TYPES) | set(COMPOSITE_TYPES) | set(CONNECTOR_TYPES)
)

# Mirrors frontend/src/features/archimate/taxonomy/elements.ts's aspectOf() --
# keep the two in sync. A type absent from every set below, outside the
# Motivation layer and not composite, falls through to the Process/Function/
# Interaction/Event/Service suffix rule (same as the frontend).
_ASPECT_ACTIVE = frozenset(
    {
        "BusinessActor",
        "BusinessRole",
        "BusinessCollaboration",
        "BusinessInterface",
        "ApplicationComponent",
        "ApplicationCollaboration",
        "ApplicationInterface",
        "Node",
        "Device",
        "SystemSoftware",
        "TechnologyCollaboration",
        "TechnologyInterface",
        "Path",
        "CommunicationNetwork",
        "Equipment",
        "Facility",
        "DistributionNetwork",
        "Resource",
    }
)
_ASPECT_BEHAVIOR_EXTRA = frozenset(
    {
        "Capability",
        "ValueStream",
        "CourseOfAction",
        "WorkPackage",
        "ImplementationEvent",
    }
)
_ASPECT_PASSIVE = frozenset(
    {
        "BusinessObject",
        "Contract",
        "Representation",
        "DataObject",
        "Artifact",
        "Material",
        "Deliverable",
    }
)
# No single aspect in the standard: spans all three (Product, Plateau, Gap) or
# sits outside the Aspects grid entirely (Grouping, Location).
_ASPECT_COMPOSITE = frozenset({"Product", "Plateau", "Gap", "Grouping", "Location"})
_ASPECT_SUFFIX_RE = re.compile(r"(Process|Function|Interaction|Event|Service)$")


def aspect_of(element_type: str) -> str | None:
    """ArchiMate's structural aspect for a standard element type: "passive",
    "behavior" or "active" -- or None for Motivation elements, connectors and
    the composite types that the standard does not classify under one aspect.
    """
    if element_type in CONNECTOR_TYPES or element_type in _ASPECT_COMPOSITE:
        return None
    if element_type in LAYERS["motivation"]:
        return None
    if element_type in _ASPECT_PASSIVE:
        return "passive"
    if element_type in _ASPECT_ACTIVE:
        return "active"
    if element_type in _ASPECT_BEHAVIOR_EXTRA or _ASPECT_SUFFIX_RE.search(element_type):
        return "behavior"
    return None


RELATIONSHIP_TYPES: tuple[str, ...] = (
    "Composition",
    "Aggregation",
    "Assignment",
    "Realization",
    "Serving",
    "Access",
    "Influence",
    "Triggering",
    "Flow",
    "Specialization",
    "Association",
)
ACCESS_TYPES = ("Access", "Read", "Write", "ReadWrite")

LETTER_TO_RELATIONSHIP: dict[str, str] = {
    "a": "Access",
    "c": "Composition",
    "f": "Flow",
    "g": "Aggregation",
    "i": "Assignment",
    "n": "Influence",
    "o": "Association",
    "r": "Realization",
    "s": "Specialization",
    "t": "Triggering",
    "v": "Serving",
}

_TABLE_PATH = Path(__file__).with_name("relation_table.json")


@lru_cache(maxsize=1)
def _table() -> dict[str, dict[str, str]]:
    table: dict[str, dict[str, str]] = json.loads(_TABLE_PATH.read_text(encoding="utf-8"))["table"]
    return table


def allowed_relationships(source: str, target: str) -> frozenset[str]:
    letters = _table().get(source, {}).get(target, "")
    return frozenset(LETTER_TO_RELATIONSHIP[ch] for ch in letters)


def is_relationship_allowed(source: str, target: str, relationship: str) -> bool:
    return relationship in allowed_relationships(source, target)
