# BO Relationship (ER-lite diagram for Business Objects)

**Spec status:** draft. Agreed Save, ownership, ER direction, editor permissions, Draw.io-style sync, shared positions and BO subtypes are recorded below.

## Goal

A new page under the **Application & Data** menu group, "BO Relationship": an automatic, macroscopic ER-style diagram of `DataObject` cards, showing which systems are master/slave of each data object and the relationships between data objects themselves.

## Scope

In scope:
- New page, menu entry under **Application & Data** → **BO Relationship**.
- **New ER relation type, DataObject ↔ DataObject.** It is separate from the lineage relation `relDataObjectSuccessor`. A-to-B and B-to-A are views of the same ER link. Store one relation per unordered BO pair and keep its original direction for the cardinality value (`1:1` / `1:n` / `n:1` / `n:m`).
- **At most one Master per Business Object.** Choose one linked Application as the authoritative source for the whole `DataObject`. Anagrafica clienti, Consensi privacy and Dati di spedizione equipment are separate BOs and can each have a different Master.
  - Record the Master designation on the existing `relAppToDataObj` link. The other linked Applications display as **Slave** when a Master is assigned. CRUD flags remain independent of ownership.
  - With no Master, show all linked Applications under **Unclassified** (Da classificare). Choosing a new Master replaces the old designation in one operation. The former Master becomes Slave. Clearing the designation or removing the Master link returns the remaining Applications to Unclassified.
