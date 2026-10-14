"""Value Chain / Value Stream layout — pure transforms.

Ported from the retired `value-chain` extension's `bandModel.mjs`. Kept as
plain functions on purpose: mutmut does not mutate decorated functions, so
logic that must carry a mutation score cannot live in a route handler.

Only `category` (level 0) BusinessProcess cards render as boxes; the band is
the category card's own `attributes.processType`.
"""

from __future__ import annotations

import unicodedata
import uuid
from collections.abc import Iterable
from typing import Any

BAND_KEYS: tuple[str, ...] = ("management", "core", "support", "not_set")

_FAR_LAST = 999  # same "no value sorts last" convention as the original


def band_key_for(process_type: str | None) -> str:
    return process_type if process_type in ("core", "support", "management") else "not_set"


def is_flag_true(value: Any) -> bool:
    """Tolerant boolean read for admin-set flags (isCore, isCross).

    Some installs carry the STRING "True"/"true" instead of a JSON boolean —
    verified live on isCore. A strict `is True` would drop those rows silently.
    """
    return value is True or (isinstance(value, str) and value.lower() == "true")


def _num(value: Any, default: float) -> float:
    if value is None or isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _name_key(name: str) -> tuple[str, str]:
    """Name sort key approximating the original `localeCompare`.

    ponytail: stdlib approximation — case- and accent-insensitive primary
    order, raw name as the final tie-break. NOT full ICU collation (digit and
    punctuation weighting, language-specific rules). Swap in a collation
    library only if a visibly wrong ordering is reported.
    """
    decomposed = unicodedata.normalize("NFD", name.casefold())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)), name


def _children_by_parent(cards: Iterable[Any]) -> dict[uuid.UUID, list[Any]]:
    out: dict[uuid.UUID, list[Any]] = {}
    for card in cards:
        if card.parent_id is None:
            continue
        out.setdefault(card.parent_id, []).append(card)
    return out


def collect_descendants_by_subtype(
    cards: Iterable[Any], root_id: uuid.UUID, subtypes: str | Iterable[str]
) -> list[Any]:
    """Every descendant with one of `subtypes`, at any depth."""
    wanted = {subtypes} if isinstance(subtypes, str) else set(subtypes)
    children = _children_by_parent(cards)
    found: list[Any] = []
    stack = [root_id]
    seen: set[uuid.UUID] = set()
    while stack:
        current = stack.pop()
        if current in seen:  # a cycle in parent_id would otherwise spin forever
            continue
        seen.add(current)
        for child in children.get(current, []):
            if child.subtype in wanted:
                found.append(child)
            stack.append(child.id)
    return found


def collect_leaf_ids(cards: Iterable[Any], root_id: uuid.UUID) -> list[uuid.UUID]:
    """Leaf ids of the subtree at `root_id`, including `root_id` when childless."""
    children = _children_by_parent(cards)
    leaves: list[uuid.UUID] = []
    stack = [root_id]
    seen: set[uuid.UUID] = set()
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        kids = children.get(current, [])
        if not kids:
            leaves.append(current)
        else:
            stack.extend(kid.id for kid in kids)
    return leaves


def split_cross_cutting(leaves: Iterable[Any]) -> tuple[list[Any], list[Any]]:
    """Cross-cutting value streams (isCross) out of the chevron sequence.

    A cross-cutting stream spans a whole flow and has no single position in
    the sequence, so it is rendered as its own full-width band. `levelOrder`
    stacks several of them relative to each other, ascending.
    """
    cross = [leaf for leaf in leaves if is_flag_true((leaf.attributes or {}).get("isCross"))]
    sequence = [leaf for leaf in leaves if not is_flag_true((leaf.attributes or {}).get("isCross"))]
    cross.sort(
        key=lambda c: (_num((c.attributes or {}).get("levelOrder"), _FAR_LAST), _name_key(c.name))
    )
    return cross, sequence


def _rest_sort_key(card: Any) -> tuple[float, tuple[str, str]]:
    attrs = card.attributes or {}
    raw = attrs.get("sortOrder")
    if raw is None:
        raw = attrs.get("stageOrder")
    return (_num(raw, _FAR_LAST), _name_key(card.name))


