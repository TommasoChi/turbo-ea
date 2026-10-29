# Cost Report: Remove `aggregate`, Add Sankey View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the double-counting-prone `aggregate`/`parent_card_id` drill-down from the cost report, and add a Sankey chart view showing Application→IT Component cost flows via the `app_to_itc` relation, with a 2-level/3-level `group_by` flag and a fullscreen button shared with the Treemap.

**Architecture:** Backend: strip the `aggregate` branch and `parent_card_id` filter out of `GET /reports/cost-treemap` (dead code once aggregate is gone — nothing else set `parent_card_id`); add a new `GET /reports/cost-sankey` endpoint returning Recharts' `{nodes, links}` shape. Frontend: generalize `ReportShell`'s hardcoded 2-button view toggle to accept an extra middle button and a per-report chart-view label override; `CostReport.tsx` drops all aggregate/drill state (`AggregateOption`, `SourceRef`, `DrillFrame`, `drillStack`, `canDrill`, …), restricts the card-type selector to Application + IT Component (both selectable at once for the Sankey), and renders a `Sankey` panel. A shared `FullscreenPanel` wrapper (Fullscreen API) wraps both the Treemap and Sankey panels.

**Tech Stack:** FastAPI + SQLAlchemy (backend), React + MUI + Recharts `Sankey` (frontend, already in `recharts@3.7.0`, no new dependency).

**Spec:** `docs/superpowers/specs/2026-10-28-cost-report-sankey-design.md`

## Global Constraints

- No new npm/pip dependency — `Sankey` is already exported by the installed `recharts@3.7.0`.
- `_SAFE_KEY_RE` (existing regex in `reports.py`) gates every field-key/type-key query param, same as `cost_field` today.
- `costs.view` permission gates every new/changed endpoint, matching `cost_treemap`'s existing gate.
- Regenerate `docs/api/openapi.json` via `scripts/dump_openapi.py` after any route signature change (`.claude/rules/api-contracts.md`).
- New frontend strings go in `frontend/src/i18n/locales/en/reports.json` only; run `/translate` before the PR for the other 9 locales (`.claude/rules/i18n-locales.md`).
- `app_to_itc` is the real relation-type key (source `Application`, target `ITComponent`) — the spec's `relAppToITC` was a descriptive name, not the key; use `app_to_itc`.

## Decisions this plan makes (spec's open questions)

The spec left three questions open. Resolved here, as this plan's author's call:

1. **Sankey node/flow semantics.** 2-level (`group_by` off): one node per Application with cost > 0, one node per related IT Component with cost > 0; one link per `app_to_itc` relation between a visible pair, **value = the IT Component's own cost field** (the cost originates at the component; an IT Component related to several Applications fans out the same value on each link — explicitly acceptable per the spec, since a Sankey draws one flow per relation rather than summing). 3-level (`group_by` on, group type = a related card type of the Application, e.g. `BusinessCapability`): Application → group node → IT Component, i.e. the group layer sits *between* the two type layers (Application's own groups, not IT Component's). Link Application→group value = the Application's own cost field; link group→IT Component value = the related IT Component's cost field.
2. **Drill-down (`parent_card_id`) does not carry over.** Its only caller was the aggregate-mode "click a rectangle to drill" flow; with `aggregate` gone, nothing calls it, so `parent_card_id`, `DrillFrame`, `drillStack`, breadcrumbs and the multi-panel grid are deleted as dead code, not ported to Sankey. If click-to-explore for Sankey is wanted later, that's new scope.
3. **Fullscreen = a shared wrapper component** (`FullscreenPanel.tsx`), not a per-chart prop — same component wraps the Treemap `Paper` and the new Sankey `Paper`, using the browser Fullscreen API on the `Paper` node.

## Review Focus

