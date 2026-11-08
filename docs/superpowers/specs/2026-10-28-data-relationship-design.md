# BO Relationship (ER-lite diagram for Business Objects)

**Spec status:** draft. Save and ownership rules agreed on 2026-11-08. Remaining decisions are listed below.

## Goal

A new page under the **Application & Data** menu group, "BO Relationship": an automatic, macroscopic ER-style diagram of `DataObject` cards, showing which systems are master/slave of each data object and the relationships between data objects themselves.

## Scope

In scope:
- New page, menu entry under **Application & Data** → **BO Relationship**.
- **New ER relation type, DataObject ↔ DataObject.** It is separate from the existing lineage relation `relDataObjectSuccessor`. It carries per-relation cardinality (`1:1` / `1:n` / `n:1` / `n:m`), stored in the direction of the relation.
- **At most one Master per Business Object.** Choose one linked Application as the authoritative source for the whole `DataObject`. Anagrafica clienti, Consensi privacy and Dati di spedizione equipment are separate BOs and can each have a different Master.
  - Record the Master designation on the existing `relAppToDataObj` link. The other linked Applications display as **Slave** when a Master is assigned. CRUD flags remain independent of ownership.
  - With no Master, show all linked Applications under **Unclassified** (Da classificare). Choosing a new Master replaces the old designation in one operation. The former Master becomes Slave. Clearing the designation or removing the Master link returns the remaining Applications to Unclassified.
