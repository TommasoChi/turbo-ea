# VAPT — Licensing core surface (feat/licensing-core)

**Date:** 2026-11-06
**Target:** local deploy instance only — `http://localhost:8920` (docker compose project `software/turbo-ea-conf`), running the `feat/licensing-core` images (alembic 178). No other host was contacted.
**Scope:** the new licensing surface — `GET /cards/{id}/licenses`, `GET .../{fy}`, `PUT/DELETE .../{fy}/items/{metric}/{key}`, `POST .../{fy}/confirm`, `POST .../items/{metric}/{key}/copy-to-forecast`, `/metamodel/license-types` (GET/POST/PATCH), `GET /reports/licensing`, `POST /licenses/import?dry_run=`, saved reports of type `licensing`, workspace transfer of `CardLicenses` / `LicenseTypes`, redaction of `card.licenses_updated` events.
**Tier:** Medium. No AI/Ollama. Rate limiting out of scope.
**Accounts:** `vapt-admin`, `vapt-member`, `vapt-viewer` (`turbo-ea-vapt/accounts.md`), re-enabled by the coordinator with the user's authorisation for this pass. Read-scope tests used three throwaway roles reached through admin role impersonation (`POST /auth/impersonate`), so no existing role or user was changed.

## Summary

Two Low findings, six informational notes, no High or Medium. Every permission, read-scope, IDOR, input and file-handling test behaved as the spec intends:

- hidden card is 404 before any 403;
- viewer and member writes are 403;
- the import refuses wrong, empty, disguised, bombed, oversized and XXE files;
- license counts never reach a reader without license access through any event feed;
- card names and license-type labels are escaped on every rendered surface checked.

| # | Severity | Finding |
|---|---|---|
| LOW-1 | Low | `DELETE` of a cell ignores the write window: it edits a year that `PUT` and `confirm` refuse |
| LOW-2 | Low | A public `licensing` saved report gives its thumbnail and config, including a hidden card's id, to users without `licenses.view` or without read access to that card |
| INFO-1 | Info | Per-year `GET` serves any year 1900–2200 |
| INFO-2 | Info | Path `fiscal_year` accepts `2026.0` as 2026 |
| INFO-3 | Info | `GET /reports/licensing` has no `license_type` parameter; it is silently ignored |
| INFO-4 | Info | Writes accept `current-5` (2021), but the section and report start at `current-4` |
| INFO-5 | Info | License-type catalogue readable by any signed-in user (by design) |
| INFO-6 | Info | Report rows echo card `attributes` minus cost keys (by design) |

---

## Findings

### LOW-1 — `DELETE /cards/{id}/licenses/{fy}/items/{metric}/{key}` bypasses the write window

- **Where:** `backend/app/services/card_licenses.py::delete_cell`. It has no `yearly_rows.in_window` check, while `merge_cell` (PUT, copy, import) and `confirm_year` have one. The cost twin `card_costs.delete_item` has the same gap, so the licensing code inherited it.
- **Reproduction** (admin, own test card, fiscal year 2019 = `current-7`, row seeded with psql because the API cannot write it):
  - `GET .../licenses/2019` → 200, cell `vaptlic {licensed: 50, actual: 40}`
  - `PUT .../licenses/2019/items/users/vaptlic {"licensed":1}` → **422 `year_out_of_range`**
  - `DELETE .../licenses/2019/items/users/vaptlic` → **204**; the row's `items` became `{}` and a `card.licenses_updated` event for FY2019 was published.
- **Expected vs actual:** a year outside `current-5 … current+1` is read-only for every write, as the spec and `cost-items.md` describe. Actual: DELETE edits it.
- **Impact:** a user with `licenses.edit`, or a `card.edit` stakeholder on the card, can erase historical counts that no other path can rewrite. Rows outside the window exist on any instance older than five years, and workspace imports can bring them in. Integrity only: it is not a privilege escalation.
- **Suggested fix:** in `delete_cell`, raise `LicenseError("year_out_of_range")` when the year is outside `in_window`, before resolving. Add a regression test with an out-of-window row. Apply the same fix to `card_costs.delete_item`.

### LOW-2 — Public `licensing` saved reports leak thumbnail and config past `licenses.view` and `CardReadScope`