- Zero-cost cards on either side of a Sankey link: an Application or IT Component with cost 0 must not appear as a node (matches today's Treemap/table, which already drop zero-cost items) — Task 2's test `test_cost_sankey_drops_zero_cost_nodes`.
- An IT Component related to zero Applications (or vice versa): must not appear as an orphan node with no link — Task 2's test `test_cost_sankey_excludes_unlinked_cards`.
- A relation that exists in the DB but one of whose endpoints is outside the caller's read scope: the link must not leak the hidden card's name — Task 2's test `test_cost_sankey_respects_read_scope`.
- Switching `cardTypeKey` away from Application/ITComponent while a saved report config still names a different type (legacy saved reports pre-dating this change): the restored type must fall back to Application, not silently 400 — Task 4's test `fallsBackToApplicationForUnsupportedSavedType`.
- `group_by` referencing a card type with no relation to Application at all: Sankey must render the 2-level flow with an empty/absent group layer rather than erroring — Task 2's test `test_cost_sankey_group_by_unrelated_type_is_ignored`.

---

## File Structure

- Modify `backend/app/api/v1/reports.py`: strip `aggregate`/`parent_card_id` from `cost_treemap`; add `cost_sankey`.
- Modify `backend/tests/api/test_reports_extended.py`: delete the 8 aggregate/parent_card_id tests (lines ~1258-1549).
- Create `backend/tests/api/test_reports_cost_sankey.py`: tests for the new endpoint.
- Modify `frontend/src/features/reports/ReportShell.tsx`: generalize the view toggle.
- Modify `frontend/src/features/reports/ReportShell.test.tsx` (or create if absent — check first): cover the new toggle prop.
- Modify `frontend/src/features/reports/CostReport.tsx`: remove aggregate/drill, restrict type selector, add Sankey panel.
- Create `frontend/src/features/reports/FullscreenPanel.tsx`: shared fullscreen wrapper.
- Create `frontend/src/features/reports/FullscreenPanel.test.tsx`.
- Modify `frontend/src/features/reports/CostReport.test.tsx`: update for removed aggregate UI, add Sankey coverage.
- Modify `frontend/src/i18n/locales/en/reports.json`: new strings (`cost.sankeyChartView`, `cost.treemapChartView`, `shell.fullscreen`, `shell.exitFullscreen`).
- Modify `backend/app/services/seed.py`: no change needed (group type used in 3-level Sankey is user-chosen at query time, not seeded).

---

## Task 1: Backend — remove `aggregate` and `parent_card_id` from `cost_treemap`

**Files:**
- Modify: `backend/app/api/v1/reports.py:1412-1668` (the `cost_treemap` function)
- Modify: `backend/tests/api/test_reports_extended.py:1258-1549` (delete 8 tests)

**Interfaces:**
- Consumes: nothing new.
- Produces: `cost_treemap`'s remaining query params after this task: `type`, `cost_field`, `group_by` — Task 4 (frontend) wires the type selector to only ever send `Application` or `ITComponent`.

- [ ] **Step 1: Delete the 8 aggregate/parent_card_id tests**

Delete `test_cost_treemap_aggregate_from_related_type`,
`test_cost_treemap_aggregate_dedupes_parallel_relations`,
`test_cost_treemap_aggregate_multi_type_sums_cleanly`,
`test_cost_treemap_aggregate_duplicate_pair_400`,
`test_cost_treemap_aggregate_invalid_field_400`,
`test_cost_treemap_aggregate_unknown_type_400`,
`test_cost_treemap_aggregate_malformed_spec_400`,
`test_cost_treemap_parent_card_id_filters_to_related` from
`backend/tests/api/test_reports_extended.py` (lines 1258-1549). Keep every
other test in the file, including `test_cost_treemap_invalid_cost_field_400`
and `test_cost_treemap_permission_denied` just above them.

- [ ] **Step 2: Run the suite to confirm nothing else referenced them**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/api/test_reports_extended.py -v`
Expected: remaining tests in the file pass (the 8 deleted ones are gone from
collection, not failing).

- [ ] **Step 3: Remove the dead parameters and branches from `cost_treemap`**

In `backend/app/api/v1/reports.py`:
- Remove `aggregate: list[str] | None = Query(None)` and
  `parent_card_id: uuid.UUID | None = Query(None)` from the signature.
- Remove the `if parent_card_id is not None:` block entirely (it only
  narrowed `sheets`; nothing else depends on `sheets` being pre-narrowed).
- Remove the `if aggregate: ... else: ...` branching — keep only the former
  `else` body (the plain per-card `cost_value(attrs.get(cost_field))` loop)
  un-indented, as the only cost computation.
- Trim the docstring to describe only `type`, `cost_field`, `group_by`,
  the fiscal-year rule, and the response shape — delete the `aggregate` and
  `parent_card_id` paragraphs.
- Leave `group_by` and its grouping block (lines 1617-1661) unchanged.

- [ ] **Step 4: Run the full reports test file again**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/api/test_reports_extended.py tests/api/test_reports_costs.py tests/api/test_reports_cost_fiscal_year.py -v`
Expected: all pass, no `NameError`/`UnboundLocalError` from the removed branch.

- [ ] **Step 5: Lint**

Run: `cd backend && venv/Scripts/python.exe -m ruff check app/api/v1/reports.py && venv/Scripts/python.exe -m ruff format --check app/api/v1/reports.py tests/api/test_reports_extended.py`
Expected: clean (run `ruff format` without `--check` first if it reports a diff, then re-run `--check`).

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/reports.py backend/tests/api/test_reports_extended.py
git commit -m "feat(reports): remove aggregate and parent_card_id from the cost treemap

Both existed only to power a many-to-many cost roll-up that silently
double-counts (one IT Component serving several Applications gets summed
into each one). The Sankey view replacing it draws one flow per relation
instead, so no replacement mechanism is needed."
```

---

## Task 2: Backend — `GET /reports/cost-sankey`

**Files:**
- Modify: `backend/app/api/v1/reports.py` (add `cost_sankey`, after `cost_treemap`)
- Create: `backend/tests/api/test_reports_cost_sankey.py`

**Interfaces:**
- Consumes: `cost_value()`, `is_live_in_fiscal_year()`, `get_fiscal_year_start()`, `current_fiscal_year()`, `CardReadScope`, `_SAFE_KEY_RE` — all already imported/defined in `reports.py`, same as `cost_treemap` uses them.
- Produces: `GET /reports/cost-sankey?cost_field=<key>&group_by=<CardType key, optional>` →
  ```python
  {
    "nodes": [{"id": str, "name": str, "type": "Application" | "ITComponent" | "<group type>"}],
    "links": [{"source": int, "target": int, "value": float}],  # indices into nodes
    "total": float,
    "fiscal_year": int,
    "fiscal_year_start": int,
  }
  ```
  `source`/`target` are indices into `nodes`, matching Recharts' `Sankey` `data` prop shape directly (`<Sankey data={{nodes, links}} />`).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/api/test_reports_cost_sankey.py
import pytest
from tests.conftest import auth_headers, create_card, create_relation, create_relation_type

pytestmark = pytest.mark.anyio


class TestCostSankey:
    async def test_cost_sankey_two_level_flow(self, client, db, env):
        """One link per app_to_itc relation; value = the IT Component's cost."""
        admin = env["admin"]
        app1 = await create_card(
            db, card_type="Application", name="ERP", user_id=admin.id,
            attributes={"costTotalAnnual": 1000},
        )
        itc1 = await create_card(
            db, card_type="ITComponent", name="DB", user_id=admin.id,
            attributes={"costTotalAnnual": 500},
        )
        await create_relation(db, type_key="app_to_itc", source_id=app1.id, target_id=itc1.id)

        resp = await client.get(
            "/api/v1/reports/cost-sankey",
            params={"cost_field": "costTotalAnnual"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        names = {n["id"]: n["name"] for n in data["nodes"]}
        assert set(names.values()) == {"ERP", "DB"}
        assert len(data["links"]) == 1
        link = data["links"][0]
        assert names[data["nodes"][link["source"]]["id"]] == "ERP"
        assert names[data["nodes"][link["target"]]["id"]] == "DB"
        assert link["value"] == 500

    async def test_cost_sankey_drops_zero_cost_nodes(self, client, db, env):
        """A card with cost 0 (or no cost field set) never becomes a node."""
        admin = env["admin"]
        app1 = await create_card(db, card_type="Application", name="NoCost", user_id=admin.id)
        itc1 = await create_card(
            db, card_type="ITComponent", name="DB", user_id=admin.id,
            attributes={"costTotalAnnual": 500},
        )
        await create_relation(db, type_key="app_to_itc", source_id=app1.id, target_id=itc1.id)

        resp = await client.get(
            "/api/v1/reports/cost-sankey",
            params={"cost_field": "costTotalAnnual"},
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert data["nodes"] == []
        assert data["links"] == []

    async def test_cost_sankey_excludes_unlinked_cards(self, client, db, env):
        """A costed card with no app_to_itc relation never appears as an orphan node."""
        admin = env["admin"]
        await create_card(
            db, card_type="Application", name="Lonely", user_id=admin.id,
            attributes={"costTotalAnnual": 1000},
        )
        resp = await client.get(
            "/api/v1/reports/cost-sankey",
            params={"cost_field": "costTotalAnnual"},
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert data["nodes"] == []

    async def test_cost_sankey_fans_out_shared_component(self, client, db, env):
        """One IT Component related to two Applications: one link per relation,
        each carrying the component's full cost (no division, no dedup)."""
        admin = env["admin"]
        app1 = await create_card(
            db, card_type="Application", name="ERP", user_id=admin.id,
            attributes={"costTotalAnnual": 1},
        )
        app2 = await create_card(
            db, card_type="Application", name="CRM", user_id=admin.id,
            attributes={"costTotalAnnual": 1},
        )
        itc = await create_card(
            db, card_type="ITComponent", name="SharedDB", user_id=admin.id,
            attributes={"costTotalAnnual": 500},
        )
        await create_relation(db, type_key="app_to_itc", source_id=app1.id, target_id=itc.id)
        await create_relation(db, type_key="app_to_itc", source_id=app2.id, target_id=itc.id)

        resp = await client.get(
            "/api/v1/reports/cost-sankey",
            params={"cost_field": "costTotalAnnual"},
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert len(data["links"]) == 2
        assert all(link["value"] == 500 for link in data["links"])
        assert data["total"] == 1000

    async def test_cost_sankey_group_by_three_level(self, client, db, env):
        """group_by inserts a middle node layer between Application and ITComponent."""
        admin = env["admin"]
        await create_relation_type(
            db, key="app_to_bc", label="Application uses Capability",
            source_type_key="Application", target_type_key="BusinessCapability",
        )
        bc = await create_card(db, card_type="BusinessCapability", name="Finance", user_id=admin.id)
        app1 = await create_card(
            db, card_type="Application", name="ERP", user_id=admin.id,
            attributes={"costTotalAnnual": 1000},
        )
        itc1 = await create_card(
            db, card_type="ITComponent", name="DB", user_id=admin.id,
            attributes={"costTotalAnnual": 500},
        )
        await create_relation(db, type_key="app_to_bc", source_id=app1.id, target_id=bc.id)
        await create_relation(db, type_key="app_to_itc", source_id=app1.id, target_id=itc1.id)

        resp = await client.get(
            "/api/v1/reports/cost-sankey",
            params={"cost_field": "costTotalAnnual", "group_by": "BusinessCapability"},
            headers=auth_headers(admin),
        )
        data = resp.json()
        types_by_name = {n["name"]: n["type"] for n in data["nodes"]}
        assert types_by_name == {"ERP": "Application", "Finance": "BusinessCapability", "DB": "ITComponent"}
        assert len(data["links"]) == 2  # ERP->Finance, Finance->DB

    async def test_cost_sankey_group_by_unrelated_type_is_ignored(self, client, db, env):
        """group_by naming a type with no relation to any Application falls back
        to the plain 2-level flow instead of erroring."""
        admin = env["admin"]
        app1 = await create_card(
            db, card_type="Application", name="ERP", user_id=admin.id,
            attributes={"costTotalAnnual": 1000},
        )
        itc1 = await create_card(
            db, card_type="ITComponent", name="DB", user_id=admin.id,
            attributes={"costTotalAnnual": 500},
        )
        await create_relation(db, type_key="app_to_itc", source_id=app1.id, target_id=itc1.id)

        resp = await client.get(
            "/api/v1/reports/cost-sankey",
            params={"cost_field": "costTotalAnnual", "group_by": "BusinessCapability"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        types_by_name = {n["name"]: n["type"] for n in data["nodes"]}
        assert types_by_name == {"ERP": "Application", "DB": "ITComponent"}
        assert len(data["links"]) == 1

    async def test_cost_sankey_invalid_cost_field_400(self, client, db, env):
        resp = await client.get(
            "/api/v1/reports/cost-sankey",
            params={"cost_field": "cost;DROP TABLE"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400

    async def test_cost_sankey_permission_denied(self, client, db, env):
        resp = await client.get(
            "/api/v1/reports/cost-sankey",
            params={"cost_field": "costTotalAnnual"},
            headers=auth_headers(env["noreports"]),
        )
        assert resp.status_code == 403

    async def test_cost_sankey_respects_read_scope(self, client, db, env):
        """A relation to a card outside the caller's read scope is never
        exposed as a link or a node naming that hidden card."""
        admin = env["admin"]
        app1 = await create_card(
            db, card_type="Application", name="ERP", user_id=admin.id,
            attributes={"costTotalAnnual": 1000},
        )
        hidden_itc = await create_card(
            db, card_type="ITComponent", name="SecretDB", user_id=admin.id,
            attributes={"costTotalAnnual": 500}, status="ARCHIVED",
        )
        await create_relation(db, type_key="app_to_itc", source_id=app1.id, target_id=hidden_itc.id)

        resp = await client.get(
            "/api/v1/reports/cost-sankey",
            params={"cost_field": "costTotalAnnual"},
            headers=auth_headers(admin),
        )
        data = resp.json()
        assert "SecretDB" not in {n["name"] for n in data["nodes"]}
        assert data["links"] == []
```

Use the existing `env` fixture's `admin`/`noreports` users; `app_to_itc` is
pre-seeded on `env` (confirmed in `conftest.py:529`), `app_to_bc` is not and
is created inline in the one test that needs it, same pattern already used
for `provider_to_app` elsewhere in this test suite.

- [ ] **Step 2: Run to verify all fail**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/api/test_reports_cost_sankey.py -v`
Expected: FAIL — `404 Not Found` (route doesn't exist yet) or `ImportError` if an import is wrong.

- [ ] **Step 3: Implement `cost_sankey`**

```python
@router.get("/cost-sankey")
async def cost_sankey(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    cost_field: str = Query("costTotalAnnual"),
    group_by: str | None = Query(None),
):
    """Cost flow between Application and ITComponent, via app_to_itc relations.

    Two-level flow (``group_by`` unset): one node per Application and one per
    ITComponent with ``cost_field`` > 0, one link per ``app_to_itc`` relation
    between two visible nodes, link value = the ITComponent end's cost (an
    ITComponent related to several Applications fans the same value out on
    each link rather than being divided or deduped — a Sankey draws one flow
    per relation, so this cannot double-count the way a summed total would).

    Three-level flow (``group_by`` names a card type related to Application):
    Application -> group node -> ITComponent. A ``group_by`` value naming a
    type with no relation to any visible Application silently falls back to
    the two-level flow instead of erroring, so a stale saved-report config
    degrades gracefully.
    """
    await PermissionService.require_permission(db, user, "costs.view")
    if not _SAFE_KEY_RE.match(cost_field):
        raise HTTPException(400, f"Invalid cost_field: {cost_field!r}")
    if group_by is not None and not _SAFE_KEY_RE.match(group_by):
        raise HTTPException(400, f"Invalid group_by: {group_by!r}")

    fy_start = await get_fiscal_year_start(db)
    fy = current_fiscal_year(fy_start)
    read_scope = await CardReadScope.load(db, user)

    async def costed_cards(type_key: str) -> dict[uuid.UUID, tuple[str, float]]:
        result = await db.execute(
            select(Card).where(
                Card.type == type_key, Card.status == "ACTIVE", *read_scope.where(Card, mode="module")
            )
        )
        out = {}
        for c in result.scalars().all():
            if not is_live_in_fiscal_year(c.lifecycle, fy, fy_start):
                continue
            cost = cost_value((c.attributes or {}).get(cost_field))
            if cost:
                out[c.id] = (c.name, cost)
        return out

    apps = await costed_cards("Application")
    itcs = await costed_cards("ITComponent")
    if not apps or not itcs:
        return {"nodes": [], "links": [], "total": 0.0, "fiscal_year": fy, "fiscal_year_start": fy_start}

    rel_result = await db.execute(
        select(Relation).where(
            ((Relation.source_id.in_(apps)) & (Relation.target_id.in_(itcs)))
            | ((Relation.source_id.in_(itcs)) & (Relation.target_id.in_(apps)))
        )
    )
    app_itc_pairs: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for r in rel_result.scalars().all():
        if r.source_id in apps and r.target_id in itcs:
            app_itc_pairs.add((r.source_id, r.target_id))
        elif r.target_id in apps and r.source_id in itcs:
            app_itc_pairs.add((r.target_id, r.source_id))

    group_cards: dict[uuid.UUID, tuple[str, float]] = {}
    app_group: dict[uuid.UUID, uuid.UUID] = {}
    if group_by:
        grp_result = await db.execute(
            select(Card).where(
                Card.type == group_by, Card.status == "ACTIVE", *read_scope.where(Card, mode="module")
            )
        )
        grp_ids = {c.id: c.name for c in grp_result.scalars().all()}
        if grp_ids:
            rel2 = await db.execute(
                select(Relation).where(
                    ((Relation.source_id.in_(apps)) & (Relation.target_id.in_(grp_ids)))
                    | ((Relation.source_id.in_(grp_ids)) & (Relation.target_id.in_(apps)))
                )
            )
            for r in rel2.scalars().all():
                if r.source_id in apps and r.target_id in grp_ids:
                    app_group[r.source_id] = r.target_id
                elif r.target_id in apps and r.source_id in grp_ids:
                    app_group[r.target_id] = r.source_id
            for gid in set(app_group.values()):
                group_cards[gid] = (grp_ids[gid], 0.0)
    # No Application actually links to a group_by card -> fall back silently.
    has_groups = bool(app_group)

    nodes: list[dict] = []
    index_of: dict[uuid.UUID, int] = {}

    def add_node(card_id: uuid.UUID, name: str, type_key: str) -> int:
        if card_id not in index_of:
            index_of[card_id] = len(nodes)
            nodes.append({"id": str(card_id), "name": name, "type": type_key})
        return index_of[card_id]

    links: list[dict] = []
    total = 0.0
    for app_id, itc_id in app_itc_pairs:
        itc_name, itc_cost = itcs[itc_id]
        app_name, _ = apps[app_id]
        if has_groups and app_id in app_group:
            gid = app_group[app_id]
            g_name, _ = group_cards[gid]
            a_idx = add_node(app_id, app_name, "Application")
            g_idx = add_node(gid, g_name, group_by)
            i_idx = add_node(itc_id, itc_name, "ITComponent")
            links.append({"source": a_idx, "target": g_idx, "value": apps[app_id][1]})
            links.append({"source": g_idx, "target": i_idx, "value": itc_cost})
        else:
            a_idx = add_node(app_id, app_name, "Application")
            i_idx = add_node(itc_id, itc_name, "ITComponent")
            links.append({"source": a_idx, "target": i_idx, "value": itc_cost})
        total += itc_cost

    return {
        "nodes": nodes,
        "links": links,
        "total": total,
        "fiscal_year": fy,
        "fiscal_year_start": fy_start,
    }
```

Place this function directly after `cost_treemap` in `reports.py`.

- [ ] **Step 4: Run to verify all pass**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/api/test_reports_cost_sankey.py -v`
Expected: PASS, all tests.

- [ ] **Step 5: Lint**

Run: `cd backend && venv/Scripts/python.exe -m ruff check app/api/v1/reports.py tests/api/test_reports_cost_sankey.py && venv/Scripts/python.exe -m ruff format --check app/api/v1/reports.py tests/api/test_reports_cost_sankey.py`
Expected: clean.

- [ ] **Step 6: Regenerate OpenAPI**

Run: `cd .. && PYTHONUTF8=1 backend/venv/Scripts/python.exe scripts/dump_openapi.py`
Expected: "Wrote ... openapi.json" with the new `/cost-sankey` path present; `git diff --stat docs/api/openapi.json` shows a change.

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/v1/reports.py backend/tests/api/test_reports_cost_sankey.py docs/api/openapi.json
git commit -m "feat(reports): add GET /reports/cost-sankey

Two-level Application->ITComponent cost flow via app_to_itc relations, with
an optional group_by that inserts a third node layer between them. Replaces
the removed aggregate mechanism for the new Sankey chart view: a flow per
relation instead of a summed total, so no double-counting."
```

---

## Task 3: Frontend — generalize `ReportShell`'s view toggle

**Files:**
- Modify: `frontend/src/features/reports/ReportShell.tsx`
- Modify/Create: `frontend/src/features/reports/ReportShell.test.tsx` (check whether it exists first; extend it if so)
- Modify: `frontend/src/i18n/locales/en/reports.json`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ReportShellProps` gains two optional props, consumed by Task 4:
  - `chartViewLabel?: string` — overrides the `shell.chartView` tooltip text for this report's chart button only (falls back to `t("shell.chartView")` when unset).
  - `extraViews?: { value: string; icon: string; label: string }[]` — extra `ToggleButton`s rendered between the chart button and the table button; `view`/`onViewChange` widen from `"chart" | "table"` to `string` to admit these values.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/features/reports/ReportShell.test.tsx (add to existing file, or create)
it("renders an extra view button between chart and table, and fires onViewChange with its value", async () => {
  const onViewChange = vi.fn();
  render(
    <ReportShell
      title="X" icon="payments" view="chart" onViewChange={onViewChange}
      extraViews={[{ value: "sankey", icon: "waterfall_chart", label: "Sankey chart view" }]}
    >
      <div />
    </ReportShell>,
  );
  const sankeyBtn = screen.getByRole("button", { name: /sankey chart view/i });
  await userEvent.click(sankeyBtn);
  expect(onViewChange).toHaveBeenCalledWith("sankey");
});

it("uses chartViewLabel to override the chart button's tooltip", () => {
  render(
    <ReportShell title="X" icon="payments" view="chart" onViewChange={vi.fn()} chartViewLabel="Treemap chart view">
      <div />
    </ReportShell>,
  );
  expect(screen.getByRole("button", { name: /treemap chart view/i })).toBeInTheDocument();
});
```

Follow this file's existing render-helper/import conventions (check the top
of `ReportShell.test.tsx` if it exists, otherwise match another report's
`*.test.tsx`, e.g. `CostReport.test.tsx`, for the test-utils import path).

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- ReportShell.test.tsx`
Expected: FAIL — no element with that accessible name (prop not yet read).

- [ ] **Step 3: Implement**

In `ReportShell.tsx`:
- Widen `view?: "chart" | "table"` and `onViewChange?: (v: "chart" | "table") => void` to `view?: string` and `onViewChange?: (v: string) => void` in `ReportShellProps`.
- Add `chartViewLabel?: string;` and `extraViews?: { value: string; icon: string; label: string }[];` to `ReportShellProps`, destructure both in the component with `extraViews` defaulting to `[]`.
- In the `ToggleButtonGroup`, change the chart `Tooltip title` to `chartViewLabel ?? t("shell.chartView")`.
- Between the chart `ToggleButton` and the table `ToggleButton`, map `extraViews` into one `ToggleButton` each: `<ToggleButton key={v.value} value={v.value}><Tooltip title={v.label}><Box sx={{ display: "flex" }}><MaterialSymbol icon={v.icon} size={18} /></Box></Tooltip></ToggleButton>`.
- `showPptxItem`'s condition (`!hasTableToggle || view === "chart"`) must also cover the new values — change it to `!hasTableToggle || view !== "table"`, so any non-table view (chart, or an extra view like `sankey`) still offers PPTX export; `showXlsxItem` is unaffected since it already only triggers on `view === "table"`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- ReportShell.test.tsx`
Expected: PASS. Then run `npm test -- ReportShell` (no file filter) to confirm no other `ReportShell` consumer broke from the widened prop types (TypeScript structural typing means `"chart"|"table"` literals still satisfy `string`, so this should be a type-check, not a behavior change — run `npm run typecheck` too).

- [ ] **Step 5: Add the two new i18n strings**

In `frontend/src/i18n/locales/en/reports.json`, under `"shell"`, confirm `chartView`/`tableView` already exist (they do, per the spec's Current State) and leave them unchanged — the per-report override in Task 4 supplies its own string, it does not touch this shared one.

- [ ] **Step 6: Lint & typecheck**

Run: `cd frontend && npm run lint -- --fix frontend/src/features/reports/ReportShell.tsx && npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/reports/ReportShell.tsx frontend/src/features/reports/ReportShell.test.tsx
git commit -m "feat(reports): let ReportShell take extra view buttons and a chart-label override

Needed for the cost report's third Sankey toggle and its per-report
'Treemap chart view' tooltip, without relabeling the other 10 reports
that share this shell."
```

---

## Task 4: Frontend — `FullscreenPanel` wrapper

**Files:**
- Create: `frontend/src/features/reports/FullscreenPanel.tsx`
- Create: `frontend/src/features/reports/FullscreenPanel.test.tsx`
- Modify: `frontend/src/i18n/locales/en/reports.json`

**Interfaces:**
- Produces: `FullscreenPanel({ children, label }: { children: ReactNode; label: string }): JSX.Element` — renders `children` inside a `Box` with a fullscreen `IconButton` (icon `fullscreen` / `fullscreen_exit`, toggled by `document.fullscreenElement`) positioned top-right; clicking it calls `requestFullscreen()`/`exitFullscreen()` on the wrapping `Box`'s ref. `label` is the `IconButton`'s `aria-label`/tooltip text in the "enter fullscreen" state (`"Exit fullscreen"` is used verbatim in the exit state, via `t("shell.exitFullscreen")`, not passed in).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/features/reports/FullscreenPanel.test.tsx
import FullscreenPanel from "./FullscreenPanel";

it("calls requestFullscreen on click when not fullscreen", async () => {
  const requestFullscreen = vi.fn();
  render(
    <FullscreenPanel label="Fullscreen">
      <div>chart</div>
    </FullscreenPanel>,
  );
  const btn = screen.getByRole("button", { name: "Fullscreen" });
  // jsdom has no real requestFullscreen; stub it on the DOM node under test.
  const panel = btn.closest("[data-testid='fullscreen-panel']") as HTMLElement;
  panel.requestFullscreen = requestFullscreen;
  await userEvent.click(btn);
  expect(requestFullscreen).toHaveBeenCalled();
});

it("calls exitFullscreen when document.fullscreenElement is the panel", async () => {
  const exitFullscreen = vi.fn();
  document.exitFullscreen = exitFullscreen;
  render(
    <FullscreenPanel label="Fullscreen">
      <div>chart</div>
    </FullscreenPanel>,
  );
  const panel = screen.getByTestId("fullscreen-panel");
  Object.defineProperty(document, "fullscreenElement", { value: panel, configurable: true });
  panel.dispatchEvent(new Event("fullscreenchange"));
  const exitBtn = await screen.findByRole("button", { name: /exit fullscreen/i });
  await userEvent.click(exitBtn);
  expect(exitFullscreen).toHaveBeenCalled();
  Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- FullscreenPanel.test.tsx`
Expected: FAIL — module `./FullscreenPanel` does not exist.

- [ ] **Step 3: Implement `FullscreenPanel`**

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";

export default function FullscreenPanel({ children, label }: { children: ReactNode; label: string }) {
  const { t } = useTranslation("reports");
  const ref = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = () => {
    if (isFullscreen) document.exitFullscreen();
    else ref.current?.requestFullscreen();
  };

  return (
    <Box ref={ref} data-testid="fullscreen-panel" sx={{ position: "relative" }}>
      <Tooltip title={isFullscreen ? t("shell.exitFullscreen") : label}>
        <IconButton
          size="small"
          onClick={toggle}
          aria-label={isFullscreen ? t("shell.exitFullscreen") : label}
          sx={{ position: "absolute", top: 4, right: 4, zIndex: 1 }}
        >
          <MaterialSymbol icon={isFullscreen ? "fullscreen_exit" : "fullscreen"} size={18} />
        </IconButton>
      </Tooltip>
      {children}
    </Box>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- FullscreenPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add `shell.exitFullscreen` string**

In `frontend/src/i18n/locales/en/reports.json`, under `"shell"`, add `"exitFullscreen": "Exit fullscreen"`.

- [ ] **Step 6: Lint & typecheck**

Run: `cd frontend && npm run lint -- --fix frontend/src/features/reports/FullscreenPanel.tsx && npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/reports/FullscreenPanel.tsx frontend/src/features/reports/FullscreenPanel.test.tsx frontend/src/i18n/locales/en/reports.json
git commit -m "feat(reports): add a shared FullscreenPanel wrapper

Used by the cost report's Treemap and Sankey panels — no existing
fullscreen pattern elsewhere in the reports to extend instead."
```

---

## Task 5: Frontend — `CostReport.tsx`: remove aggregate/drill, restrict type selector, add Sankey

**Files:**
- Modify: `frontend/src/features/reports/CostReport.tsx`
- Modify: `frontend/src/features/reports/CostReport.test.tsx`
- Modify: `frontend/src/i18n/locales/en/reports.json`

**Interfaces:**
- Consumes: `ReportShell`'s `chartViewLabel`/`extraViews` props (Task 3); `FullscreenPanel` (Task 4); `GET /reports/cost-sankey` response shape (Task 2); `GET /reports/cost-treemap` without `aggregate`/`parent_card_id` (Task 1).
- Produces: nothing consumed by a later task (last task touching this component in this plan).

- [ ] **Step 1: Write the failing tests**

```tsx
// Add to CostReport.test.tsx
it("offers only Application and ITComponent in the card-type selector", () => {
  renderCostReport(); // existing test helper in this file
  const select = screen.getByLabelText(/card type/i);
  userEvent.click(select);
  const options = screen.getAllByRole("option").map((o) => o.textContent);
  expect(options.sort()).toEqual(["Application", "IT Component"].sort());
});

it("renders a Sankey toggle button and switches the panel on click", async () => {
  renderCostReport();
  const sankeyBtn = await screen.findByRole("button", { name: /sankey chart view/i });
  await userEvent.click(sankeyBtn);
  expect(await screen.findByTestId("cost-sankey-panel")).toBeInTheDocument();
});

it("no longer renders the cost-source (aggregate) control", () => {
  renderCostReport();
  expect(screen.queryByLabelText(/cost source/i)).not.toBeInTheDocument();
});
```

Add these to the existing `CostReport.test.tsx` using its existing
`renderCostReport`/mock-API helper (read the file's current top-of-file
setup before writing the final version of these three tests, so the mock
responses match its established shape — in particular, mock
`GET /reports/cost-sankey` to return `{ nodes: [...], links: [...], total: 0, fiscal_year: 2026, fiscal_year_start: 1 }` for the second test).

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npm test -- CostReport.test.tsx`
Expected: FAIL on all three (selector still offers every readable type, no Sankey button exists, cost-source control still renders).

- [ ] **Step 3: Delete the aggregate/drill code**

In `CostReport.tsx`, delete: the `AggregateOption` interface, `SourceRef`
interface, `DrillFrame` interface, `normaliseDrillFrame`, the
`aggregateOptions` memo, the `costSources`/`setCostSources` state and its
restore/persist/reset wiring, the `activeAggregates` memo, `drillStack`/
`setDrillStack`/`drillPanels`/`setDrillPanels`/`drillFrame`/`canDrill`/
`drillSources`/`handleRectClick`'s drill branch, the breadcrumb JSX block,
the cost-source `TextField` toolbar block and its help tooltip, and the
`panels`/`panelsWithTotals` multi-panel-grid logic — collapse back to a
single dataset: `rawItems` (from `/reports/cost-treemap?type=...&cost_field=...`)
is the only data source now, `items`/`total` derive from it directly through
`applyScope`, same as today's `rawItems` branch minus the `drillPanels ??`
fallback. `handleRectClick` keeps only its non-drill branch
(`setSidePanelCardId(id)`).

- [ ] **Step 4: Restrict the card-type selector**

Replace the `readableTypes.filter((tp) => !tp.is_hidden).map(...)` in the
type `TextField` with a fixed list built from `readableTypes`:
```tsx
const costReportTypes = useMemo(
  () => readableTypes.filter((tp) => tp.key === "Application" || tp.key === "ITComponent"),
  [readableTypes],
);
```
and map `costReportTypes` instead of the filtered `readableTypes` in the
toolbar `TextField`. In the saved-report-config restore `useEffect`, guard
`restoredType` the same way: `if (restoredType && (restoredType === "Application" || restoredType === "ITComponent")) setCardTypeKey(restoredType);` else leave the default `"Application"` — this is the Review Focus case for a legacy saved config naming an unsupported type.

- [ ] **Step 5: Add the Sankey view**

- Add `const [sankeyData, setSankeyData] = useState<{ nodes: ...; links: ... } | null>(null);` and fetch it in a new branch of the existing data-loading effect (or a sibling `useAbortableEffect`) when `view === "sankey"`, calling `GET /reports/cost-sankey?cost_field=${costField}${groupBy ? "&group_by=" + groupBy : ""}`.
- Render `<Sankey data={sankeyData} nodeWidth={14} nodePadding={20} />` (imported from `recharts`, alongside the existing `Treemap` import) inside a `<FullscreenPanel label={t("cost.fullscreen")}>` wrapped `Paper` with `data-testid="cost-sankey-panel"`, mirroring the existing Treemap `Paper`'s `ResponsiveContainer` usage.
- Wrap the existing Treemap `Paper` (the one rendered when `view === "chart"`) in `<FullscreenPanel label={t("cost.fullscreen")}>` too.
- On `<ReportShell>`, pass `chartViewLabel={t("cost.treemapChartView")}` and `extraViews={[{ value: "sankey", icon: "waterfall_chart", label: t("cost.sankeyChartView") }]}`.
- Change `view` state's type from `"chart" | "table"` to `"chart" | "sankey" | "table"` and the `view === "chart" ? (...) : (...)` ternary to a 3-way check (`view === "chart"` → Treemap, `view === "sankey"` → Sankey, else → table).

- [ ] **Step 6: Add the two new strings**

In `frontend/src/i18n/locales/en/reports.json`, under `"cost"`, add:
```json
"treemapChartView": "Treemap chart view",
"sankeyChartView": "Sankey chart view",
"fullscreen": "Fullscreen"
```

- [ ] **Step 7: Run to verify all CostReport tests pass**

Run: `cd frontend && npm test -- CostReport.test.tsx`
Expected: PASS, including the 3 new tests and every pre-existing test in the file (the drill-down/aggregate tests in this file must also be deleted as part of this step if they test now-removed behavior — check the file for tests named `*aggregate*`/`*drill*` and remove them alongside the production code, mirroring Task 1 Step 1 on the backend side).

- [ ] **Step 8: Lint & typecheck**

Run: `cd frontend && npm run lint -- --fix frontend/src/features/reports/CostReport.tsx && npm run typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/features/reports/CostReport.tsx frontend/src/features/reports/CostReport.test.tsx frontend/src/i18n/locales/en/reports.json
git commit -m "feat(reports): cost report Sankey view, drop aggregate/drill-down

Card-type selector restricted to Application/ITComponent (the only types
the Sankey flow connects); Treemap and the new Sankey panel both gain a
fullscreen button."
```

---

## Self-Review

**1. Spec coverage:** tooltip rename (Task 5 Step 6), third Sankey toggle (Task 3 + Task 5), fullscreen on both chart panels (Task 4 + Task 5), `group_by` extended to Sankey via 2/3-level flag (Task 2), `aggregate` removed entirely incl. UI (Task 1 + Task 5), type selector restricted to Application+ITComponent shown together (Task 5 Step 4 — "together" meaning both are flow endpoints in one Sankey call, not a dual-select control; the single `cardTypeKey` selector remains for Treemap/Table, which still show one type at a time, matching today's UX). Custom table columns, fiscal-year history, and YoY trend are separate plans (3-6 per the dependency order already agreed) — correctly out of this plan's scope.

**2. Step scan:** every code step above names the exact function/prop/type touched; no "handle edge cases" placeholders.

**3. Type consistency:** `cost_field`/`group_by` param names match between Task 2's backend and Task 5's frontend fetch call; `FullscreenPanel`'s `label` prop matches its one call site's `t("cost.fullscreen")` in Task 5; `ReportShellProps.extraViews[].value` (`"sankey"`) matches the `view` state's new union member in Task 5.

**4. Review Focus:** the five lines above each map to a named test (Task 2's four sankey edge-case tests, Task 5's saved-config fallback test).

**5. Proportion:** five tasks, each independently testable and committable; the backend endpoint (Task 2) is the only large code block, sized by the number of distinct flow shapes (2-level, 3-level, fallback) the tests pin.
