# BO Relationship (ER-lite diagram for Business Objects)

**Spec status:** draft, in progress — brainstorming session on 2026-10-28, not yet all sections covered. Added to incrementally as the conversation continues.

## Goal

A new page under the **Application & Data** menu group, "BO Relationship": an automatic, macroscopic ER-style diagram of `DataObject` cards, showing which systems are master/slave of each data object and the relationships between data objects themselves.

## Scope

In scope:
- New page, menu entry under **Application & Data** → **BO Relationship**.
- **New relation type, DataObject ↔ DataObject** (does not exist today — confirmed, no `source_type_key`/`target_type_key` pair involving `DataObject` on both sides exists in `backend/app/services/seed.py`). Carries a per-instance cardinality value (`1:1` / `1:n` / `n:1` / `n:m`), not a fixed type-level `cardinality` column — see "Cardinality direction" below for why and how.
- **Master/slave on the existing `relAppToDataObj` relation** (Application ↔ DataObject, today only carries CRUD boolean flags `crudCreate`/`crudRead`/`crudUpdate`/`crudDelete`). Add a new, explicit attribute, "Data Ownership" (master/slave), set by the user — **not** inferred from the CRUD flags. Both live on the same relation's `attributes` JSONB, same mechanism, independent values.
- **Card icons/shapes on `DataObject`**, shown on the card and listed in a legend. Source: `analisi-documenti/Projetti/Turbo-ea-prod/Business Application Management_V.0.2.xlsx`, sheet `Dati`.
  - **Type (Document vs Data)**: not a badge icon, a **different node shape** in the diagram — new field (not in today's `DataObject.fields_schema`, confirmed: today's fields are only `dataSensitivity`, `dataOwner`, `isPersonalData`).
  - **GDPR**: badge icon shown when `isPersonalData` = true (field already exists).
  - **Payment data** (PCI-DSS scope): badge icon shown when a new `isPaymentData` boolean = true.
  - `Categoria GDPR`, `Interessati`, `Retention`, `Tipo dato di pagamento` — **deferred**, not part of this pass; not needed for the diagram or its icons/shapes.
  - `Application Master` (the xlsx sheet's own text column) — superseded by the master/slave relation attribute below; maps to a *relation*, not a card field. **No bulk/automatic import** of the xlsx's existing data — populated by hand per object, same as any other card.
- **Diagram interaction:**
  - Clicking a `DataObject` node opens the existing `CardDetailSidePanel` component (same one `CostReport.tsx` already uses) on the right, showing that card.
  - A new panel on the **left** lists the Applications related to that data object, split as **Master** / **Slave** — name + link only, plus the master/slave badge. No other data (not CRUD, not cost).
  - **Editing an existing relation** (e.g. changing master/slave, or a DataObject↔DataObject cardinality) happens on the card itself (the side panel on the right), not on the diagram canvas.
  - **Adding a new object or a new relation** from the diagram page requires an explicit **Save** button — same pattern as the existing diagram editors (`DiagramEditor`), not autosave. A saved new object is a real `Card` (type `DataObject`) and its relations are real `Relation` rows — not diagram-local-only state.
- **Diagram library:** reuse `diagram-js` (+ `diagram-js-direct-editing`), already a project dependency and already used by `DiagramEditor`/`DiagramViewer` for ArchiMate/BPMN diagrams. No new dependency.
- **Layout and overlap avoidance:** reuse `@dagrejs/dagre`, already a project dependency (`frontend/src/features/reports/layeredDependencyLayout.ts` already uses it for the Layered Dependency View) to compute node positions and edge routing with minimal overlap.
- **Layout persistence (hybrid, confirmed):** dagre computes the automatic layout only for nodes that have no stored position yet (first appearance, or a newly added object). Once computed (or once a user drags a node), the position is **saved**, same pattern as the existing `DiagramEditor`-backed diagrams — not recomputed from scratch on every page load.
- **Cardinality direction (the per-instance mirroring problem).** A plain text/select attribute on a `Relation` would show the *same* raw value ("1:n") no matter which side's card the user opens the relation on — confirmed as a real risk. **Verified precedent, and it is narrower than first assumed**: `frontend/src/features/cards/sections/RelationAttributesEditor.tsx` has no generic "direction-aware field type" — it special-cases one hardcoded attribute **key**, `flowDirection` (a `single_select`), with its own inversion logic (provider/consumer, forward/reverse wording) written specifically for that key (see `flowDirectionBadge` and the `field.key !== "flowDirection"` branches). **Decision: follow the same pattern, not a new generic mechanism** — add a second reserved key, `cardinality` (`single_select`, options `1:1`/`1:n`/`n:1`/`n:m`), to the new DataObject↔DataObject relation type's `attributes_schema`, and write a dedicated inversion helper for it (analogous to `flowDirectionBadge`, swapping `1:n`↔`n:1` and leaving `1:1`/`n:m` unchanged) in the same file. One directional value is stored (source→target), the dedicated helper flips it when read from the target card. No new relation/model, no migration beyond the attribute field itself plus this one new rendering helper.

- **Diagram scope and filtering.** Shows every `DataObject` by default (no drill-down, unlike the cost report's Sankey, which dropped drill-down entirely — a deliberate, separate choice for this feature). An **optional filter panel** narrows the set, reusing the existing faceted-filter component `frontend/src/components/FilterSidebarSection.tsx` (`FilterSectionHeader` + `FilterCheckboxList`) verbatim — the same pattern already used elsewhere in the app (e.g. the inventory/search page) for exactly this: a `boolean` field (`isPersonalData`, `isPaymentData`) becomes a single checkbox toggle, a `single_select`/`multiple_select` field becomes a checkbox list of its own options. Filterable fields: `Categoria GDPR` status, payment-data status, plus any other `DataObject` field added later — the component already generalizes to "any boolean or select field", so no extra design needed per field.
- **Declared limit: ownership is per-object, not per-field.** Verified against how enterprise data-governance tooling usually models this (web research, 2026-10-28): master/slave/system-of-record is routinely split *per field* in practice (e.g. a CRM is authoritative for sales data, an ERP for billing, on what is conceptually "the same" customer entity — the "golden record" pattern). This spec's master/slave lives on the whole `relAppToDataObj` relation (one flag per Application↔DataObject pair), matching the original request's framing ("macroscopico, non un vero ER"). If per-field ownership granularity is ever needed, it is a separate, larger feature (the relation would need to carry a value per attribute, not one flag) — not attempted here.
- **Access control.** Two explicit permissions gate this page — view and edit — independent of (and in addition to) the underlying `CardWriteService` permission checks that already gate creating/editing the `DataObject`/`Application` cards and their relations. The page-level permission controls who can *open* BO Relationship and *use its Save button*; `CardWriteService` still enforces field- and card-type-level write rules underneath, same as every other card write path in the app.

Out of scope (not asked, not assumed):
- Any card type other than `DataObject` and `Application` as diagram participants (e.g. no `BusinessCapability` node layer here — that concept belongs to the cost-report Sankey's group_by, a different feature on the same branch).
- Autosave of new objects/relations (explicit Save only, per above).
- Inferring master/slave from CRUD flags (explicit, independent field).
- Bulk/automatic import of the xlsx's existing `Dati` sheet data (per above — populated by hand).
- `Categoria GDPR`, `Interessati`, `Retention`, `Tipo dato di pagamento` as new fields (deferred, per above).

## Current state (verified, not assumed)

- `DataObject` card type exists (`backend/app/services/seed.py:3598`), category `"Application & Data"`, `fields_schema` today: `dataSensitivity` (single_select), `dataOwner` (text), `isPersonalData` (boolean). No `Type` (Document/Data) field, no payment-data field.
- `relAppToDataObj` relation type exists (`source_type_key: "Application"`, `target_type_key: "DataObject"`, `cardinality: "n:m"` at the type level, `attributes_schema`: `crudCreate`/`crudRead`/`crudUpdate`/`crudDelete` booleans). No master/slave attribute today.
- No `DataObject` ↔ `DataObject` relation type exists today (grepped every `source_type_key`/`target_type_key: "DataObject"` in `seed.py`: only `Initiative→DataObject`, `Application→DataObject`, `Interface→DataObject` — never `DataObject` on both sides).
- `Relation.attributes` is a free-form JSONB column (`backend/app/models/relation.py`), already the mechanism CRUD uses — the new master/slave and cardinality attributes use the same column, no schema change beyond each relation type's own `attributes_schema` definition.
- `RelationType.cardinality` (`backend/app/models/relation_type.py`) is a fixed type-level column (`"1:1"`/`"1:n"`/`"n:m"`), separate from the per-instance cardinality value this spec adds — the type-level column stays at its default and is not what drives the diagram's displayed value.
- `diagram-js`/`diagram-js-direct-editing` and `@dagrejs/dagre` are both already project dependencies (`frontend/package.json`), used respectively by the diagram editors and the Layered Dependency View.
- `CardDetailSidePanel` (`frontend/src/components/CardDetailSidePanel.tsx`) is the shared right-hand card drawer, already reused by `CostReport.tsx` (`cardId`/`open`/`onClose` props) — this spec reuses it verbatim.

## Open questions for the next pass

- Exact permission keys for the new page-level view/edit permissions (naming convention to match the rest of the app's permission catalogue — not yet looked up).
- Exact field key/label for `DataObject.type` (Document/Data) and its two node shapes' visual spec (which diagram-js shape primitive for each).
- `DataObject.isPaymentData` field key/label (boolean, straightforward — no open design question, just not yet written down as an exact field definition).