def order_leaves(leaves: list[Any], successor_rels: Iterable[Any]) -> list[Any]:
    """Order leaves by the successor chain, then by sortOrder/stageOrder, name.

    `relBusinessContextSuccessor`: source *succeeds* target, so the TARGET
    comes first. Relations pointing outside `leaves` are ignored, and a cycle
    terminates because each id is visited once.
    """
    in_set = {card.id: card for card in leaves}
    next_of: dict[uuid.UUID, uuid.UUID] = {}
    has_prev: set[uuid.UUID] = set()
    for rel in successor_rels:
        if rel.source_id not in in_set or rel.target_id not in in_set:
            continue
        next_of[rel.target_id] = rel.source_id
        has_prev.add(rel.source_id)

    ordered: list[Any] = []
    visited: set[uuid.UUID] = set()
    for start in [c for c in leaves if c.id not in has_prev and c.id in next_of]:
        current: uuid.UUID | None = start.id
        while current is not None and current in in_set and current not in visited:
            visited.add(current)
            ordered.append(in_set[current])
            current = next_of.get(current)

    rest = sorted((c for c in leaves if c.id not in visited), key=_rest_sort_key)
    return ordered + rest


def group_contiguous_process_spans(
    ordered_leaf_ids: list[uuid.UUID], leaf_process_ids: dict[uuid.UUID, list[uuid.UUID]]
) -> tuple[list[dict], list[dict]]:
    """One box spanning several leaves when a process covers a consecutive run.

    Non-contiguous leaves get one box per leaf instead: no single rectangle
    would be honest about the step it skips.
    """
    index_of = {leaf_id: i for i, leaf_id in enumerate(ordered_leaf_ids)}
    indices_by_process: dict[uuid.UUID, list[int]] = {}
    for leaf_id in ordered_leaf_ids:
        for process_id in leaf_process_ids.get(leaf_id, []):
            indices_by_process.setdefault(process_id, []).append(index_of[leaf_id])

    spans: list[dict] = []
    singles: list[dict] = []
    for process_id, raw in indices_by_process.items():
        indices = sorted(raw)
        contiguous = len(indices) > 1 and indices[-1] - indices[0] + 1 == len(indices)
        if contiguous:
            spans.append(
                {
                    "process_id": process_id,
                    "start_index": indices[0],
                    "end_index": indices[-1],
                    "leaf_ids": [ordered_leaf_ids[i] for i in indices],
                }
            )
        else:
            singles.extend(
                {"process_id": process_id, "leaf_id": ordered_leaf_ids[i], "index": i}
                for i in indices
            )
    return spans, singles


def assign_process_level_rows(process_levels: list[dict]) -> tuple[dict[uuid.UUID, int], int]:
    """Bucket processes into vertical rows by their own `levelOrder`.

    Rows are relative: levels 5 and 10 with nothing between them produce rows
    0 and 1. Processes with no level land together in one trailing row.
    """
    levels = [p.get("level_order") for p in process_levels]
    # Raw values stay the keys (like the JS Set/Map); only the ORDER is numeric.
    distinct = sorted({lvl for lvl in levels if lvl is not None}, key=lambda v: _num(v, _FAR_LAST))
    row_of_level = {level: i for i, level in enumerate(distinct)}
    unleveled_row = len(distinct)
    has_unleveled = any(lvl is None for lvl in levels)
    row_of_process_id = {
        p["process_id"]: unleveled_row if lvl is None else row_of_level[lvl]
        for p, lvl in zip(process_levels, levels, strict=True)
    }
    return row_of_process_id, len(distinct) + (1 if has_unleveled else 0)


# --- Aggregate payload for GET /reports/value-chain ---------------------------


def _is_hierarchy_level_one(value: Any) -> bool:
    """The original compared with `=== 1`: a number, never `true` or `"1"`."""
    return not isinstance(value, bool) and isinstance(value, (int, float)) and value == 1


def _house_item(card: Any) -> dict:
    return {"id": str(card.id), "name": card.name}