- **Card icons/shapes on `DataObject`**, shown on the card and listed in a legend. Source: `analisi-documenti/Projetti/Turbo-ea-prod/Business Application Management_V.0.2.xlsx`, sheet `Dati`.
  - **Type (Document vs Data)**: not a badge icon, a **different node shape** in the diagram — new field (not in today's `DataObject.fields_schema`, confirmed: today's fields are only `dataSensitivity`, `dataOwner`, `isPersonalData`).
  - **GDPR**: badge icon shown when `isPersonalData` = true (field already exists).
  - **Payment data** (PCI-DSS scope): badge icon shown when a new `isPaymentData` boolean = true.
  - `Categoria GDPR`, `Interessati`, `Retention`, `Tipo dato di pagamento` — **deferred**, not part of this pass; not needed for the diagram or its icons/shapes.
  - `Application Master` (the xlsx sheet's own text column) — superseded by the master/slave relation attribute below; maps to a *relation*, not a card field. **No bulk/automatic import** of the xlsx's existing data — populated by hand per object, same as any other card.
- **Diagram interaction:**
  - Clicking a `DataObject` node opens the existing `CardDetailSidePanel` component (same one `CostReport.tsx` already uses) on the right, showing that card.
  - A new panel on the **left** lists the linked Applications under **Master**, **Slave**, or **Unclassified**. Show name, link and role. Apply card visibility to the applications and the derived grouping.
  - **Editing an existing relation** happens on the card in the right panel. The Master can be assigned, transferred or cleared there. Cardinality changes to an existing ER relation also happen there.
  - **Adding a new object or relation** requires an explicit **Save**. Save persists new cards first, then eligible relations, then changed positions. Each successful operation stays saved if another operation fails, following Draw.io's inventory sync behavior.
  - **Partial success is visible and retryable.** If `Ordine` is created but its link to `Cliente` fails, the card stays in the inventory and the editor identifies the link as pending. Retrying submits only pending work and recovers the identity of an already created card if its response was lost. The retry creates no duplicate card or relation.
- **Diagram library:** reuse `diagram-js` (+ `diagram-js-direct-editing`), already a project dependency and already used by `DiagramEditor`/`DiagramViewer` for ArchiMate/BPMN diagrams. No new dependency.
- **Layout and overlap avoidance:** reuse `@dagrejs/dagre`, already a project dependency (`frontend/src/features/reports/layeredDependencyLayout.ts` already uses it for the Layered Dependency View) to compute node positions and edge routing with minimal overlap.
- **Layout persistence (hybrid, confirmed):** dagre computes the automatic layout only for nodes that have no stored position yet (first appearance, or a newly added object). Once computed (or once a user drags a node), the position is **saved**, same pattern as the existing `DiagramEditor`-backed diagrams — not recomputed from scratch on every page load.
- **Cardinality direction (the per-instance mirroring problem).** A plain text/select attribute on a `Relation` would show the *same* raw value ("1:n") no matter which side's card the user opens the relation on — confirmed as a real risk. **Verified precedent, and it is narrower than first assumed**: `frontend/src/features/cards/sections/RelationAttributesEditor.tsx` has no generic "direction-aware field type" — it special-cases one hardcoded attribute **key**, `flowDirection` (a `single_select`), with its own inversion logic (provider/consumer, forward/reverse wording) written specifically for that key (see `flowDirectionBadge` and the `field.key !== "flowDirection"` branches). **Decision: follow the same pattern, not a new generic mechanism** — add a second reserved key, `cardinality` (`single_select`, options `1:1`/`1:n`/`n:1`/`n:m`), to the new DataObject↔DataObject relation type's `attributes_schema`, and write a dedicated inversion helper for it (analogous to `flowDirectionBadge`, swapping `1:n`↔`n:1` and leaving `1:1`/`n:m` unchanged) in the same file. One directional value is stored (source→target), the dedicated helper flips it when read from the target card. Reuse the existing relation model and add the attribute with the new ER relation type.

- **Diagram scope and filtering.** Show readable `DataObject` cards by default, including isolated nodes. A filter panel reuses `FilterSidebarSection`. Personal data (`isPersonalData`) and payment data (`isPaymentData`) are available in the first pass. `Categoria GDPR` remains deferred. Whether to offer additional metamodel fields as filters is open.
- **Ownership granularity is the Business Object.** Each card represents one BO and has its own optional Master. Attributes within the same BO, such as first name and surname within Anagrafica clienti, share that designation.
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
- `relDataObjectSuccessor` is an existing `DataObject` ↔ `DataObject` lineage relation. The new ER relation is a separate metamodel type.
- `Relation.attributes` is a free-form JSONB column (`backend/app/models/relation.py`), already the mechanism CRUD uses — the new master/slave and cardinality attributes use the same column, no schema change beyond each relation type's own `attributes_schema` definition.
- `RelationType.cardinality` (`backend/app/models/relation_type.py`) is a fixed type-level column (`"1:1"`/`"1:n"`/`"n:m"`), separate from the per-instance cardinality value this spec adds — the type-level column stays at its default and is not what drives the diagram's displayed value.
- `diagram-js`/`diagram-js-direct-editing` and `@dagrejs/dagre` are both already project dependencies (`frontend/package.json`), used respectively by the diagram editors and the Layered Dependency View.
- `CardDetailSidePanel` (`frontend/src/components/CardDetailSidePanel.tsx`) is the shared right-hand card drawer, already reused by `CostReport.tsx` (`cardId`/`open`/`onClose` props) — this spec reuses it verbatim.

## Open questions before implementation

- **Canvas actions.** Confirm that creating links from the canvas is limited to DataObject-to-DataObject ER relations. The current plan manages Application links and their Master designation in the card panel.
- **Cardinality.** Confirm whether the values describe the diagram or also enforce constraints on inventory relationships. If edited from the target card, `1:n` and `n:1` must be converted back to the stored source-to-target direction.
- **Visuals and filters.** Pick Document and Data shapes and a neutral shape for existing cards with an unset type. Specify where to show GDPR and payment badges and their legend. Confirm whether additional metamodel filters belong in the first version.
- **Layout.** Decide when auto-generated positions become shared and whether shared positions are included in workspace transfer. Opening the page as a viewer has no write side effects.
- **Permissions.** Confirm the default role grants. The plan names `boRelationship.view` and `boRelationship.edit`. Card and relation permissions also apply to operations made through this page.
