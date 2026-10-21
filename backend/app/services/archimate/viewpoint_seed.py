"""Seed the 23 standard ArchiMate 3.1 viewpoints into the catalog
(``ArchimateViewpoint`` + ``ArchimateViewpointObject``), plus the
viewpoint x tab -> card-type suggestion overrides (``ArchimateViewpointTabCard``).

"Core element" in the ArchiMate 3.1 spec's own definition of the Goal
Realization, Requirements Realization and Layered viewpoints (any element may
additionally appear) is deliberately **not** seeded as "allow everything" --
that would silently reintroduce Free mode for those three. Only the
explicitly named elements are seeded; an admin can widen the list later
through the editable tag-chip UI (Task 5).
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.archimate_viewpoint import (
    ArchimateViewpoint,
    ArchimateViewpointObject,
    ArchimateViewpointTabCard,
)
from app.services.archimate import taxonomy

# Each description paraphrases the ArchiMate 3.1 standard's own definition of
# the viewpoint in plain, non-expert language (same register as
# enterprise_object_seed.py's ENTERPRISE_OBJECT_DESCRIPTIONS), at most ~30
# words. `objects` are EnterpriseObject.key values, taken verbatim from
# taxonomy.py's key names -- one Enterprise Object per allowed ArchiMate
# element. `layer` is the admin-facing classification only; it does not
# restrict which objects a viewpoint may allow.
_VIEWPOINT_DEFS: list[dict] = [
    {
        "key": "organization",
        "name": "Organization",
        "icon": "account_tree",
        "layer": "business",
        "description": (
            "Shows how people, roles, and locations are organized inside a company, the way an "
            "org chart does, including who works with whom."
        ),
        "objects": (
            "BusinessActor",
            "BusinessRole",
            "BusinessCollaboration",
            "Location",
            "BusinessInterface",
        ),
    },
    {
        "key": "business-process-cooperation",
        "name": "Business Process Cooperation",
        "icon": "sync_alt",
        "layer": "business",
        "description": (
            "Shows how business processes work together and exchange information, and which "
            "applications support each step along the way."
        ),
        "objects": (
            "BusinessActor",
            "BusinessRole",
            "BusinessCollaboration",
            "Location",
            "BusinessInterface",
            "BusinessProcess",
            "BusinessFunction",
            "BusinessInteraction",
            "BusinessEvent",
            "BusinessService",
            "BusinessObject",
            "Representation",
            "ApplicationComponent",
            "ApplicationCollaboration",
            "ApplicationInterface",
            "ApplicationProcess",
            "ApplicationFunction",
            "ApplicationInteraction",
            "ApplicationEvent",
            "ApplicationService",
            "DataObject",
        ),
    },
    {
        "key": "product",
        "name": "Product",
        "icon": "shopping_bag",
        "layer": "business",
        "description": (
            "Shows everything a product is made of: the business and application services it "
            "bundles, plus its contract and the value it offers."
        ),
        "objects": (
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
            "Product",
            "Contract",
            "ApplicationComponent",
            "ApplicationCollaboration",
            "ApplicationInterface",
            "ApplicationProcess",
            "ApplicationFunction",
            "ApplicationInteraction",
            "ApplicationEvent",
            "ApplicationService",
            "DataObject",
            "TechnologyService",
            "Artifact",
            "Material",
            "Value",
        ),
    },
    {
        "key": "application-cooperation",
        "name": "Application Cooperation",
        "icon": "hub",
        "layer": "application",
        "description": (
            "Shows how software components connect and exchange data with each other to support "
            "the business."
        ),
        "objects": (
            "Location",
            "ApplicationComponent",
            "ApplicationCollaboration",
            "ApplicationInterface",
            "ApplicationProcess",
            "ApplicationFunction",
            "ApplicationInteraction",
            "ApplicationEvent",
            "ApplicationService",
            "DataObject",
        ),
    },
    {
        "key": "application-usage",
        "name": "Application Usage",
        "icon": "cloud",
        "layer": "application",
        "description": (
            "Shows how business processes and roles actually use software applications to get "
            "their work done."
        ),
        "objects": (
            "BusinessActor",
            "BusinessRole",
            "BusinessCollaboration",
            "BusinessProcess",
            "BusinessFunction",
            "BusinessInteraction",
            "BusinessEvent",
            "BusinessObject",
            "ApplicationComponent",
            "ApplicationCollaboration",
            "ApplicationInterface",
            "ApplicationProcess",
            "ApplicationFunction",
            "ApplicationInteraction",
            "ApplicationEvent",
            "ApplicationService",
            "DataObject",
        ),
    },
    {
        "key": "implementation-and-deployment",
        "name": "Implementation and Deployment",
        "icon": "deployed_code",
        "layer": "application",
        "description": (
            "Shows which pieces of hardware and system software run which application "
            "components, and how they depend on each other."
        ),
        "objects": (
            "ApplicationComponent",
            "ApplicationCollaboration",
            "ApplicationInterface",
            "ApplicationProcess",
            "ApplicationFunction",
            "ApplicationInteraction",
            "ApplicationEvent",
            "ApplicationService",
            "DataObject",
            "SystemSoftware",
            "TechnologyInterface",
            "Path",
            "TechnologyProcess",
            "TechnologyFunction",
            "TechnologyInteraction",
            "TechnologyService",
            "Artifact",
        ),
    },
    {
        "key": "technology",
        "name": "Technology",
        "icon": "dns",
        "layer": "technology",
        "description": (
            "Shows the hardware, networks, and system software an organization has, and how they "
            "connect to each other."
        ),
        "objects": (
            "Location",
            "Node",
            "TechnologyCollaboration",
            "Device",
            "SystemSoftware",
            "TechnologyInterface",
            "CommunicationNetwork",
            "Path",
            "TechnologyProcess",
            "TechnologyFunction",
            "TechnologyInteraction",
            "TechnologyService",
            "TechnologyEvent",
            "Artifact",
        ),
    },
    {
        "key": "technology-usage",
        "name": "Technology Usage",
        "icon": "settings_suggest",
        "layer": "technology",
        "description": (
            "Shows how software applications rely on specific pieces of technology "
            "infrastructure to run."
        ),
        "objects": (
            "ApplicationComponent",
            "ApplicationCollaboration",
            "ApplicationProcess",
            "ApplicationFunction",
            "ApplicationInteraction",
            "ApplicationEvent",
            "DataObject",
            "Node",
            "Device",
            "TechnologyCollaboration",
            "SystemSoftware",
            "TechnologyInterface",
            "CommunicationNetwork",
            "Path",
            "TechnologyProcess",
            "TechnologyFunction",
            "TechnologyInteraction",
            "TechnologyService",
            "TechnologyEvent",
            "Artifact",
        ),
    },
    {
        "key": "information-structure",
        "name": "Information Structure",
        "icon": "schema",
        "layer": "application",
        "description": (
            "Shows the pieces of information an organization works with, what they mean, and how "
            "they relate to each other, like an entity diagram."
        ),
        "objects": ("BusinessObject", "Representation", "DataObject", "Artifact", "Meaning"),
    },
    {
        "key": "service-realization",
        "name": "Service Realization",
        "icon": "design_services",
        "layer": "business",
        "description": (
            "Shows how a business service is actually delivered underneath, by which processes, "
            "roles, and supporting applications."
        ),
        "objects": (
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
            "Representation",
            "ApplicationComponent",
            "ApplicationCollaboration",
            "ApplicationInterface",
            "ApplicationProcess",
            "ApplicationFunction",
            "ApplicationInteraction",
            "ApplicationEvent",
            "ApplicationService",
            "DataObject",
        ),
    },
    {
        "key": "physical",
        "name": "Physical",
        "icon": "warehouse",
        "layer": "technology",
        "description": (
            "Shows physical things, like equipment, buildings, and transport networks, and how "
            "they connect to the technology infrastructure."
        ),
        "objects": (
            "Location",
            "Node",
            "Device",
            "Equipment",
            "Facility",
            "Path",
            "CommunicationNetwork",
            "DistributionNetwork",
            "Material",
        ),
    },
    {
        "key": "layered",
        "name": "Layered",
        "icon": "layers",
        "layer": "business",
        "description": (
            "Shows one big picture spanning every layer, strategy down to technology, with how "
            "each layer supports the one above it."
        ),
        # Every key in taxonomy.ALL_ELEMENT_TYPES (all 7 layers plus the 4
        # "Other" rows), read directly rather than a literal list so a future
        # new element type is automatically included.
        "objects": taxonomy.ALL_ELEMENT_TYPES,
    },
    {
        "key": "stakeholder",
        "name": "Stakeholder",
        "icon": "groups",
        "layer": "motivation",
        "description": (
            "Shows who has a stake in the architecture and what drives their concerns, "
            "assessments, and goals."
        ),
        "objects": ("Stakeholder", "Driver", "Assessment", "Goal", "Outcome"),
    },
    {
        "key": "goal-realization",
        "name": "Goal Realization",
        "icon": "flag",
        "layer": "motivation",
        "description": (
            "Shows how a high-level goal breaks down into smaller goals, principles, and "
            "requirements that make it achievable."
        ),
        "objects": ("Goal", "Principle", "Requirement", "Constraint", "Outcome"),
    },
    {
        "key": "requirements-realization",
        "name": "Requirements Realization",
        "icon": "checklist",
        "layer": "motivation",
        "description": (
            "Shows how specific requirements and constraints are actually met by the "
            "architecture, tied back to goals and outcomes."
        ),
        "objects": ("Goal", "Requirement", "Constraint", "Outcome", "Value", "Meaning"),
    },
    {
        "key": "motivation",
        "name": "Motivation",
        "icon": "psychology",
        "layer": "motivation",
        "description": (
            "Shows the full chain of reasoning behind an architecture: stakeholders, drivers, "
            "goals, principles, requirements, and the values behind them."
        ),
        "objects": (
            "Stakeholder",
            "Driver",
            "Assessment",
            "Goal",
            "Principle",
            "Requirement",
            "Constraint",
            "Outcome",
            "Value",
            "Meaning",
        ),
    },
    {
        "key": "strategy",
        "name": "Strategy",
        "icon": "route",
        "layer": "strategy",
        "description": (
            "Shows an organization's strategic direction: the resources and capabilities it has, "
            "and the courses of action it plans to take."
        ),
        "objects": ("CourseOfAction", "Capability", "Resource", "Outcome"),
    },
    {
        "key": "capability-map",
        "name": "Capability Map",
        "icon": "grid_view",
        "layer": "strategy",
        "description": (
            "Shows an organization's capabilities and the resources that back each one up."
        ),
        "objects": ("Outcome", "Capability", "Resource"),
    },
    {
        "key": "outcome-realization",
        "name": "Outcome Realization",
        "icon": "emoji_events",
        "layer": "strategy",
        "description": (
            "Shows how a capability, backed by resources, produces a real outcome and the value "
            "that outcome creates."
        ),
        "objects": ("Capability", "Resource", "Outcome", "Value", "Meaning"),
    },
    {
        "key": "resource-map",
        "name": "Resource Map",
        "icon": "inventory_2",
        "layer": "strategy",
        "description": (
            "Shows which resources support which capabilities, and which work packages are "
            "changing them."
        ),
        "objects": ("Resource", "Capability", "WorkPackage"),
    },
    {
        "key": "project",
        "name": "Project",
        "icon": "work",
        "layer": "implementation",
        "description": (
            "Shows how planned work, like projects and deliverables, moves an organization's "
            "goals and roles forward."
        ),
        "objects": (
            "Goal",
            "WorkPackage",
            "ImplementationEvent",
            "Deliverable",
            "BusinessActor",
            "BusinessRole",
        ),
    },
    {
        "key": "migration",
        "name": "Migration",
        "icon": "swap_horiz",
        "layer": "implementation",
        "description": (
            "Shows the stepping stones between where the architecture is now and where it's "
            "heading, and the gaps between them."
        ),
        "objects": ("Plateau", "Gap"),
    },
    {
        "key": "implementation-and-migration",
        "name": "Implementation and Migration",
        "icon": "landscape",
        "layer": "implementation",
        "description": (
            "Shows the planning and execution of architectural change together: goals, work "
            "packages, deliverables, plateaus, and the gaps that remain."
        ),
        "objects": (
            "Goal",
            "Requirement",
            "Constraint",
            "WorkPackage",
            "ImplementationEvent",
            "Deliverable",
            "Plateau",
            "Gap",
            "BusinessActor",
            "BusinessRole",
            "Location",
        ),
    },
]

# (viewpoint_key, tab_key, card_type_key) -- which card type(s) a card detail
# tab should suggest creating for a given viewpoint.
_TAB_CARD_DEFS: list[tuple[str, str, str]] = [
    ("implementation-and-deployment", "application", "Application"),
    ("implementation-and-deployment", "technology", "ITComponent"),
    ("implementation-and-deployment", "technology", "Platform"),
    ("migration", "business", "Initiative"),
    ("migration", "application", "Application"),
    ("migration", "application", "DataObject"),
    ("migration", "technology", "ITComponent"),
    ("migration", "technology", "Platform"),
    ("project", "business", "Initiative"),
    ("project", "application", "Application"),
    ("project", "application", "DataObject"),
    ("project", "technology", "ITComponent"),
    ("project", "technology", "Platform"),
    ("implementation-and-migration", "business", "Initiative"),
    ("implementation-and-migration", "application", "Application"),
    ("implementation-and-migration", "application", "DataObject"),
    ("implementation-and-migration", "technology", "ITComponent"),
    ("implementation-and-migration", "technology", "Platform"),
]


async def seed_viewpoints(db: AsyncSession) -> None:
    """Seed the 23 standard viewpoints and their tab->card overrides.

    Idempotent and insert-only, same contract as ``seed_enterprise_objects``:
    a viewpoint is added (with its full ``ArchimateViewpointObject`` set) only
    the first time its ``key`` is missing -- once the row exists, nothing here
    touches it or its object list again, so an admin's edit (e.g. through the
    Task 5 tag-chip editor) survives a later boot.

    The tab->card overrides are tracked per-triple against the rows currently
    in ``ArchimateViewpointTabCard`` rather than through a seed_markers-style
    durable marker: nothing in this feature set yet lets an admin remove one
    of these suggestion rows (unlike ``EnterpriseObjectCardMapping`` -- Admin ->
    Metamodel -> ARCHI MAP), so there is no "empty table == never seeded"
    trap to guard against today.
    # ponytail: plain existing-rows check, not a durable marker -- revisit if
    # a later task adds an editor that lets an admin delete one of these rows.
    """
    existing_result = await db.execute(select(ArchimateViewpoint.key))
    existing_keys = set(existing_result.scalars().all())

    for sort_order, vp in enumerate(_VIEWPOINT_DEFS):
        if vp["key"] in existing_keys:
            continue
        db.add(
            ArchimateViewpoint(
                key=vp["key"],
                name=vp["name"],
                icon=vp["icon"],
                description=vp["description"],
                layer=vp["layer"],
                is_standard=True,
                sort_order=sort_order,
            )
        )
        for enterprise_object_key in vp["objects"]:
            db.add(
                ArchimateViewpointObject(
                    viewpoint_key=vp["key"],
                    enterprise_object_key=enterprise_object_key,
                )
            )

    existing_tc_result = await db.execute(
        select(
            ArchimateViewpointTabCard.viewpoint_key,
            ArchimateViewpointTabCard.tab_key,
            ArchimateViewpointTabCard.card_type_key,
        )
    )
    existing_triples = {tuple(row) for row in existing_tc_result.all()}

    for viewpoint_key, tab_key, card_type_key in _TAB_CARD_DEFS:
        triple = (viewpoint_key, tab_key, card_type_key)
        if triple in existing_triples:
            continue
        existing_triples.add(triple)
        db.add(
            ArchimateViewpointTabCard(
                viewpoint_key=viewpoint_key,
                tab_key=tab_key,
                card_type_key=card_type_key,
            )
        )
