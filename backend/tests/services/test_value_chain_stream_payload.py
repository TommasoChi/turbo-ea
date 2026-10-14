"""`build_stream_payload` — the aggregate behind GET /reports/value-chain/{id}.

Ports the data side of the retired extension's `ValueStreamPage.mjs` (roots,
leaves, the leafData effect, the per-root band/span/row computation). Every
value is pinned exactly: mutation tooling is not available locally, so the
assertions have to kill mutants on their own.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from app.services.value_chain_report import build_stream_payload


@dataclass
class C:
    """Minimal stand-in for a Card row."""

    name: str
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    parent_id: uuid.UUID | None = None
    subtype: str | None = None
    attributes: dict | None = field(default_factory=dict)
    description: str | None = None


@dataclass
class R:
    source_id: uuid.UUID
    target_id: uuid.UUID


def s(card) -> str:
    return str(card.id)


def cat(name="Sales", **attributes):
    return C(name, subtype="category", attributes=attributes)


def proc(name, parent=None, subtype="process", **attributes):
    return C(name, subtype=subtype, parent_id=parent.id if parent else None, attributes=attributes)


def vs(name, parent=None, **attributes):
    return C(
        name,
        subtype="valueStream",
        parent_id=parent.id if parent else None,
        attributes=attributes,
    )


def link(source, target):
    return R(source.id, target.id)


def build(
    category,
    processes=(),
    contexts=(),
    capabilities=(),
    objectives=(),
    process_to_ctx_rels=(),
    ctx_to_cap_rels=(),
    objective_rels=(),
    successor_rels=(),
    element_counts=None,
    related_cards=(),
    related_links=(),
):
    return build_stream_payload(
        category_id=category.id,
        processes=[category, *processes],
        contexts=list(contexts),
        capabilities=list(capabilities),
        objectives=list(objectives),
        process_to_ctx_rels=list(process_to_ctx_rels),
        ctx_to_cap_rels=list(ctx_to_cap_rels),
        objective_rels=list(objective_rels),
        successor_rels=list(successor_rels),
        element_counts=element_counts or {},
        related_cards=list(related_cards),
        related_links=list(related_links),
    )


def only_root(result):
    assert len(result["roots"]) == 1
    return result["roots"][0]


def stream(card, parent_id=None, parent_name=None):
    return {"id": s(card), "name": card.name, "parent_id": parent_id, "parent_name": parent_name}


def flow(n=3):
    """Category -> root with `n` ordered leaves (sortOrder 1..n)."""
    category = cat()
    root = vs("Order to Cash")
    leaves = [vs(f"Step {i}", root, sortOrder=i) for i in range(1, n + 1)]
    return category, root, leaves


# --- roots -------------------------------------------------------------------


def test_a_category_with_no_linked_stream_has_no_roots():
    category = cat()
    other = vs("Elsewhere")
    assert build(category, contexts=[other]) == {"roots": []}


def test_roots_are_the_category_s_targets_by_name_and_deduped():
    category = cat()
    other_cat = cat("Other")
    zeta, alpha, foreign = vs("Zeta"), vs("alpha"), vs("Foreign")
    result = build(
        category,
        processes=[other_cat],
        contexts=[zeta, alpha, foreign],
        process_to_ctx_rels=[
            link(category, zeta),
            link(category, alpha),
            link(category, zeta),  # duplicate row
            link(other_cat, foreign),  # another category's root
        ],
    )
    assert [(r["id"], r["name"]) for r in result["roots"]] == [
        (s(alpha), "alpha"),
        (s(zeta), "Zeta"),
    ]


def test_a_root_hidden_by_the_read_scope_is_not_a_root():
    category = cat()
    hidden = vs("Hidden")
    result = build(category, contexts=[], process_to_ctx_rels=[link(category, hidden)])
    assert result == {"roots": []}


def test_a_childless_root_is_its_own_single_leaf_and_carries_the_category():
    """collectLeafIds returns the root itself when it has no children, and the
    category -> root link then feeds that leaf's process list: the JS added the
    link's source card plus its process/variant descendants."""
    category = cat()
    root = vs("Order to Cash")
    child = proc("Take order", category, levelOrder=2)
    result = build(
        category,
        processes=[child],
        contexts=[root],
        process_to_ctx_rels=[link(category, root)],
    )
    r = only_root(result)
    assert r["sequence"] == [stream(root)]
    assert r["cross"] == []
    # The category is a container: its child is in the same list.
    assert r["leaf_processes"] == {s(root): [{"id": s(category), "children": [s(child)]}]}
    assert r["spans"] == []
    assert r["singles"] == []
    assert r["row_of_process"] == {s(category): 0}
    assert r["row_count"] == 1
    assert r["process_count"] == 2


