# ArchiMate in card Resources, editor Back, link-endpoint hardening: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A card's Resources tab lists and opens its ArchiMate diagrams, the editor's Back returns to where the user came from, the Settings "Open Architecture Studio" button is gone, and the card-link endpoints stop accepting ArchiMate diagrams and hidden cards.

**Architecture:** One backend change in `diagrams.py` (the two card-link handlers reuse the existing `_diagram_for` loader and the existing `_readable_card_ids` helper) and three independent frontend changes (`ResourcesTab`, `ArchimateEditorPage`, `SettingsAdmin`). No schema, no new permission key, no new route.

**Tech Stack:** FastAPI + SQLAlchemy async + pytest (real Postgres via `./scripts/test.sh`); React 19 + MUI 6 + react-router 8 + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-13-archimate-card-resources-and-back-design.md` (read it: it holds the reasons and the "Agent's calls").

**Who does what (this plan is also the trial of the project's agents):** Task 1 → `backend-dev`. Tasks 2, 3, 4 → `frontend-dev` (independent files, may run in parallel; only one agent at a time may use the test Postgres, and tasks 2-4 do not). Task 5 and 6 → the session. Agents never commit: the session commits after each task. Every agent brief ends with: *also say which skills and rule files you had at start, whether you saw the `ponytail` mode, and roughly how much context you used* (trial notes, kept in the final summary).

## Global Constraints

- English only in code, keys and docs written here; the nine other locales come from `/translate` (Task 5). Never open a non-English locale file.
- No hex colour; MUI 6 only; request hooks for filter-driven GETs.
- Agents run `ruff format . && ruff check .` (backend) and `npx eslint <files>` + `npx tsc --noEmit -p .` (frontend) before reporting. **Nobody runs mutation testing locally.**
- Version `2.204.1` → `2.204.2` (patch); `CHANGELOG.md` lines under Fixed / Removed / Security.
- A card the caller cannot read is 404 with the same body as a missing card, never 403.

## Review Focus

1. A hidden card and a non-existent card must be indistinguishable on `POST` and `DELETE /diagrams/{id}/cards` (Task 1).
2. An ArchiMate row on a layer the caller has no key on must not appear in `GET /diagrams?card_id=…&kind=all` (Task 1).
3. Back after an SSO login or a reload (entry key not `"default"`, `history.state.idx` 0) must land on `/diagrams`, never leave the app (Task 3).
4. Back while `useUnsavedChangesGuard`'s sentinel entry is on the stack (`history.state === null`) must not throw and must land on `/diagrams` (Task 3).
5. A card linked to one DrawIO and one ArchiMate diagram shows both, each opening its own viewer (Task 2).

---

### Task 1: Card-link endpoints refuse ArchiMate and hidden cards (`backend-dev`)

**Files:**
- Modify: `backend/app/api/v1/diagrams.py` (`link_card_to_diagram` ~1231, `unlink_card_from_diagram` ~1269)
- Test: `backend/tests/api/test_diagrams_archimate_kind.py` (it already has `env`, `cards_env`, `_create`, `AM`, hidden-card patterns around lines 225-290)

**Interfaces:**
- Consumes: `_diagram_for(db, user, diagram_id: str, action: str) -> Diagram` (loader: DrawIO behind `diagrams.<action>`, ArchiMate behind its layer key, 404 when missing, keeps the `DIAGRAM_KINDS` filter) and `_readable_card_ids(db, user, card_ids: list[str]) -> list[str]` (read this one first: confirm a non-existent id is also dropped).
- Produces: both handlers load the diagram with `_diagram_for(..., "manage")`; `d.kind == "archimate"` → `HTTPException(409, "An ArchiMate diagram's card links come from its model")`; then the card id must be in `_readable_card_ids` or `HTTPException(404, "Card not found")`; the rest (409 "already linked", 404 "Link not found", insert/delete) is unchanged.

- [ ] **Step 1: Write the failing tests** in `test_diagrams_archimate_kind.py`. Names and assertions:
  - `test_link_an_archimate_diagram_is_refused` / `test_unlink_an_archimate_diagram_is_refused`: admin creates an ArchiMate diagram with `_create(..., kind="archimate", data=AM)`, then `POST`/`DELETE /api/v1/diagrams/{id}/cards[/{card}]` → `409`.
  - `test_link_an_archimate_diagram_needs_the_layer_key`: a user holding `diagrams.manage` only (custom role via `create_role`) → `403`, not `409`, for both verbs.
  - `test_link_a_hidden_card_and_a_missing_card_answer_the_same`: on a DrawIO diagram, `POST` with a card hidden from the caller (reuse the `cards_env` hidden-card setup) and with `uuid.uuid4()` → both `404`, `r1.json() == r2.json()`; same for `DELETE`.
  - `test_link_and_unlink_a_readable_card_still_work`: `201` then `204`; linking twice → `409`; unlinking an unlinked readable card → `404` with `"Link not found"`.
  - Characterisation (should already pass): `test_card_listing_with_kind_all_hides_an_archimate_layer_the_caller_cannot_view`: an ArchiMate diagram linked to a card, caller without the layer's view key → `GET /api/v1/diagrams?card_id=<id>&kind=all` omits it; with the key → includes it. Add a similar one for `kind=archimate` only if `grep -n "kind=archimate" backend/tests/api` shows none.
- [ ] **Step 2: Run and confirm the new tests fail for the right reason**
  Run: `./scripts/test.sh backend/tests/api/test_diagrams_archimate_kind.py -k "link or kind_all"`
  Expected: the refusal and hidden-card tests FAIL (201/204 or 409 instead of the asserted status); the characterisation test passes.
- [ ] **Step 3: Implement** in the two handlers as described under Produces. Keep `test_diagrams.py` green: a `boRelationship` diagram on unlink stays 404 (`_diagram_for` filters `DIAGRAM_KINDS`).
- [ ] **Step 4: Run the file and the neighbours**
  Run: `./scripts/test.sh backend/tests/api/test_diagrams_archimate_kind.py backend/tests/api/test_diagrams.py backend/tests/api/test_archimate_diagram_permissions.py`
  Expected: all pass. Then `cd backend && ruff format . && ruff check .` clean.
- [ ] **Step 5: Report, then the session commits** (`fix(diagrams): card links refuse ArchiMate diagrams and hidden cards`).

---

### Task 2: Resources tab lists and opens ArchiMate diagrams (`frontend-dev`)

**Files:**
- Modify: `frontend/src/features/cards/sections/ResourcesTab.tsx` (load at ~165, row at ~738-750), `frontend/src/i18n/locales/en/<the namespace ResourcesTab already uses>.json`
- Test: `frontend/src/features/cards/sections/ResourcesTab.test.tsx`

**Interfaces:**
- Consumes: `DiagramSummary.kind?: "drawio" | "archimate"` (`frontend/src/types/index.ts`); the backend now answers `GET /diagrams?card_id=<id>&kind=all` per row.
- Produces: load URL is exactly `` `/diagrams?card_id=${fsId}&kind=all` ``; row click → `navigate(d.kind === "archimate" ? `/admin/architectureStudio/${d.id}` : `/diagrams/${d.id}`)`; the unlink `IconButton` renders only when `canManageDiagramLinks && d.kind !== "archimate"`; an ArchiMate row shows a small `Chip` with a new English key. The "link a diagram" picker (`/diagrams`, DrawIO only) is **not** changed.

- [ ] **Step 1: Write the failing tests**; first update the mock URL (`beforeEach` ~line 95) and the assertion at ~147 to the `&kind=all` form, then add: `lists an ArchiMate diagram next to a DrawIO one` (both names visible), `opens an ArchiMate row in the Architecture Studio` (`navigateMock` called with `/admin/architectureStudio/diag-2`), `keeps opening a DrawIO row in the viewer` (existing test ~474), `shows no unlink button on an ArchiMate row` (unlink buttons count equals the DrawIO rows only, with `canManageDiagramLinks` true), `marks an ArchiMate row` (chip text).
- [ ] **Step 2: Run, see them fail**
  Run: `cd frontend && npx vitest run src/features/cards/sections/ResourcesTab.test.tsx`
  Expected: FAIL (URL mismatch, wrong route, unlink button present).
- [ ] **Step 3: Implement** as under Produces; one line on the view-only question from the spec ("Constraints and traps"): the builder checks `ROUTE_PERMISSIONS` for `/admin/architectureStudio/:id` and decides whether an ArchiMate row is clickable for a user without the manage-any-layer key, records the call in its report, and covers it with a test.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then `npx eslint src/features/cards/sections/ResourcesTab.tsx src/features/cards/sections/ResourcesTab.test.tsx` and `npx tsc --noEmit -p .` clean.
- [ ] **Step 5: Report, then the session commits** (`fix(cards): list ArchiMate diagrams in a card's Resources`).

