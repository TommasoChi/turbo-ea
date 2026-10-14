"""`build_chain_payload` — the aggregate behind GET /reports/value-chain.

Ports the extension's `buildBandModel` tests (bandModel.test.mjs,
describe("buildBandModel")) plus the counts and the Core "house" that
ValueChainReport.mjs computed in the browser. Every value is pinned exactly:
mutation tooling is not available locally, so the assertions have to kill
mutants on their own.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from app.services.value_chain_report import build_chain_payload, collect_leaf_ids


@dataclass
class C:
    """Minimal stand-in for a Card row."""

    name: str
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    parent_id: uuid.UUID | None = None
    subtype: str | None = None
    attributes: dict | None = field(default_factory=dict)


@dataclass
class R:
    source_id: uuid.UUID
    target_id: uuid.UUID


def payload(
    categories=(),
    contexts=(),
    objectives=(),
    process_to_ctx_rels=(),
    objective_rels=(),
    successor_rels=(),
):
    return build_chain_payload(
        categories=list(categories),
        contexts=list(contexts),
        objectives=list(objectives),
        process_to_ctx_rels=list(process_to_ctx_rels),
        objective_rels=list(objective_rels),
        successor_rels=list(successor_rels),
    )


def band(result, key):
    return {b["key"]: b for b in result["bands"]}[key]["boxes"]


def box_names(result, key):
    return [b["name"] for b in band(result, key)]


def only_box(result, key="core"):
    boxes = band(result, key)
    assert len(boxes) == 1
    return boxes[0]


def cat(name, process_type="core", **kwargs):
    return C(name, subtype="category", attributes={"processType": process_type}, **kwargs)


def vs(name, parent=None, **attributes):
    return C(
        name,
        subtype="valueStream",
        parent_id=parent.id if parent else None,
        attributes=attributes,
    )


def core_root(name, **extra):
    return vs(name, hierarchyLevel=1, isCore=True, **extra)


# --- buildBandModel port (bandModel.test.mjs, describe("buildBandModel")) ---


def test_always_returns_all_four_bands_even_when_empty():
    """JS: "always returns all 4 bands, even when empty". The whole payload is
    pinned: no extra keys (no `withheld_ids`, ruling R16), empty house."""
    assert payload() == {
        "bands": [
            {"key": "management", "boxes": []},
            {"key": "core", "boxes": []},
            {"key": "support", "boxes": []},
            {"key": "not_set", "boxes": []},
        ],
        "core_house": {"level_one": [], "level_two": {}, "level_three": {}},
    }


def test_sorts_a_category_into_its_process_type_band():
    """JS: "sorts a category into its processType band"."""
    result = payload(
        categories=[
            cat("Finance", "management"),
            cat("Sales", "core"),
            cat("HR", "support"),
        ]
    )
    assert box_names(result, "management") == ["Finance"]
    assert box_names(result, "core") == ["Sales"]
    assert box_names(result, "support") == ["HR"]
    assert box_names(result, "not_set") == []


def test_no_or_unknown_process_type_lands_in_not_set():
    """JS: "a category with no processType (or an unknown value) lands in
    not_set". Also covers `attributes` NULL and a missing processType key."""
    no_type = C("No Type", subtype="category", attributes={})
    null_attrs = C("Null Attrs", subtype="category", attributes=None)
    bogus = cat("Bogus Type", "bogus")
    result = payload(categories=[no_type, null_attrs, bogus])
    assert box_names(result, "not_set") == ["Bogus Type", "No Type", "Null Attrs"]
    assert {b["process_type"] for b in band(result, "not_set")} == {"not_set"}
    for key in ("management", "core", "support"):
        assert band(result, key) == []


def test_has_children_only_when_some_card_points_to_it_as_parent():
    """JS: "hasChildren is true only when some other card points to it"."""
    has_kids = cat("Has kids")
    no_kids = cat("No kids")
    group = C("Group", subtype="group", parent_id=has_kids.id)
    result = payload(categories=[has_kids, no_kids, group])
    flags = {b["name"]: b["has_children"] for b in band(result, "core")}
    assert flags == {"Has kids": True, "No kids": False}


def test_has_children_counts_a_child_of_any_subtype():
    """`parentIds.has(card.id)` in the JS does not look at the child's subtype."""
    parent = cat("Parent")
    odd_child = C("Odd", subtype=None, parent_id=parent.id)
    box = only_box(payload(categories=[parent, odd_child]))
    assert box["has_children"] is True
    assert box["group_count"] == 0
    assert box["process_count"] == 0


