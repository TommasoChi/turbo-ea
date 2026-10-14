"""Response shape of GET /reports/value-chain.

The report handlers in ``app/api/v1/reports.py`` return plain dicts and declare
no ``response_model``; these models document the payload built by
``app.services.value_chain_report.build_chain_payload`` and are validated
against the live response in ``tests/api/test_reports_value_chain.py``.

The payload carries keys, never presentation: ``process_type`` is a band key,
not a colour or a translated label.
"""

from __future__ import annotations

from pydantic import BaseModel


class ValueChainBox(BaseModel):
    """One BusinessProcess card drawn as a box."""

    id: str
    name: str
    # Some card has this one as parent_id (the drill-down "+").
    has_children: bool
    # Descendants at any depth, by subtype.
    group_count: int
    process_count: int
    # Distinct LEAF BusinessContext cards under the card's relProcessToBizCtx targets.
    value_stream_count: int
    # Distinct valueGate Objectives linked (relObjectiveToBizCtx) to one of those leaves.
    value_gate_count: int
    # Band key of the card's own processType: management | core | support | not_set.
    process_type: str


class ValueChainBand(BaseModel):
    key: str  # management | core | support | not_set, always all four, in that order
    boxes: list[ValueChainBox]  # category cards only, ordered by name


class CoreHouseStream(BaseModel):
    """A BusinessContext card in the Core house (level 1 chevron or level 2 box)."""

    id: str
    name: str


class CoreHouse(BaseModel):
    # Root valueStream cards with hierarchyLevel 1 and isCore, successor-chain order.
    level_one: list[CoreHouseStream]
    # str(level-1 id) -> its direct children, successor-chain order.
    level_two: dict[str, list[CoreHouseStream]]
    # str(level-1 id) -> BusinessProcess cards linked straight to it, by name.
    level_three: dict[str, list[ValueChainBox]]


class ValueChainResponse(BaseModel):
    bands: list[ValueChainBand]
    core_house: CoreHouse
