"""Response shapes of GET /reports/value-chain and its drill-down
GET /reports/value-chain/{category_id}.

The report handlers in ``app/api/v1/reports.py`` return plain dicts and declare
no ``response_model``; these models document the payloads built by
``app.services.value_chain_report.build_chain_payload`` and
``build_stream_payload``, and are validated against the live responses in
``tests/api/test_reports_value_chain.py`` and ``test_reports_value_stream.py``.

The payloads carry keys, never presentation: ``process_type`` is a band key,
attribute values are raw option keys, never a colour or a translated label.
"""

from __future__ import annotations

from typing import Any

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


# --- GET /reports/value-chain/{category_id} ----------------------------------
# All ids are strings. "Leaf" = a BusinessContext with no visible child under
# a root; "countable leaves" = the ordered sequence followed by the
# cross-cutting leaves (gates, capabilities and processes of a cross-cutting
# leaf count even though it has no column of its own).


class ValueStreamLeaf(BaseModel):
    """A leaf value stream (a chevron)."""

    id: str
    name: str
    # The leaf's immediate parent, used to group a run of consecutive leaves in
    # a titled container; None when that parent is the root itself (or the
    # leaf is the childless root). parent_name is None when the parent is not
    # visible.
    parent_id: str | None
    parent_name: str | None


class ValueStreamSpan(BaseModel):
    """One standalone process covering consecutive sequence leaves: one box."""

    process_id: str
    start_index: int  # into `sequence`, inclusive
    end_index: int  # inclusive
    leaf_ids: list[str]


class ValueStreamSingle(BaseModel):
    """A standalone process on non-contiguous leaves: one box per leaf.

    The same item is also listed in `leaf_processes` for that leaf.
    """

    process_id: str
    leaf_id: str
    index: int  # into `sequence`


class ValueStreamTreeItem(BaseModel):
    """A top-level Process-band box. A container when `children` is not empty:
    a card is a container only when another card of the SAME leaf list has it
    as parent. Details of every id are in the root's `processes`."""

    id: str
    children: list[str]  # by name


class RelatedItem(BaseModel):
    id: str
    name: str


class ValueStreamProcess(BaseModel):
    id: str
    name: str
    subtype: str | None  # category | group | process | variant
    # BPMN steps of the process; 0 without bpm.view.
    element_count: int
    # Raw option keys of the "Color by" fields: processType, maturity,
    # automationLevel, riskLevel (None when unset).
    color_attributes: dict[str, Any]
    # Distinct cards linked on the process's OWN steps for `?related=`
    # (Application / DataObject / Organization), by name; [] for `none`.
    related: list[RelatedItem]


class ValueStreamGate(BaseModel):
    """A valueGate Objective linked (relObjectiveToBizCtx) to a countable leaf."""

    id: str
    name: str
    leaf_id: str
    objective_type: str | None  # raw objectiveType option key


class ValueStreamCapability(BaseModel):
    """A BusinessCapability linked (relBizCtxToBC) to a countable leaf."""

    id: str
    name: str
    leaf_id: str
    # Its immediate visible parent capability, else the capability itself.
    group_id: str
    group_name: str


class ValueStreamGoal(BaseModel):
    """A businessGoal Objective linked (relObjectiveToBizCtx) to the root itself."""

    id: str
    name: str
    description: str | None


class ValueStreamRoot(BaseModel):
    """One value stream the category realizes (relProcessToBizCtx), by name."""

    id: str
    name: str
    # Leaves not flagged isCross, in successor-chain order, then
    # sortOrder/stageOrder, then name.
    sequence: list[ValueStreamLeaf]
    # isCross leaves (full-width bars), by levelOrder then name.
    cross: list[ValueStreamLeaf]
    spans: list[ValueStreamSpan]
    singles: list[ValueStreamSingle]
    # str(sequence leaf id) -> the boxes in that leaf's own column: its tree
    # minus every process drawn as a span. One key per sequence leaf.
    leaf_processes: dict[str, list[ValueStreamTreeItem]]
    # Distinct top-level boxes of all cross-cutting leaves, full width.
    cross_processes: list[ValueStreamTreeItem]
    # Distinct levelOrder rows used by the band's top-level boxes, unleveled
    # last; 0 when the band is empty (the page still reserved one row).
    row_count: int
    # str(process id) -> row, for every distinct top-level box of the band.
    row_of_process: dict[str, int]
    # Band header count: sum of each countable leaf's process list length.
    process_count: int
    # str(process id) -> details, for every card in any countable leaf's list.
    processes: dict[str, ValueStreamProcess]
    # Per countable leaf in order, by name within a leaf.
    gates: list[ValueStreamGate]
    capabilities: list[ValueStreamCapability]
    goals: list[ValueStreamGoal]  # by name


class ValueStreamResponse(BaseModel):
    roots: list[ValueStreamRoot]