def test_counts_groups_and_processes_recursively_per_category():
    """JS: "counts groups and processes recursively per category"."""
    finance = cat("Finance", "management")
    grp1 = C("g1", subtype="group", parent_id=finance.id)
    grp2 = C("g2", subtype="group", parent_id=finance.id)
    nested_group = C("g1.1", subtype="group", parent_id=grp1.id)
    procs = [
        C("p1", subtype="process", parent_id=grp1.id),
        C("p2", subtype="process", parent_id=grp1.id),
        C("p3", subtype="process", parent_id=grp2.id),
        C("p4", subtype="process", parent_id=nested_group.id),
    ]
    variant = C("v1", subtype="variant", parent_id=grp2.id)
    other_cat = cat("Other", "management")
    other_proc = C("other p", subtype="process", parent_id=other_cat.id)
    result = payload(
        categories=[finance, grp1, grp2, nested_group, *procs, variant, other_cat, other_proc]
    )
    boxes = {b["name"]: b for b in band(result, "management")}
    assert (boxes["Finance"]["group_count"], boxes["Finance"]["process_count"]) == (3, 4)
    assert (boxes["Other"]["group_count"], boxes["Other"]["process_count"]) == (0, 1)


def test_only_category_cards_become_boxes():
    """JS: "only subtype 'category' cards become boxes — groups/processes never do"."""
    result = payload(
        categories=[
            C("Stray group", subtype="group", attributes={"processType": "core"}),
            C("Stray process", subtype="process", attributes={"processType": "core"}),
            C("No subtype", subtype=None, attributes={"processType": "core"}),
        ]
    )
    assert all(b["boxes"] == [] for b in result["bands"])


# --- Box shape and ordering ------------------------------------------------


def test_box_carries_every_key_as_plain_values():
    sales = cat("Sales", "support")
    result = payload(categories=[sales])
    assert band(result, "support") == [
        {
            "id": str(sales.id),
            "name": "Sales",
            "has_children": False,
            "group_count": 0,
            "process_count": 0,
            "value_stream_count": 0,
            "value_gate_count": 0,
            "process_type": "support",
        }
    ]


def test_boxes_are_ordered_by_name_case_insensitively():
    """The JS kept /cards order, which the API sorts by name."""
    result = payload(categories=[cat("beta"), cat("Gamma"), cat("Alpha")])
    assert box_names(result, "core") == ["Alpha", "beta", "Gamma"]


# --- Value Stream / Value Gate counts ----------------------------------------


def _stream_tree():
    parent = vs("Order to Cash")
    quote = vs("Quote", parent)
    invoice = vs("Invoice", parent)
    return parent, quote, invoice


def test_value_stream_count_counts_the_leaves_of_a_linked_parent():
    sales = cat("Sales")
    parent, quote, invoice = _stream_tree()
    box = only_box(
        payload(
            categories=[sales],
            contexts=[parent, quote, invoice],
            process_to_ctx_rels=[R(sales.id, parent.id)],
        )
    )
    assert box["value_stream_count"] == 2


def test_value_stream_count_is_a_set_of_distinct_leaves():
    """Linking the parent AND one of its leaves still counts 2 leaves, not 3."""
    sales = cat("Sales")
    parent, quote, invoice = _stream_tree()
    box = only_box(
        payload(
            categories=[sales],
            contexts=[parent, quote, invoice],
            process_to_ctx_rels=[
                R(sales.id, parent.id),
                R(sales.id, quote.id),
                R(sales.id, quote.id),
            ],
        )
    )
    assert box["value_stream_count"] == 2


def test_a_childless_linked_stream_is_its_own_leaf():
    sales = cat("Sales")
    lone = vs("Lone")
    box = only_box(
        payload(categories=[sales], contexts=[lone], process_to_ctx_rels=[R(sales.id, lone.id)])
    )
    assert box["value_stream_count"] == 1


def test_relations_of_another_category_are_not_counted():
    sales = cat("Sales")
    other = cat("Other", "support")
    parent, quote, invoice = _stream_tree()
    gate = C("Gate", subtype="valueGate")
    result = payload(
        categories=[sales, other],
        contexts=[parent, quote, invoice],
        objectives=[gate],
        process_to_ctx_rels=[R(other.id, quote.id)],
        objective_rels=[R(gate.id, quote.id)],
    )
    assert (only_box(result)["value_stream_count"], only_box(result)["value_gate_count"]) == (0, 0)
    assert only_box(result, "support")["value_stream_count"] == 1
    assert only_box(result, "support")["value_gate_count"] == 1