def test_the_full_root_shape():
    category = cat()
    root = vs("Order to Cash")
    leaf = vs("Quote", root)
    p = proc("Quoting", category, processType="core", maturity="defined", levelOrder=1)
    result = build(
        category,
        processes=[p],
        contexts=[root, leaf],
        process_to_ctx_rels=[link(category, root), link(p, leaf)],
        element_counts={p.id: 4},
    )
    assert result == {
        "roots": [
            {
                "id": s(root),
                "name": "Order to Cash",
                "sequence": [stream(leaf)],
                "cross": [],
                "spans": [],
                "singles": [{"process_id": s(p), "leaf_id": s(leaf), "index": 0}],
                "leaf_processes": {s(leaf): [{"id": s(p), "children": []}]},
                "cross_processes": [],
                "row_count": 1,
                "row_of_process": {s(p): 0},
                "process_count": 1,
                "processes": {
                    s(p): {
                        "id": s(p),
                        "name": "Quoting",
                        "subtype": "process",
                        "element_count": 4,
                        "color_attributes": {
                            "processType": "core",
                            "maturity": "defined",
                            "automationLevel": None,
                            "riskLevel": None,
                        },
                        "related": [],
                    }
                },
                "gates": [],
                "capabilities": [],
                "goals": [],
            }
        ]
    }


# --- value stream band -------------------------------------------------------


def test_cross_cutting_leaves_leave_the_sequence():
    category, root, (a, b) = flow(2)
    monitoring = vs("Monitoring", root, isCross="True", levelOrder=2)
    audit = vs("Audit", root, isCross=True, levelOrder=1)
    result = build(
        category,
        contexts=[root, b, monitoring, a, audit],
        process_to_ctx_rels=[link(category, root)],
    )
    r = only_root(result)
    assert r["cross"] == [stream(audit), stream(monitoring)]
    assert r["sequence"] == [stream(a), stream(b)]


def test_sequence_follows_the_successor_chain():
    category, root, (a, b, c) = flow(3)
    # c succeeds a: chain a -> c, then b by sortOrder.
    result = build(
        category,
        contexts=[root, a, b, c],
        process_to_ctx_rels=[link(category, root)],
        successor_rels=[R(c.id, a.id)],
    )
    assert [x["name"] for x in only_root(result)["sequence"]] == ["Step 1", "Step 3", "Step 2"]


def test_a_leaf_under_an_intermediate_stream_names_its_parent():
    category = cat()
    root = vs("Order to Cash")
    group = vs("Fulfilment", root, sortOrder=2)
    direct = vs("Quote", root, sortOrder=1)
    nested = vs("Ship", group)
    result = build(
        category,
        contexts=[root, group, direct, nested],
        process_to_ctx_rels=[link(category, root)],
    )
    assert only_root(result)["sequence"] == [
        stream(direct),
        stream(nested, parent_id=s(group), parent_name="Fulfilment"),
    ]


