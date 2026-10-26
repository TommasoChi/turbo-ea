"""Seed starter ``ArchimateViewpointExample`` rows from the bundled Exchange
Format XML fixtures in ``viewpoint_examples/``.

Same source and intent as the TOGAF ADM / ArchiSurance reference walkthrough
used throughout the catalog's own design (see ``viewpoint_seed.py``): each
fixture is one named figure from that walkthrough, trimmed down to just the
elements and relationships its own diagram actually uses (the walkthrough's
source files are cumulative across figures -- converting a later figure's
whole file would drag in every earlier figure's content too) and pre-converted
to Exchange Format XML, so this seed only has to read and insert, the same
division of labor as ``bpm.py``'s ``TEMPLATES`` + ``bpmn_templates/*.bpmn``.

Idempotent and insert-only on the natural key (``viewpoint_key``, ``name``):
once a figure's row exists, an admin's own edit or deletion of it survives a
later boot, exactly like ``seed_viewpoints``.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.archimate_viewpoint import ArchimateViewpointExample

_FIXTURES_DIR = Path(__file__).parent / "viewpoint_examples"

# (viewpoint_key, name, fixture filename) -- figure numbers and titles are
# from the walkthrough's own per-phase description files; viewpoint_key is
# the standard viewpoint whose `objects` list fully covers the figure's
# element types (or "layered" when no single viewpoint does, which is
# expected for these ADM figures: they deliberately mix layers).
_EXAMPLE_DEFS: list[tuple[str, str, str]] = [
    (
        "stakeholder",
        "Business Goals Associated with the Driver Profitability (v3.1)",
        "fig04.xml",
    ),
    ("layered", "Goal Refinement View for Rationalization Strategy", "fig06.xml"),
    ("layered", "Strategy View for Digital Customer Intimacy Strategy", "fig07.xml"),
    ("layered", "Solution Concept View", "fig08.xml"),
    ("organization", "Organization View", "fig09.xml"),
    ("layered", "Value Stream", "fig11.xml"),
    ("capability-map", "Capability Model", "fig12.xml"),
    ("value-stream", "Value Stream and Capability Cross-Mapping", "fig13.xml"),
    ("application-usage", "Business Function View (Baseline)", "fig14.xml"),
    ("layered", "Capability Realization", "fig15.xml"),
    ("application-usage", "Business Process View", "fig16.xml"),
    ("requirements-realization", "Requirements Realization View", "fig18.xml"),
    ("capability-map", "Capabilities Gap Analysis", "fig19.xml"),
    ("capability-map", "Resource Map View", "fig20.xml"),
    ("layered", "Resource Realization View", "fig21.xml"),
    ("application-cooperation", "Application Cooperation (Baseline)", "fig22.xml"),
    ("application-cooperation", "Application Cooperation (Target)", "fig23.xml"),
    ("application-usage", "Application Usage (Baseline)", "fig24.xml"),
    ("layered", "Application Behavior (Target)", "fig25.xml"),
    ("application-cooperation", "Application Architecture - Gap Analysis", "fig26.xml"),
    ("information-structure", "Information Structure", "fig27.xml"),
    ("application-usage", "Data Dissemination View", "fig28.xml"),
    ("technology", "Infrastructure View (Baseline)", "fig29.xml"),
    ("technology", "Infrastructure View (Target)", "fig30.xml"),
    ("physical", "Data Acquisition from IoT Services (Baseline)", "fig31.xml"),
    ("layered", "IoT Device Services (Target)", "fig32.xml"),
    ("technology", "Technology Architecture: Gap Analysis", "fig33.xml"),
    ("layered", "TOGAF Project Context Diagram", "fig35.xml"),
]


async def seed_viewpoint_examples(db: AsyncSession) -> None:
    existing_result = await db.execute(
        select(ArchimateViewpointExample.viewpoint_key, ArchimateViewpointExample.name)
    )
    existing = {tuple(row) for row in existing_result.all()}

    for viewpoint_key, name, filename in _EXAMPLE_DEFS:
        if (viewpoint_key, name) in existing:
            continue
        exchange_xml = (_FIXTURES_DIR / filename).read_text(encoding="utf-8")
        db.add(
            ArchimateViewpointExample(
                viewpoint_key=viewpoint_key,
                name=name,
                exchange_xml=exchange_xml,
            )
        )