def build_chain_payload(
    categories: Iterable[Any],
    contexts: Iterable[Any],
    objectives: Iterable[Any],
    process_to_ctx_rels: Iterable[Any],
    objective_rels: Iterable[Any],
    successor_rels: Iterable[Any],
) -> dict:
    """Band/box model plus the Core "house" for the Value Chain page.

    Port of the data side of the extension's `ValueChainReport.mjs` and
    `buildBandModel`. Inputs are card/relation rows already filtered by status,
    archive and read scope; `categories` is EVERY BusinessProcess card, not
    only the category ones, because the counts walk the whole tree.

    A relation counts only when both of its endpoints are in the given card
    lists: the relation queries are not scoped, the card queries are, so a
    relation to a filtered-out card must not produce a phantom count.
    """
    processes = list(categories)
    contexts = list(contexts)
    objectives = list(objectives)
    successor_rels = list(successor_rels)

    process_by_id = {p.id: p for p in processes}
    context_ids = {c.id for c in contexts}
    gate_ids = {o.id for o in objectives if o.subtype == "valueGate"}
    parent_ids = {p.parent_id for p in processes if p.parent_id is not None}

    targets_of: dict[uuid.UUID, set[uuid.UUID]] = {}
    sources_of: dict[uuid.UUID, set[uuid.UUID]] = {}
    for rel in process_to_ctx_rels:
        if rel.source_id in process_by_id and rel.target_id in context_ids:
            targets_of.setdefault(rel.source_id, set()).add(rel.target_id)
            sources_of.setdefault(rel.target_id, set()).add(rel.source_id)

    gates_at: dict[uuid.UUID, set[uuid.UUID]] = {}
    for rel in objective_rels:
        if rel.source_id in gate_ids and rel.target_id in context_ids:
            gates_at.setdefault(rel.target_id, set()).add(rel.source_id)

    def box(card: Any) -> dict:
        # Value streams are the LEAVES under each linked BusinessContext: a
        # linked card may be a container higher up the stream hierarchy.
        leaves: set[uuid.UUID] = set()
        for target_id in targets_of.get(card.id, ()):
            leaves.update(collect_leaf_ids(contexts, target_id))
        gates: set[uuid.UUID] = set()
        for leaf_id in leaves:
            gates |= gates_at.get(leaf_id, set())
        return {
            "id": str(card.id),
            "name": card.name,
            "has_children": card.id in parent_ids,
            "group_count": len(collect_descendants_by_subtype(processes, card.id, "group")),
            "process_count": len(collect_descendants_by_subtype(processes, card.id, "process")),
            "value_stream_count": len(leaves),
            "value_gate_count": len(gates),
            "process_type": band_key_for((card.attributes or {}).get("processType")),
        }

    def by_name(cards: Iterable[Any]) -> list[Any]:
        # The id tie-break keeps same-name cards in a stable order across calls.
        return sorted(cards, key=lambda c: (_name_key(c.name), str(c.id)))

    boxes_by_band: dict[str, list[dict]] = {key: [] for key in BAND_KEYS}
    for card in by_name(p for p in processes if p.subtype == "category"):
        built = box(card)
        boxes_by_band[built["process_type"]].append(built)

    # Level 1 needs BOTH "no parent" and hierarchyLevel 1: the two signals
    # disagree on live data and the intersection is the deliberate choice.
    level_one = order_leaves(
        [
            c
            for c in contexts
            if c.subtype == "valueStream"
            and c.parent_id is None
            and _is_hierarchy_level_one((c.attributes or {}).get("hierarchyLevel"))
            and is_flag_true((c.attributes or {}).get("isCore"))
        ],
        successor_rels,
    )
    children = _children_by_parent(contexts)
    level_two: dict[str, list[dict]] = {}
    level_three: dict[str, list[dict]] = {}
    for root in level_one:
        key = str(root.id)
        level_two[key] = [
            _house_item(c) for c in order_leaves(children.get(root.id, []), successor_rels)
        ]
        # Processes linked straight to the level-1 card, not to a level-2 child.
        level_three[key] = [
            box(p) for p in by_name(process_by_id[pid] for pid in sources_of.get(root.id, ()))
        ]

    return {
        "bands": [{"key": key, "boxes": boxes_by_band[key]} for key in BAND_KEYS],
        "core_house": {
            "level_one": [_house_item(c) for c in level_one],
            "level_two": level_two,
            "level_three": level_three,
        },
    }