- **Where:** `backend/app/api/v1/saved_reports.py` (`list_saved_reports`, `_serialize`). The list returns `config` and `thumbnail` for every own, shared or public report, with no check on the report type's permission and no read-scope filter on card ids inside `config`. This is a pre-existing saved-reports pattern (cost reports behave the same way); `licensing` was newly added to `VALID_REPORT_TYPES`.
- **Reproduction:**
  1. Admin `POST /saved-reports` with `report_type: licensing`, `visibility: public`, `config.cardId = <test card>` and a PNG data-URL thumbnail → 201.
  2. `vapt-viewer` (role `viewer`, `licenses.view = false`) `GET /saved-reports` → the report, `thumbnail` present, `config.cardId` present. `GET /reports/licensing` for the same viewer is 403.
  3. A role with an explicit View deny on Application (impersonated) `GET /saved-reports` → `config.cardId` is the id of an Application card it cannot read; that card is 404 everywhere else.
  4. `vapt-viewer` `POST /saved-reports` (licensing) → 403: creation is correctly gated.
- **Expected vs actual:** the spec gates the report on `licenses.view`, and `CardReadScope` says a hidden card's id appears in no payload. Actual: the saved-report list gives the thumbnail (a picture of license counts) and hidden card ids to such readers.
- **Impact:** low. Someone with `licenses.view` must first publish the report. The image shows license counts to a reader who is not allowed to see them, and a hidden card's id leaks, but not its name.
- **Suggested fix:** when listing or reading saved reports, drop (or withhold `thumbnail` and `config` for) reports whose type needs a permission the caller lacks (`licensing` needs `licenses.view`, `cost` needs `costs.view`). Scrub card ids in `config` that `CardReadScope` hides. One helper can serve every gated report type.

### INFO-1 — the per-year read accepts any year from 1900 to 2200

`GET /cards/{id}/licenses/1900` and `.../2200` → 200 with an empty year. This is wider than the section window, but it only returns data for a card the caller may already read, so it is harmless. Optionally reject years outside `current-5 … current+1`.

### INFO-2 — `fiscal_year` path value `2026.0` is read as 2026

`PUT .../licenses/2026.0/items/users/vaptlic` → 200 and writes FY2026, because Pydantic's lax integer parsing accepts it. No security impact. Use `StrictInt`, or leave it as is.

### INFO-3 — the report has no `license_type` query parameter

`GET /reports/licensing?license_type=vaptlic` → 200, and the parameter is ignored: the license-type filter runs in the client. This matches the spec's single response that carries every type. It is listed only because the test brief named the parameter.

### INFO-4 — writes accept `current-5`, the section and the report start at `current-4`

`PUT .../2021/...` → 200, but `GET /reports/licensing?fiscal_year=2021` → 400 `fiscal_year_out_of_range`, and the section window starts at 2022. Data written for `current-5` can therefore be read only through the per-year `GET`. This follows the cost design (`cost-items.md`); it is noted for awareness.

### INFO-5 — `GET /metamodel/license-types` is open to any signed-in user

Confirmed for viewer and member (200). This deviation was decided at plan review because the card section needs the labels. The catalogue holds reference data only, never counts.

### INFO-6 — report rows echo `attributes`, with cost keys removed when the caller lacks `costs.view`

Confirmed: admin rows carry `costTotalAnnual`; a role holding `licenses.view` but not `costs.view` gets `['hierarchyLevel', 'licensingModel']` only, and `costTotalAnnual` appears nowhere in its response. This is the same rule as the cost report.

---

## What was tested and passed

### Permissions and IDOR (vertical and horizontal)

| Test | Expected | Result |
|---|---|---|
| viewer `GET` section / year (no `licenses.view`, no stakeholder role) | 403 | 403 |
| viewer and member `PUT`, `DELETE`, `confirm`, `copy-to-forecast` | 403 | 403; the stored cell was unchanged after the attempts |
| member `GET` section / year (`licenses.view` by default) | 200, `can_edit: false` | as expected |
| viewer and member `POST` / `PATCH /metamodel/license-types` | 403 | 403 |
| viewer and member `GET /metamodel/license-types` | 200 (by design) | 200 |
| viewer `GET /reports/licensing` (with and without `card_id`) | 403 | 403; member 200 |
| viewer and member `POST /licenses/import` (dry run and apply) | 403 | 403 |
| viewer as `observer` stakeholder on card B: read B / write B / read A | 200 / 403 / 403 | as expected |
| member as `responsible` (`card.edit`) stakeholder on B: write B / write A | 200 / 403 | as expected |
| admin `/events` vs viewer / member `/events` | 200 / 403 | as expected |
| viewer `/admin/workspace/export` and `/import` | 403 | 403 |

