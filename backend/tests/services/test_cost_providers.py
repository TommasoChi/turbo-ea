import uuid

import pytest

from app.services import cost_providers as cp
from app.services.card_costs import UNSET, CostError
from app.services.card_read_scope import CardReadScope
from tests.conftest import create_card, create_card_type, create_relation, create_relation_type

EVERYTHING = CardReadScope.everything()
NO_PROVIDERS = CardReadScope(
    role_key="x",
    wildcard=False,
    base_view=True,
    denied_types=frozenset({"Provider"}),
    allowed_types=frozenset(),
    stakeholder_card_ids=frozenset(),
)


@pytest.fixture
async def env(db):
    await create_card_type(db, key="Application")
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_card_type(db, key="Provider", label="Provider")
    await create_relation_type(
        db,
        key="relProviderToApp",
        source_type_key="Provider",
        target_type_key="Application",
    )
    await create_relation_type(
        db,
        key="relProviderToITC",
        source_type_key="Provider",
        target_type_key="ITComponent",
    )
    parent = await create_card(db, name="Parent app")
    app = await create_card(db, name="App", parent_id=parent.id)
    child = await create_card(db, name="Child app", parent_id=app.id)
    sibling = await create_card(db, name="Sibling app", parent_id=parent.id)
    return {"parent": parent, "app": app, "child": child, "sibling": sibling}


async def provider(db, name, linked=None, rel="relProviderToApp", **kw):
    card = await create_card(db, card_type="Provider", name=name, **kw)
    if linked is not None:
        await create_relation(db, type_key=rel, source_id=card.id, target_id=linked.id)
    return card


async def test_candidates_walk_card_ancestors_and_descendants(db, env):
    a = await provider(db, "A", env["app"])
    p = await provider(db, "P", env["parent"])
    c = await provider(db, "C", env["child"])
    await provider(db, "S", env["sibling"])
    got = await cp.candidate_providers(db, EVERYTHING, env["app"].id, "Application")
    assert got == [(a.id, "A"), (c.id, "C"), (p.id, "P")]


async def test_candidates_use_the_relation_of_the_card_type(db, env):
    itc = await create_card(db, card_type="ITComponent", name="Itc")
    await provider(db, "OnApp", env["app"])
    await provider(db, "OnItc", itc, rel="relProviderToITC")
    await create_relation(
        db,
        type_key="relProviderToApp",
        source_id=(await provider(db, "WrongRel")).id,
        target_id=itc.id,
    )
    got = await cp.candidate_providers(db, EVERYTHING, itc.id, "ITComponent")
    assert [n for _, n in got] == ["OnItc"]


async def test_candidates_skip_archived_and_unreadable_providers(db, env):
    await provider(db, "Archived", env["app"], status="ARCHIVED")
    await provider(db, "Hidden", env["app"])
    assert await cp.candidate_providers(db, NO_PROVIDERS, env["app"].id, "Application") == []
    got = await cp.candidate_providers(db, EVERYTHING, env["app"].id, "Application")
    assert [n for _, n in got] == ["Hidden"]


async def test_unreadable_ancestor_does_not_stop_the_walk(db, env):
    await create_card_type(db, key="Hidden")
    top = await create_card(db, name="Top")
    mid = await create_card(db, card_type="Hidden", name="Mid", parent_id=top.id)
    leaf = await create_card(db, name="Leaf", parent_id=mid.id)
    scope = CardReadScope(
        role_key="x",
        wildcard=False,
        base_view=True,
        denied_types=frozenset({"Hidden"}),
        allowed_types=frozenset(),
        stakeholder_card_ids=frozenset(),
    )
    top_provider = await provider(db, "TopProvider", top)
    got = await cp.candidate_providers(db, scope, leaf.id, "Application")
    assert got == [(top_provider.id, "TopProvider")]


async def test_resolve_write_keeps_stored_when_unset(db, env):
    got = await cp.resolve_write(db, EVERYTHING, env["app"].id, "Application", "abc", UNSET)
    assert got == "abc"


async def test_resolve_write_accepts_the_stored_id_even_if_no_longer_a_candidate(db, env):
    stale = await provider(db, "Stale")
    sid = str(stale.id)
    got = await cp.resolve_write(db, EVERYTHING, env["app"].id, "Application", sid, sid)
    assert got == sid


async def test_resolve_write_rejects_a_new_non_candidate(db, env):
    other = await provider(db, "Other")
    with pytest.raises(CostError) as exc:
        await cp.resolve_write(db, EVERYTHING, env["app"].id, "Application", None, str(other.id))
    assert exc.value.code == "invalid_provider"


async def test_resolve_write_accepts_a_new_candidate(db, env):
    ok = await provider(db, "Ok", env["parent"])
    got = await cp.resolve_write(db, EVERYTHING, env["app"].id, "Application", None, str(ok.id))
    assert got == str(ok.id)


async def test_resolve_write_null_clears_a_visible_stored_provider(db, env):
    vis = await provider(db, "Vis", env["app"])
    got = await cp.resolve_write(db, EVERYTHING, env["app"].id, "Application", str(vis.id), None)
    assert got is None


async def test_resolve_write_null_keeps_an_unreadable_stored_provider(db, env):
    hid = await provider(db, "Hid", env["app"])
    got = await cp.resolve_write(db, NO_PROVIDERS, env["app"].id, "Application", str(hid.id), None)
    assert got == str(hid.id)


async def test_resolve_write_null_clears_a_deleted_stored_provider(db, env):
    gone = str(uuid.uuid4())
    assert (
        await cp.resolve_write(db, NO_PROVIDERS, env["app"].id, "Application", gone, None) is None
    )


async def test_resolve_write_null_with_nothing_stored_stays_none(db, env):
    assert await cp.resolve_write(db, EVERYTHING, env["app"].id, "Application", None, None) is None


async def test_resolve_write_new_pick_replaces_an_unreadable_stored_provider(db, env):
    hid = await provider(db, "Hid", env["app"])
    ok = await provider(db, "Ok", env["app"])
    scope = CardReadScope(
        role_key="x",
        wildcard=False,
        base_view=True,
        denied_types=frozenset(),
        allowed_types=frozenset(),
        stakeholder_card_ids=frozenset(),
        subtype_denials=(),
    )
    got = await cp.resolve_write(db, scope, env["app"].id, "Application", str(hid.id), str(ok.id))
    assert got == str(ok.id)


async def test_provider_names_hide_unreadable_and_non_provider_cards(db, env):
    prov = await provider(db, "Prov")
    archived = await provider(db, "Old", status="ARCHIVED")
    ids = [prov.id, archived.id, env["app"].id]
    assert await cp.provider_names(db, EVERYTHING, ids) == {prov.id: "Prov", archived.id: "Old"}
    assert await cp.provider_names(db, NO_PROVIDERS, ids) == {}
