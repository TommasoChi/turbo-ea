---
paths:
  - "backend/app/services/archimate/**"
  - "backend/app/api/v1/archimate.py"
  - "backend/app/models/archimate_viewpoint.py"
  - "backend/alembic/versions/*archimate*"
  - "frontend/src/features/archimate/**"
  - "frontend/src/features/diagrams/ArchimateViewpointPicker*"
  - "frontend/src/api/archimateViewpoints.ts"
  - "frontend/src/hooks/useArchimateEnabled.ts"
  - "scripts/archimate/**"
---

# ArchiMate

> Loaded when you touch `backend/app/services/archimate/**`, `frontend/src/features/archimate/**`, … (full
> list in the frontmatter). Authored from the fork's own ArchiMate branch work — there was no prior
> `CLAUDE.md` section to move, so treat this as a living log: add to it as the feature grows.

- **Architecture split.** Backend owns taxonomy, validation and the Viewpoint catalog
  (`backend/app/services/archimate/`). Frontend owns a diagram-js-based editor under
  `features/archimate/engine/` plus three sibling folders: `exchange/` (Open Group Exchange Format
  XML read/write), `mapping/` (card-type ↔ Enterprise Object resolution), `taxonomy/` (the 62
  element types + relationship matrix, generated — see below).
- **Two layer taxonomies, don't conflate them** (`taxonomy.py`): `LAYERS` is the 8-value ArchiMate
  classification (`strategy, business, application, technology, physical, implementation,
  motivation, other`) used for the admin-facing Viewpoint `layer` field. `TAB_LAYERS` is the
  3-tab grouping (`business, application, technology`) the Diagrams page scopes by
  (`/business-architecture/diagram` etc.). `TAB_LAYERS` is the canonical shared home — imported by
  both `app/api/v1/diagrams.py` and `viewpoint_seed.py`, never redefined locally.
- **Viewpoint `domains`** (JSONB column, migration 167): stored and admin-editable, independent of
  the single-value `layer` field. Seeded once from the allowed objects' layers via `_domains_of()`
  in `viewpoint_seed.py`, but editable afterward through `PATCH /metamodel/viewpoints/{key}`.
  `DiagramsPage.tsx`'s layer-scoped entry points filter by **membership in `domains`** (multi-value),
  never by the single `layer` — a viewpoint can legitimately span more than one domain (e.g.
  Product: business + application).
- **Migration "baked-in literal" convention** (precedent: migration 160, continued in 167): a
  migration's own copy of a mapping (e.g. migration 167's inlined `_TAB_LAYERS`) is a hardcoded
  literal, never imported from the live source module — so a later source change can't silently
  rewrite migration history.
- **A migration's lightweight `sa.table()` must declare every column its `.values()` touches**,
  including JSONB ones, or SQLAlchemy raises `CompileError: Unconsumed column names` at runtime —
  only on a database that already has rows for the backfill loop to iterate. The test suite's
  ephemeral DB starts empty, so this is **not caught by pytest**; it only showed up deploying
  migration 167 against the populated `turbo-ea-aruba` instance (crash-looped the backend
  container). Any migration backfilling existing data needs a check against a real populated DB,
  not just a green test run — see root `CLAUDE.md` § turbo-ea-aruba deploy for the backup-first
  procedure.
- **XXE.** Uploaded ArchiMate XML (Exchange Format or Archi-native) is parsed only through
  `defusedxml.ElementTree.fromstring(xml, forbid_dtd=True)` in `validate.py` — never the stdlib
  `xml.etree.ElementTree` on untrusted input (`archi_native_import.py`'s own `fromstring` import is
  for re-serializing already-validated content, not for parsing uploads). Guarded by
  `tests/fixtures/archimate/hostile_xxe.xml`.
- **Exchange Format vs. Archi-native — two different XML dialects.** The Open Group **Exchange
  Format** (ArchiMate 3.1 XSD) is what Turbo EA stores, imports and exports per-diagram
  (`exchange/exchangeModel.ts` on the frontend; `archi_native_import.py` + `validate.py` on the
  backend). Archi's own **native `.archimate`** format is a whole multi-view *project* file — every
  element, relationship and view it ever held, not just one diagram — which is what a user exports
  from the Archi desktop app. `archi_native_import.py` converts a whole native model with no way to
  scope it to one view; `scripts/archimate/convert_viewpoint_example.py` exists only to trim a
  native export down to one view's worth of elements/relationships (dropping `Junction`s, which the
  Exchange Format has no counterpart for) before handing the minimal native XML to that same
  converter — it never reimplements the conversion itself.
- **Card linkage** travels as a standard Exchange Format `<property>`, keyed to the well-known
  propertyDefinition id `propid-turboea-cardId` (`CARD_ID_DEFINITION`, `exchangeModel.ts`) — a real
  ArchiMate property, not a Turbo EA-only extension, so a link round-trips through a plain
  Archi/Exchange file untouched.
- **Engine isolation from the API**, enforced by a source-text scan
  (`engine/noApiImports.test.ts`): no file under `features/archimate/engine/**` may import the API
  client, by any spelling (`@/api`, a relative `../api`, a dynamic `import()`, a re-export). Every
  card operation (create / open / link / unlink / delete) goes through `EditorBridge`
  (`engine/EditorBridge.ts`), supplied by the page — dropping a shape or deleting one must never
  itself create or delete a card.
- **`reconcile.ts`** merges the editor's (first-view-only) edits back into the loaded model. Because
  the editor only ever shows the model's first view, it may delete an element/relationship on save
  **only** when: that view drew it, no other view still draws it, and the file originally defined it
  there (not something the first view merely referenced). These are the data-loss guards against
  silently dropping content that belongs to other views in the same file.
- **`ModelSync.ts`** keeps a connection's relationship `source`/`target` in step with what it
  visually joins, including across undo/redo. Its custom `ArchimateLayouter` preserves user-placed
  bendpoints on an end-move — diagram-js's default `BaseLayouter` would straighten the connection to
  a centre-to-centre line instead.
- **Renderer name positioning** (`ArchimateRenderer.ts`): a shape's name is always anchored near the
  top/header band, never centred across the shape's full height. Centring broke for composite /
  container elements (e.g. a BusinessProcess nesting other processes via Composition) once the
  shape grew taller than one text line — the centred name landed right where the nested children are
  drawn, hiding it completely. The regression test pins the baseline to an **exact** y value, not a
  loose upper bound, specifically so arithmetic-operator mutants on that one line get caught.
- **`relation_table.json` (backend) and `taxonomy/relationTable.generated.ts` (frontend) are both
  generated**, from Archi's own published `relationships.xml`, by
  `scripts/archimate/generate_taxonomy.py` — never hand-edit either file; regenerate instead.
- **MCP tools** (`create_archimate_diagram`, `update_archimate_diagram`, `get_archimate_mapping`)
  live alongside every other tool in `mcp-server/turbo_ea_mcp/server.py` — see
  [`mcp-server.md`](mcp-server.md) for the server's own conventions.