### Hidden card (explicit View deny on Application, through an impersonated role) and 403/404 order

| Test | Expected | Result |
|---|---|---|
| role without `licenses.view`: hidden App card `GET` section / year / `PUT` | 404 (not 403) | 404 |
| same role: visible ITComponent card `GET` | 403 | 403 |
| role with `licenses.view` + `licenses.edit`: hidden card `GET`, `PUT`, `DELETE`, `confirm`, `copy-to-forecast` | 404 | 404 on all |
| same role: `GET /reports/licensing?card_id=<hidden>` | 404 | 404 |
| same role: `type=Application` report | the hidden card in no row and no trend | 0 rows, id absent |
| same role: Platform aggregate linked to the hidden App and a visible ITC | ITC only | ITC only; the hidden id is absent from rows and trend (admin sees both) |
| same role: hidden card history | 404 | 404 |
| same role: import naming the hidden card | `card_not_found`, no hint that it exists | `card_not_found`; a same-named visible ITC matched instead of `ambiguous_card`, which is correct |

### Input validation (admin, own test card)

All of the following are rejected as listed, and none caused a 500:

- **Counts:** `licensed` `-1`, `1.5`, `"10"`, `true`, `1000000001`, `1e20`, missing or `null`; `actual` `-1`, `2.5`, `"x"`; a JSON list body; a non-JSON body → all 422.
- **Forecast year (2027):** an `actual` value → 422 `forecast_actual`; licensed only → 200.
- **Years:** 2020 and 2028 → 422 `year_out_of_range`; 1899, 2201, `-1`, `abc` and `99999999999999999999` → 422 from the path validator.
- **Metric and key:** `Users`, `users;drop`, `1abc`, a 65-character key, `ad-min` and `vapt'lic` → 422 from the pattern; `nokey` → 422 `unknown_type`.
- **Archived type:** a new cell on an archived type → 409 `archived_type`.
- **Copy to forecast:** copying from the Forecast year → 422; copying a cell that does not exist → 422 `unknown_type`.
- **`confirm`:** an out-of-window year → 422.
- **Malformed ids:** a non-UUID, `' OR 1=1--` and a truncated UUID → 404 `Not found`. A nil UUID → 404. A Platform card's id → 404, so the route does not reveal that the card exists without licenses. `%00` → 400 from nginx.
- **Report parameters:**
  - `fiscal_year=2027` → 400 `forecast_not_selectable`; `2020` → 400; `abc`, `1899` and `2201` → 422.
  - a bad `metric` → 400; `type=Platform` and `type=<script>` → 400, the value echoed in JSON only.
  - `group_by` on a multi-select field, on an n:m relation or with an SQL-like string → 400 with a clear message.
  - `card_id` as a non-UUID or a nil UUID → 404; `card_id` of a BusinessCapability card → 400.

### Import (`POST /licenses/import`)

| Case | Result |
|---|---|
| CSV named `.csv` | 400 "not a valid .xlsx workbook" |
| xlsx bytes named `.csv`; plain text and HTML named `.xlsx` | 400 "File content does not match its extension" |
| empty file | 400 "File is empty" |
| a zip that holds no workbook | 400 |
| zip bomb: a 61 KB file declaring a 60 MB sheet | 400 "declares 62914560 bytes; the limit is 50 MB" |
| 21 MB file | 413 from nginx |
| missing columns; header only; 10,001 rows | 400 with a clear message |
| `dry_run=maybe` | 422 |
| XXE (`<!DOCTYPE … SYSTEM "file:///etc/hostname">` in the sheet XML) | 400, nothing echoed. The control file (same rewrite, no DOCTYPE) parses with 200, so the DOCTYPE caused the refusal. The backend's `openpyxl.xml.DEFUSEDXML` is `True` |
| row rules in one file | ambiguous name → `ambiguous_card`; the same cell twice → `duplicate_cell` (both rows); Forecast year with actual → `forecast_actual`; archived type on a new cell → `archived_license_type`; unknown type → `unknown_license_type`; `abc` and an out-of-window year → `invalid_year`; `-3`, `1.5` and `10^12` → `invalid_number`; bad metric → `invalid_metric`; the string `"12"` is accepted; a formula in Actual (`=1+1`, no cached value) reads as empty and leaves the value unchanged; a `=HYPERLINK(…)` Component is read as empty (`card_not_found`) and is never evaluated; a label match ignores case |
| dry run | `applied: 0`; stored data unchanged (before and after compared) |
| apply | `applied: 3`, exactly the matched cells; the target cell reads back as written |
| caller without `licenses.edit` | 403 |