def test_only_cross_cutting_leaves():
    category = cat()
    root = vs("Order to Cash")
    x1 = vs("Monitoring", root, isCross=True, levelOrder=1)
    x2 = vs("Reporting", root, isCross=True, levelOrder=2)
    shared = proc("Governance", category, levelOrder=3)
    only_x2 = proc("Reports", category)
    result = build(
        category,
        processes=[shared, only_x2],
        contexts=[root, x1, x2],
        process_to_ctx_rels=[
            link(category, root),
            link(shared, x1),
            link(shared, x2),
            link(only_x2, x2),
        ],
    )
    r = only_root(result)
    assert r["sequence"] == []
    assert r["spans"] == []
    assert r["singles"] == []
    assert r["leaf_processes"] == {}
    # Deduped across cross-cutting leaves, first seen first (levelOrder order,
    # then name within a leaf).
    assert r["cross_processes"] == [
        {"id": s(shared), "children": []},
        {"id": s(only_x2), "children": []},
    ]
    assert r["row_of_process"] == {s(shared): 0, s(only_x2): 1}
    assert r["row_count"] == 2
    # Counted once per leaf it appears under, like the JS sumLeafField.
    assert r["process_count"] == 3


# --- business process band: spans, singles, rows ------------------------------


def test_a_process_on_contiguous_leaves_is_one_span_and_leaves_the_columns():
    category, root, (a, b, c) = flow(3)
    shared = proc("Order handling", category, levelOrder=1)
    local = proc("Invoice run", category, levelOrder=1)
    result = build(
        category,
        processes=[shared, local],
        contexts=[root, a, b, c],
        process_to_ctx_rels=[
            link(category, root),
            link(shared, a),
            link(shared, b),
            link(local, b),
        ],
    )
    r = only_root(result)
    assert r["spans"] == [
        {"process_id": s(shared), "start_index": 0, "end_index": 1, "leaf_ids": [s(a), s(b)]}
    ]
    assert r["singles"] == [{"process_id": s(local), "leaf_id": s(b), "index": 1}]
    assert r["leaf_processes"] == {
        s(a): [],
        s(b): [{"id": s(local), "children": []}],
        s(c): [],
    }
    assert r["row_of_process"] == {s(shared): 0, s(local): 0}
    assert r["row_count"] == 1
    assert r["process_count"] == 3


def test_a_process_on_non_contiguous_leaves_is_one_box_per_leaf():
    category, root, (a, b, c) = flow(3)
    split = proc("Check", category)
    result = build(
        category,
        processes=[split],
        contexts=[root, a, b, c],
        process_to_ctx_rels=[link(category, root), link(split, a), link(split, c)],
    )
    r = only_root(result)
    assert r["spans"] == []
    assert r["singles"] == [
        {"process_id": s(split), "leaf_id": s(a), "index": 0},
        {"process_id": s(split), "leaf_id": s(c), "index": 2},
    ]
    item = [{"id": s(split), "children": []}]
    assert r["leaf_processes"] == {s(a): item, s(b): [], s(c): item}


def test_a_group_with_children_in_the_list_is_never_span_eligible():
    """Only STANDALONE items (no children in the leaf's own list) feed the
    span grouping; a container renders per leaf even on contiguous leaves."""
    category, root, (a, b) = flow(2)
    group = proc("Fulfilment", category, subtype="group")
    step = proc("Pick", group)
    variant = proc("Pick (express)", group, subtype="variant")
    result = build(
        category,
        processes=[group, step, variant],
        contexts=[root, a, b],
        process_to_ctx_rels=[link(category, root), link(group, a), link(group, b)],
    )
    r = only_root(result)
    assert r["spans"] == []
    assert r["singles"] == []
    container = [{"id": s(group), "children": [s(step), s(variant)]}]
    assert r["leaf_processes"] == {s(a): container, s(b): container}
    assert r["row_of_process"] == {s(group): 0}
    assert r["row_count"] == 1
    assert r["process_count"] == 6
    assert set(r["processes"]) == {s(group), s(step), s(variant)}