def test_a_relation_to_an_invisible_stream_adds_nothing():
    """The target was filtered out by status/archive/read scope. Without the
    guard `collect_leaf_ids` would return the missing id as its own leaf."""
    sales = cat("Sales")
    invisible = uuid.uuid4()
    box = only_box(payload(categories=[sales], process_to_ctx_rels=[R(sales.id, invisible)]))
    assert box["value_stream_count"] == 0


def test_value_gate_counted_once_when_linked_to_several_leaves():
    sales = cat("Sales")
    parent, quote, invoice = _stream_tree()
    gate = C("Gate 1", subtype="valueGate")
    gate2 = C("Gate 2", subtype="valueGate")
    box = only_box(
        payload(
            categories=[sales],
            contexts=[parent, quote, invoice],
            objectives=[gate, gate2],
            process_to_ctx_rels=[R(sales.id, parent.id)],
            objective_rels=[
                R(gate.id, quote.id),
                R(gate.id, invoice.id),
                R(gate2.id, invoice.id),
            ],
        )
    )
    assert box["value_gate_count"] == 2


def test_value_gate_needs_the_value_gate_subtype():
    sales = cat("Sales")
    lone = vs("Lone")
    plain = C("Plain objective", subtype=None)
    box = only_box(
        payload(
            categories=[sales],
            contexts=[lone],
            objectives=[plain],
            process_to_ctx_rels=[R(sales.id, lone.id)],
            objective_rels=[R(plain.id, lone.id)],
        )
    )
    assert box["value_gate_count"] == 0


def test_value_gate_on_the_non_leaf_parent_is_not_counted():
    """JS reads gates off the LEAF ids only."""
    sales = cat("Sales")
    parent, quote, invoice = _stream_tree()
    gate = C("Gate", subtype="valueGate")
    box = only_box(
        payload(
            categories=[sales],
            contexts=[parent, quote, invoice],
            objectives=[gate],
            process_to_ctx_rels=[R(sales.id, parent.id)],
            objective_rels=[R(gate.id, parent.id)],
        )
    )
    assert box["value_gate_count"] == 0


def test_a_gate_relation_from_an_invisible_objective_adds_nothing():
    sales = cat("Sales")
    lone = vs("Lone")
    box = only_box(
        payload(
            categories=[sales],
            contexts=[lone],
            process_to_ctx_rels=[R(sales.id, lone.id)],
            objective_rels=[R(uuid.uuid4(), lone.id)],
        )
    )
    assert box["value_gate_count"] == 0


def test_a_hidden_parent_does_not_break_the_hierarchy():
    """Review Focus 5: the read scope filters the card list before the layout
    runs, so a child whose parent was filtered out must not crash the walk
    nor be counted under a box it can no longer reach."""
    category = cat("Sales")
    hidden_group = C("Hidden", subtype="group", parent_id=category.id)
    orphan = C("Orphaned child", subtype="process", parent_id=hidden_group.id)

    # The scope removed `hidden_group`; `orphan` survives with a dangling parent.
    visible = [category, orphan]
    result = build_chain_payload(
        categories=visible,
        contexts=[],
        objectives=[],
        process_to_ctx_rels=[],
        objective_rels=[],
        successor_rels=[],
    )
    box = only_box(result)
    assert box["group_count"] == 0
    assert box["process_count"] == 0
    assert box["has_children"] is False
    assert collect_leaf_ids(visible, category.id) == [category.id]


# --- Core house ---------------------------------------------------------------


def test_level_one_needs_no_parent_level_one_core_and_value_stream():
    good = core_root("Good")
    string_flag = vs("String flag", hierarchyLevel=1, isCore="True")
    float_level = vs("Float level", hierarchyLevel=1.0, isCore="true")
    rejected = [
        vs("No level", isCore=True),
        vs("Not core", hierarchyLevel=1),
        vs("Core false", hierarchyLevel=1, isCore=False),
        vs("Level two", hierarchyLevel=2, isCore=True),
        vs("Bool level", hierarchyLevel=True, isCore=True),
        vs("String level", hierarchyLevel="1", isCore=True),
        C(
            "Wrong subtype",
            subtype="businessCapability",
            attributes={"hierarchyLevel": 1, "isCore": True},
        ),
        C("Null attrs", subtype="valueStream", attributes=None),
        vs("Has parent", good, hierarchyLevel=1, isCore=True),
    ]
    house = payload(contexts=[good, string_flag, float_level, *rejected])["core_house"]
    assert [s["name"] for s in house["level_one"]] == ["Float level", "Good", "String flag"]


