"""Pure helpers of ``api/v1/relations.py`` — no database needed.

``_resolve_ref_input`` and ``_rel_to_response`` touch nothing async; a fake
resolver and a plain ``SimpleNamespace`` relation stand in for the real
``CardResolver`` / ``Relation`` model.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1.relations import _rel_to_response, _resolve_ref_input
from app.models.relation_type import RelationType
from app.schemas.relation import RelationRefInput
from app.services.card_resolver import Candidate, ResolveResult


def _rt(**overrides):
    defaults = {"source_type_key": "Application", "target_type_key": "ITComponent"}
    return RelationType(**{**defaults, **overrides})


class _FakeResolver:
    """Records the last ref string it was asked to resolve."""

    def __init__(self, outcome: ResolveResult):
        self.outcome = outcome
        self.calls: list[tuple[str, str]] = []

    def resolve(self, type_key: str, ref: str) -> ResolveResult:
        self.calls.append((type_key, ref))
        return self.outcome


class TestResolveRefInputById:
    def test_a_valid_uuid_is_returned_without_consulting_the_resolver(self):
        card_id = uuid.uuid4()
        resolver = _FakeResolver(ResolveResult(status="missing"))
        result = _resolve_ref_input(
            RelationRefInput(id=str(card_id)), _rt(), endpoint="source", resolver=resolver
        )
        assert result == card_id
        assert resolver.calls == []

    def test_an_invalid_uuid_raises_422_naming_the_endpoint(self):
        with pytest.raises(HTTPException) as exc:
            _resolve_ref_input(
                RelationRefInput(id="not-a-uuid"),
                _rt(),
                endpoint="target",
                resolver=_FakeResolver(ResolveResult(status="missing")),
            )
        assert exc.value.status_code == 422
        assert "Invalid target UUID: not-a-uuid" in exc.value.detail


class TestResolveRefInputType:
    def test_source_endpoint_uses_the_source_type_key_as_default(self):
        resolver = _FakeResolver(ResolveResult(status="resolved", card_id=uuid.uuid4()))
        _resolve_ref_input(RelationRefInput(name="x"), _rt(), endpoint="source", resolver=resolver)
        assert resolver.calls[0][0] == "Application"

    def test_target_endpoint_uses_the_target_type_key_as_default(self):
        resolver = _FakeResolver(ResolveResult(status="resolved", card_id=uuid.uuid4()))
        _resolve_ref_input(RelationRefInput(name="x"), _rt(), endpoint="target", resolver=resolver)
        assert resolver.calls[0][0] == "ITComponent"

    def test_a_matching_explicit_type_is_accepted(self):
        resolver = _FakeResolver(ResolveResult(status="resolved", card_id=uuid.uuid4()))
        _resolve_ref_input(
            RelationRefInput(type="Application", name="x"),
            _rt(),
            endpoint="source",
            resolver=resolver,
        )
        assert resolver.calls[0][0] == "Application"

    def test_a_mismatched_explicit_type_raises_422_naming_both_types(self):
        with pytest.raises(HTTPException) as exc:
            _resolve_ref_input(
                RelationRefInput(type="Risk", name="x"),
                _rt(),
                endpoint="source",
                resolver=_FakeResolver(ResolveResult(status="missing")),
            )
        assert exc.value.status_code == 422
        assert "Risk" in exc.value.detail
        assert "Application" in exc.value.detail
        assert "Source" in exc.value.detail


class TestResolveRefInputName:
    def test_a_missing_name_raises_422(self):
        with pytest.raises(HTTPException) as exc:
            _resolve_ref_input(
                RelationRefInput(type="Application"),
                _rt(),
                endpoint="source",
                resolver=_FakeResolver(ResolveResult(status="missing")),
            )
        assert exc.value.status_code == 422
        assert "Source reference is missing a name" in exc.value.detail

    def test_parent_path_segments_join_with_the_name_separated_by_slash(self):
        resolver = _FakeResolver(ResolveResult(status="resolved", card_id=uuid.uuid4()))
        _resolve_ref_input(
            RelationRefInput(type="Application", parent_path=["Root", "Mid"], name="Leaf"),
            _rt(),
            endpoint="source",
            resolver=resolver,
        )
        assert resolver.calls[0][1] == "Root / Mid / Leaf"

    def test_a_literal_slash_in_a_segment_is_escaped(self):
        resolver = _FakeResolver(ResolveResult(status="resolved", card_id=uuid.uuid4()))
        _resolve_ref_input(
            RelationRefInput(type="Application", name="A/B"),
            _rt(),
            endpoint="source",
            resolver=resolver,
        )
        assert resolver.calls[0][1] == "A\\/B"

    def test_a_literal_backslash_in_a_segment_is_doubled(self):
        resolver = _FakeResolver(ResolveResult(status="resolved", card_id=uuid.uuid4()))
        _resolve_ref_input(
            RelationRefInput(type="Application", name="A\\B"),
            _rt(),
            endpoint="source",
            resolver=resolver,
        )
        assert resolver.calls[0][1] == "A\\\\B"


class TestResolveRefInputOutcome:
    def test_resolved_with_a_card_id_returns_it(self):
        card_id = uuid.uuid4()
        resolver = _FakeResolver(ResolveResult(status="resolved", card_id=card_id))
        result = _resolve_ref_input(
            RelationRefInput(type="Application", name="x"),
            _rt(),
            endpoint="source",
            resolver=resolver,
        )
        assert result == card_id

    def test_resolved_without_a_card_id_still_counts_as_not_found(self):
        resolver = _FakeResolver(ResolveResult(status="resolved", card_id=None))
        with pytest.raises(HTTPException) as exc:
            _resolve_ref_input(
                RelationRefInput(type="Application", name="x"),
                _rt(),
                endpoint="source",
                resolver=resolver,
            )
        assert exc.value.status_code == 422
        assert "not found" in exc.value.detail

    def test_ambiguous_lists_up_to_three_candidates(self):
        candidates = [Candidate(id=uuid.uuid4(), parent_path=(), name=f"Card{i}") for i in range(5)]
        resolver = _FakeResolver(ResolveResult(status="ambiguous", candidates=candidates))
        with pytest.raises(HTTPException) as exc:
            _resolve_ref_input(
                RelationRefInput(type="Application", name="x"),
                _rt(),
                endpoint="source",
                resolver=resolver,
            )
        assert exc.value.status_code == 422
        assert "ambiguous" in exc.value.detail
        assert exc.value.detail.count("Card") == 3

    def test_missing_raises_not_found_naming_the_ref(self):
        resolver = _FakeResolver(ResolveResult(status="missing"))
        with pytest.raises(HTTPException) as exc:
            _resolve_ref_input(
                RelationRefInput(name="Nowhere"),
                _rt(),
                endpoint="target",
                resolver=resolver,
            )
        assert exc.value.status_code == 422
        assert "Target not found: Nowhere" in exc.value.detail


def _rel(**overrides):
    defaults = dict(
        id=uuid.uuid4(),
        type="relAppToITC",
        source_id=uuid.uuid4(),
        target_id=uuid.uuid4(),
        source=None,
        target=None,
        attributes=None,
        description=None,
        created_at=None,
    )
    return SimpleNamespace(**{**defaults, **overrides})


def _card(**overrides):
    defaults = dict(id=str(uuid.uuid4()), type="Application", name="Foo", subtype=None)
    return SimpleNamespace(**{**defaults, **overrides})


class TestRelToResponse:
    def test_explicit_refs_are_used_without_touching_the_loaded_relationships(self):
        rel = _rel(source=_card(name="should not be read"))
        source_ref = _card(name="explicit")
        response = _rel_to_response(rel, source_ref=source_ref, target_ref=None)
        assert response.source is not None
        assert response.source.name == "explicit"

    def test_the_loaded_source_card_is_used_when_no_ref_is_supplied(self):
        source_card = _card(name="Widget")
        rel = _rel(source=source_card)
        response = _rel_to_response(rel)
        assert response.source is not None
        assert response.source.name == "Widget"

    def test_a_relation_with_no_loaded_source_yields_no_source_ref(self):
        rel = _rel(source=None)
        response = _rel_to_response(rel)
        assert response.source is None

    def test_cost_keys_are_stripped_from_attributes(self):
        rel = _rel(attributes={"licenseCost": 100, "note": "x"})
        response = _rel_to_response(rel, strip_cost_keys=frozenset({"licenseCost"}))
        assert response.attributes == {"note": "x"}

    def test_an_empty_strip_set_leaves_attributes_untouched(self):
        rel = _rel(attributes={"licenseCost": 100})
        response = _rel_to_response(rel, strip_cost_keys=frozenset())
        assert response.attributes == {"licenseCost": 100}

    def test_stripping_with_no_attributes_does_not_raise(self):
        rel = _rel(attributes=None)
        response = _rel_to_response(rel, strip_cost_keys=frozenset({"licenseCost"}))
        assert response.attributes is None
