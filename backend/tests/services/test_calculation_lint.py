"""Static formula analysis — no database needed.

Covers the two checks that exist to stop #886 recurring: naming a field key that
does not exist on the target type, and plucking a bare key off a related card
(which raises nothing and quietly sums to 0).
"""

from __future__ import annotations

import ast

from app.services.calculation_lint import (
    _is_data_name,
    _parse,
    _wrapper_derived,
    data_refs,
    known_field_keys,
    lint_formula,
    split_formula_lines,
    suggest_field,
    unknown_field_refs,
)

FIELDS_SCHEMA = [
    {
        "section": "Cost",
        "fields": [
            {"key": "licenseCost", "label": "License Cost", "type": "cost"},
            {"key": "supportCost", "label": "Support Cost", "type": "cost"},
            {"key": "costTotalAnnual", "label": "Total Annual Cost", "type": "cost"},
        ],
    },
    {
        "section": "Fit",
        "fields": [{"key": "businessFit", "label": "Business Fit", "type": "single_select"}],
    },
]


class TestSplitFormulaLines:
    def test_drops_blanks_and_comments(self):
        assert split_formula_lines("# a comment\n\n  data.x  \n") == [(None, "data.x")]

    def test_detects_assignment(self):
        assert split_formula_lines("bf = data.x\nbf * 2") == [("bf", "data.x"), (None, "bf * 2")]

    def test_equality_is_not_an_assignment(self):
        assert split_formula_lines('data.x == "a"') == [(None, 'data.x == "a"')]

    def test_inequality_is_not_an_assignment(self):
        assert split_formula_lines('data.x != "a"') == [(None, 'data.x != "a"')]

    def test_a_bare_identifier_before_double_equals_is_still_not_an_assignment(self):
        # "data.x == ..." never exercises the "==" guard: the dot already fails
        # isidentifier() on its own, so a mutated/removed guard would not show
        # up as a difference. A bare name does.
        assert split_formula_lines("x == 5") == [(None, "x == 5")]

    def test_a_bare_identifier_before_bang_equals_is_still_not_an_assignment(self):
        assert split_formula_lines("x != 5") == [(None, "x != 5")]

    def test_a_non_identifier_before_equals_is_not_an_assignment(self):
        assert split_formula_lines("1x = 5") == [(None, "1x = 5")]

    def test_nothing_after_equals_is_not_an_assignment(self):
        assert split_formula_lines("x =") == [(None, "x =")]

    def test_whitespace_around_equals_is_trimmed_on_both_sides(self):
        assert split_formula_lines("x    =    5") == [("x", "5")]

    def test_a_hash_that_is_not_the_first_character_is_kept_verbatim(self):
        # Only a LEADING "#" marks a comment line — there is no inline-comment
        # stripping, so a formula that legitimately contains "#" elsewhere
        # (unlikely here, but the function must not special-case it) passes
        # through untouched.
        assert split_formula_lines("data.x # not a comment") == [(None, "data.x # not a comment")]


class TestParse:
    def test_a_valid_expression_parses(self):
        assert _parse("data.x + 1") is not None

    def test_a_statement_is_not_a_valid_expression(self):
        # "pass" compiles in exec mode but not eval mode — pins the parse mode.
        assert _parse("pass") is None

    def test_unparseable_text_yields_none(self):
        assert _parse("data.x +") is None

    def test_a_value_error_also_yields_none(self):
        # A null byte raises ValueError, not SyntaxError — both must be caught.
        assert _parse("data.x\x00") is None


class TestIsDataName:
    def test_the_bare_name_data_is_true(self):
        assert _is_data_name(ast.parse("data", mode="eval").body) is True

    def test_any_other_name_is_false(self):
        assert _is_data_name(ast.parse("parent", mode="eval").body) is False

    def test_a_non_name_node_is_false(self):
        assert _is_data_name(ast.parse("1", mode="eval").body) is False