def test_a_nested_group_is_not_pulled_in_as_a_descendant():
    """Descendants are collected for subtypes process and variant only."""
    category, root, (a,) = flow(1)
    group = proc("Fulfilment", category, subtype="group")
    inner = proc("Inner group", group, subtype="group")
    deep = proc("Pack", inner)
    result = build(
        category,
        processes=[group, inner, deep],
        contexts=[root, a],
        process_to_ctx_rels=[link(category, root), link(group, a)],
    )
    # `deep`'s parent (`inner`) is not in the list, so it is top level, and
    # `group` is left with no child in the list and no elements: dropped.
    assert only_root(result)["leaf_processes"] == {s(a): [{"id": s(deep), "children": []}]}


def test_an_empty_group_is_dropped_unless_it_carries_its_own_flow():
    category, root, (a, b) = flow(2)
    hollow = proc("Colocation", category, subtype="group")
    billing = proc("Billing", hollow)
    flowing = proc("Sourcing", category, subtype="group")
    result = build(
        category,
        processes=[hollow, billing, flowing],
        contexts=[root, a, b],
        process_to_ctx_rels=[
            link(category, root),
            link(hollow, a),
            link(hollow, b),
            link(billing, b),  # billing claimed by b only
            link(flowing, a),
        ],
        element_counts={flowing.id: 9},
    )
    r = only_root(result)
    # a: billing excluded (own link elsewhere) -> hollow empty, 0 elements -> dropped.
    # b: billing kept -> hollow is its container.
    assert r["leaf_processes"] == {
        s(a): [{"id": s(flowing), "children": []}],
        s(b): [{"id": s(hollow), "children": [s(billing)]}],
    }
    assert r["singles"] == [{"process_id": s(flowing), "leaf_id": s(a), "index": 0}]
    assert r["processes"][s(flowing)]["element_count"] == 9
    assert r["processes"][s(hollow)]["element_count"] == 0
    assert r["process_count"] == 3


def test_an_empty_group_with_its_own_elements_is_kept():
    category, root, (a,) = flow(1)
    group = proc("Sourcing", category, subtype="group")
    kept = build(
        category,
        processes=[group],
        contexts=[root, a],
        process_to_ctx_rels=[link(category, root), link(group, a)],
        element_counts={group.id: 1},
    )
    assert only_root(kept)["leaf_processes"] == {s(a): [{"id": s(group), "children": []}]}
    dropped = build(
        category,
        processes=[group],
        contexts=[root, a],
        process_to_ctx_rels=[link(category, root), link(group, a)],
    )
    assert only_root(dropped)["leaf_processes"] == {s(a): []}
    assert only_root(dropped)["process_count"] == 0
    assert only_root(dropped)["row_count"] == 0
    assert only_root(dropped)["processes"] == {}


def test_a_non_group_card_is_never_dropped_for_being_empty():
    category, root, (a,) = flow(1)
    lone = proc("Lone", category)
    result = build(
        category,
        processes=[lone],
        contexts=[root, a],
        process_to_ctx_rels=[link(category, root), link(lone, a)],
    )
    assert only_root(result)["leaf_processes"] == {s(a): [{"id": s(lone), "children": []}]}


def test_a_descendant_linked_to_this_leaf_too_stays():
    category, root, (a, b) = flow(2)
    group = proc("Group", category, subtype="group")
    both = proc("Both", group)
    result = build(
        category,
        processes=[group, both],
        contexts=[root, a, b],
        process_to_ctx_rels=[
            link(category, root),
            link(group, a),
            link(both, a),
            link(both, b),
        ],
    )
    r = only_root(result)
    assert r["leaf_processes"] == {
        s(a): [{"id": s(group), "children": [s(both)]}],
        s(b): [{"id": s(both), "children": []}],
    }


def test_unleveled_processes_land_in_one_trailing_row():
    category, root, (a, b, c) = flow(3)
    five = proc("Five", category, levelOrder=5)
    ten = proc("Ten", category, levelOrder="10")
    none_a = proc("Free A", category)
    none_b = proc("Free B", category, levelOrder=None)
    result = build(
        category,
        processes=[five, ten, none_a, none_b],
        contexts=[root, a, b, c],
        process_to_ctx_rels=[
            link(category, root),
            link(ten, a),
            link(five, b),
            link(none_a, c),
            link(none_b, a),
        ],
    )
    r = only_root(result)
    assert r["row_of_process"] == {s(five): 0, s(ten): 1, s(none_a): 2, s(none_b): 2}
    assert r["row_count"] == 3