### Event redaction (`card.licenses_updated`)

- **Card history:**
  - admin and member (`licenses.view`) see `changes.license_types` and the summary with type labels.
  - viewer (no license access) sees the event, but `changes` is `{}` and the summary carries no type names: "Licensing of … changed (FY26)".
  - viewer as a stakeholder on card B sees B's keys, as allowed per card.
- **Dashboard (`/reports/dashboard`):** viewer gets 13 license events; the only ones that keep keys belong to card B, where the viewer is a stakeholder. None on card A keep them.
- **My cards (`/events/my-cards`):** viewer and member see events only for cards where they hold a stakeholder role, with keys allowed.
- **`/events` and `/reports/admin-dashboard`:** 403 for viewer.
- **SSE (`/events/stream`):** a non-admin gets only user-directed events, so `card.licenses_updated` reached neither the viewer nor the writer itself. The writer was vapt-admin impersonating a role without `licenses.view` and holding the `responsible` stakeholder role on the card; its own write produced no stream message. License data never reaches a non-admin over SSE; `reader_drop_keys` would strip it if a future change routed the event there.

### Saved reports and workspace transfer

- **Saved reports:** a viewer cannot create a `licensing` report (403); an invalid `report_type` → 400; for the list, see LOW-2.
- **Workspace export (admin):** the bundle holds `LicenseTypes` (9 rows during the test, header `key, label, sort_order, archived, translations`) and `CardLicenses` (16 rows, card refs by id and type).
- **Workspace import preview** of that same bundle: `CardLicenses` 16 skipped as `already_present`, `LicenseTypes` 9 `identical`, 0 errors. Nothing was applied and the transfer was cancelled (DELETE → 204).

### Rendered-page XSS (browser pane, local instance)

Test card name: `VAPT-LIC <img src=x onerror=alert(1)>"'><svg/onload=alert(2)>`. Test type label: `VL <img src=x onerror=alert(3)>`.

- **API:** returns the raw strings in JSON, as designed (report rows, import `component`, history summary).
- **Card page:** the payload renders as text in the title and the Licensing section; the DOM holds no `img[src=x]` and no `svg[onload]`.
- **Utilisation tooltip:** the name is escaped (`&lt;img`), consistent with commit `5821cff9`.
- **Table view:** the name is escaped in `licensing-row-name`.
- **Trend tooltip:** the license-type label is escaped (`&lt;img`).
- No dialog fired, and no injected element was found on any of these views.
- A static check found that the only custom tooltip formatter in the licensing frontend (`licensingUtilisationOption.ts`) uses `escapeHtml`, and no `dangerouslySetInnerHTML` is used.

### Unauthenticated perimeter (first run)

All 14 probes of the licensing routes return 401 (404 for a `..` key after nginx normalises the path), and none returns a 500.

### Code-level review

- **Read and edit gates:** read scope first, then the per-card permission.
- **Import:** parsing runs off the DB session; the import matches cards through `CardReadScope`.
- **Writes:** they lock the year row with `FOR UPDATE` and never commit inside the service.
- **No raw SQL** on the licensing surface; SQL injection is not reachable by construction.
- **Event payloads** carry license-type keys, never counts.

---

## Not tested

- **nikto, ZAP and sqlmap:** skipped. The README runs them through the compose `vapt` profile against `nginx:8080`, not as a one-liner against `localhost:8920`, and the brief said to skip them in that case.
- **CSRF on the new state-changing routes:** not exercised. They use the same cookie and auth stack as every other route, so this is out of the licensing scope.
- **Billion-laughs entity expansion:** inconclusive. The test file's entity did not land in the cell. Protection rests on `DEFUSEDXML = True` plus the XXE result above.
- **Formula (CSV) injection in the client-side XLSX export of the table:** the export is built in the browser by `extractSheetsFromDOM` and was not exercised.
- **Workspace import apply:** deliberately not run, to avoid altering instance data; only the preview was run.
- **Dependency and supply-chain bucket:** no new dependency in this branch (`openpyxl` was already present).

