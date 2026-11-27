# Status of the cost-controller work (hand-off notes, 2026-11-27)

Branch `feat/cost-controller-permissions` (from `main` 77881d477, VERSION bumped to 2.215.0). This file is a snapshot for whoever continues; delete it before the PR.

## Read first
- Specs (three parts, plus mockups): `docs/superpowers/specs/2026-11-26-cost-controller-permissions-design.md` (part 1, this branch's PR "E"), `2026-11-26-initiative-pages-design.md` (part 2, PRs A and B), `2026-11-26-build-cost-report-design.md` (part 3, PRs C and D), `2026-11-26-initiatives-improvements-mockups/` (three static HTML mockups, open the files directly).
- Plan of PR E: `docs/superpowers/plans/2026-11-26-cost-controller-permissions.md` (10 tasks).

## Done on this branch (PR E)
Tasks 1-9 implemented and reviewed (task review plus fix rounds), Task 10 docs, version, changelog, translations (nine locales) and the strict manual build done. Highlights: `card.edit_costs`, Cost Controller stakeholder role (Initiative, Application, IT Component), `ppm_manager` application role, migration 202 (Member and BPM Admin lose `ppm.manage` and `costs.view`), PPM write gates (manage = ppm.view + ppm.manage + card edit; cost write = ppm.view + ppm.manage + can_edit_costs), amounts withheld (keys absent) without cost access, cost history and configured relations follow the cost permissions, frontend gates fail closed.

## Still to do before opening the PR (project rules in `CLAUDE.md`)
1. Full backend suite: `./scripts/test.sh` (from the repo root, paths without a `backend/` prefix). It was started and its result is not known: check `.superpowers/sdd/2026-11-26-cost-controller-permissions/full-backend.log` if it exists. Known unrelated failure on Windows: `test_an_older_bundle_dates_only_the_signed_decisions_it_created_in_utc` (`time.tzset`).
2. Full frontend suite: `cd frontend && npm run test:run`. Known flaky under load: `PpmRiskTab` "creates a risk" (passes alone).
3. Review chain, fresh agents each: `code-simplifier`, then `code-reviewer`, then `security-reviewer`; apply every finding including Minor, each with its test.
4. `vapt` agent on the isolated stack (`.claude/agents/vapt.md`): required because `permissions.py` and the PPM routes changed.
5. Rules that now drift from the code (ask the owner for an explicit yes for each file, show the exact lines first): `.claude/rules/ppm.md` ("ppm.manage write: admin, bpm_admin, member"), `.claude/rules/cost-items.md` (editing needs a stakeholder with `card.edit`; it is now `card.edit_costs`), `.claude/rules/workspace-transfer.md` (note: a bundle replaces the permissions of an existing role, so an old bundle's grant can overwrite a target admin's explicit `card.edit_costs`; same semantics as `view_costs`), permissions rules.
6. Save a learning (`trail note`, owner's yes first): the two-layer rule (application permission opens the function, card permission says on which cards), why "ppm.manage OR card.edit_costs" was dropped, why Member and BPM Admin lost PPM and costs.
7. Open the PR with `.github/pull_request_template.md`; Test Plan names the existing tests updated in Task 6 and Task 8 and the invoice 404 decision.

## Decisions to remember
- Invoice routes answer 404 (not 403) without cost visibility, by design.
- A bundle or content pack with no usable `app_version` gets no legacy `card.edit_costs` grant.
- Comment moderation needs `ppm.manage` and `card.edit`.
- Gantt rows without cost access omit `capex_*`/`opex_*` (frontend tolerates it).
- `PPM Manager` application role is not translated (no seed translations for application roles).

## Cautions
- Never use `git stash` or `git reset --hard`: the repo has the owner's unrelated old stashes (an agent once popped one).
- `.mutnightly2/` is an untracked old folder of the owner: leave it.
- Pending after E: parts 2 and 3 need their own plans (`writing-plans`), then PRs A, B, C, D in that order of preference (A and B can run in parallel after E; C needs E; D needs C).
