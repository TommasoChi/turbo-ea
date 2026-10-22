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
        "Figure 4: Business Goals Associated with the Driver Profitability (v3.1)",
        "fig04.xml",
    ),
    ("layered", "Figure 6: Goal Refinement View for Rationalization Strategy", "fig06.xml"),
    ("layered", "Figure 7: Strategy View for Digital Customer Intimacy Strategy", "fig07.xml"),
    ("layered", "Figure 8: Solution Concept View", "fig08.xml"),
    ("organization", "Figure 9: Organization View", "fig09.xml"),
    ("layered", "Figure 11: Value Stream", "fig11.xml"),
    ("capability-map", "Figure 12: Capability Model", "fig12.xml"),
    ("layered", "Figure 13: Value Stream and Capability Cross-Mapping", "fig13.xml"),
    ("application-usage", "Figure 14: Business Function View (Baseline)", "fig14.xml"),
    ("layered", "Figure 15: Capability Realization", "fig15.xml"),
    ("application-usage", "Figure 16: Business Process View", "fig16.xml"),
    ("layered", "Figure 18: Requirements Realization View", "fig18.xml"),
    ("capability-map", "Figure 19: Capabilities Gap Analysis", "fig19.xml"),
    ("capability-map", "Figure 20: Resource Map View", "fig20.xml"),
    ("layered", "Figure 21: Resource Realization View", "fig21.xml"),
    ("application-cooperation", "Figure 22: Application Cooperation (Baseline)", "fig22.xml"),
    ("application-cooperation", "Figure 23: Application Cooperation (Target)", "fig23.xml"),
    ("application-usage", "Figure 24: Application Usage (Baseline)", "fig24.xml"),
    ("layered", "Figure 25: Application Behavior (Target)", "fig25.xml"),
    ("application-cooperation", "Figure 26: Application Architecture - Gap Analysis", "fig26.xml"),
    ("information-structure", "Figure 27: Information Structure", "fig27.xml"),
    ("application-usage", "Figure 28: Data Dissemination View", "fig28.xml"),
    ("technology", "Figure 29: Infrastructure View (Baseline)", "fig29.xml"),
    ("technology", "Figure 30: Infrastructure View (Target)", "fig30.xml"),
    ("physical", "Figure 31: Data Acquisition from IoT Services (Baseline)", "fig31.xml"),
    ("layered", "Figure 32: IoT Device Services (Target)", "fig32.xml"),
    ("technology", "Figure 33: Technology Architecture: Gap Analysis", "fig33.xml"),
    ("layered", "Figure 35: TOGAF Project Context Diagram", "fig35.xml"),
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