def test_a_process_reached_twice_gets_one_row_entry():
    """Dedup: a process in a span, a cross-cutting leaf AND a sequence leaf."""
    category, root, (a, b) = flow(2)
    cross = vs("Monitoring", root, isCross=True)
    everywhere = proc("Everywhere", category, levelOrder=2)
    result = build(
        category,
        processes=[everywhere],
        contexts=[root, a, b, cross],
        process_to_ctx_rels=[
            link(category, root),
            link(everywhere, a),
            link(everywhere, b),
            link(everywhere, cross),
        ],
    )
    r = only_root(result)
    assert r["row_of_process"] == {s(everywhere): 0}
    assert r["row_count"] == 1
    assert r["cross_processes"] == [{"id": s(everywhere), "children": []}]
    assert len(r["spans"]) == 1
    assert r["process_count"] == 3


# --- gates, goals, capabilities ----------------------------------------------


def test_gates_are_value_gates_of_every_leaf_cross_cutting_included():
    category, root, (a, b) = flow(2)
    cross = vs("Monitoring", root, isCross=True)
    g2 = C("Zulu gate", subtype="valueGate", attributes={"objectiveType": "tactical"})
    g1 = C("Alpha gate", subtype="valueGate")
    g3 = C("Cross gate", subtype="valueGate", attributes={"objectiveType": "strategic"})
    not_a_gate = C("Goal on a leaf", subtype="businessGoal")
    result = build(
        category,
        contexts=[root, a, b, cross],
        objectives=[g1, g2, g3, not_a_gate],
        process_to_ctx_rels=[link(category, root)],
        objective_rels=[
            link(g2, a),
            link(g1, a),
            link(g1, a),  # duplicate row
            link(g3, cross),
            link(not_a_gate, b),
        ],
    )
    assert only_root(result)["gates"] == [
        {"id": s(g1), "name": "Alpha gate", "leaf_id": s(a), "objective_type": None},
        {"id": s(g2), "name": "Zulu gate", "leaf_id": s(a), "objective_type": "tactical"},
        {"id": s(g3), "name": "Cross gate", "leaf_id": s(cross), "objective_type": "strategic"},
    ]
    assert only_root(result)["goals"] == []


def test_goals_are_business_goals_linked_to_the_root_itself():
    category, root, (a,) = flow(1)
    goal_b = C("Retain talent", subtype="businessGoal", description="Keep people")
    goal_a = C("Attract talent", subtype="businessGoal")
    gate_on_root = C("Root gate", subtype="valueGate")
    result = build(
        category,
        contexts=[root, a],
        objectives=[goal_a, goal_b, gate_on_root],
        process_to_ctx_rels=[link(category, root)],
        objective_rels=[link(goal_b, root), link(goal_a, root), link(gate_on_root, root)],
    )
    r = only_root(result)
    assert r["goals"] == [
        {"id": s(goal_a), "name": "Attract talent", "description": None},
        {"id": s(goal_b), "name": "Retain talent", "description": "Keep people"},
    ]
    # A gate on the root is not a leaf's gate (the root has a child).
    assert r["gates"] == []


def test_capabilities_group_under_their_visible_parent():
    category, root, (a, b) = flow(2)
    l1 = C("Sales Management")
    under = C("Pricing", parent_id=l1.id)
    orphan = C("Billing", parent_id=uuid.uuid4())  # parent not visible
    top = C("Analytics")
    result = build(
        category,
        contexts=[root, a, b],
        capabilities=[l1, under, orphan, top],
        process_to_ctx_rels=[link(category, root)],
        ctx_to_cap_rels=[link(a, under), link(a, orphan), link(b, top), link(b, top)],
    )
    assert only_root(result)["capabilities"] == [
        {
            "id": s(orphan),
            "name": "Billing",
            "leaf_id": s(a),
            "group_id": s(orphan),
            "group_name": "Billing",
        },
        {
            "id": s(under),
            "name": "Pricing",
            "leaf_id": s(a),
            "group_id": s(l1),
            "group_name": "Sales Management",
        },
        {
            "id": s(top),
            "name": "Analytics",
            "leaf_id": s(b),
            "group_id": s(top),
            "group_name": "Analytics",
        },
    ]