class TestWrapperDerived:
    def test_an_attribute_off_a_card_collection_root_is_true(self):
        assert _wrapper_derived(ast.parse("relations.x", mode="eval").body, {}) is True

    def test_an_attribute_off_something_else_is_false(self):
        assert _wrapper_derived(ast.parse("parent.x", mode="eval").body, {}) is False

    def test_a_bare_card_collection_root_name_is_true_by_default(self):
        assert _wrapper_derived(ast.Name(id="children"), {}) is True

    def test_a_bare_other_name_is_false_by_default(self):
        assert _wrapper_derived(ast.Name(id="foo"), {}) is False

    def test_an_alias_overrides_the_default_even_for_a_root_name(self):
        # The alias dict is consulted first — a variable that happens to be
        # named "relations" but was proven not wrapper-derived earlier must
        # not fall back to the "name is a root" default.
        assert _wrapper_derived(ast.Name(id="relations"), {"relations": False}) is False

    def test_an_alias_is_honoured_when_true(self):
        assert _wrapper_derived(ast.Name(id="apps"), {"apps": True}) is True

    def test_a_subscript_off_a_root_is_true(self):
        assert _wrapper_derived(ast.parse('relations["x"]', mode="eval").body, {}) is True

    def test_a_subscript_off_something_else_is_false(self):
        assert _wrapper_derived(ast.parse('parent["x"]', mode="eval").body, {}) is False

    def test_binop_is_true_when_only_the_left_side_is_wrapper_derived(self):
        # Both sides true in the concatenation test elsewhere does not tell
        # "and" apart from "or" — this asymmetric case does.
        node = ast.parse("relations.x + parent.y", mode="eval").body
        assert _wrapper_derived(node, {}) is True

    def test_binop_is_false_when_neither_side_is_wrapper_derived(self):
        node = ast.parse("parent.a + other.b", mode="eval").body
        assert _wrapper_derived(node, {}) is False

    def test_a_zero_argument_call_is_false(self):
        assert _wrapper_derived(ast.parse("NOW()", mode="eval").body, {}) is False

    def test_a_call_whose_func_is_not_a_bare_name_is_false(self):
        node = ast.parse("relations.x.method(y)", mode="eval").body
        assert _wrapper_derived(node, {}) is False

    def test_an_unrelated_node_type_is_false(self):
        assert _wrapper_derived(ast.parse("42", mode="eval").body, {}) is False


class TestKnownFieldKeys:
    def test_builtins_and_extras_are_present_even_with_no_schema(self):
        keys = known_field_keys(None, extra={"calcTarget"})
        assert {"name", "catalogueId", "calcTarget"} <= keys

    def test_a_section_with_no_fields_key_contributes_nothing(self):
        assert known_field_keys([{"section": "Empty"}]) == known_field_keys(None)


class TestDataRefs:
    def test_plain_reference(self):
        assert data_refs("data.licenseCost + 1") == {"licenseCost"}

    def test_subscript_reference(self):
        # `_DotDict` raises KeyError on a missing subscript rather than
        # returning None, so this path must be checked too — and it would
        # otherwise be an easy way past the save-time validation.
        assert data_refs('data["licenseCost"]') == {"licenseCost"}

    def test_nested_lifecycle_yields_the_root_key(self):
        # `lifecycle` is the key that has to exist; `endOfLife` lives inside it.
        assert data_refs("data.lifecycle.endOfLife") == {"lifecycle"}

    def test_string_literal_is_not_a_reference(self):
        # The whole reason this is AST-based rather than a regex.
        assert data_refs('PLUCK(relations.relAppToITC, "data.foo")') == set()

    def test_collects_across_assignment_lines(self):
        formula = "a = data.licenseCost\nb = data.supportCost\na + b"
        assert data_refs(formula) == {"licenseCost", "supportCost"}

    def test_unparseable_formula_yields_nothing(self):
        assert data_refs("data.x +") == set()

    def test_parent_attributes_are_not_data_refs(self):
        assert data_refs("parent.attributes.licenseCost") == set()


class TestUnknownFieldRefs:
    def test_known_keys_pass(self):
        formula = "data.licenseCost + data.supportCost"
        assert unknown_field_refs(formula, FIELDS_SCHEMA) == []

    def test_builtin_props_pass(self):
        formula = 'IF(data.status == "ACTIVE", data.lifecycle.endOfLife, data.name)'
        assert unknown_field_refs(formula, FIELDS_SCHEMA) == []

    def test_typo_is_reported(self):
        formula = "data.LicenseCost + data.supportCost"
        assert unknown_field_refs(formula, FIELDS_SCHEMA) == ["LicenseCost"]

    def test_multiple_unknowns_sorted(self):
        formula = "data.zeta + data.alpha"
        assert unknown_field_refs(formula, FIELDS_SCHEMA) == ["alpha", "zeta"]

    def test_empty_schema_still_allows_builtins(self):
        assert unknown_field_refs("data.name", []) == []
        assert unknown_field_refs("data.anything", None) == ["anything"]


