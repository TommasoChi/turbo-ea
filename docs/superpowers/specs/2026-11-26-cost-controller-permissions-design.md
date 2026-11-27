# Cost access and the Cost Controller role

Part 1 of 3 of the initiatives improvements. It ships first (PR **E**): the other two parts rely on its permission rule. Part 2: `2026-11-26-initiative-pages-design.md`. Part 3: `2026-11-26-build-cost-report-design.md`. Mockups of all three parts: `2026-11-26-initiatives-improvements-mockups/`.

## Why

Who may see and edit the costs of a card is today answered in different places with different rules. An initiative's PPM pages show budget and cost amounts to anyone with `ppm.view` (only the invoices follow the card's cost access); a stakeholder who can edit a card can edit its costs; and there is no way to give someone the costs of a card without letting them edit the card. This part states one rule for both and adds a **Cost Controller**: a role that reads a card and manages its costs, and nothing else.

## Goals

1. One permission rule, two layers: the application permission opens a function, the card permission says on which cards it applies.
2. A new card-level permission, `card.edit_costs`, separate from `card.edit`.
3. A new **Cost Controller** stakeholder role (Initiative, Application, IT Component) and a matching default application role.
4. Amounts of an initiative are withheld, in the API response, from whoever cannot view that card's costs.

## Non-goals

- Changing how budget lines, cost items, invoices and Providers are stored (no new tables).
- Reworking licenses: they keep their own rule.
- A separate invoice permission (invoices follow cost access).
- **Vertical visibility cones** (visibility narrowed by hierarchy, today only horizontal, per card type): a later development, not here.

## What exists today (facts the rule relies on)