# --- related items -----------------------------------------------------------


def test_related_items_come_from_the_process_s_own_steps():
    category, root, (a,) = flow(1)
    group = proc("Group", category, subtype="group")
    child = proc("Child", group)
    crm, erp, hidden_id = C("CRM"), C("erp"), uuid.uuid4()
    result = build(
        category,
        processes=[group, child],
        contexts=[root, a],
        process_to_ctx_rels=[link(category, root), link(group, a)],
        related_cards=[crm, erp],
        related_links=[
            (group.id, erp.id),
            (group.id, crm.id),
            (group.id, crm.id),  # two steps, same app
            (group.id, hidden_id),  # not visible
            (child.id, erp.id),
        ],
    )
    procs = only_root(result)["processes"]
    # Own items only, by name: the page never unioned a group with its children.
    assert procs[s(group)]["related"] == [
        {"id": s(crm), "name": "CRM"},
        {"id": s(erp), "name": "erp"},
    ]
    assert procs[s(child)]["related"] == [{"id": s(erp), "name": "erp"}]


# --- read scope / hidden cards -----------------------------------------------


def test_relations_to_cards_outside_the_visible_sets_are_ignored():
    category, root, (a,) = flow(1)
    hidden_proc = proc("Hidden process", category)
    hidden_gate = C("Hidden gate", subtype="valueGate")
    hidden_cap = C("Hidden capability")
    hidden_leaf = vs("Hidden leaf", root)
    visible = proc("Visible", category)
    result = build(
        category,
        processes=[visible],
        contexts=[root, a],
        process_to_ctx_rels=[
            link(category, root),
            link(hidden_proc, a),
            link(visible, a),
            link(visible, hidden_leaf),
        ],
        objective_rels=[link(hidden_gate, a)],
        ctx_to_cap_rels=[link(a, hidden_cap)],
    )
    r = only_root(result)
    assert r["sequence"] == [stream(a)]
    assert r["leaf_processes"] == {s(a): [{"id": s(visible), "children": []}]}
    assert r["gates"] == []
    assert r["capabilities"] == []


def test_a_hidden_own_link_does_not_claim_a_descendant_away():
    """`visible -> hidden leaf` is ignored, so the descendant has no own link
    and still shows under every leaf its group realises."""
    category, root, (a,) = flow(1)
    group = proc("Group", category, subtype="group")
    child = proc("Child", group)
    hidden_leaf = vs("Hidden", root)
    result = build(
        category,
        processes=[group, child],
        contexts=[root, a],
        process_to_ctx_rels=[link(category, root), link(group, a), link(child, hidden_leaf)],
    )
    assert only_root(result)["leaf_processes"] == {s(a): [{"id": s(group), "children": [s(child)]}]}


def test_two_roots_are_built_independently():
    category = cat()
    r1, r2 = vs("Beta"), vs("Alpha")
    l1, l2 = vs("Leaf 1", r1), vs("Leaf 2", r2)
    p = proc("P", category, levelOrder=3)
    result = build(
        category,
        processes=[p],
        contexts=[r1, r2, l1, l2],
        process_to_ctx_rels=[link(category, r1), link(category, r2), link(p, l1)],
    )
    alpha, beta = result["roots"]
    assert (alpha["name"], beta["name"]) == ("Alpha", "Beta")
    assert alpha["sequence"] == [stream(l2)]
    assert alpha["row_of_process"] == {}
    assert alpha["row_count"] == 0
    assert alpha["process_count"] == 0
    assert beta["row_of_process"] == {s(p): 0}
    assert beta["process_count"] == 1
