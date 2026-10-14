"""Port of the extension's bandModel tests. These pin behaviour verified
against live production data, so they are the specification, not a formality."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from app.services.value_chain_report import (
    BAND_KEYS,
    assign_process_level_rows,
    band_key_for,
    collect_descendants_by_subtype,
    collect_leaf_ids,
    group_contiguous_process_spans,
    is_flag_true,
    order_leaves,
    split_cross_cutting,
)


@dataclass
class C:
    """Minimal stand-in for a Card row."""

    name: str
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    parent_id: uuid.UUID | None = None
    subtype: str | None = None
    attributes: dict = field(default_factory=dict)


@dataclass
class R:
    source_id: uuid.UUID
    target_id: uuid.UUID


def names(cards):
    return [c.name for c in cards]


def test_band_keys_order_is_management_core_support_notset():
    assert BAND_KEYS == ("management", "core", "support", "not_set")


def test_band_key_for_known_and_unknown():
    assert band_key_for("core") == "core"
    assert band_key_for("support") == "support"
    assert band_key_for("management") == "management"
    assert band_key_for(None) == "not_set"
    assert band_key_for("whatever") == "not_set"


def test_band_key_for_is_exact_match_only():
    # Port of the "no processType (or an unknown value) lands in not_set" rule.
    assert band_key_for("") == "not_set"
    assert band_key_for("Core") == "not_set"
    assert band_key_for("not_set") == "not_set"


def test_is_flag_true_accepts_the_string_form():
    # Review Focus 1: live data carries "True"/"true" instead of a boolean.
    assert is_flag_true(True)
    assert is_flag_true("True")
    assert is_flag_true("true")
    assert not is_flag_true(False)
    assert not is_flag_true("False")
    assert not is_flag_true(None)
    assert not is_flag_true(1)


def test_is_flag_true_is_case_insensitive_and_rejects_other_strings():
    assert is_flag_true("TRUE")
    assert not is_flag_true("false")
    assert not is_flag_true("yes")
    assert not is_flag_true("1")
    assert not is_flag_true("")
    assert not is_flag_true(0)


def test_collect_descendants_walks_any_depth():
    root = C("cat", subtype="category")
    grp = C("grp", parent_id=root.id, subtype="group")
    proc = C("proc", parent_id=grp.id, subtype="process")
    var = C("var", parent_id=proc.id, subtype="variant")
    cards = [root, grp, proc, var]
    assert [c.name for c in collect_descendants_by_subtype(cards, root.id, "process")] == ["proc"]
    assert {
        c.name for c in collect_descendants_by_subtype(cards, root.id, ["process", "variant"])
    } == {
        "proc",
        "var",
    }
    assert collect_descendants_by_subtype(cards, root.id, "group")[0].name == "grp"


def test_collect_descendants_of_a_childless_root_is_empty():
    # Review Focus 4
    root = C("cat", subtype="category")
    assert collect_descendants_by_subtype([root], root.id, "process") == []


def _js_descendant_cards():
    cat1 = C("cat1", subtype="category")
    grp1 = C("grp1", parent_id=cat1.id, subtype="group")
    grp2 = C("grp2", parent_id=cat1.id, subtype="group")
    proc1 = C("proc1", parent_id=grp1.id, subtype="process")
    proc2 = C("proc2", parent_id=grp1.id, subtype="process")
    var1 = C("var1", parent_id=grp2.id, subtype="variant")
    return cat1, [cat1, grp1, grp2, proc1, proc2, var1]


def test_collect_descendants_single_subtype_at_any_depth_js_fixture():
    cat1, cards = _js_descendant_cards()
    found = collect_descendants_by_subtype(cards, cat1.id, "process")
    assert sorted(names(found)) == ["proc1", "proc2"]


def test_collect_descendants_accepts_an_array_of_subtypes_js_fixture():
    cat1, cards = _js_descendant_cards()
    found = collect_descendants_by_subtype(cards, cat1.id, ["process", "variant"])
    assert sorted(names(found)) == ["proc1", "proc2", "var1"]


def test_collect_descendants_accepts_a_tuple_and_a_set_of_subtypes():
    cat1, cards = _js_descendant_cards()
    assert sorted(names(collect_descendants_by_subtype(cards, cat1.id, ("group", "variant")))) == [
        "grp1",
        "grp2",
        "var1",
    ]
    assert sorted(names(collect_descendants_by_subtype(cards, cat1.id, {"variant"}))) == ["var1"]


def test_collect_descendants_returns_empty_when_nothing_matches():
    cat1, cards = _js_descendant_cards()
    assert collect_descendants_by_subtype(cards, cat1.id, "capability") == []


def test_collect_descendants_for_a_non_root_leaf_is_empty_js_fixture():
    _, cards = _js_descendant_cards()
    proc1 = next(c for c in cards if c.name == "proc1")
    assert collect_descendants_by_subtype(cards, proc1.id, "process") == []


def test_collect_descendants_excludes_the_root_itself_and_other_branches():
    root = C("root", subtype="process")
    other = C("other", subtype="process")
    kid = C("kid", parent_id=root.id, subtype="process")
    stray = C("stray", parent_id=other.id, subtype="process")
    found = collect_descendants_by_subtype([root, other, kid, stray], root.id, "process")
    assert names(found) == ["kid"]


def test_collect_descendants_matching_subtype_does_not_stop_the_walk():
    # A matching card must not hide its own matching descendants.
    root = C("root", subtype="category")
    outer = C("outer", parent_id=root.id, subtype="group")
    inner = C("inner", parent_id=outer.id, subtype="group")
    found = collect_descendants_by_subtype([root, outer, inner], root.id, "group")
    assert sorted(names(found)) == ["inner", "outer"]


def test_collect_descendants_terminates_on_a_parent_id_cycle():
    a = C("a", subtype="process")
    b = C("b", subtype="process")
    a.parent_id = b.id
    b.parent_id = a.id
    found = collect_descendants_by_subtype([a, b], a.id, "process")
    assert sorted(names(found)) == ["a", "b"]


def test_collect_descendants_terminates_on_a_self_parented_card():
    x = C("x", subtype="process")
    x.parent_id = x.id
    assert names(collect_descendants_by_subtype([x], x.id, "process")) == ["x"]


def test_collect_leaf_ids_returns_the_root_when_it_has_no_children():
    # Review Focus 4
    root = C("solo")
    assert collect_leaf_ids([root], root.id) == [root.id]


def test_collect_leaf_ids_returns_only_leaves():
    root = C("root")
    mid = C("mid", parent_id=root.id)
    leaf_a = C("a", parent_id=mid.id)
    leaf_b = C("b", parent_id=root.id)
    ids = collect_leaf_ids([root, mid, leaf_a, leaf_b], root.id)
    assert set(ids) == {leaf_a.id, leaf_b.id}


def test_collect_leaf_ids_finds_every_leaf_in_a_multi_level_tree_js_fixture():
    root = C("root")
    a = C("a", parent_id=root.id)
    b = C("b", parent_id=root.id)
    a1 = C("a1", parent_id=a.id)
    a2 = C("a2", parent_id=a.id)
    ids = collect_leaf_ids([root, a, b, a1, a2], root.id)
    assert len(ids) == 3
    assert set(ids) == {a1.id, a2.id, b.id}


def test_collect_leaf_ids_a_node_with_children_is_never_itself_a_leaf():
    root = C("root")
    child = C("child", parent_id=root.id)
    assert collect_leaf_ids([root, child], root.id) == [child.id]


def test_collect_leaf_ids_starts_from_a_subtree_not_the_whole_forest():
    root = C("root")
    kid = C("kid", parent_id=root.id)
    other = C("other")
    other_kid = C("other_kid", parent_id=other.id)
    assert collect_leaf_ids([root, kid, other, other_kid], root.id) == [kid.id]


def test_collect_leaf_ids_terminates_on_a_parent_id_cycle():
    a = C("a")
    b = C("b")
    a.parent_id = b.id
    b.parent_id = a.id
    # Every node has a child, so nothing is a leaf — and the walk must stop.
    assert collect_leaf_ids([a, b], a.id) == []


def test_collect_leaf_ids_keeps_leaves_found_before_a_cycle_closes():
    root = C("root")
    a = C("a")
    leaf = C("leaf", parent_id=root.id)
    a.parent_id = root.id
    root.parent_id = a.id  # root <-> a cycle, plus a real leaf under root
    assert collect_leaf_ids([root, a, leaf], root.id) == [leaf.id]


def test_split_cross_cutting_separates_and_orders_by_level_order():
    a = C("A", attributes={"isCross": True, "levelOrder": 2})
    b = C("B", attributes={"isCross": "True", "levelOrder": 1})
    c = C("C", attributes={})
    cross, sequence = split_cross_cutting([a, b, c])
    assert [x.name for x in cross] == ["B", "A"]
    assert [x.name for x in sequence] == ["C"]


def test_split_cross_cutting_tolerates_string_booleans_js_fixture():
    leaves = [
        C("A", attributes={"isCross": True}),
        C("B", attributes={"isCross": "True"}),
        C("C", attributes={"isCross": False}),
        C("D", attributes={}),
    ]
    cross, sequence = split_cross_cutting(leaves)
    assert names(cross) == ["A", "B"]
    assert names(sequence) == ["C", "D"]


def test_split_cross_cutting_sequence_keeps_input_order():
    leaves = [C("z"), C("m", attributes={"isCross": True}), C("a"), C("k")]
    cross, sequence = split_cross_cutting(leaves)
    assert names(cross) == ["m"]
    assert names(sequence) == ["z", "a", "k"]


def test_split_cross_cutting_treats_missing_attributes_as_empty():
    leaf = C("A")
    leaf.attributes = None
    cross, sequence = split_cross_cutting([leaf])
    assert cross == []
    assert names(sequence) == ["A"]


def test_cross_cutting_without_level_order_goes_last():
    a = C("A", attributes={"isCross": True})
    b = C("B", attributes={"isCross": True, "levelOrder": 5})
    cross, _ = split_cross_cutting([a, b])
    assert [x.name for x in cross] == ["B", "A"]


def test_split_cross_cutting_orders_by_level_order_ascending_then_name_js_fixture():
    leaves = [
        C("X", attributes={"isCross": True, "levelOrder": 2}),
        C("Zebra", attributes={"isCross": True, "levelOrder": 1}),
        C("Apple", attributes={"isCross": True, "levelOrder": 1}),
    ]
    cross, _ = split_cross_cutting(leaves)
    assert names(cross) == ["Apple", "Zebra", "X"]


def test_split_cross_cutting_without_level_order_sorts_after_leveled_js_fixture():
    leaves = [
        C("A", attributes={"isCross": True}),
        C("B", attributes={"isCross": True, "levelOrder": 1}),
    ]
    cross, _ = split_cross_cutting(leaves)
    assert names(cross) == ["B", "A"]


def test_split_cross_cutting_returns_empty_cross_when_none_is_cross_js_fixture():
    leaves = [C("A", attributes={"isCross": False}), C("B")]
    cross, sequence = split_cross_cutting(leaves)
    assert cross == []
    assert len(sequence) == 2
    assert names(sequence) == ["A", "B"]


def test_split_cross_cutting_level_order_zero_is_a_real_level():
    leaves = [
        C("none", attributes={"isCross": True}),
        C("zero", attributes={"isCross": True, "levelOrder": 0}),
    ]
    cross, _ = split_cross_cutting(leaves)
    assert names(cross) == ["zero", "none"]


def test_split_cross_cutting_numeric_string_level_order_sorts_numerically():
    leaves = [
        C("ten", attributes={"isCross": True, "levelOrder": "10"}),
        C("nine", attributes={"isCross": True, "levelOrder": "9"}),
    ]
    cross, _ = split_cross_cutting(leaves)
    assert names(cross) == ["nine", "ten"]


def test_split_cross_cutting_non_numeric_level_order_counts_as_missing():
    leaves = [
        C("junk", attributes={"isCross": True, "levelOrder": "abc"}),
        C("five", attributes={"isCross": True, "levelOrder": 5}),
    ]
    cross, _ = split_cross_cutting(leaves)
    assert names(cross) == ["five", "junk"]


def test_split_cross_cutting_missing_level_means_999_exactly():
    # Pins the "far last" constant at its boundary on both sides.
    leaves = [
        C("l1000", attributes={"isCross": True, "levelOrder": 1000}),
        C("l998", attributes={"isCross": True, "levelOrder": 998}),
        C("missing_b", attributes={"isCross": True}),
        C("l999_a", attributes={"isCross": True, "levelOrder": 999}),
    ]
    cross, _ = split_cross_cutting(leaves)
    assert names(cross) == ["l998", "l999_a", "missing_b", "l1000"]


def test_order_leaves_follows_the_successor_chain_target_first():
    first = C("first")
    second = C("second")
    third = C("third")
    # "second succeeds first" => first comes before second
    rels = [R(source_id=second.id, target_id=first.id), R(source_id=third.id, target_id=second.id)]
    assert [c.name for c in order_leaves([third, first, second], rels)] == [
        "first",
        "second",
        "third",
    ]


def test_order_leaves_full_chain_js_fixture():
    c, a, b = C("c"), C("a"), C("b")
    # a succeeds b, b succeeds c  =>  chain reads c, b, a
    rels = [R(source_id=a.id, target_id=b.id), R(source_id=b.id, target_id=c.id)]
    assert names(order_leaves([c, a, b], rels)) == ["c", "b", "a"]


def test_order_leaves_appends_unchained_by_sort_order_then_name():
    a = C("alpha", attributes={"sortOrder": 2})
    b = C("beta", attributes={"sortOrder": 1})
    c = C("gamma", attributes={})
    assert [x.name for x in order_leaves([a, b, c], [])] == ["beta", "alpha", "gamma"]


def test_order_leaves_falls_back_to_sort_order_without_a_chain_js_fixture():
    x = C("X", attributes={"sortOrder": 2})
    y = C("Y", attributes={"sortOrder": 1})
    z = C("Z", attributes={"sortOrder": 3})
    assert names(order_leaves([x, y, z], [])) == ["Y", "X", "Z"]


def test_order_leaves_falls_back_to_name_when_sort_order_is_missing_js_fixture():
    m = C("Zebra")
    n = C("Apple")
    assert names(order_leaves([m, n], [])) == ["Apple", "Zebra"]


def test_order_leaves_equal_sort_order_ties_break_by_name():
    leaves = [C("b", attributes={"sortOrder": 1}), C("a", attributes={"sortOrder": 1})]
    assert names(order_leaves(leaves, [])) == ["a", "b"]


def test_order_leaves_falls_back_to_stage_order():
    a = C("a", attributes={"stageOrder": 2})
    b = C("b", attributes={"stageOrder": 1})
    assert [x.name for x in order_leaves([a, b], [])] == ["b", "a"]


def test_sort_order_wins_over_stage_order():
    a = C("a", attributes={"sortOrder": 9, "stageOrder": 1})
    b = C("b", attributes={"sortOrder": 1, "stageOrder": 9})
    assert [x.name for x in order_leaves([a, b], [])] == ["b", "a"]


def test_sort_order_wins_over_stage_order_js_fixture():
    # stageOrder alone would put b before a; sortOrder must win.
    a = C("A", attributes={"sortOrder": 1, "stageOrder": 9})
    b = C("B", attributes={"sortOrder": 2, "stageOrder": 0})
    assert names(order_leaves([b, a], [])) == ["A", "B"]


def test_order_leaves_sort_order_zero_does_not_fall_back_to_stage_order():
    # Only None falls through (JS `??`), not falsy values.
    a = C("a", attributes={"sortOrder": 0, "stageOrder": 9})
    b = C("b", attributes={"sortOrder": 1, "stageOrder": 0})
    assert names(order_leaves([b, a], [])) == ["a", "b"]


def test_order_leaves_stage_order_js_fixture_names_a_b():
    a = C("A", attributes={"stageOrder": 2})
    b = C("B", attributes={"stageOrder": 1})
    assert names(order_leaves([a, b], [])) == ["B", "A"]


def test_numeric_strings_sort_numerically():
    # Review Focus 2: the JS original coerced via subtraction.
    a = C("a", attributes={"sortOrder": "10"})
    b = C("b", attributes={"sortOrder": "9"})
    assert [x.name for x in order_leaves([a, b], [])] == ["b", "a"]


def test_order_leaves_decimal_numeric_strings_compare_as_numbers():
    a = C("a", attributes={"sortOrder": "9.5"})
    b = C("b", attributes={"sortOrder": 9})
    c = C("c", attributes={"stageOrder": "10"})
    assert names(order_leaves([c, a, b], [])) == ["b", "a", "c"]


def test_order_leaves_non_numeric_sort_order_counts_as_missing():
    junk = C("junk", attributes={"sortOrder": "abc"})
    five = C("five", attributes={"sortOrder": 5})
    assert names(order_leaves([junk, five], [])) == ["five", "junk"]


def test_order_leaves_missing_sort_order_means_999_exactly():
    leaves = [
        C("l1000", attributes={"sortOrder": 1000}),
        C("missing_b"),
        C("l999_a", attributes={"sortOrder": 999}),
        C("l998", attributes={"sortOrder": 998}),
    ]
    assert names(order_leaves(leaves, [])) == ["l998", "l999_a", "missing_b", "l1000"]


def test_order_leaves_boolean_sort_order_counts_as_missing():
    flag = C("flag", attributes={"sortOrder": True})
    five = C("five", attributes={"sortOrder": 5})
    assert names(order_leaves([flag, five], [])) == ["five", "flag"]


def test_order_leaves_missing_attributes_are_tolerated():
    a = C("a")
    a.attributes = None
    b = C("b", attributes={"sortOrder": 1})
    assert names(order_leaves([a, b], [])) == ["b", "a"]


def test_order_leaves_ignores_relations_pointing_outside_the_set():
    # Review Focus 3
    inside = C("inside")
    outside = C("outside")
    rels = [R(source_id=outside.id, target_id=inside.id)]
    assert [c.name for c in order_leaves([inside], rels)] == ["inside"]


def test_order_leaves_ignores_relations_whose_target_is_outside_js_fixture():
    a = C("A", attributes={"sortOrder": 1})
    b = C("B", attributes={"sortOrder": 2})
    rels = [R(source_id=a.id, target_id=uuid.uuid4())]
    assert names(order_leaves([a, b], rels)) == ["A", "B"]


def test_order_leaves_ignored_relation_does_not_start_a_chain():
    # If the out-of-set relation leaked in, "late" would be chained ahead of "early".
    early = C("early", attributes={"sortOrder": 1})
    late = C("late", attributes={"sortOrder": 2})
    rels = [
        R(source_id=early.id, target_id=uuid.uuid4()),
        R(source_id=uuid.uuid4(), target_id=late.id),
    ]
    assert names(order_leaves([late, early], rels)) == ["early", "late"]


def test_order_leaves_mixes_a_chain_with_unchained_leaves_js_fixture():
    solo = C("Solo", attributes={"sortOrder": 1})
    first = C("First")
    second = C("Second")
    rels = [R(source_id=second.id, target_id=first.id)]
    assert names(order_leaves([solo, first, second], rels)) == ["First", "Second", "Solo"]


def test_order_leaves_several_chains_emit_in_input_order_of_their_starts():
    a1, a2, b1, b2 = C("a1"), C("a2"), C("b1"), C("b2")
    rels = [R(source_id=a2.id, target_id=a1.id), R(source_id=b2.id, target_id=b1.id)]
    assert names(order_leaves([b1, a1, a2, b2], rels)) == ["b1", "b2", "a1", "a2"]
    assert names(order_leaves([a1, b1, b2, a2], rels)) == ["a1", "a2", "b1", "b2"]


def test_order_leaves_survives_a_cycle():
    # Review Focus 3: a cycle must terminate and emit each card once.
    a = C("a")
    b = C("b")
    rels = [R(source_id=a.id, target_id=b.id), R(source_id=b.id, target_id=a.id)]
    result = order_leaves([a, b], rels)
    assert sorted(c.name for c in result) == ["a", "b"]
    assert len(result) == 2


def test_order_leaves_pure_cycle_degrades_to_the_sorted_remainder():
    a = C("a")
    b = C("b")
    rels = [R(source_id=a.id, target_id=b.id), R(source_id=b.id, target_id=a.id)]
    assert names(order_leaves([b, a], rels)) == ["a", "b"]


def test_order_leaves_cycle_reachable_from_a_start_emits_each_card_once():
    s, a, b = C("s"), C("a"), C("b")
    rels = [
        R(source_id=a.id, target_id=s.id),  # a succeeds s
        R(source_id=b.id, target_id=a.id),  # b succeeds a
        R(source_id=a.id, target_id=b.id),  # a succeeds b -> loop a, b
    ]
    result = order_leaves([b, a, s], rels)
    assert names(result) == ["s", "a", "b"]


def test_order_leaves_self_succession_emits_the_card_once():
    a = C("a")
    result = order_leaves([a], [R(source_id=a.id, target_id=a.id)])
    assert names(result) == ["a"]


def test_order_leaves_does_not_mutate_its_input():
    a = C("b", attributes={"sortOrder": 2})
    b = C("a", attributes={"sortOrder": 1})
    leaves = [a, b]
    order_leaves(leaves, [])
    assert leaves == [a, b]


def test_order_leaves_of_nothing_is_empty():
    assert order_leaves([], []) == []


def test_contiguous_process_spans_one_box_over_several_leaves():
    leaves = [uuid.uuid4() for _ in range(3)]
    proc = uuid.uuid4()
    spans, singles = group_contiguous_process_spans(
        leaves, {leaves[0]: [proc], leaves[1]: [proc], leaves[2]: []}
    )
    assert spans == [
        {"process_id": proc, "start_index": 0, "end_index": 1, "leaf_ids": [leaves[0], leaves[1]]}
    ]
    assert singles == []


def test_non_contiguous_process_falls_back_to_singles():
    leaves = [uuid.uuid4() for _ in range(3)]
    proc = uuid.uuid4()
    spans, singles = group_contiguous_process_spans(
        leaves, {leaves[0]: [proc], leaves[1]: [], leaves[2]: [proc]}
    )
    assert spans == []
    assert [s["index"] for s in singles] == [0, 2]


def test_a_process_at_one_leaf_is_a_single():
    leaves = [uuid.uuid4()]
    proc = uuid.uuid4()
    spans, singles = group_contiguous_process_spans(leaves, {leaves[0]: [proc]})
    assert spans == []
    assert singles == [{"process_id": proc, "leaf_id": leaves[0], "index": 0}]


def _five_leaves():
    return [uuid.uuid4() for _ in range(5)]  # positions 0..4 (a..e)


def test_spans_a_process_at_one_leaf_of_five_is_a_single_js_fixture():
    order = _five_leaves()
    p1 = uuid.uuid4()
    spans, singles = group_contiguous_process_spans(order, {order[0]: [p1]})
    assert spans == []
    assert singles == [{"process_id": p1, "leaf_id": order[0], "index": 0}]


def test_spans_two_contiguous_leaves_merge_into_one_span_js_fixture():
    order = _five_leaves()
    p1 = uuid.uuid4()
    spans, singles = group_contiguous_process_spans(order, {order[0]: [p1], order[1]: [p1]})
    assert spans == [
        {"process_id": p1, "start_index": 0, "end_index": 1, "leaf_ids": [order[0], order[1]]}
    ]
    assert singles == []


def test_spans_three_contiguous_leaves_in_the_middle_js_fixture():
    order = _five_leaves()
    p1 = uuid.uuid4()
    spans, singles = group_contiguous_process_spans(
        order, {order[1]: [p1], order[2]: [p1], order[3]: [p1]}
    )
    assert spans == [
        {
            "process_id": p1,
            "start_index": 1,
            "end_index": 3,
            "leaf_ids": [order[1], order[2], order[3]],
        }
    ]
    assert singles == []


def test_spans_non_contiguous_leaves_fall_back_to_singles_js_fixture():
    order = _five_leaves()
    p1 = uuid.uuid4()
    spans, singles = group_contiguous_process_spans(order, {order[0]: [p1], order[2]: [p1]})
    assert spans == []
    assert sorted(singles, key=lambda s: s["index"]) == [
        {"process_id": p1, "leaf_id": order[0], "index": 0},
        {"process_id": p1, "leaf_id": order[2], "index": 2},
    ]


def test_spans_a_gap_inside_a_longer_run_is_not_contiguous():
    # Three leaves out of positions 0..3: length 3 but extent 4.
    order = _five_leaves()
    p1 = uuid.uuid4()
    spans, singles = group_contiguous_process_spans(
        order, {order[0]: [p1], order[1]: [p1], order[3]: [p1]}
    )
    assert spans == []
    assert [s["index"] for s in singles] == [0, 1, 3]


def test_spans_covering_every_leaf_is_just_one_span_js_fixture():
    order = _five_leaves()
    p1 = uuid.uuid4()
    spans, singles = group_contiguous_process_spans(order, {leaf: [p1] for leaf in order})
    assert spans == [{"process_id": p1, "start_index": 0, "end_index": 4, "leaf_ids": list(order)}]
    assert singles == []


def test_spans_multiple_independent_processes_partition_correctly_js_fixture():
    order = _five_leaves()
    p1, p2 = uuid.uuid4(), uuid.uuid4()
    spans, singles = group_contiguous_process_spans(
        order, {order[0]: [p1], order[1]: [p1], order[3]: [p2]}
    )
    assert spans == [
        {"process_id": p1, "start_index": 0, "end_index": 1, "leaf_ids": [order[0], order[1]]}
    ]
    assert singles == [{"process_id": p2, "leaf_id": order[3], "index": 3}]


def test_spans_two_processes_sharing_the_same_leaves_each_get_a_span():
    order = _five_leaves()
    p1, p2 = uuid.uuid4(), uuid.uuid4()
    spans, singles = group_contiguous_process_spans(order, {order[2]: [p1, p2], order[3]: [p1, p2]})
    assert [s["process_id"] for s in spans] == [p1, p2]
    assert [(s["start_index"], s["end_index"]) for s in spans] == [(2, 3), (2, 3)]
    assert singles == []


def test_spans_the_same_process_listed_twice_on_one_leaf_is_not_a_span():
    order = _five_leaves()
    p1 = uuid.uuid4()
    spans, singles = group_contiguous_process_spans(order, {order[0]: [p1, p1]})
    assert spans == []
    assert singles == [
        {"process_id": p1, "leaf_id": order[0], "index": 0},
        {"process_id": p1, "leaf_id": order[0], "index": 0},
    ]


def test_spans_empty_input_returns_empty_spans_and_singles_js_fixture():
    spans, singles = group_contiguous_process_spans([], {})
    assert spans == []
    assert singles == []


def test_spans_a_leaf_not_in_the_order_contributes_nothing_js_fixture():
    order = _five_leaves()
    spans, singles = group_contiguous_process_spans(order, {uuid.uuid4(): [uuid.uuid4()]})
    assert spans == []
    assert singles == []


def test_level_rows_are_relative_not_absolute():
    a, b = uuid.uuid4(), uuid.uuid4()
    rows, count = assign_process_level_rows(
        [{"process_id": a, "level_order": 5}, {"process_id": b, "level_order": 10}]
    )
    assert rows == {a: 0, b: 1}
    assert count == 2


def test_unleveled_processes_land_in_one_trailing_row():
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    rows, count = assign_process_level_rows(
        [
            {"process_id": a, "level_order": 1},
            {"process_id": b, "level_order": None},
            {"process_id": c, "level_order": None},
        ]
    )
    assert rows[a] == 0
    assert rows[b] == rows[c] == 1
    assert count == 2


def test_no_levels_at_all_is_a_single_row():
    a = uuid.uuid4()
    rows, count = assign_process_level_rows([{"process_id": a, "level_order": None}])
    assert rows == {a: 0}
    assert count == 1


def test_level_rows_two_unleveled_processes_share_row_zero_js_fixture():
    a, b = uuid.uuid4(), uuid.uuid4()
    rows, count = assign_process_level_rows(
        [{"process_id": a, "level_order": None}, {"process_id": b, "level_order": None}]
    )
    assert rows == {a: 0, b: 0}
    assert count == 1


def test_level_rows_two_distinct_levels_produce_two_rows_js_fixture():
    commessa, delivery, assegnazione = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    rows, count = assign_process_level_rows(
        [
            {"process_id": commessa, "level_order": 1},
            {"process_id": delivery, "level_order": 2},
            {"process_id": assegnazione, "level_order": 2},
        ]
    )
    assert rows == {commessa: 0, delivery: 1, assegnazione: 1}
    assert count == 2


def test_level_rows_unleveled_trail_after_every_declared_level_js_fixture():
    leveled, unleveled = uuid.uuid4(), uuid.uuid4()
    rows, count = assign_process_level_rows(
        [
            {"process_id": unleveled, "level_order": None},
            {"process_id": leveled, "level_order": 1},
        ]
    )
    assert rows == {leveled: 0, unleveled: 1}
    assert count == 2


def test_level_rows_arbitrary_n_distinct_levels_each_get_a_row_js_fixture():
    a, b, c, d = (uuid.uuid4() for _ in range(4))
    rows, count = assign_process_level_rows(
        [
            {"process_id": a, "level_order": 3},
            {"process_id": b, "level_order": 1},
            {"process_id": c, "level_order": 2},
            {"process_id": d, "level_order": 4},
        ]
    )
    assert rows == {b: 0, c: 1, a: 2, d: 3}
    assert count == 4


def test_level_rows_empty_input_is_zero_rows_js_fixture():
    rows, count = assign_process_level_rows([])
    assert rows == {}
    assert count == 0


def test_level_rows_level_zero_is_a_real_level_not_unleveled():
    a, b = uuid.uuid4(), uuid.uuid4()
    rows, count = assign_process_level_rows(
        [{"process_id": a, "level_order": 0}, {"process_id": b, "level_order": None}]
    )
    assert rows == {a: 0, b: 1}
    assert count == 2
    rows, count = assign_process_level_rows([{"process_id": a, "level_order": 0}])
    assert rows == {a: 0}
    assert count == 1


# --- Fix round 1: localeCompare-like name order and numeric level order ---

_NAMES = ["Banana", "apple", "Èvasione", "Fatture"]


def test_order_leaves_names_sort_case_and_accent_insensitively():
    leaves = [C(n) for n in _NAMES]
    assert names(order_leaves(leaves, [])) == ["apple", "Banana", "Èvasione", "Fatture"]


def test_split_cross_cutting_names_sort_case_and_accent_insensitively():
    leaves = [C(n, attributes={"isCross": True, "levelOrder": 1}) for n in _NAMES]
    cross, _ = split_cross_cutting(leaves)
    assert names(cross) == ["apple", "Banana", "Èvasione", "Fatture"]


def test_order_leaves_names_equal_ignoring_case_and_accents_tie_break_on_raw_name():
    cafe, accented = C("Cafe"), C("Café")
    assert names(order_leaves([accented, cafe], [])) == ["Cafe", "Café"]
    assert names(order_leaves([cafe, accented], [])) == ["Cafe", "Café"]


def test_split_cross_cutting_names_equal_ignoring_case_and_accents_tie_break_on_raw_name():
    attrs = {"isCross": True}
    cafe, accented = C("Cafe", attributes=dict(attrs)), C("Café", attributes=dict(attrs))
    cross, _ = split_cross_cutting([accented, cafe])
    assert names(cross) == ["Cafe", "Café"]


def test_order_leaves_sort_order_still_beats_name():
    late_name = C("Zeta", attributes={"sortOrder": 1})
    early_name = C("apple", attributes={"sortOrder": 2})
    assert names(order_leaves([early_name, late_name], [])) == ["Zeta", "apple"]


def test_split_cross_cutting_level_order_still_beats_name():
    z = C("Zeta", attributes={"isCross": True, "levelOrder": 1})
    a = C("apple", attributes={"isCross": True, "levelOrder": 2})
    cross, _ = split_cross_cutting([a, z])
    assert names(cross) == ["Zeta", "apple"]


def test_level_rows_all_string_levels_order_numerically():
    a, b = uuid.uuid4(), uuid.uuid4()
    rows, count = assign_process_level_rows(
        [{"process_id": a, "level_order": "10"}, {"process_id": b, "level_order": "9"}]
    )
    assert rows == {a: 1, b: 0}
    assert count == 2


def test_level_rows_mixed_int_and_string_levels_do_not_raise():
    a, b = uuid.uuid4(), uuid.uuid4()
    rows, count = assign_process_level_rows(
        [{"process_id": a, "level_order": 2}, {"process_id": b, "level_order": "1"}]
    )
    assert rows == {a: 1, b: 0}
    assert count == 2


def test_level_rows_missing_level_order_key_counts_as_unleveled():
    a, b = uuid.uuid4(), uuid.uuid4()
    rows, count = assign_process_level_rows(
        [{"process_id": a, "level_order": 1}, {"process_id": b}]
    )
    assert rows == {a: 0, b: 1}
    assert count == 2