- **Diagram shapes and badges for `DataObject`**, explained in a legend. Source: `analisi-documenti/Projetti/Turbo-ea-prod/Business Application Management_V.0.2.xlsx`, sheet `Dati`.
  - **Required BO subtype.** Add the native `DataObject` subtypes **Data** (`data`) and **Document** (`document`) to the metamodel. Both are BOs. Require a subtype when creating a BO. Use a distinct shape for each subtype. Existing BOs without a subtype stay readable and can be classified explicitly.
  - **GDPR**: badge icon shown when `isPersonalData` = true (field already exists).
  - **Payment data** (PCI-DSS scope): badge icon shown when a new `isPaymentData` boolean = true.
  - `Categoria GDPR`, `Interessati`, `Retention`, `Tipo dato di pagamento` — **deferred**, not part of this pass; not needed for the diagram or its icons/shapes.
  - `Application Master` (the xlsx sheet's own text column) — represented by the Master designation on the Application link; maps to a *relation*, not a card field. **No bulk/automatic import** of the xlsx's existing data — populated by hand per object, same as any other card.
- **Diagram interaction:**
  - Clicking a `DataObject` node opens the existing `CardDetailSidePanel` component (same one `CostReport.tsx` already uses) on the right, showing that card.
  - A new panel on the **left** lists the linked Applications under **Master**, **Slave**, or **Unclassified**. Show name, link and role. Apply card visibility to the applications and the derived grouping.
  - **Creating links from the diagram.** An editor can draw BO-to-BO ER links or connect an existing Application to a BO with the Application card picker. For the Application link, show the Master and Slave roles. Choosing Master assigns or transfers the sole Master. Slave is available when another Application is Master, including a Master staged earlier in the same save. When there is no Master, the editor can save the Application link as Unclassified.
  - The card panel can also edit existing links, including changing cardinality and assigning, transferring or clearing the Master. Access to write actions inside the BO page requires its edit permission.
  - **Explicit Save.** Save persists new cards first, then eligible ER and Application links and their requested roles, then the accepted diagram changes and positions. Each successful operation stays saved if a later operation fails, following Draw.io's inventory sync behavior.
  - **Partial success is visible and retryable.** If `Ordine` is created but its link to `Cliente` fails, the card stays in the inventory and the editor identifies the link as pending. Retrying submits only pending work and recovers the identity of an already created card if its response was lost. The retry creates no duplicate card or relation.
- **Diagram library:** reuse `diagram-js` (+ `diagram-js-direct-editing`), already a project dependency and already used by `DiagramEditor`/`DiagramViewer` for ArchiMate/BPMN diagrams. No new dependency.
- **Layout and overlap avoidance:** reuse `@dagrejs/dagre`, already a project dependency (`frontend/src/features/reports/layeredDependencyLayout.ts` already uses it for the Layered Dependency View) to compute node positions and edge routing with minimal overlap.
- **Shared positions.** Keep saved positions fixed. Compute local proposals for nodes without a saved position and share manual moves or accepted proposals only on explicit Save.
- **Cardinality direction.** Use a dedicated helper for the reserved `cardinality` attribute. Swap `1:n` and `n:1` when reading or editing from the opposite end. `1:1` and `n:m` are symmetric. Saving from the opposite end converts the value back to the original stored direction.

- **Inventory check and sync, following Draw.io.** On each load, open the last saved diagram and compare it with readable inventory data. Flag relevant changes without applying them automatically. Recheck on demand. An editor can choose **Sync** to apply inventory changes to the open diagram, keeping manual positions. The next **Save** shares the refreshed diagram and any position changes. Include renamed, changed-subtype, archived or deleted BOs and changed or removed links. Detect additions too because the BO view covers the readable inventory. Compare a fresh view on the first load if no saved diagram exists.
- **Diagram scope and filtering.** Include readable `DataObject` cards, including isolated nodes. Reuse `FilterSidebarSection` for personal data (`isPersonalData`) and payment data (`isPaymentData`) in the first pass. `Categoria GDPR` remains deferred. Additional metamodel filters are open.
- **Ownership granularity is the Business Object.** Each card represents one BO and has its own optional Master. Attributes within the same BO, such as first name and surname within Anagrafica clienti, share that designation.
- **Access control.** Administrators can view and edit BO Relationship. Other users are view-only by default. The `boRelationship.view` and `boRelationship.edit` permissions allow later role and group configuration. Save, Sync and write actions in the page and its card panel require edit permission plus the applicable underlying card or relation permissions.

Out of scope (not asked, not assumed):
- Any card type other than `DataObject` and `Application` as diagram participants (e.g. no `BusinessCapability` node layer here — that concept belongs to the cost-report Sankey's group_by, a different feature on the same branch).
- Autosave of new objects/relations (explicit Save only, per above).
- Inferring master/slave from CRUD flags (explicit, independent field).
- Bulk/automatic import of the xlsx's existing `Dati` sheet data (per above — populated by hand).
- `Categoria GDPR`, `Interessati`, `Retention`, `Tipo dato di pagamento` as new fields (deferred, per above).

## Current state (verified, not assumed)

- The `DataObject` card type exists in Application & Data. Its current seed has no Data/Document subtypes and no payment-data field.
- `relAppToDataObj` relation type exists (`source_type_key: "Application"`, `target_type_key: "DataObject"`, `cardinality: "n:m"` at the type level, `attributes_schema`: `crudCreate`/`crudRead`/`crudUpdate`/`crudDelete` booleans). No master/slave attribute today.
- `relDataObjectSuccessor` is an existing `DataObject` ↔ `DataObject` lineage relation. The new ER relation is a separate metamodel type.
- `Relation.attributes` is a free-form JSONB column (`backend/app/models/relation.py`), already the mechanism CRUD uses — the new master/slave and cardinality attributes use the same column, no schema change beyond each relation type's own `attributes_schema` definition.
- `RelationType.cardinality` (`backend/app/models/relation_type.py`) is a fixed type-level column (`"1:1"`/`"1:n"`/`"n:m"`), separate from the per-instance cardinality value this spec adds — the type-level column stays at its default and is not what drives the diagram's displayed value.
- `diagram-js`/`diagram-js-direct-editing` and `@dagrejs/dagre` are both already project dependencies (`frontend/package.json`), used respectively by the diagram editors and the Layered Dependency View.
- Reuse the existing `CardDetailSidePanel` with a BO-specific edit gate and a refresh hook after supported changes.

## Agent's calls

- Derive visible Application groups from links the viewer can read. A hidden Master has the same visible result as an unset Master.
- Save changed positions only. Preserve the other positions when two editors change different nodes, including when a filter hides part of the diagram.
- Display a neutral shape for an existing BO without a subtype and allow explicit classification. The migration does not infer Data or Document from the name.
- Keep Applications in the selected BO's side panel. The diagram's link action can pick them and assign the role.

## Open questions before implementation

- **Canvas removal.** Decide whether removing a line should be available and, if so, whether it deletes the inventory relation.
- **Cardinality validation.** Decide whether cardinality is descriptive or also enforces constraints on inventory relationships. The current plan allows an unset value when creating a link.
- **Visuals and filters.** Choose the shapes and legend placement. Confirm whether GDPR and payment badges also appear on inventory cards and whether to offer more filters in the first version.
- **Layout.** Decide what happens if two editors move the same node and whether the saved diagram state and shared positions are included in workspace transfer.
- **Retry lifetime.** Decide whether pending items must survive refresh or reopening the page. The agreed retry within the current editing session already requires deduplication after a lost server response.