class TestSuggestField:
    def test_case_mismatch_is_the_first_guess(self):
        assert suggest_field("LicenseCost", FIELDS_SCHEMA) == "licenseCost"

    def test_near_miss(self):
        assert suggest_field("licenseCst", FIELDS_SCHEMA) == "licenseCost"

    def test_nothing_close_returns_none(self):
        assert suggest_field("zzzzzzzz", FIELDS_SCHEMA) is None

    def test_an_exact_match_is_returned_unchanged(self):
        assert suggest_field("licenseCost", FIELDS_SCHEMA) == "licenseCost"

    def test_extra_keys_are_considered(self):
        assert suggest_field("CalcTarget", FIELDS_SCHEMA, extra={"calcTarget"}) == "calcTarget"


class TestLintFormula:
    def test_bare_key_over_relations_warns(self):
        warnings = lint_formula('SUM(PLUCK(relations.relInitiativeToApp, "CAPEX"))')
        assert len(warnings) == 1
        assert 'PLUCK key "CAPEX"' in warnings[0]
        assert '"attributes.CAPEX"' in warnings[0]

    def test_attributes_prefix_is_clean(self):
        assert lint_formula('SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))') == ()

    def test_rel_attributes_prefix_is_clean(self):
        assert (
            lint_formula('SUM(PLUCK(relations.relAppToITC, "rel_attributes.costTotalAnnual"))')
            == ()
        )

    def test_ppm_prefix_is_clean(self):
        assert lint_formula('SUM(PLUCK(relations.relInitiativeToApp, "ppm.capexBudget"))') == ()

    def test_wrapper_level_keys_are_clean(self):
        assert lint_formula('PLUCK(relations.relAppToITC, "name")') == ()
        assert lint_formula('FILTER(relations.relAppToITC, "type", "ITComponent")') == ()

    def test_children_collection_is_checked_too(self):
        warnings = lint_formula('SUM(PLUCK(children, "costTotalAnnual"))')
        assert len(warnings) == 1
        assert '"attributes.costTotalAnnual"' in warnings[0]

    def test_alias_from_an_earlier_line_is_tracked(self):
        # The shape where the `attributes.` prefix is most often forgotten, and
        # the one a per-expression walker cannot see.
        formula = 'apps = relations.relAppToITC\nSUM(PLUCK(apps, "costTotalAnnual"))'
        warnings = lint_formula(formula)
        assert len(warnings) == 1
        assert '"attributes.costTotalAnnual"' in warnings[0]

    def test_alias_of_a_plain_list_is_not_flagged(self):
        formula = 'years = ppm.byYear\nSUM(PLUCK(years, "capexBudget"))'
        assert lint_formula(formula) == ()

    def test_concatenated_collections_keep_provenance(self):
        formula = 'SUM(PLUCK(relations.relAppToITC + relations.relAppToDataObj, "cost"))'
        assert len(lint_formula(formula)) == 1

    def test_subscripted_relations_keep_provenance(self):
        formula = 'SUM(PLUCK(relations["relAppToITC"], "cost"))'
        assert len(lint_formula(formula)) == 1

    def test_nested_call_still_recognised(self):
        warnings = lint_formula(
            'COUNT(PLUCK(FILTER(relations.relOrgToApp, "attributes.hosting", "onPrem"), "x"))'
        )
        assert len(warnings) == 1
        assert 'PLUCK key "x"' in warnings[0]

    def test_non_card_collection_is_not_flagged(self):
        # ppm.byYear is a plain list of dicts whose keys sit at the top level.
        assert lint_formula('SUM(PLUCK(FILTER(ppm.byYear, "year", 2026), "capexBudget"))') == ()

    def test_computed_key_is_not_flagged(self):
        assert lint_formula('PLUCK(relations.relAppToITC, "attributes." + data.pick)') == ()

    def test_filter_is_checked(self):
        warnings = lint_formula('COUNT(FILTER(relations.relOrgToApp, "hostingType", "onPremise"))')
        assert len(warnings) == 1
        assert 'FILTER key "hostingType"' in warnings[0]

    def test_duplicate_warnings_are_collapsed(self):
        formula = (
            'a = SUM(PLUCK(relations.relAppToITC, "CAPEX"))\n'
            'b = SUM(PLUCK(relations.relAppToITC, "CAPEX"))\n'
            "a + b"
        )
        assert len(lint_formula(formula)) == 1

    def test_clean_formula_has_no_warnings(self):
        assert lint_formula("COALESCE(data.licenseCost, 0) + COALESCE(data.supportCost, 0)") == ()
