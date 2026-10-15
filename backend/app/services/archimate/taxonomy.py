"""ArchiMate 3.x taxonomy: element and relationship names are the Open Group
Exchange XSD 3.1 names verbatim. The relation matrix is generated (see
scripts/archimate/generate_taxonomy.py) and read from relation_table.json."""

from __future__ import annotations

import json
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
    "implementation": ("WorkPackage", "Deliverable", "ImplementationEvent", "Plateau", "Gap"),
}
COMPOSITE_TYPES = ("Grouping", "Location")
CONNECTOR_TYPES = ("AndJunction", "OrJunction")
ELEMENT_TYPES: tuple[str, ...] = tuple(e for names in LAYERS.values() for e in names)
ALL_ELEMENT_TYPES: frozenset[str] = (
    frozenset(ELEMENT_TYPES) | set(COMPOSITE_TYPES) | set(CONNECTOR_TYPES)
)

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
    return json.loads(_TABLE_PATH.read_text(encoding="utf-8"))["table"]


def allowed_relationships(source: str, target: str) -> frozenset[str]:
    letters = _table().get(source, {}).get(target, "")
    return frozenset(LETTER_TO_RELATIONSHIP[ch] for ch in letters)


def is_relationship_allowed(source: str, target: str, relationship: str) -> bool:
    return relationship in allowed_relationships(source, target)