---

### Task 3: Editor Back returns to where the user came from (`frontend-dev`)

**Files:**
- Modify: `frontend/src/features/archimate/ArchimateEditorPage.tsx`
- Test: `frontend/src/features/archimate/ArchimateEditorPage.test.tsx`

**Interfaces:**
- Produces: `onBack` computes `const inApp = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;` and calls `navigate(inApp ? -1 : "/diagrams")`. It must **not** test `location.key` (an SSO login replaces the entry, so the key is not `"default"` while the previous entry is the identity provider).

- [ ] **Step 1: Write the failing tests** (replace `goes back to the sandbox list`): `goes back to the previous page when the app navigated here` (set `window.history.replaceState({ idx: 1 }, "")`, render with the page reached from a prior in-memory entry, click back, assert the prior path), `falls back to /diagrams on a deep link` (`replaceState({ idx: 0 }, "")`), `falls back to /diagrams when the entry key is not "default" but idx is 0` (the SSO case; reach the page via an in-memory `navigate(..., { replace: true })` so the key differs), `falls back to /diagrams while the unsaved-changes sentinel is on the stack` (`replaceState(null, "")`, no throw). Reset `window.history.replaceState(null, "")` in `afterEach`.
- [ ] **Step 2: Run, see them fail**
  Run: `cd frontend && npx vitest run src/features/archimate/ArchimateEditorPage.test.tsx`
  Expected: FAIL (the page still navigates to `/admin/architectureStudio`).