---

## Cleanup ledger (all deleted or reverted)

| Item | Ids | Removed by |
|---|---|---|
| License types `vaptlic`, `vaptarch` | `71848944-67c4-45da-a8ee-a08e65968547`, `febb953d-a2ed-4a4a-9ca8-0817a5b5f04f` | psql `DELETE … WHERE id IN (…) AND key IN (…)` (no delete API: the catalogue is "never deleted") |
| Cards: App (XSS name), App `VAPT-LIC-2`, App `VAPT Dup`, ITC `VAPT Dup`, Platform `VAPT-LIC-PLATFORM` | `5969b532-2a94-4e87-a9a6-94e380c66548`, `90b19947-b0c6-4542-be8f-860f7de0ee14`, `87bdaecc-cbdc-4449-968c-114790079885`, `2ec35118-579e-4287-acd7-0f04db9b43e0`, `a961ed9f-cacf-4325-98e5-652d39134869` | API `DELETE /cards/{id}` (permanent). Their `card_licenses` rows (including the psql-seeded FY2019 row `d7b26855-c2d3-48f1-8650-76d29304fa84`) and the `card_costs` row cascaded: 0 left |
| Relations `relPlatformToApp`, `relPlatformToITC` | `33841c82-cd9b-4546-a797-d6d1fbd5c9c4`, `eef95777-019e-4bb1-920f-0a2431e55e75` | API `DELETE /relations/{id}` |
| Stakeholders (viewer observer, member responsible, admin responsible, all on `VAPT-LIC-2`) | `4b1ec697-0751-4796-afde-a2a1e721066f`, `66fba6dc-2b7d-4d93-bdce-f836c898a827`, `4686d1b6-5fbc-4925-9b4b-379e514c62c1` | API `DELETE /stakeholders/{id}` |
| Roles `vaptlichid`, `vaptlichidlic`, `vaptlicnocost` | by key | API archive, then psql `DELETE FROM roles WHERE key IN (…)` (no delete API) |
| Application `role_permissions` deny cells | was `{}` | API `PATCH /metamodel/types/Application {"role_permissions": {}}`; verified `{}` |
| Saved report (public licensing) | `562743af-e41c-49d9-9aa7-6e178485605b` | API `DELETE /saved-reports/{id}` |
| Workspace import transfer (preview only) | `1411a033-1d69-4257-b07f-9fd0d65929f6` | API `DELETE /admin/workspace/import/{id}`; 0 rows left |
| Browser pane session | vapt-admin | `POST /auth/logout` |

**Left in place on purpose:**

- **Event rows** written by the test (created in the last two hours): `card.licenses_updated` 14, `card.created` 5, `card.deleted` 5, `relation.created` 4, `relation.deleted` 4, `stakeholder.added` 3, `stakeholder.removed` 3, `card.costs_updated` 1.
- **Audit-log entries** for the license-type, role and metamodel admin actions.
- **No notifications** were left for the vapt users.
- **Login trail:** failed-login attempts from the first run (`admin@prova.com`, `viewer@prova.com`, `vapt-member` × 1 each) and the logins of this run.
- **`vapt-admin`, `vapt-member`, `vapt-viewer` are still `is_active = true`.** The coordinator resets them after this report, as agreed; this pass did not change them.

## Before / after proof

| table | before | after |
|---|---|---|
| cards | 661 | 661 |
| card_licenses | 8 | 8 |
| license_types | 7 | 7 |
| users | 9 | 9 |
| roles | 5 | 5 |
| stakeholders | 22 | 22 |
| saved_reports | 0 | 0 |
| relations | 706 | 706 |

The 8 pre-existing `card_licenses` rows (`id | card_id | fiscal_year | items`, ordered by id) are byte-identical before and after: `diff` is empty and both dumps have md5 `3e1686bb0c5f731d8f8b5411f80a7136`. The 7 license types are unchanged (`utenti, admin, user, non_prod, prod, macchine, installetion`, same labels, order and archived flags). The pre-VAPT backup was not touched.