def test_level_one_follows_the_successor_chain():
    """JS orders the level-1 row with orderLeaves too (source succeeds target)."""
    a = core_root("A")
    b = core_root("B")
    c = core_root("C", sortOrder=1)
    # B comes first, then A; C has no chain and goes after it.
    house = payload(contexts=[a, b, c], successor_rels=[R(a.id, b.id)])["core_house"]
    assert [s["name"] for s in house["level_one"]] == ["B", "A", "C"]


def test_house_items_are_id_and_name():
    root = core_root("Root")
    child = vs("Child", root)
    house = payload(contexts=[root, child])["core_house"]
    assert house["level_one"] == [{"id": str(root.id), "name": "Root"}]
    assert house["level_two"] == {str(root.id): [{"id": str(child.id), "name": "Child"}]}
    assert house["level_three"] == {str(root.id): []}


def test_level_two_is_direct_children_ordered_by_successor_chain():
    root = core_root("Root")
    first = vs("Zeta first", root)
    second = vs("Alpha second", root)
    unchained = C("Any subtype", parent_id=root.id, attributes={"sortOrder": 5})
    grandchild = vs("Grandchild", first)
    other_root = core_root("Other root")
    house = payload(
        contexts=[root, first, second, unchained, grandchild, other_root],
        successor_rels=[R(second.id, first.id)],
    )["core_house"]
    assert [c["name"] for c in house["level_two"][str(root.id)]] == [
        "Zeta first",
        "Alpha second",
        "Any subtype",
    ]
    assert house["level_two"][str(other_root.id)] == []


def test_level_three_is_processes_linked_directly_to_the_level_one_card():
    root = core_root("Sales")
    l2 = vs("Quote", root)
    l2b = vs("Invoice", root)
    lead = cat("lead-to-Order", "support")
    group = C("g", subtype="group", parent_id=lead.id)
    proc = C("p", subtype="process", parent_id=group.id)
    acct = cat("Account-to-Report")
    via_l2 = cat("Linked to level two")
    gate = C("Gate", subtype="valueGate")
    result = payload(
        categories=[lead, group, proc, acct, via_l2],
        contexts=[root, l2, l2b],
        objectives=[gate],
        process_to_ctx_rels=[
            R(lead.id, root.id),
            R(lead.id, root.id),  # duplicate relation: listed once
            R(acct.id, root.id),
            R(via_l2.id, l2.id),
            R(uuid.uuid4(), root.id),  # invisible process: ignored
        ],
        objective_rels=[R(gate.id, l2b.id)],
    )
    level_three = result["core_house"]["level_three"][str(root.id)]
    assert [p["name"] for p in level_three] == ["Account-to-Report", "lead-to-Order"]
    assert level_three[1] == {
        "id": str(lead.id),
        "name": "lead-to-Order",
        "has_children": True,
        "group_count": 1,
        "process_count": 1,
        "value_stream_count": 2,
        "value_gate_count": 1,
        "process_type": "support",
    }


def test_level_three_includes_a_non_category_process():
    """The JS filters level 3 on the relation target only, not on subtype."""
    root = core_root("Sales")
    stray = C("Stray process", subtype="process", attributes={})
    house = payload(
        categories=[stray], contexts=[root], process_to_ctx_rels=[R(stray.id, root.id)]
    )["core_house"]
    assert [p["name"] for p in house["level_three"][str(root.id)]] == ["Stray process"]
    assert house["level_three"][str(root.id)][0]["process_type"] == "not_set"


def test_successor_relations_may_be_a_one_shot_iterable():
    """The relations are walked once per level-1 card: an iterator must not be
    exhausted after the first walk."""
    root = core_root("Root")
    first = vs("Zeta", root)
    second = vs("Alpha", root)
    result = build_chain_payload(
        categories=iter([]),
        contexts=iter([root, first, second]),
        objectives=iter([]),
        process_to_ctx_rels=iter([]),
        objective_rels=iter([]),
        successor_rels=iter([R(second.id, first.id)]),
    )
    assert [c["name"] for c in result["core_house"]["level_two"][str(root.id)]] == [
        "Zeta",
        "Alpha",
    ]
