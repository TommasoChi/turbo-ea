"""Default mapping from Turbo EA types to ArchiMate 3.x concepts.

Seed data and migration 158 both read these tables, and ``test_archimate_default_mapping``
pins that the migration's embedded copy equals this module. An admin edits the
live values in Admin -> Metamodel -> ARCHI MAP (branch 2); nothing here overrides
an admin-set value. Element and relationship names are the Open Group XSD 3.1 names.
"""

from __future__ import annotations

from typing import TypedDict


class RelationDefault(TypedDict, total=False):
    type: str
    reversed: bool
    access: str


CARD_TYPE_DEFAULTS: dict[str, str | None] = {
    "Objective": "Goal",
    "Platform": "Grouping",
    "Initiative": "WorkPackage",
    "Organization": "BusinessActor",
    "BusinessCapability": "Capability",
    "BusinessContext": None,
    "BusinessProcess": "BusinessProcess",
    "Application": "ApplicationComponent",
    "Interface": "ApplicationInterface",
    "DataObject": "BusinessObject",
    "ITComponent": "Node",
    "TechCategory": "Grouping",
    "Provider": "BusinessActor",
}

SUBTYPE_DEFAULTS: dict[tuple[str, str], str] = {
    ("Objective", "businessGoal"): "Goal",
    ("Objective", "valueGate"): "Assessment",
    ("Organization", "region"): "Location",
    ("BusinessContext", "process"): "BusinessProcess",
    ("BusinessContext", "valueStream"): "ValueStream",
    ("BusinessContext", "customerJourney"): "BusinessProcess",
    ("BusinessContext", "businessProduct"): "Product",
    ("BusinessContext", "esgCapability"): "Capability",
    ("BusinessProcess", "category"): "BusinessFunction",
    ("BusinessProcess", "group"): "BusinessFunction",
    ("ITComponent", "software"): "SystemSoftware",
    ("ITComponent", "hardware"): "Device",
    ("ITComponent", "saas"): "TechnologyService",
    ("ITComponent", "paas"): "TechnologyService",
    ("ITComponent", "iaas"): "TechnologyService",
    ("ITComponent", "service"): "TechnologyService",
    ("ITComponent", "aiModel"): "SystemSoftware",
}

RELATION_DEFAULTS: dict[str, RelationDefault] = {
    "relObjectiveToBC": {"type": "Association"},
    "relPlatformToObjective": {"type": "Influence"},
    "relPlatformToApp": {"type": "Aggregation"},
    "relPlatformToITC": {"type": "Aggregation"},
    "relInitiativeToObjective": {"type": "Influence"},
    "relInitiativeToPlatform": {"type": "Association"},
    "relInitiativeToBC": {"type": "Association"},
    "relInitiativeToApp": {"type": "Association"},
    "relInitiativeToInterface": {"type": "Association"},
    "relInitiativeToDataObj": {"type": "Association"},
    "relInitiativeToITC": {"type": "Association"},
    "relOrgToObjective": {"type": "Association"},
    "relOrgToInitiative": {"type": "Assignment"},
    "relOrgToBizCtx": {"type": "Association"},
    "relOrgToApp": {"type": "Serving", "reversed": True},
    "relOrgToITC": {"type": "Association"},
    "relAppToBC": {"type": "Realization"},
    "relAppToBizCtx": {"type": "Association"},
    "relAppToInterface": {"type": "Association"},
    "relAppToDataObj": {"type": "Access", "access": "crud"},
    "relAppToITC": {"type": "Serving", "reversed": True},
    "relITCToTechCat": {"type": "Aggregation", "reversed": True},
    "relITCToPlatform": {"type": "Aggregation", "reversed": True},
    "relInterfaceToDataObj": {"type": "Association"},
    "relInterfaceToITC": {"type": "Association"},
    "relProviderToInitiative": {"type": "Association"},
    "relProviderToApp": {"type": "Association"},
    "relProviderToITC": {"type": "Association"},
    "relBizCtxToBC": {"type": "Association"},
    "relProcessToBC": {"type": "Realization"},
    "relProcessToApp": {"type": "Serving", "reversed": True},
    "relProcessToDataObj": {"type": "Access", "access": "crud"},
    "relProcessToITC": {"type": "Serving", "reversed": True},
    "relProcessDependency": {"type": "Association"},
    "relProcessCalls": {"type": "Triggering"},
    "relProcessToOrg": {"type": "Assignment", "reversed": True},
    "relProcessToInitiative": {"type": "Association"},
    "relProcessToObjective": {"type": "Influence"},
    "relProcessToBizCtx": {"type": "Realization"},
    "relObjectiveToBizCtx": {"type": "Association"},
    "relBusinessContextSuccessor": {"type": "Triggering", "reversed": True},
}

# Successor relations exist per card type; they all read "A succeeds B".
SUCCESSOR_DEFAULT: RelationDefault = {"type": "Association"}
SUCCESSOR_KEYS_PREFIX = "rel"
SUCCESSOR_KEYS_SUFFIX = "Successor"
