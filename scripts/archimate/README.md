# ArchiMate scripts

Two standalone scripts for maintaining the ArchiMate side of the metamodel.
Both are plain Python (stdlib `xml.etree.ElementTree` only) and read a local
file — nothing here calls out to the network.

## `generate_taxonomy.py` — the relationship matrix

Regenerates the ArchiMate 3.x relationship-type matrix (which relationship
kinds are legal between which element types) from a local copy of Archi's own
published `relationships.xml`, writing both the backend's `relation_table.json`
and the frontend's generated TypeScript table. See the script's own docstring
for the exact command.

## `convert_viewpoint_example.py` — Viewpoint Catalog starter examples

Turns one *view* of an Archi-native `.archimate` export into a Turbo EA
Viewpoint Catalog example (Exchange Format XML) — the fixtures seeded by
`backend/app/services/archimate/viewpoint_example_seed.py` and offered as
starters when creating a new ArchiMate diagram from a Viewpoint.

An Archi export is a whole *model* — every element, relationship and view it
has ever held — not just the one diagram you want. The backend's own
converter (`archi_native_import.py`) converts the whole model with no way to
scope it to a single view, so this script trims first (keeping only what the
chosen view's own nodes reference, dropping `Junction` elements the Exchange
Format has no counterpart for) and only then hands the minimal native XML to
the real backend converter. It never reimplements that conversion — scoping
only.

### Usage

```bash
# List every view in the file with its object count, nothing written.
python scripts/archimate/convert_viewpoint_example.py --list-views model.archimate

# Convert one view (by exact name) to Exchange Format XML on stdout.
python scripts/archimate/convert_viewpoint_example.py model.archimate \
    --view "Organization View"

# Same, written straight to a fixture file, plus the standard Viewpoint
# the view's element types best match.
python scripts/archimate/convert_viewpoint_example.py model.archimate \
    --view "Organization View" \
    --output backend/app/services/archimate/viewpoint_examples/fig09.xml \
    --match-viewpoint
```

Reads a plain-XML or zip-packaged (Archi's own `.archimate` zip export, with
an `images/` folder alongside `model.xml`) file alike. Run from the repo
root — the script adds `backend/` to `sys.path` itself to reuse the real
converter and the standard Viewpoint catalog.

### Registering a new example

1. Run the command above with `--output` pointing at a new file under
   `backend/app/services/archimate/viewpoint_examples/`.
2. Add one line to `_EXAMPLE_DEFS` in
   `backend/app/services/archimate/viewpoint_example_seed.py`:
   `(viewpoint_key, "Display name", "the-file.xml")` — `--match-viewpoint`
   tells you which `viewpoint_key` to use.
3. The seed is insert-only on the natural key `(viewpoint_key, name)`, so a
   fresh backend boot (or `scripts/test.sh`, or a redeploy) picks it up
   automatically — no manual seed command needed.

### Source of the current 28 examples

The 28 examples seeded today were converted from the **ArchiSurance
Practice** reference model —
[`yasenstar/ArchiSurance_Practice`](https://github.com/yasenstar/ArchiSurance_Practice)
on GitHub (MIT licensed), a worked TOGAF ADM walkthrough built for a paid
Udemy course on ArchiMate/TOGAF. Only the derived, trimmed Exchange Format
fixtures are committed here — the original `.archimate` corpus (~28 MB,
third-party promotional course material) is **not** bundled in this repo.
Anyone extending the set should pull that source (or any other Archi model)
down separately and run it through this script.
