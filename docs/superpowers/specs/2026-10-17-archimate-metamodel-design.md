# ArchiMate Metamodel Configuration — Design

> **For agentic workers:** this document is input to `superpowers:writing-plans`.

## Intent and why

The ArchiMate editor shipped in PR #15 (`feature/archimate-foundation`) lets users draw
diagrams using the fixed ArchiMate 3.x taxonomy and link elements to turbo-EA cards, but the
card↔ArchiMate mapping is hardcoded (`backend/app/services/archimate/default_mapping.py`),
1:1, and read-only in the admin UI. The admin-facing docs already promise an editable mapping
screen ("ARCHI MAP") that was never built (`docs/admin/metamodel.it.md:250`).

This phase ("archimate-metamodel", branch `feature/archimate-metamodel`) replaces that gap with
a proper admin area: an editable, many-to-many mapping between turbo-EA card types/subtypes and
ArchiMate concepts, a visual classification of those concepts along the ArchiMate "Full
Framework" (layer × aspect), explicit per-concept relationship rules, and — looking further
ahead — the ability to define concepts and relationship rules that don't exist in the ArchiMate
standard at all, as the first step toward turbo-EA defining its own taxonomy/ontology instead of
being strictly bound to the Open Group's.

The branding ("ArchiMate" → "Architecture Studio") is part of this phase because the word
"ArchiMate" was judged too intimidating/jargon-heavy for the target users, per the stated design
goal: make the feature approachable without simplifying what it actually models ("rendere
fluibile senza semplificare").

## Goals

- An editable n:m mapping between (card type, optional card subtype) and ArchiMate/Enterprise
  Object concepts, replacing today's 1:1 `CardType.archimate_type` / subtype-override columns.
- An editable n:m mapping between a turbo-EA `RelationType` and the ArchiMate relationship(s) it
  may be drawn as, replacing today's 1:1 `RelationType.archimate_type` column and
  `default_mapping.py`'s `RELATION_DEFAULTS` dict, with one row flagged as the default used for
  automatic diagram derivation.
- A registry of "Enterprise Object" concepts (the rebranded term for an ArchiMate element type,
  standard or custom) with: unique key, name, icon, color, layer, a short child-friendly
  description, and a visibility flag.
- A visual classification UI (the ArchiMate "Full Framework" grid: layer × aspect) covering
  every Enterprise Object, standard and custom.
- A relationship-rules UI exposing/editing which of ArchiMate's 11 relationship types are legal
  between Enterprise Objects — today fully implicit in `relation_table.json`.
- The ability for an admin to define a brand-new Enterprise Object that has no equivalent in the
  ArchiMate 3.x standard ("custom" concepts), with sane, low-risk defaults (generic icon-based
  shape, Association-only relationships, Exchange-Format export as a `Label` node) rather than
  requiring new engineering for each one.
- Rebrand the editor and its nav/route from "ArchiMate" to "Architecture Studio" in all
  user-facing surfaces, preserving the legal trademark disclaimer and all internal identifiers.

## Non-goals (for this phase)

- Viewpoints / "Drawing Types" (which Enterprise Objects + relations are usable in a given named
  perspective) — explicitly parked. The name is settled; the data model and UI are not, pending
  real-world examples the user will supply.
- Deciding whether custom Enterprise Objects ever get configurable relationship rules beyond
  "Association only" — explicitly left open (see Open Questions).
- Custom per-concept ArchiMate-notation glyphs (hand-drawn SVG shapes) for custom Enterprise
  Objects — explicitly rejected for now; custom objects use the existing CardType icon system
  (Material Symbols + color via `IconPicker`/`ColorPicker`), not bespoke notation art.
- Full migration away from the Open Group Exchange Format as the diagram file format — the XSD
  stays the reference for what's "standard" vs "custom"; this phase does not replace it.
- Any backend/DB schema design beyond what's described below — exact columns, migrations and
  indices are for the plan to work out, following the codebase's existing patterns.

## Anti-goals

- Do not make standard ArchiMate elements editable/deletable as if they were custom — their key,
  taxonomy membership and (once verified) aspect are fixed by the Open Group spec; admins only
  configure their visibility, description, and card-type mapping.
- Do not silently drop a custom Enterprise Object's type information on Exchange Format export —
  it must round-trip as a `Label` node (losing type semantics, as already accepted for Notes),
  not be rejected or crash the exporter.
- Do not let a non-privileged user (no metamodel-edit permission) edit an Enterprise Object's
  description from the drawing palette — the popover there is read-only for them; only users
  with metamodel-edit rights see the edit (pencil) affordance, there and in the admin screens.

## Constraints

- Must reuse existing patterns rather than invent new ones: `CardType.is_hidden` + eye-icon
  toggle for visibility; `KeyInput`/`isValidKey` for custom-object keys; `IconPicker` +
  `ColorPicker` for custom-object appearance; the nested `Tabs`/`Tab` pattern already used by
  `RelationsTabContent.tsx` for each new sub-tab.
- Must not touch: the ArchiMate trademark disclaimer text, the `archimate_enabled` setting key,
  the `useArchimateEnabled`/`invalidateArchimateEnabled` hooks, any `features/archimate/*`
  component/file names, or ArchiMate 3.x technical terminology used *inside* the editor's own
  notation (only the feature's outward branding changes).
- Standard ArchiMate element/relationship names stay the Open Group Exchange XSD 3.1 names
  verbatim, per the existing `taxonomy.py` convention — custom objects get their own
  admin-chosen key, never colliding with a standard name.
- "Architecture Studio" stays untranslated (English) across all 10 locales, matching the
  existing convention for "ArchiMate" as a proper noun.

## Decisions made (the "how", as decided in conversation)

### Branding / navigation — already implemented

Done and committed (`2494f530` on `feature/archimate-metamodel`, not pushed): editor route
`/admin/archimate` → `/admin/architectureStudio` (and `/:diagramId`); user-visible labels
"ArchiMate sandbox"/"ArchiMate editor" → "Architecture Studio" across all 10 locales; trademark
disclaimer, internal identifiers, component/file names, and in-notation ArchiMate terminology
left untouched. Lint/typecheck/touched-tests verified green.

### Admin surface: a new "Architecture Studio" tab

In `frontend/src/features/admin/MetamodelAdmin.tsx`, a new top-level tab **"Architecture
Studio"**, positioned immediately after "Relation Types" (today's tab index 1). It contains five
sub-tabs, built with the same nested `Tabs`/`Tab` + local `sub` state pattern already used by
`RelationsTabContent.tsx`:

#### 1. Card Mapping

Two responsibilities:

**(a) Enterprise Object registry.** Each Enterprise Object (the rebranded term for an ArchiMate
element type) has: a unique key (fixed/locked to the Open Group XSD name for the ~40 standard
types, pre-seeded; admin-chosen via `KeyInput`/`isValidKey` for custom ones, locked after
creation), name, icon + color (via `IconPicker`/`ColorPicker`, same widgets as `CardType`), layer,
a short description (≤20–30 words, written for a non-expert — the standard ArchiMate definition
simplified; seeded by Claude for all standard types, admin-editable after), and a visibility flag
(`is_hidden`-equivalent). A **"New Architecture Object"** button opens a dialog matching "New
Card Type"'s (layer, icon, name, description) and always creates a **custom** object — standard
objects are pre-seeded, not created here.

Clicking an Enterprise Object's name/icon — in the Architecture Studio drawing palette, or in
this admin list — opens a `Popover` (click-triggered, not hover: works on touch) anchored at the
click point, showing icon + name + description. A pencil/edit icon inside it lets a user with
metamodel-edit permission edit the description inline; everyone else (including in the drawing
palette) sees it read-only.

Visibility semantics mirror draw.io's shape-library toggle and today's `CardType.is_hidden`:
hiding an Enterprise Object only removes it from the Architecture Studio palette going forward.
Elements already drawn with that type on existing diagrams are completely unaffected — no
warning, no degraded state, fully editable as before. **Seed default: all ~40 standard
Enterprise Objects are visible**, matching today's palette exactly (no regression) — visibility
is an independent admin action, unrelated to whether an object happens to have a card mapping.
Whether an Enterprise Object has any card-mapping rows at all is optional and independent of its
visibility, exactly as `CARD_TYPE_DEFAULTS` already leaves some card types unmapped
(`"BusinessContext": None`) today — an unmapped object simply never offers "Link to card".

**(b) Card mapping.** A flat many-to-many table: `(enterprise_object, card_type, card_subtype?)`.
A row with `card_subtype = NULL` matches every card of that card type, regardless of subtype; a
row with a specific subtype matches only cards of that subtype. There is no override/cascade
between type-level and subtype-level rows — it's one flat set. Example: Enterprise Object "A" has
rows `(A, CardTypeA, NULL)` and `(A, CardTypeB, SubtypeBA)`. "Link to card" on a diagram element
of type A offers: every card of CardTypeA (any subtype) **union** every card of CardTypeB whose
subtype is SubtypeBA — a straightforward reverse lookup on this table, no precedence logic.

Replaces today's `CardType.archimate_type` / `CardSubtype.archimate_type` single-value columns
and `default_mapping.py`'s `CARD_TYPE_DEFAULTS`/`SUBTYPE_DEFAULTS` dicts with the equivalent seed
data in the new bridge table.

#### 2. Framework Grid

A grid matching the Open Group's own "Full Framework" diagram: rows are the existing ArchiMate
layers (`taxonomy.py`'s `LAYERS` — Strategy, Business, Application, Technology, Physical,
Implementation & Migration), columns are the three aspects (Passive Structure, Behavior, Active
Structure); Motivation is its own full-height column with no aspect subdivision (per the
reference diagram the user supplied). Every Enterprise Object — standard or custom — is placed
in one cell (layer × aspect), or in the Motivation column.

**Gap, flagged for the builder:** no aspect classification exists in code today — only layer
grouping. Most of the ~40 standard elements' aspect is well established from the ArchiMate 3.2
spec (e.g., BusinessObject = Passive Structure, BusinessProcess = Behavior, BusinessActor =
Active Structure), but a handful of edge cases need verification against the authoritative Open
Group spec before being hardcoded, not guessed: Product, ValueStream, Plateau, Gap,
Path/CommunicationNetwork, and the Strategy-layer elements (Resource, Capability,
CourseOfAction).

Custom Enterprise Objects must also be classified here — there is no default/skip option.

**"Other" section.** `Grouping`, `Location`, `AndJunction`, `OrJunction` (ArchiMate's
composite/connector types, already excluded from `taxonomy.py`'s `LAYERS`) sit in a 5th section
at the end of the Framework Grid, outside the layer×aspect cells, alongside the existing `Note`
pseudo-type from the foundation phase. Each has its own special handling, not the generic
Enterprise Object treatment:

- **Grouping** is the engine's parent/container mechanism (the same containment concept already
  used for Notes). Fixed, not admin-editable.
- **Location** does not map to a card type/subtype like other Enterprise Objects — it maps to
  **location-type fields**, wherever they exist across any card type (today: `Organization`'s
  `region` subtype; tomorrow, potentially a location field on `ITComponent` or others). This is a
  genuinely different mapping mechanism from Card Mapping's (card type, card subtype) pairs — the
  principle is decided, the concrete field-mapping mechanism is left to the builder (see below).
- **AndJunction/OrJunction** are pure ArchiMate notation (splitting/merging connector lines with
  AND/OR semantics, no business meaning of their own) — never mapped to a card.
- **Generic custom objects under "Other"** (freeform concepts that don't fit the layer×aspect
  grid at all) — raised but explicitly deferred to the backlog; needs more study before it's
  speced.

#### 3. Connection Rules

Exposes and makes editable, per Enterprise Object, which of ArchiMate's 11 relationship types
(Composition, Aggregation, Assignment, Realization, Serving, Access, Influence, Triggering,
Flow, Specialization, Association) are legal when connecting it to another Enterprise Object. For
the ~40 standard elements this is already fully encoded in `relation_table.json` / `taxonomy.py`'s
`allowed_relationships()` — this tab surfaces that existing matrix for viewing/editing rather than
building a new rule engine. For a custom Enterprise Object, the default is **Association only**
(ArchiMate's one universal, semantically generic relationship) until an admin configures more.

Named "Connection Rules" rather than "Relation Rules" specifically to avoid collision with the
sibling top-level "Relation Types" tab (turbo-EA's own card-relationship types — a different
concept).

#### 4. Relation Mapping

A different thing from Connection Rules, though related. Connection Rules governs
ArchiMate-to-ArchiMate legality (Enterprise Object × Enterprise Object, ~40×40, already
implicit in `relation_table.json`). Relation Mapping governs turbo-EA's own vocabulary: for each
`RelationType` (already scoped to one specific card-type pair/direction today, e.g.
`relOrgToApp`), which ArchiMate relationship(s) it may be drawn as, plus the existing
`reversed`/`access` flags. n:m — a `RelationType` may have several valid ArchiMate relationship
rows — but exactly one row per `RelationType` is flagged `is_default`: the one
`resolveRelation()` uses to auto-derive a diagram connection from the card graph when no human is
choosing. The other rows stay valid (e.g. for future manual override) without being auto-picked.

The relationship choices offered here must be **filtered by Connection Rules**: only ArchiMate
relationship types that Connection Rules allows between the Enterprise Objects that the
`RelationType`'s source/target card types map to (via Card Mapping) are selectable — Relation
Mapping cannot configure a combination Connection Rules itself forbids.

Replaces today's `RelationType.archimate_type`/`archimate_access`/`archimate_reversed` columns and
`default_mapping.py`'s `RELATION_DEFAULTS` dict.

#### 5. Drawing Types

Parked (non-goal, see above). Name is final; scope is not — the user will provide concrete
viewpoint examples before this sub-tab is designed. Conceptually: a named viewpoint (in the
ISO/IEC/IEEE 42010 sense) lists which Enterprise Objects — and, implicitly, which relations
between them — are usable when drawing that kind of diagram.

### Strategic direction: beyond the ArchiMate standard (phased)

Longer-term — explicitly staged, not this phase's deliverable — turbo-EA moves from being
strictly bound to the Open Group ArchiMate XSD taxonomy toward its own extensible
taxonomy/ontology, while the ~40 standard ArchiMate elements remain first-class, pre-seeded, and
spec-compliant. The Exchange Format XSD stays in the codebase as a **reference** (to tell
standard from custom), not as the enforced ceiling on what can be modeled. A custom Enterprise
Object is exported to Exchange Format XML as a `<node xsi:type="Label">` (the same mechanism
already built for Notes), accepting that round-tripping through strict ArchiMate tooling (e.g.
Archi) loses that element's type semantics.

## Open questions (explicitly unresolved — not this phase's decision)

- Should admins eventually be able to enable additional relationship types for a custom
  Enterprise Object (a checklist over the 11 types), or does "Association only" stay permanent
  for every custom object? Parked mid-conversation; revisit before or during the Connection Rules
  implementation task.
- Generic custom objects under the "Other" section (not fitting the layer×aspect grid at all) —
  raised, explicitly deferred to the backlog pending further study.
- The concrete field-mapping mechanism for `Location` (which fields count as "location-type",
  across which card types, and how the bridge table/UI represents a field-level mapping instead
  of a card-type-level one) — the principle is decided, the mechanism is not.
- Drawing Types / viewpoints: entirely open pending the user's examples.

## What's left to the builder

- Exact DB schema (tables/columns/migration) for: the Enterprise Object registry, the
  `(enterprise_object, card_type, card_subtype?)` bridge table, the aspect classification, the
  `(relation_type, archimate_relationship, is_default)` bridge table for Relation Mapping, and
  (if built this phase) the per-object relationship-rule overrides — follow the existing
  `CardType`/`RelationType`/`archimate_type` column patterns already in
  `backend/app/models/card_type.py` and `backend/app/models/relation_type.py`.
  - Do not delete the existing Exchange Format XSD files in the project — they remain the
    reference for which keys count as "standard" vs. custom.
- Seed data: migrate `default_mapping.py`'s `CARD_TYPE_DEFAULTS`/`SUBTYPE_DEFAULTS` into the Card
  Mapping bridge table, and `RELATION_DEFAULTS` into the Relation Mapping bridge table (each
  migrated row becomes `is_default = true`), as their initial rows; verify
  `test_archimate_default_mapping*.py` and `test_seed_archimate_mapping.py` are updated/replaced
  consistently with the new model — do not leave the old 1:1 columns and the new n:m tables both
  live.
- Registry rows for `Grouping`, `Location`, `AndJunction`, `OrJunction` (the "Other" section) —
  these need Enterprise Object entries to serve as card-mapping targets even though they're
  excluded from the layer×aspect grid proper; `Grouping`'s row must not be admin-editable.
- The ~40 standard Enterprise Objects' child-friendly descriptions (≤20–30 words each) — draft
  all of them against the Open Group ArchiMate 3.2 spec's own definitions, simplified; seed as
  defaults, admin-editable.
- The ~40 standard elements' aspect classification for the Framework Grid, verified against the
  authoritative Open Group spec for the edge cases listed above before being hardcoded.
- API endpoints for: CRUD on Enterprise Objects, CRUD on the card-mapping bridge table, read/edit
  of the aspect grid, read/edit of connection rules — follow the existing
  `/metamodel/types`/`/metamodel/relation-types` endpoint conventions.
- Permission gating: the pencil/edit affordance on the description popover, and all five
  sub-tabs' write actions, gated behind the same permission tier that already gates `CardType`/
  `RelationType` editing.
- i18n: all new UI strings across the 10 existing locales, following the project's established
  process (seed English + ask-for-translation-review pattern already used elsewhere in this
  repo).
- Whether/how to update `docs/admin/metamodel*.md`'s "ARCHI MAP... arriva nella prossima
  versione" note now that the real screen (differently named) exists.