- `PermissionService.can_view_costs(db,user,card_id)` = `costs.view` OR a stakeholder role on the card granting `card.view_costs` (#1412); `can_edit_costs` = view AND (`costs.edit` OR a stakeholder role with `card.edit` via `_can_edit_domain`, shared with licenses). Defaults in `backend/app/core/permissions.py`: `RESPONSIBLE_CARD_PERMISSIONS` and `IT_PROJECT_MANAGER_CARD_PERMISSIONS` have `card.view_costs` and `card.edit` on; Observer has neither. `with_legacy_cost_grant` fills `card.view_costs` for old role maps (migration 195). `APP_TO_CARD_PERMISSION_MAP` maps application permissions to card permissions.
- PPM reads (`/ppm/initiatives/{id}/costs`, `/financials`) need only `ppm.view` and a readable card; invoices need `invoice_access` (= `can_view_costs`). PPM writes (budget lines, cost lines, invoices, status reports, risks, tasks, Gantt) need only the application permission `ppm.manage`, with no check on the card.
- Application and IT Component costs are yearly cost items under `/cards/{id}/costs`; the cost section is hidden (403) without `view_costs`, with no message.
- Application roles with `ppm.manage` on by default: BPM Admin and Member, both also with `inventory.edit`; Viewer has `ppm.view` and no `costs.view`.

## The rule

**Principle.** A card is data in two parts: the **general** part (everything but costs) and the **costs** part. PPM is a **function** working on cards; it grants access to no card by itself. A card the user cannot read does not exist for them (`CardReadScope`), so every other permission applies only on readable cards: `view_costs` or `edit_costs` without `card.view` give nothing, and editing costs needs viewing them. "Readable" means: for the PPM pages and Build cost, `CardReadScope` in `module` mode (what `_get_initiative_or_404` does today); for the card page, `inventory.view` or a stakeholder `card.view`.

**What each function needs** (`card.edit_costs` is written `edit_costs`, `card.view_costs` `view_costs`):

| Function | Permissions required |
|---|---|
| See the card (general data) | `card.view` |
| See the costs of the card | `card.view` + `view_costs` |
| See PPM without costs (status reports, risks, tasks, Gantt) | `card.view` + `ppm.view` |
| See PPM costs (budget, cost items, invoices, amounts) | `card.view` + `view_costs` + `ppm.view` |
| Edit card data | `card.view` + `card.edit` |
| Edit PPM without costs | `card.view` + `card.edit` + `ppm.view` + `ppm.manage` |
| Edit PPM costs | `card.view` + `view_costs` + `edit_costs` + `ppm.view` + `ppm.manage` |
| Build cost report | `ppm.view`; lists only cards with `card.view` + `view_costs` |
| Open the PPM pages | `ppm.view` |

For Application and IT Component the yearly cost items are edited with `card.view` + `view_costs` + `edit_costs`, no PPM.

**Who can do what** (✓ yes, – no):

| Function | Only `view_costs` | Only `edit_costs` | Viewer (`card.view`, `ppm.view`) | Cost Controller (`card.view`, `view_costs`, `edit_costs`, `ppm.view`, `ppm.manage`) | Responsible / PM (all six) |
|---|---|---|---|---|---|
| See card | – | – | ✓ | ✓ | ✓ |
| See PPM without costs | – | – | ✓ | ✓ | ✓ |
| See PPM costs | – | – | – | ✓ | ✓ |
| Edit card data | – | – | – | – | ✓ |
| Edit PPM without costs | – | – | – | – | ✓ |
| Edit PPM costs | – | – | – | ✓ | ✓ |
| Build cost report | – | – | empty state | ✓ | ✓ |
| Open the PPM pages | – | – | ✓ | ✓ | ✓ |

The Cost Controller sees everything of the card and of status reports, risks and Gantt, and edits only the costs. After the change a note goes to the rules on permissions and a learning is saved (owner's request, done at the end, with the owner's yes for each rule file).

## Requirements

- **R21. Cost Controller role.** A new **card-level permission `card.edit_costs`** ("Edit the costs of this card"), separate from `card.edit`, for every card type that carries costs. Editing a card's costs needs the costs to be viewable AND (`costs.edit` at application level, or a stakeholder role with `card.edit_costs`); `card.edit` alone no longer suffices, so an admin can make a role that edits the card but not its costs. `APP_TO_CARD_PERMISSION_MAP` gains `"costs.edit": "card.edit_costs"`; `_can_edit_domain` is not shared with licenses any more (licenses keep their rule). A migration copies each existing role's `card.edit` into `card.edit_costs`, so nothing changes for existing roles (same technique as `card.view_costs`, migration 195); a new `with_legacy_edit_cost_grant` does the same for workspaces exported before this version (threshold = the version that ships it, with an import test of an older bundle). A new stakeholder role **Cost Controller** (key `costController`, `counts_for_quality: true`) is added, through its own list and not `_DEFAULT_ROLES`, to **Initiative, Application and IT Component**: `card.view`, `card.view_costs`, `card.edit_costs` and `card.create_comments` on, everything else off. It reads the card and its PPM data (status reports, risks, Gantt, tasks visible, not editable) and manages costs only. Seed adds it at start-up where missing (existing installs included, no migration for the role), workspace transfer carries it. A role an admin deletes is recreated at restart like every built-in role. Whoever holds `card.manage_stakeholders` can assign it, as for `card.view_costs`. The default `*_CARD_PERMISSIONS` carry `card.edit_costs` equal to `card.edit`.
- **R22. The permission rule, two layers: the application permission opens the function, the card permission says on which cards.** `/cards/{id}/my-permissions` gains `can_edit_costs`, used by the Cost tab and the Manage buttons.
  - **See PPM data**: `ppm.view` AND card readable (`CardReadScope`).
  - **See amounts**: `ppm.view` AND card readable AND cost access on the card (`costs.view`, or a stakeholder role with `card.view_costs`). Build cost and the reports list only such cards.
  - **Manage status reports, risks, tasks, Gantt**: `ppm.manage` AND `card.edit` on the card (backend enforces it, not only the button).
  - **Write budget lines, cost items, invoices**: `ppm.manage` AND cost-edit access on the card (R21). A Cost Controller therefore needs `ppm.view` and `ppm.manage` in its application role.
  - **Amounts withheld**: without cost access the rows stay (description, FY, Provider, dates) and `amount`, `planned`, `actual`, `remaining_*`, totals, subtotals, `/rollup`, calculated values and numeric custom fields are omitted from the response (optional fields in the schema), on every endpoint that carries them (`/costs`, `/financials`, `/budgets`, `/rollup`, the patch and move responses); the cost sections and the Budget & Costs tab are hidden, with no message, exactly as the cost section of an Application or IT Component card is hidden today. Viewers lose the amounts they see today (they have no `costs.view`). Invoices already follow cost access; "invoice access" is the same condition.
  - A Responsible or IT Project Manager keeps seeing and editing the costs of their initiative (default stakeholder roles carry both card permissions, and the user holds the PPM Manager application role); an Observer sees none. **Risk checked in the tests:** a PM with `ppm.manage` who cannot edit the card (no `inventory.edit`, no stakeholder `card.edit`) loses Manage for status reports, risks, tasks and Gantt.
- **R23. How R21 and R22 are built.**
  - **Application role: PPM Manager.** A default **application role "PPM Manager"** (key `ppm_manager`, seed, added where missing): the Viewer's rights (it sees applications, IT components, data and the rest, read only) plus `ppm.manage`; no `inventory.edit`, no `costs.view`, no `costs.edit`. It is the profile of Project Managers and Cost Controllers: they use the PPM function, and what they may do on a card comes from their stakeholder role on it (Responsible or IT Project Manager: manage the project and its costs; Cost Controller: costs only).
  - **Member and BPM Admin leave the PPM and the costs.** The built-in roles `member` and `bpm_admin` lose `ppm.manage` and `costs.view` (they keep `ppm.view`): in the seed defaults and, by the migration, in existing installs (the owner's decision: a local-only installation). Custom roles are not touched. No role gets `costs.edit` from the migration.
  - **Existing stakeholder roles keep their rights.** One migration: copy `card.edit` into `card.edit_costs` for every stakeholder role definition. `costs.edit`'s description (it says stakeholders that can edit a card edit its costs) is rewritten; the new permission's label is English, translated by `/translate`.
  - **Computed like the backend.** `can_edit_costs` in `/cards/{id}/my-permissions` = `can_view_costs` AND (`costs.edit` or `card.edit_costs`), by `PermissionService.can_edit_costs`, never by the union of the permission maps (a View deny on the type must hide the button). `APP_TO_CARD_PERMISSION_MAP` gains `"costs.edit": "card.edit_costs"`.
  - **Gates.** PPM write routes (`api/v1/ppm.py`) add `check_permission(... "inventory.edit", initiative_id, "card.edit")` to every `ppm.manage` gate except budget, cost line, invoice and move routes, which add `can_edit_costs`. `cost_history` follows `can_view_costs` to read and `can_edit_costs` to write (it asks `card.edit` today). `cost`-type fields of a card and of a relation stay on `card.edit`. The configured relation a cost can create (`ppm_field_relations`, today `relations.manage`) is part of the cost write and follows `can_edit_costs`. Task comments: creating follows Manage; the author edits and deletes their own as today.
  - **Amounts withheld.** Invoices are hidden altogether without cost access (as today). Build cost filters the rows; `/reports/ppm/dashboard` and `/gantt` keep the rows and drop the amounts, as today. The stakeholder role is added in the three places of the seed (Initiative's explicit list, `_APP_ROLES`, `_DEFAULT_ROLES` through its own list so other types do not get it).
  - **Frontend.** This PR ships the gates: Manage buttons need `can_edit`, the Cost tab and Manage cost need `can_edit_costs`, the Budget & Costs tab and cost sections are hidden without cost access. Whichever of this PR and part 2's PR A merges second updates the other's buttons.
  - **Tests.** Role by role (the matrix), the migration, import of an older bundle, a PM with `ppm.manage` who cannot edit the card, a View deny on the type, and every endpoint that carries amounts.

## Delivery

One pull request, **E**: permission, roles, migration, the PPM write gates, the backend withholding of amounts, the frontend gates. VAPT runs on it (it touches `permissions.py` and the PPM write routes); OpenAPI is regenerated; one version bump and changelog entry. It ships before parts 2 and 3.

## Agent's calls (check them)

- The permission model and the Cost Controller on Initiative, Application and IT Component are the owner's decisions.
- **Member and BPM Admin lose cost view and PPM Manage** (owner's decision, existing installs included); Project Managers and Cost Controllers use the new PPM Manager application role. Users who were Project Managers with a Member role must be given it. The cost report (`costs.view`) disappears for Member and BPM Admin too.
- Viewers lose the amounts they see today in the initiative's PPM pages (they have no `costs.view`): the rule the owner wrote.
- `cost`-type fields of a card stay on `card.edit`; `cost_history` follows the cost permissions.
- The configured relation of a cost follows `can_edit_costs`, so the Cost Controller needs no `relations.manage`.
- Invoice rows answer 404 (not 403) to a user without cost visibility, by design: the row does not exist for them.
- The notice in the changelog: whoever holds `card.manage_stakeholders` can assign the Cost Controller; a built-in role an admin deletes is recreated at restart.

## Left to the builder

The migration number and file names, the threshold constant for `with_legacy_edit_cost_grant`, and the exact permission label strings.

## Acceptance

- A Cost Controller on an Initiative, an Application and an IT Component can read the card, see and edit its costs, and cannot edit the card; Responsible and IT Project Manager keep their access; an Observer sees no amount in the API response.
- The migration copies `card.edit` into `card.edit_costs` on every stakeholder role definition (existing stakeholder roles keep their cost rights) and removes `ppm.manage` and `costs.view` from the built-in `member` and `bpm_admin` roles; a Member or BPM Admin can no longer see costs or use PPM Manage. The seed adds the stakeholder role and the PPM Manager application role once.
- A PM who cannot edit the card loses Manage for status reports, risks, tasks and Gantt; the Manage buttons and the Cost tab follow `can_edit` and `can_edit_costs`.
- Tests as listed in R23; user manual and nine locales via `/translate`; changelog and version bump.
