# Integration Flow (automatic data-flow diagram)

**Spec status:** draft, in progress — brainstorming session on 2026-10-28, continued from the BO Relationship spec. Separate feature: BO Relationship is the data-only master/slave view (`docs/superpowers/specs/2026-10-28-data-relationship-design.md`); Integration Flow is the **flow of data between applications** — different question, different page.

## Goal

A new page under **Application & Data** — "Integration Flow" — that **automatically generates** the kind of diagram Aruba's architects today draw **by hand** in drawio (reference: `TeamSystem HR -Togaf`, `http://localhost:8920/diagrams/dd906061-e084-481d-85e1-f9e5e0301a62`, viewed live during this session): which `Application` sends which `DataObject` to which other `Application`, through which `Interface`, optionally via an integration-middleware `ITComponent`.

## Current state (verified, not assumed)

The entire data model this feature needs **already exists** in turbo-ea — this is a new **visualization** over existing data, not a new metamodel:

- `Application`, `Interface`, `DataObject`, `ITComponent` card types already exist (`backend/app/services/seed.py`).
- `Interface.subtypes` already distinguishes `logicalInterface` from `api` and others — the logical-vs-physical granularity this team already works at is already modeled, confirmed against the user's own framing ("oggi gestiamo integrazioni logiche di alto livello e fisiche... non i servizi ma i singoli flussi dati").
- `relAppToInterface` (`Application`→`Interface`, `cardinality: n:m`, `attributes_schema: [FLOW_DIRECTION_FIELD]`) — already carries the reserved `flowDirection` attribute (provider/consumer/bidirectional), the exact mechanism BO Relationship's `cardinality` field reuses the pattern of.
- `relInterfaceToDataObj` (`Interface`→`DataObject`, `cardinality: n:m`) — names which data an interface carries.
- `relInterfaceToITC` (`Interface`→`ITComponent`, `cardinality: n:m`) — names the technical component(s) an interface runs through; this is how a middleware hub attaches to an interface.
- **"Middleware" is not a card type.** It is an `ITComponent` card, distinguished only by being tagged with a `TechCategory` card. **The exact category label to look for is "Integration Middleware"** (confirmed by the user — not the generic "Middleware" `TechCategory.description` example text mentions). `TechCategory` itself is a free-form hierarchical taxonomy (`backend/app/services/seed.py:3992`, no fixed option list) — confirmed by the user that "Integration Middleware" already exists as a real `ITComponent` category on the live data, so the page can rely on it being present rather than treating it as a convention to introduce.
- The reference hand-drawn diagram's visual grammar (`TeamSystem HR -Togaf`, screenshotted live): a source `Application` box; a dotted arrow either straight to the target `Application` (annotated "nessun middleware modellato" when there genuinely is none) or via a small `«ITComponent: integration/middleware»`-labelled box; each arrow carries a label naming the integration plus its protocol/mode (e.g. "Create User Profile IAG (HTTP, real-time)"); a small satellite box under/near each arrow names the `DataObject` carried (e.g. "EmployeeData"). This is the exact visual pattern Integration Flow must reproduce **automatically** from the metamodel instead of by hand.

## Scope

In scope:
- New page, menu entry under **Application & Data** → **Integration Flow**.
- **Data-driven, not free-draw** — same principle BO Relationship already committed to: the diagram is generated from real `Application`/`Interface`/`DataObject`/`ITComponent` cards and their existing relations (`relAppToInterface`, `relInterfaceToDataObj`, `relInterfaceToITC`). No hand-drawn arrow is ever possible that doesn't correspond to a real relation.
- **Node types on the canvas:** `Application` (source and target), `Interface` (the flow itself — rendered as the labelled arrow/edge the same way the hand-drawn reference does, not as its own box, **unless** an `Interface` connects to an `ITComponent` tagged "Integration Middleware", in which case that `ITComponent` renders as an intermediate hub node — mirrors the reference diagram's own distinction between "direct" and "via middleware" flows).
- **Hub-and-spoke for middleware:** when several `Interface`s route through the same "Integration Middleware"-tagged `ITComponent`, the diagram shows that `ITComponent` once, as a star-shaped hub, rather than repeating it — avoids the reference diagram's own manual duplication problem.
- **Edge labels:** the `Interface`'s own name/label, plus its `DataObject`(s) shown as a satellite annotation, matching the hand-drawn reference's visual convention.
- **The page permits creation**, following the standard workflow a logical integration is documented in today: create the **logical `Interface`** first (`Application`→`Interface`→`Application`, the high-level "these two systems integrate" statement), then optionally refine it by adding one or more **lower-level/physical `Interface`s** underneath (the `api`/technical subtypes), each optionally routed through an **integration-middleware `ITComponent`**, and the **`DataObject`(s)** each interface carries — same node/edge vocabulary and visual layering as the reference `TeamSystem HR -Togaf` diagram (logical flow at the top level, physical/technical detail nested under it). Reuses the same technical foundations already decided for BO Relationship: `diagram-js` + `@dagrejs/dagre` for layout, explicit Save button (not autosave) for anything added from the canvas — a created `Interface`/relation is a real `Relation` row, not diagram-local state, same principle as BO Relationship's "Save" requirement.

Out of scope (not asked, not assumed, or explicitly deferred):
- Any metamodel change — every node/edge type this feature draws already exists.
- A redesign of `Interface`'s own card-detail editing — this page only *visualizes* existing interfaces, consistent with "generato, non disegnato a mano", same principle BO Relationship already committed to for `DataObject` relations.

## Points to deepen (TO BE DECIDED — not MVP/backlog yet, needs its own pass)

- **MVP vs backlog for the LeanIX-inspired advanced features:**
  - Drill-down ("+" to expand a node's connections incrementally, rather than showing the whole graph at once)
  - Smart filters (by `DataObject`, by `Interface` technology/protocol)
  - Color-coding by lifecycle state or GDPR/personal-data classification (ties into `DataObject.isPersonalData`, already in BO Relationship's scope for a different page — may be shareable styling logic)
  - Time slider (As-Is vs To-Be, reading each `Interface`'s lifecycle dates the way the rest of the app already reads `is_live_in_fiscal_year`-style lifecycle windows elsewhere)
  - Redundancy detection (flagging when several `Interface`s connect the same `Application` pair — a "standardize your integrations" signal)
- Exact diagram scope: whole landscape at once, or scoped to one `Application` (mirrors the still-open "diagram scope" question on BO Relationship, likely answered the same way once decided there — reuse the answer rather than re-deciding independently, unless the two pages' real usage turns out to differ).
