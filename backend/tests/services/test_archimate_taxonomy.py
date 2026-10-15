from __future__ import annotations

from app.services.archimate import taxonomy as tx

XSD_ELEMENTS = {
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
    "ApplicationComponent",
    "ApplicationCollaboration",
    "ApplicationInterface",
    "ApplicationFunction",
    "ApplicationInteraction",
    "ApplicationProcess",
    "ApplicationEvent",
    "ApplicationService",
    "DataObject",
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
    "Equipment",
    "Facility",
    "DistributionNetwork",
    "Material",
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
    "Resource",
    "Capability",
    "CourseOfAction",
    "ValueStream",
    "WorkPackage",
    "Deliverable",
    "ImplementationEvent",
    "Plateau",
    "Gap",
    "Grouping",
    "Location",
    "AndJunction",
    "OrJunction",
}
XSD_RELATIONSHIPS = {
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
}
CONCEPTS = tx.ALL_ELEMENT_TYPES


def test_element_names_equal_the_xsd_enumeration():
    assert tx.ALL_ELEMENT_TYPES == XSD_ELEMENTS
    assert len(tx.ALL_ELEMENT_TYPES) == 62
    assert len(tx.ELEMENT_TYPES) == 58 and len(set(tx.ELEMENT_TYPES)) == 58


def test_relationship_names_equal_the_xsd_enumeration():
    assert set(tx.RELATIONSHIP_TYPES) == XSD_RELATIONSHIPS and len(tx.RELATIONSHIP_TYPES) == 11
    assert set(tx.LETTER_TO_RELATIONSHIP.values()) == XSD_RELATIONSHIPS


def test_every_layer_element_is_in_exactly_one_layer():
    flat = [e for names in tx.LAYERS.values() for e in names]
    assert len(flat) == len(set(flat)) == 58


def test_table_only_names_known_concepts():
    for s, targets in tx._table().items():
        assert s in CONCEPTS or s == "Relationship", s
        for t in targets:
            assert t in CONCEPTS or t == "Relationship", (s, t)


def test_every_concept_pair_is_present_in_the_table():
    for s in CONCEPTS:
        for t in CONCEPTS:
            assert t in tx._table().get(s, {}), (s, t)


def test_association_is_allowed_between_every_pair_of_elements():
    for s in tx.ELEMENT_TYPES:
        for t in tx.ELEMENT_TYPES:
            assert tx.is_relationship_allowed(s, t, "Association"), (s, t)


# The spec defines Contract as a specialization of Business Object and Constraint
# as a specialization of Requirement, so Specialization also holds across them.
SPECIALIZATION_CROSS_TYPE = {
    ("BusinessObject", "Contract"),
    ("Contract", "BusinessObject"),
    ("Requirement", "Constraint"),
    ("Constraint", "Requirement"),
}


def test_specialization_only_between_same_type_elements():
    for s in tx.ELEMENT_TYPES:
        assert tx.is_relationship_allowed(s, s, "Specialization"), s
    cross = {
        (s, t)
        for s in tx.ELEMENT_TYPES
        for t in tx.ELEMENT_TYPES
        if s != t and tx.is_relationship_allowed(s, t, "Specialization")
    }
    assert cross == SPECIALIZATION_CROSS_TYPE


def test_access_only_targets_passive_structure_elements():
    # Deliverable is the passive element of Implementation & Migration.
    passive = {
        "BusinessObject",
        "Contract",
        "Representation",
        "DataObject",
        "Artifact",
        "Material",
        "Deliverable",
    }
    outside = {
        (s, t)
        for s in tx.ELEMENT_TYPES
        for t in tx.ELEMENT_TYPES
        if t not in passive and tx.is_relationship_allowed(s, t, "Access")
    }
    assert outside == set()


def test_known_spec_examples():
    assert tx.is_relationship_allowed("BusinessActor", "BusinessProcess", "Assignment")
    assert tx.is_relationship_allowed("ApplicationComponent", "BusinessProcess", "Serving")
    assert tx.is_relationship_allowed("BusinessProcess", "BusinessObject", "Access")
    assert not tx.is_relationship_allowed("DataObject", "BusinessActor", "Assignment")