- [ ] **Step 3: Implement** the one-line `onBack` above (the route `/diagrams` exists in `App.tsx`).
- [ ] **Step 4: Run** the same command, then eslint and `tsc` on the two files. Expected: PASS, clean.
- [ ] **Step 5: Report, then the session commits** (`fix(archimate): Back returns to the page the editor was opened from`).

---

### Task 4: Remove the Settings "Open Architecture Studio" button (`frontend-dev`)

**Files:**
- Modify: `frontend/src/features/admin/SettingsAdmin.tsx` (~1740-1749), `frontend/src/i18n/locales/en/admin.json` (key `settings.archimate.openSandbox`, line ~741)
- Test: `frontend/src/features/admin/SettingsAdmin.test.tsx` (the two tests at ~630-660 assert the button)

**Interfaces:** removes the `archimateEnabled && (<Box>…<Button>…openSandbox…)` block and, if `navigate` / `MaterialSymbol` become unused in that file, their imports; the `settings.archimate.*` toggle texts stay.

- [ ] **Step 1: Rewrite the tests first**: replace the two sandbox tests with one, `does not offer an Architecture Studio button, enabled or not` (toggle on, `queryByRole("button", { name: endsWith(t("settings.archimate.openSandbox")) })` is absent). It fails now because the button renders when enabled.
- [ ] **Step 2: Run, see it fail**
  Run: `cd frontend && npx vitest run src/features/admin/SettingsAdmin.test.tsx -t "Architecture Studio"`
  Expected: FAIL (button present).
- [ ] **Step 3: Remove** the block and the English key.
- [ ] **Step 4: Run** the whole file; eslint and `tsc` on the touched files. Expected: PASS, clean (the locale-parity tests fail until Task 5 removes the key from the other nine: say so, do not touch them).
- [ ] **Step 5: Report, then the session commits** (`chore(settings): drop the Open Architecture Studio button`).

---

### Task 5: Version, changelog, docs, translations (session)

**Files:** `VERSION`, `CHANGELOG.md`, `docs/guide/card-details.md` (section "Resources Tab", ~line 189), `docs/guide/diagrams.md`; the nine locale siblings and the nine other locales' `admin.json` via `/translate`.

- [ ] **Step 1:** `VERSION` → `2.204.2`; `CHANGELOG.md` heading `## [2.204.2] - 2026-11-13` with **Fixed** (ArchiMate diagrams now appear in a card's Resources and open in the Architecture Studio; the editor's Back returns to the previous page), **Removed** (the Settings "Open Architecture Studio" button), **Security** (linking or unlinking cards on an ArchiMate diagram is refused; a hidden card on a diagram link answers 404 like a missing one).
- [ ] **Step 2:** English docs: the Resources-tab section says ArchiMate diagrams are listed (open-only, links come from the model); `docs/guide/diagrams.md` likewise where it describes a card's linked diagrams. No screenshot change.
- [ ] **Step 3:** run `/translate`; expect it to report clean (it removes `settings.archimate.openSandbox` from the nine locales, adds the new `resources` chip key, creates the nine doc siblings).
- [ ] **Step 4:** `mkdocs build --strict` passes; `python scripts/dump_openapi.py` leaves `docs/api/openapi.json` unchanged (the routes did not change shape; if it differs, include the regenerated file).
- [ ] **Step 5:** commit (`docs: 2.204.2 changelog, manual and translations`).

---

### Task 6: Verification, review chain, VAPT (session, fresh agents)

- [ ] **Step 1:** `/graphify . --update --mode deep`, then the full suites: `./scripts/test.sh` and `cd frontend && npm run test:run`, plus `ruff`, `eslint`, `tsc`. Expected: all green, counts recorded.
- [ ] **Step 2:** `simplify` by a fresh agent (it edits code); re-run the tests of the files it touched.
- [ ] **Step 3:** the `reviewer` agent on `git diff origin/main...HEAD` (it runs `ponytail-review`, `security-review`, `python-anti-patterns`); every "must fix" gets a test first. The session itself then runs `security-review` for the PR hook.
- [ ] **Step 4:** VAPT per `.claude/rules/vapt.md` against the local instance (card-link endpoints; the 403/409/404 ladder; the Resources listing for a user without the layer key). Report where `vapt.md` says.
- [ ] **Step 5:** with the user's OK only: push and open the PR with `.github/pull_request_template.md` (Test Plan: refactor/no-op lines stated, mutation answered from CI, trial notes of the three agents in the PR body or in chat).
