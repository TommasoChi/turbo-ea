"""Seed the EnterpriseObject registry: one row per standard ArchiMate element
type (taxonomy.ELEMENT_TYPES) plus the four "Other" section rows (Grouping,
Location, AndJunction, OrJunction) that sit outside the normal layer
grouping, per the metamodel design spec."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enterprise_object import EnterpriseObject, EnterpriseObjectCardMapping
from app.services.archimate import taxonomy
from app.services.archimate.default_mapping import CARD_TYPE_DEFAULTS, SUBTYPE_DEFAULTS

# Hex values copied from frontend/src/theme/tokens.ts's ARCHIMATE_LAYER_COLORS
# (the stroke half of each layer's fill/stroke pair -- the pastel fills are
# too pale to read as a small admin-list dot/icon colour), so the registry's
# colours stay consistent with the ArchiMate canvas palette.
_LAYER_COLORS: dict[str, str] = {
    "strategy": "#c6a253",
    "business": "#c6c653",
    "application": "#53c6c6",
    "technology": "#7ec653",
    "physical": "#4e862d",
    "motivation": "#5353c6",
    "implementation": "#c65353",
}
# ARCHIMATE_LAYER_COLORS.other.stroke -- used for the 4 "Other" section rows,
# which have layer=None.
_OTHER_COLOR = "#8c8c8c"

_OTHER_SECTION_KEYS: tuple[str, ...] = (*taxonomy.COMPOSITE_TYPES, *taxonomy.CONNECTOR_TYPES)

# Human-readable display names (ArchiMate's own element names, spaced out).
_NAMES: dict[str, str] = {
    # Strategy
    "Resource": "Resource",
    "Capability": "Capability",
    "ValueStream": "Value Stream",
    "CourseOfAction": "Course of Action",
    # Business
    "BusinessActor": "Business Actor",
    "BusinessRole": "Business Role",
    "BusinessCollaboration": "Business Collaboration",
    "BusinessInterface": "Business Interface",
    "BusinessProcess": "Business Process",
    "BusinessFunction": "Business Function",
    "BusinessInteraction": "Business Interaction",
    "BusinessEvent": "Business Event",
    "BusinessService": "Business Service",
    "BusinessObject": "Business Object",
    "Contract": "Contract",
    "Representation": "Representation",
    "Product": "Product",
    # Application
    "ApplicationComponent": "Application Component",
    "ApplicationCollaboration": "Application Collaboration",
    "ApplicationInterface": "Application Interface",
    "ApplicationFunction": "Application Function",
    "ApplicationInteraction": "Application Interaction",
    "ApplicationProcess": "Application Process",
    "ApplicationEvent": "Application Event",
    "ApplicationService": "Application Service",
    "DataObject": "Data Object",
    # Technology
    "Node": "Node",
    "Device": "Device",
    "SystemSoftware": "System Software",
    "TechnologyCollaboration": "Technology Collaboration",
    "TechnologyInterface": "Technology Interface",
    "Path": "Path",
    "CommunicationNetwork": "Communication Network",
    "TechnologyFunction": "Technology Function",
    "TechnologyProcess": "Technology Process",
    "TechnologyInteraction": "Technology Interaction",
    "TechnologyEvent": "Technology Event",
    "TechnologyService": "Technology Service",
    "Artifact": "Artifact",
    # Physical
    "Equipment": "Equipment",
    "Facility": "Facility",
    "DistributionNetwork": "Distribution Network",
    "Material": "Material",
    # Motivation
    "Stakeholder": "Stakeholder",
    "Driver": "Driver",
    "Assessment": "Assessment",
    "Goal": "Goal",
    "Outcome": "Outcome",
    "Principle": "Principle",
    "Requirement": "Requirement",
    "Constraint": "Constraint",
    "Meaning": "Meaning",
    "Value": "Value",
    # Implementation & Migration
    "WorkPackage": "Work Package",
    "Deliverable": "Deliverable",
    "ImplementationEvent": "Implementation Event",
    "Plateau": "Plateau",
    "Gap": "Gap",
    # Other
    "Grouping": "Grouping",
    "Location": "Location",
    "AndJunction": "And Junction",
    "OrJunction": "Or Junction",
}

# Material Symbol name per element, picked by hand per element's meaning
# (there is no automatic icon mapping). Structurally analogous elements that
# repeat across layers (Process/Function/Interaction/Event/Collaboration)
# intentionally reuse one glyph -- the layer colour is what tells them apart.
_ICONS: dict[str, str] = {
    # Strategy
    "Resource": "inventory_2",
    "Capability": "military_tech",
    "ValueStream": "timeline",
    "CourseOfAction": "route",
    # Business
    "BusinessActor": "person",
    "BusinessRole": "assignment_ind",
    "BusinessCollaboration": "hub",
    "BusinessInterface": "input",
    "BusinessProcess": "sync_alt",
    "BusinessFunction": "functions",
    "BusinessInteraction": "forum",
    "BusinessEvent": "bolt",
    "BusinessService": "design_services",
    "BusinessObject": "description",
    "Contract": "gavel",
    "Representation": "article",
    "Product": "shopping_bag",
    # Application
    "ApplicationComponent": "widgets",
    "ApplicationCollaboration": "hub",
    "ApplicationInterface": "api",
    "ApplicationFunction": "functions",
    "ApplicationInteraction": "forum",
    "ApplicationProcess": "sync_alt",
    "ApplicationEvent": "bolt",
    "ApplicationService": "cloud",
    "DataObject": "dataset",
    # Technology
    "Node": "dns",
    "Device": "computer",
    "SystemSoftware": "terminal",
    "TechnologyCollaboration": "hub",
    "TechnologyInterface": "cable",
    "Path": "alt_route",
    "CommunicationNetwork": "lan",
    "TechnologyFunction": "functions",
    "TechnologyProcess": "sync_alt",
    "TechnologyInteraction": "forum",
    "TechnologyEvent": "bolt",
    "TechnologyService": "settings_suggest",
    "Artifact": "insert_drive_file",
    # Physical
    "Equipment": "construction",
    "Facility": "warehouse",
    "DistributionNetwork": "local_shipping",
    "Material": "inventory",
    # Motivation
    "Stakeholder": "groups",
    "Driver": "trending_up",
    "Assessment": "fact_check",
    "Goal": "flag",
    "Outcome": "emoji_events",
    "Principle": "balance",
    "Requirement": "checklist",
    "Constraint": "block",
    "Meaning": "psychology",
    "Value": "star",
    # Implementation & Migration
    "WorkPackage": "work",
    "Deliverable": "package_2",
    "ImplementationEvent": "bolt",
    "Plateau": "landscape",
    "Gap": "report_problem",
    # Other
    "Grouping": "folder",
    "Location": "location_on",
    "AndJunction": "join_full",
    "OrJunction": "call_split",
}

# Each description rewrites the ArchiMate 3.2 standard's own definition in
# plain, non-expert language, at most 30 words. Not placeholder text -- see
# task-2-report.md for notes on which ones carry more uncertainty.
ENTERPRISE_OBJECT_DESCRIPTIONS: dict[str, str] = {
    # Strategy
    "Resource": (
        "Something useful an organization owns or controls, like money, people, equipment, or "
        "information, that helps it get things done."
    ),
    "Capability": (
        "Something an organization is able to do well, a skill it has, no matter who does it or "
        "how."
    ),
    "ValueStream": (
        "A chain of steps that work together to create something valuable for a customer or other "
        "stakeholder."
    ),
    "CourseOfAction": (
        "A plan for how to use an organization's abilities and resources to reach a goal."
    ),
    # Business
    "BusinessActor": (
        "A person, team, or organization that can actually do things, like take actions or make "
        "decisions."
    ),
    "BusinessRole": (
        "A specific job or responsibility that someone, an actor, takes on, like 'cashier' or "
        "'manager'."
    ),
    "BusinessCollaboration": (
        "Two or more roles working together as a team to get something done that none could do "
        "alone."
    ),
    "BusinessInterface": (
        "The place or channel, like a counter or phone line, where people can reach a business "
        "service."
    ),
    "BusinessProcess": (
        "A series of steps an organization follows, in order, to produce a specific result or "
        "service."
    ),
    "BusinessFunction": (
        "A group of related business activities, like 'finance' or 'sales', bundled together "
        "because they use similar skills."
    ),
    "BusinessInteraction": (
        "Something two or more roles do together, back and forth, like negotiating or discussing."
    ),
    "BusinessEvent": (
        "Something that happens suddenly, like an order arriving, that triggers other things to "
        "start."
    ),
    "BusinessService": (
        "A clear, useful service an organization offers, like opening a bank account, that others "
        "can ask for and use."
    ),
    "BusinessObject": (
        "A piece of information that matters to the business, like an invoice or a customer record."
    ),
    "Contract": (
        "An agreement, written or not, that spells out what each side promises and is entitled to."
    ),
    "Representation": (
        "The actual form information takes so people can see or hear it, like a printed form or an "
        "email."
    ),
    "Product": (
        "A package of services and things, plus an agreement, that a business offers as one whole "
        "thing to customers."
    ),
    # Application
    "ApplicationComponent": (
        "A self-contained, swappable piece of software that does a specific job and offers its "
        "features through interfaces."
    ),
    "ApplicationCollaboration": (
        "Two or more software components teaming up to do something together that neither could do "
        "alone."
    ),
    "ApplicationInterface": (
        "The access point, like an API, where other software or users can use an application's "
        "features."
    ),
    "ApplicationFunction": (
        "A group of related things a piece of software does, bundled together inside one component."
    ),
    "ApplicationInteraction": (
        "Something two or more software components do together, working as a pair or group."
    ),
    "ApplicationProcess": (
        "A series of steps software follows, in order, to produce a specific result."
    ),
    "ApplicationEvent": (
        "Something that happens suddenly inside software, like a file being saved, that triggers "
        "other actions."
    ),
    "ApplicationService": (
        "A clear feature a piece of software offers, like 'send an email', that other things can "
        "ask for."
    ),
    "DataObject": (
        "A piece of information, organized and stored in a specific way, that a software component "
        "works with."
    ),
    # Technology
    "Node": (
        "A computer or device that runs software or works together with other computers and "
        "devices."
    ),
    "Device": (
        "A physical piece of equipment, like a server or laptop, that can store and run software."
    ),
    "SystemSoftware": (
        "Software, like an operating system, that provides the environment other software needs in "
        "order to run."
    ),
    "TechnologyCollaboration": (
        "Two or more technical components, like servers, working together to do something neither "
        "could alone."
    ),
    "TechnologyInterface": (
        "The access point, like a network port, where other devices or software can reach a "
        "technical service."
    ),
    "Path": (
        "A route or connection between devices that lets them send data or material back and forth."
    ),
    "CommunicationNetwork": (
        "A network, like the internet or a cable system, that connects devices so they can send "
        "data."
    ),
    "TechnologyFunction": (
        "A group of related technical activities, bundled together, that a piece of infrastructure "
        "performs."
    ),
    "TechnologyProcess": (
        "A series of technical steps, in order, that infrastructure follows to produce a specific "
        "result."
    ),
    "TechnologyInteraction": (
        "Something two or more pieces of technology infrastructure do together, working as a pair "
        "or group."
    ),
    "TechnologyEvent": (
        "Something that happens suddenly in the infrastructure, like a server restarting, that "
        "triggers other actions."
    ),
    "TechnologyService": (
        "A clear technical capability, like file storage, that infrastructure offers for "
        "applications to use."
    ),
    "Artifact": (
        "A file, like a program or a document, that software needs or creates while it runs."
    ),
    # Physical
    "Equipment": (
        "A physical machine or tool, like an ATM or a conveyor belt, that works with physical "
        "materials."
    ),
    "Facility": (
        "A physical place, like a warehouse or a factory building, built for a specific purpose."
    ),
    "DistributionNetwork": (
        "A physical network, like roads or pipelines, that moves materials or energy from place to "
        "place."
    ),
    "Material": "Physical stuff, like raw goods or energy, that can be moved, stored, or used.",
    # Motivation
    "Stakeholder": (
        "A person or group with an interest in how things turn out, like a customer or a regulator."
    ),
    "Driver": (
        "A reason or pressure, inside or outside the organization, that pushes it to set goals and "
        "change."
    ),
    "Assessment": (
        "The result of studying a driver, like a SWOT analysis finding a strength or a weakness."
    ),
    "Goal": "Something an organization wants to achieve or become, stated at a high level.",
    "Outcome": "A real result that has actually happened, showing whether a goal was reached.",
    "Principle": (
        "A guiding rule the organization follows, like 'always protect customer privacy', that "
        "shapes its decisions."
    ),
    "Requirement": (
        "A specific thing a system must do or have, stated clearly enough that it can be checked "
        "and tested."
    ),
    "Constraint": (
        "A limit or restriction, like a budget or a law, that boxes in what the architecture can "
        "do."
    ),
    "Meaning": (
        "The sense or understanding a piece of information has for a specific person or group."
    ),
    "Value": (
        "How much something is worth or how useful it is, to a person, group, or organization."
    ),
    # Implementation & Migration
    "WorkPackage": (
        "A set of planned actions meant to reach a specific result within a set time and budget."
    ),
    "Deliverable": "A specific, clearly defined result that a work package is meant to produce.",
    "ImplementationEvent": (
        "Something that happens, like a system going live, marking progress during a change "
        "project."
    ),
    "Plateau": (
        "A steady, temporary stage the architecture passes through on its way from the old state "
        "to the new one."
    ),
    "Gap": "The difference between where the architecture is now and where it needs to be next.",
    # Other
    "Grouping": (
        "A way to bundle related elements together, even across layers, because they share "
        "something in common."
    ),
    "Location": (
        "A place, physical or conceptual, where something happens or where something is positioned."
    ),
    "AndJunction": (
        "A connector meaning all the linked paths happen together, like several roads that all "
        "must be taken."
    ),
    "OrJunction": (
        "A connector meaning only one of the linked paths needs to happen, like a fork in the road."
    ),
}

_ELEMENT_TO_LAYER: dict[str, str] = {
    key: layer for layer, keys in taxonomy.LAYERS.items() for key in keys
}


async def seed_enterprise_objects(db: AsyncSession) -> None:
    """Seed the EnterpriseObject registry, adding any missing rows.

    Idempotent and insert-only: upserts by `key`, but only to *add* a row
    that does not exist yet. An existing row -- including its
    admin-editable `description` (Task 11's popover) -- is never touched
    again, on any field, once it has been created. `description`/`icon`/
    `color`/`layer`/`name`/`is_hidden`/`sort_order` are all first-insert-only
    for this reason: a seed that runs on every backend boot must not revert
    an admin's edit on the next deploy/restart.
    """
    existing_result = await db.execute(select(EnterpriseObject.key))
    existing_keys = set(existing_result.scalars().all())

    all_keys = (*taxonomy.ELEMENT_TYPES, *_OTHER_SECTION_KEYS)
    for sort_order, key in enumerate(all_keys):
        if key in existing_keys:
            continue

        layer = _ELEMENT_TO_LAYER.get(key)  # None for the 4 "Other" rows
        db.add(
            EnterpriseObject(
                key=key,
                name=_NAMES[key],
                description=ENTERPRISE_OBJECT_DESCRIPTIONS[key],
                icon=_ICONS[key],
                color=_LAYER_COLORS[layer] if layer is not None else _OTHER_COLOR,
                layer=layer,
                aspect=taxonomy.aspect_of(key),
                is_standard=True,
                is_locked=(key == "Grouping"),
                sort_order=sort_order,
            )
        )


async def seed_card_mappings(db: AsyncSession) -> None:
    """One-time-per-triple backfill of EnterpriseObjectCardMapping bridge rows
    from default_mapping.py's ``CARD_TYPE_DEFAULTS`` (card type -> element
    type, or None for "no mapping") and ``SUBTYPE_DEFAULTS`` (card
    type/subtype -> element type).

    Tracked with a durable marker (``seed_markers.applied_card_mapping_defaults``/
    ``mark_card_mapping_defaults_applied``, in the same ``app_settings`` JSONB
    ``seed_markers.demo_seed_completed`` uses), not inferred from whether the
    bridge table currently holds any rows -- that inference is the exact
    anti-pattern ``seed_markers`` documents, and breaks two ways here: an
    admin deleting every default mapping would empty the table and resurrect
    all of them on the next restart (this is the Bug 1 regression one level
    removed), and a future release's new default triple would never land on
    an existing install once the table had anything else in it. Each triple
    is marked applied the first time it is seeded (whether or not the row
    happens to already exist) and is never re-inserted after that, no matter
    what later happens to the row -- so an admin's removal survives a
    restart, and a genuinely new default triple still lands exactly once.
    """
    from app.services import seed_markers

    applied = await seed_markers.applied_card_mapping_defaults(db)

    existing_result = await db.execute(select(EnterpriseObjectCardMapping))
    existing = {
        (m.enterprise_object_key, m.card_type_key, m.card_subtype_key)
        for m in existing_result.scalars().all()
    }

    newly_applied: set[tuple[str, str, str | None]] = set()

    def _add(enterprise_object_key: str, card_type_key: str, card_subtype_key: str | None) -> None:
        triple = (enterprise_object_key, card_type_key, card_subtype_key)
        if triple in applied:
            return  # already applied once -- an admin may have removed it since
        newly_applied.add(triple)
        if triple in existing:
            return  # row already there (e.g. an admin added the exact same mapping)
        existing.add(triple)
        db.add(
            EnterpriseObjectCardMapping(
                enterprise_object_key=enterprise_object_key,
                card_type_key=card_type_key,
                card_subtype_key=card_subtype_key,
            )
        )

    for card_type_key, element_key in CARD_TYPE_DEFAULTS.items():
        if element_key is None:  # "no mapping" -- no bridge row
            continue
        _add(element_key, card_type_key, None)

    for (card_type_key, card_subtype_key), element_key in SUBTYPE_DEFAULTS.items():
        _add(element_key, card_type_key, card_subtype_key)

    await seed_markers.mark_card_mapping_defaults_applied(db, newly_applied)
