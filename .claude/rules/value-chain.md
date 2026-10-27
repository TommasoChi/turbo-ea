---
paths:
  - "backend/app/services/value_chain_report.py"
  - "backend/app/services/value_stream_catalogue_service.py"
  - "backend/app/api/v1/value_stream_catalogue.py"
  - "frontend/src/features/value-chain/**"
  - "backend/alembic/versions/*value_chain*"
---

# Value Chain

> Loaded when you touch `backend/app/services/value_chain_report.py`,
> `frontend/src/features/value-chain/**`, … (full list in the frontmatter). Authored by reverse
> engineering a sibling extension repo's README/CLAUDE.md against what actually lives in this
> fork today — there was no prior `CLAUDE.md` section to move.

- **Two "Value Chain" things exist, and only one is current.** The feature this rule covers is
  **native to core**: `GET /reports/value-chain` + `GET /reports/value-chain/value-stream`
  (`backend/app/api/v1/reports.py`), rendered at `/value-chain` and `/value-chain/value-stream`
  (`frontend/src/features/value-chain/ValueChainPage.tsx` / `ValueStreamPage.tsx`), gated by the
  `bpm.value_chain` permission and the `valuechain` module flag (`ModuleGate module="valuechain"`,
  migration `157_add_value_chain_module_flag.py`). Separately, `turbo-ea-ext-value-chain`
  (`TommasoChi/turbo-ea-ext-value-chain`, a sibling repo) was an earlier **prototype extension**
  with the same idea — its own pages, its own `ext.value-chain.view` permission, its logic in a
  pure JS module `bandModel.mjs`. That extension is **retired**: `value_chain_report.py`'s own
  module docstring says it was "Ported from the retired `value-chain` extension's `bandModel.mjs`"
  — function for function, onto this file's pure Python functions (`band_key_for`,
  `is_flag_true`, `split_cross_cutting`, `order_leaves`, `group_contiguous_process_spans`,
  `assign_process_level_rows`, `build_chain_payload`, `build_stream_payload`) plus a frontend
  mirror in `valueChainModel.ts` / `ValueChainPage.tsx` / `ValueStreamPage.tsx`. If you go reading
  the extension repo for background (its README and CLAUDE.md are a genuinely detailed design
  doc), three things changed in the port — don't carry them over by habit:
  - permission: extension's `ext.value-chain.view` → core's `bpm.value_chain`.
  - relation key: extension's custom `ObjectiveToBusinessContext` → core's seeded
    `relObjectiveToBizCtx` (`Objective` → `BusinessContext`, "is goal for" / "has goal"). Don't
    confuse with `relObjectiveToBC` (`Objective` → `BusinessCapability`, "improves") — a
    different, unrelated relation with a near-identical key.
  - routes/setup: extension's `/ext/value-chain/chain` + `?view=stream&category=` →
    core's `/value-chain` + `/value-chain/value-stream`; and everything the extension needed an
    admin to add by hand (the two `Objective` subtypes, the custom relation, `isCore`) now ships
    **in the standard seed** (`seed.py`) — no Admin → Metamodel setup needed on a fresh install.
- **The metamodel surface this report reads, all in `seed.py` already:**
  - `BusinessProcess` subtype `category` (level 0 — one box per Value Chain Map band) /
    `group` / `process`. `attributes.processType` (`core` / `management` / `support`, required on
    `category`) picks the band; anything else (including unset) falls into `not_set`.
  - `BusinessContext` subtype `valueStream`, in the ordinary parent/child hierarchy
    (`parent_id`, not a custom field). `attributes.hierarchyLevel == 1` marks a root. A leaf
    (no children, any depth) is a chevron on the Value Stream Map; an internal node is a
    collapsible group of its leaves.
  - `Objective` subtype `valueGate` / `businessGoal`.
  - Relations: `relProcessToBizCtx` (`BusinessProcess` → `BusinessContext`, links a category or
    process to its value stream), `relBizCtxToBC` (`BusinessContext` → `BusinessCapability`),
    `relObjectiveToBizCtx` (`Objective` → `BusinessContext` — the subtype decides whether it
    renders as a Value Gate or a Business Goal), `relBusinessContextSuccessor`
    (`BusinessContext` → `BusinessContext`, self-referencing — `order_leaves()`'s own ordering
    chain: source "succeeds" target ⇒ **target** renders first).
- **`attributes` flags, all tolerant of the string `"true"`/`"True"` as well as a real boolean**
  (`is_flag_true()` — some installs carry the JSON string form):
  - `isCore` on a level-1 `BusinessContext`: renders it as the three-tier "Core house" on the
    Value Chain Map instead of the plain category-box grid.
  - `isCross` on any `BusinessContext`: pulls it out of the chevron sequence and renders it as a
    full-width bar above the chevrons instead — for a value stream that spans the whole flow
    (e.g. "Planning, Reporting and Monitoring") rather than being one step in it.
  - `levelOrder` exists on **two unrelated card types, same key, different job** — don't confuse
    them when reading the metamodel: on `BusinessContext` it orders multiple `isCross` bars
    against each other (ascending, top to bottom); on `BusinessProcess` it decides which
    **vertical row** a process box renders on in the Business Process band (ascending, nearest
    the header first) — orthogonal to the box's *width*, which `group_contiguous_process_spans`
    decides separately.
  - `sortOrder` (declared field, admin-editable from the UI) vs. `stageOrder` (an **undeclared**
    JSONB key, never on any `fields_schema`): `order_leaves()` reads `sortOrder ?? stageOrder ??
    name`. The only writer of `stageOrder` is `_stage_attributes()` in
    `value_stream_catalogue_service.py`, during an import from the Value Stream Catalogue — it is
    not something an admin sets directly, and a value stream edited by hand afterward should get
    an explicit `sortOrder` instead of relying on the imported `stageOrder`.
- **`value_chain_report.py` is deliberately all plain, undecorated functions.** mutmut does not
  mutate a decorated function, so logic that needs a real mutation score can't live directly in a
  FastAPI route handler — the route (`reports.py`) stays a thin call into this module.
- **`group_contiguous_process_spans`**: a standalone `BusinessProcess` (subtype `process`, never
  `group`) linked via `relProcessToBizCtx` to more than one value-stream leaf renders as **one**
  box spanning those columns only when the leaves are **contiguous** in `order_leaves()`'s output
  — otherwise it stays duplicated once per column, so a non-adjacent link never implies a false
  continuity. A `group` never merges across columns this way, contiguous or not — it can carry its
  own sub-process tree, and the extension's design docs are explicit that merging a shared group
  is a separate, unsolved problem.
- **`value_stream_catalogue_service.py` / `api/v1/value_stream_catalogue.py` is a separate,
  adjacent feature** — importing a canned value-stream model (bundled or fetched remotely) into
  `BusinessContext` cards. It shares no code with `value_chain_report.py`; the only connection is
  that `stageOrder` fallback above.
- **MCP tool** (`get_value_chain`) lives alongside every other tool in
  `mcp-server/turbo_ea_mcp/server.py` — see [`mcp-server.md`](mcp-server.md) for the server's own
  conventions.
