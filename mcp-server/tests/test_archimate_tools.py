"""ArchiMate tools: the type mapping, Exchange-format diagram create/update, kind filter."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from turbo_ea_mcp import server

XML = '<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" identifier="m"/>'


@pytest.fixture
def fake_token(monkeypatch):
    monkeypatch.setattr(server, "_stdio_token", "test-token")
    yield "test-token"


def _route_writes_through_batch(patch_response: dict):
    """POST/PATCH routers for a tool that runs inside ``mutation_batch``."""
    post_calls: list = []
    patch_calls: list = []

    async def post_router(path, json=None):
        post_calls.append((path, json))
        if path.endswith("/commit"):
            return {"id": "B-001", "committed_at": "now"}
        if path.startswith("/mutation-batches"):
            return {"id": "B-001", "dry_run": (json or {}).get("dry_run", False)}
        return {}

    async def patch_router(path, json=None):
        patch_calls.append((path, json))
        return patch_response

    return post_router, patch_router, post_calls, patch_calls


class TestGetArchimateMapping:
    @pytest.mark.asyncio
    async def test_combines_types_and_relations_into_a_compact_mapping(self, fake_token):
        types = [
            {
                "key": "Application",
                "label": "Application",
                "archimate_type": "ApplicationComponent",
                "subtypes": [
                    {"key": "microservice", "label": "Microservice", "archimate_type": None}
                ],
            },
            {
                "key": "BusinessContext",
                "label": "Business Context",
                "archimate_type": None,
                "subtypes": [],
            },
        ]
        rels = [
            {
                "key": "relAppToITC",
                "label": "uses",
                "source_type_key": "Application",
                "target_type_key": "ITComponent",
                "archimate_type": "Serving",
                "archimate_reversed": True,
                "archimate_access": None,
            }
        ]
        get = AsyncMock(side_effect=[types, rels])
        with patch.object(server.TurboEAClient, "get", get):
            out = json.loads(await server.get_archimate_mapping())
        assert get.await_args_list[0].args == ("/metamodel/types",)
        assert get.await_args_list[1].args == ("/metamodel/relation-types",)
        assert out["card_types"] == [
            {
                "key": "Application",
                "archimate_type": "ApplicationComponent",
                "subtypes": {"microservice": None},
            },
            {"key": "BusinessContext", "archimate_type": None, "subtypes": {}},
        ]
        assert out["relation_types"] == [
            {
                "key": "relAppToITC",
                "label": "uses",
                "source": "Application",
                "target": "ITComponent",
                "archimate_type": "Serving",
                "reversed": True,
                "access": None,
            }
        ]
        assert (
            "Serving" in out["notes"]["relationship_types"]
            and "BusinessActor" in out["notes"]["element_types"]
        )

    @pytest.mark.asyncio
    async def test_missing_archimate_fields_and_null_subtypes_degrade_to_defaults(self, fake_token):
        types = [{"key": "T", "label": "T", "subtypes": None}]
        rels = [{"key": "r", "label": "R", "source_type_key": "A", "target_type_key": "B"}]
        with patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=[types, rels])):
            out = json.loads(await server.get_archimate_mapping())
        assert out["card_types"] == [{"key": "T", "archimate_type": None, "subtypes": {}}]
        assert out["relation_types"][0]["reversed"] is False
        assert out["relation_types"][0]["archimate_type"] is None
        assert out["relation_types"][0]["access"] is None

    @pytest.mark.asyncio
    async def test_unauthenticated(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        assert await server.get_archimate_mapping() == "Error: Not authenticated. Please reconnect."

    def test_is_read_only(self):
        tool = server.mcp._tool_manager._tools["get_archimate_mapping"]
        assert tool.annotations.readOnlyHint is True

    def test_the_valid_name_lists_are_exactly_the_taxonomy(self):
        # Pinned in full (not only by size) so a typo in one name is caught here.
        assert (
            server.ARCHIMATE_RELATIONSHIP_TYPES
            == (
                "Composition Aggregation Assignment Realization Serving Access Influence "
                "Triggering Flow Specialization Association"
            ).split()
        )
        assert (
            server.ARCHIMATE_ELEMENT_TYPES
            == (
                "AndJunction ApplicationCollaboration ApplicationComponent ApplicationEvent "
                "ApplicationFunction ApplicationInteraction ApplicationInterface ApplicationProcess "
                "ApplicationService Artifact Assessment BusinessActor BusinessCollaboration "
                "BusinessEvent BusinessFunction BusinessInteraction BusinessInterface BusinessObject "
                "BusinessProcess BusinessRole BusinessService Capability CommunicationNetwork "
                "Constraint Contract CourseOfAction DataObject Deliverable Device DistributionNetwork "
                "Driver Equipment Facility Gap Goal Grouping ImplementationEvent Location Material "
                "Meaning Node OrJunction Outcome Path Plateau Principle Product Representation "
                "Requirement Resource Stakeholder SystemSoftware TechnologyCollaboration "
                "TechnologyEvent TechnologyFunction TechnologyInteraction TechnologyInterface "
                "TechnologyProcess TechnologyService Value ValueStream WorkPackage"
            ).split()
        )

    def test_the_valid_name_lists_match_the_backend_taxonomy(self):
        assert len(server.ARCHIMATE_ELEMENT_TYPES) == 62
        assert server.ARCHIMATE_ELEMENT_TYPES == sorted(server.ARCHIMATE_ELEMENT_TYPES)
        assert {
            "BusinessActor",
            "ApplicationComponent",
            "Grouping",
            "Location",
            "AndJunction",
            "OrJunction",
        } <= set(server.ARCHIMATE_ELEMENT_TYPES)
        assert len(server.ARCHIMATE_RELATIONSHIP_TYPES) == 11
        assert {"Composition", "Serving", "Access", "Association"} <= set(
            server.ARCHIMATE_RELATIONSHIP_TYPES
        )


class TestCreateArchimateDiagram:
    @pytest.mark.asyncio
    async def test_dry_run_validates_and_never_creates(self, fake_token):
        post = AsyncMock(
            return_value={
                "valid": False,
                "issues": [{"code": "unknown_element_type", "message": "m", "ref": "a"}],
            }
        )
        with patch.object(server.TurboEAClient, "post", post):
            out = json.loads(await server.create_archimate_diagram("A", XML))
        post.assert_awaited_once_with("/archimate/validate", json={"xml": XML})
        assert out["dry_run"] is True and out["valid"] is False
        assert out["issues"][0]["code"] == "unknown_element_type"
        assert out["would_create"] == {
            "name": "A",
            "description": "",
            "linked_card_ids": [],
            "kind": "archimate",
        }

    @pytest.mark.asyncio
    async def test_dry_run_echoes_the_description_and_links(self, fake_token):
        post = AsyncMock(return_value={"valid": True, "issues": []})
        with patch.object(server.TurboEAClient, "post", post):
            out = json.loads(
                await server.create_archimate_diagram(
                    "A", XML, description="d", linked_card_ids=["c1"]
                )
            )
        assert out["valid"] is True and out["issues"] == []
        assert out["would_create"]["description"] == "d"
        assert out["would_create"]["linked_card_ids"] == ["c1"]

    @pytest.mark.asyncio
    async def test_commit_posts_the_diagram_with_kind_and_format(self, fake_token):
        post = AsyncMock(return_value={"id": "d1"})
        with patch.object(server.TurboEAClient, "post", post):
            out = json.loads(
                await server.create_archimate_diagram(
                    "A", XML, description="x", linked_card_ids=["c1"], dry_run=False
                )
            )
        post.assert_awaited_once_with(
            "/diagrams",
            json={
                "name": "A",
                "description": "x",
                "kind": "archimate",
                "data": {"format": "archimate-exchange-3.1", "xml": XML},
                "card_ids": ["c1"],
            },
        )
        assert out == {"id": "d1"}

    @pytest.mark.asyncio
    async def test_commit_without_description_or_links_sends_null_and_empty(self, fake_token):
        post = AsyncMock(return_value={"id": "d1"})
        with patch.object(server.TurboEAClient, "post", post):
            await server.create_archimate_diagram("A", XML, dry_run=False)
        body = post.await_args.kwargs["json"]
        assert body["description"] is None and body["card_ids"] == []

    @pytest.mark.asyncio
    async def test_commit_is_blocked_when_writes_are_disabled(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "_writes_disabled_message", lambda: "writes off")
        assert await server.create_archimate_diagram("A", XML, dry_run=False) == "writes off"

    @pytest.mark.asyncio
    async def test_dry_run_is_blocked_when_writes_are_disabled(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "_writes_disabled_message", lambda: "writes off")
        post = AsyncMock()
        with patch.object(server.TurboEAClient, "post", post):
            assert await server.create_archimate_diagram("A", XML) == "writes off"
        post.assert_not_called()

    @pytest.mark.asyncio
    async def test_unauthenticated(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        assert (
            await server.create_archimate_diagram("A", XML)
            == "Error: Not authenticated. Please reconnect."
        )

    def test_is_an_additive_write(self):
        ann = server.mcp._tool_manager._tools["create_archimate_diagram"].annotations
        assert ann.readOnlyHint is False and not ann.destructiveHint


class TestUpdateArchimateDiagram:
    @pytest.mark.asyncio
    async def test_update_dry_run_previews_without_patching(self, fake_token):
        get = AsyncMock(
            return_value={
                "kind": "archimate",
                "name": "A",
                "description": "d",
                "data": {"format": "archimate-exchange-3.1", "xml": XML},
                "card_ids": ["c1"],
            }
        )
        post = AsyncMock(return_value={"valid": True, "issues": []})
        patch_mock = AsyncMock()
        with (
            patch.object(server.TurboEAClient, "get", get),
            patch.object(server.TurboEAClient, "post", post),
            patch.object(server.TurboEAClient, "patch", patch_mock),
        ):
            out = json.loads(
                await server.update_archimate_diagram("d1", exchange_xml=XML, name="B")
            )
        get.assert_awaited_once_with("/diagrams/d1")
        post.assert_awaited_once_with("/archimate/validate", json={"xml": XML})
        patch_mock.assert_not_called()
        assert out["dry_run"] is True and out["valid"] is True and out["issues"] == []
        assert out["diagram_id"] == "d1"
        assert out["would_update"] == {
            "data": {"format": "archimate-exchange-3.1", "xml": XML},
            "name": "B",
        }
        assert out["current"] == {
            "name": "A",
            "description": "d",
            "card_ids": ["c1"],
            "xml_chars": len(XML),
        }

    @pytest.mark.asyncio
    async def test_dry_run_without_xml_does_not_validate(self, fake_token):
        get = AsyncMock(
            return_value={"kind": "archimate", "name": "A", "data": {"xml": XML}, "card_ids": []}
        )
        post = AsyncMock()
        with (
            patch.object(server.TurboEAClient, "get", get),
            patch.object(server.TurboEAClient, "post", post),
        ):
            out = json.loads(
                await server.update_archimate_diagram("d1", name="B", linked_card_ids=[])
            )
        post.assert_not_called()
        assert "valid" not in out and "issues" not in out
        assert out["would_update"] == {"name": "B", "card_ids": []}

    @pytest.mark.asyncio
    async def test_update_refuses_a_drawio_diagram(self, fake_token):
        get = AsyncMock(return_value={"kind": "drawio", "name": "D", "data": {"xml": "<m/>"}})
        with patch.object(server.TurboEAClient, "get", get):
            out = await server.update_archimate_diagram("d1", exchange_xml=XML)
        assert out.startswith("Error: diagram d1 is a DrawIO diagram")
        assert out == "Error: diagram d1 is a DrawIO diagram; use update_diagram."

    @pytest.mark.asyncio
    async def test_commit_patches_inside_a_mutation_batch_without_kind(self, fake_token):
        post, patch_, post_calls, patch_calls = _route_writes_through_batch({"id": "d1"})
        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
            patch.object(server.TurboEAClient, "patch", AsyncMock(side_effect=patch_)),
        ):
            out = json.loads(
                await server.update_archimate_diagram(
                    "d1",
                    exchange_xml=XML,
                    name="B",
                    description="d",
                    linked_card_ids=["c1"],
                    dry_run=False,
                )
            )
        assert patch_calls == [
            (
                "/diagrams/d1",
                {
                    "data": {"format": "archimate-exchange-3.1", "xml": XML},
                    "name": "B",
                    "description": "d",
                    "card_ids": ["c1"],
                },
            )
        ]
        assert out["batch_id"] == "B-001" and out["id"] == "d1"
        assert post_calls[0][0].startswith("/mutation-batches")
        assert post_calls[0][1]["tool_name"] == "update_archimate_diagram"
        assert all(path != "/archimate/validate" for path, _ in post_calls)

    @pytest.mark.asyncio
    async def test_commit_sends_only_the_fields_given(self, fake_token):
        post, patch_, _post_calls, patch_calls = _route_writes_through_batch({"id": "d1"})
        with (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
            patch.object(server.TurboEAClient, "patch", AsyncMock(side_effect=patch_)),
        ):
            await server.update_archimate_diagram("d1", name="B", dry_run=False)
        assert patch_calls == [("/diagrams/d1", {"name": "B"})]

    @pytest.mark.asyncio
    async def test_commit_is_blocked_when_writes_are_disabled(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "_writes_disabled_message", lambda: "writes off")
        assert (
            await server.update_archimate_diagram("d1", exchange_xml=XML, dry_run=False)
            == "writes off"
        )
        assert await server.update_archimate_diagram("d1", exchange_xml=XML) == "writes off"

    @pytest.mark.asyncio
    async def test_unauthenticated(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        assert (
            await server.update_archimate_diagram("d1")
            == "Error: Not authenticated. Please reconnect."
        )

    def test_is_a_destructive_write(self):
        ann = server.mcp._tool_manager._tools["update_archimate_diagram"].annotations
        assert ann.readOnlyHint is False and ann.destructiveHint is True


class TestDiagramReads:
    @pytest.mark.asyncio
    async def test_list_diagrams_passes_the_kind(self, fake_token):
        get = AsyncMock(return_value=[])
        with patch.object(server.TurboEAClient, "get", get):
            await server.list_diagrams(kind="all")
            await server.list_diagrams(card_id="c1")
        assert get.await_args_list[0].args == ("/diagrams",)
        assert get.await_args_list[0].kwargs == {"params": {"kind": "all"}}
        assert get.await_args_list[1].kwargs == {"params": {"card_id": "c1", "kind": "drawio"}}

    @pytest.mark.asyncio
    async def test_get_diagram_returns_the_kind_and_the_exchange_xml(self, fake_token):
        diagram = {
            "id": "d1",
            "kind": "archimate",
            "data": {"format": "archimate-exchange-3.1", "xml": XML},
        }
        with patch.object(server.TurboEAClient, "get", AsyncMock(return_value=diagram)):
            out = json.loads(await server.get_diagram("d1"))
        assert out["kind"] == "archimate" and out["data"]["xml"] == XML

    def test_the_read_docstrings_say_which_kinds_they_cover(self):
        tools = server.mcp._tool_manager._tools
        assert (
            "kind" in tools["get_diagram"].description
            and "data.xml" in tools["get_diagram"].description
        )
        for kind in ("drawio", "archimate", "all"):
            assert kind in tools["list_diagrams"].description

    def test_the_drawio_write_tools_point_at_the_archimate_ones(self):
        tools = server.mcp._tool_manager._tools
        assert "create_archimate_diagram" in tools["create_diagram"].description
        assert "update_archimate_diagram" in tools["update_diagram"].description
