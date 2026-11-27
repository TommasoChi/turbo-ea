---
title: "Member and BPM Admin lost PPM Manage, cost view and Manage stakeholders together, because each right reopened the others"
author: Tom
date: 2026-11-27
branch: feat/cost-controller-permissions
cost: { minutes: 1074, tokens: 1848275 }
id: l-2f3cd3c8
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - docs/superpowers/specs/2026-11-26-cost-controller-permissions-design.md
  - backend/app/services/survey_apply.py
  - docs/guide/inventory.md
  - backend/alembic/versions/202_edit_costs_permission.py
  - backend/app/core/permissions.py
  - backend/app/api/v1/stakeholders.py
  - docs/superpowers/plans/2026-11-26-cost-controller-permissions-status.md
  - backend/app/api/v1/relations.py
  - backend/app/api/v1/cards.py
---

## Decided
The built-in Member and BPM Admin lose ppm.manage and costs.view (migration 202) and stakeholders.manage (migration 203), on existing installs too, also where an admin had granted them on purpose. A downgrade does not restore them. A project manager who was a Member now needs the PPM Manager application role.
The owner kept three things out of the PR that gates cost writes on card.edit_costs:
1. Cost attributes on relations still follow can_view_costs of the source card, not can_edit_costs: they are relation fields, not card fields, and the spec never named them.
2. PATCH /cards/bulk loads and returns cards without CardReadScope (a type with a View deny answers 403, not 404): pre-existing, another theme (which cards exist for you, not which fields), and a change to the read scope of the whole bulk edit risks regressions. It is a separate PR (backlog E49).
3. Applying a survey response without the right to edit costs marks the response applied and silently keeps the stored cost; the owner chose not to add a warning to errors, to keep the apply response unchanged.
A workspace bundle replaces the permissions of every application role it names, so a bundle exported before migrations 202 and 203 gives Member and BPM Admin back ppm.manage, costs.view and stakeholders.manage. The owner accepted it: admin.import_workspace can already write any permission, and view_costs behaves the same way. The legacy grant of card.edit_costs (each stakeholder role gets what it had in card.edit) applies when no stakeholder-role row in the bundle carries the key; a bundle with no usable app_version, such as a content pack, gets none.

## Tried and ruled out
Removing only ppm.manage and costs.view. A Member holding stakeholders.manage could assign themselves the Cost Controller stakeholder role on an Application or IT Component and get back the cost view and edit that 202 had removed; the security review found it. Blocking that one assignment in the stakeholder routes (refuse roles carrying card.view_costs or card.edit_costs to someone without cost access) was the narrower option; the owner chose to take stakeholders.manage away instead, knowing a Member can then no longer assign any stakeholder.
Closing all three in the same PR: it would have widened a security PR with behaviour the spec does not describe. Survey respond/responses did leak cost values to readers without cost view; that one WAS closed here because it is the theme of the PR (amounts must not reach users without cost access).
A version threshold for the legacy grant (the PR's own version number): if main ships another release before the PR merges, the threshold falls behind and a bundle exported by that intermediate release silently loses cost editing on every role it brings. Every row exported after migration 202 carries the key, so reading the content is exact. Also ruled out: applying the 202 and 203 revocation to the Member and BPM Admin rows of older bundles. It ties the fix to a version number and erases choices an admin made on purpose.

## Watch out
A custom role, or a stakeholder role holding card.manage_stakeholders, can still assign itself the Cost Controller: accepted. Rights that gate each other must be removed as a set: check what a right to assign roles can give back before removing a right it feeds.

In the code: backend/alembic/versions/202_edit_costs_permission.py, 203_member_loses_stakeholders_manage.py; MEMBER_PERMISSIONS and BPM_ADMIN_PERMISSIONS in backend/app/core/permissions.py; stakeholders POST in backend/app/api/v1/stakeholders.py.
Someone who can view an Initiative's costs but not edit them can still change a cost attribute on its relations. The static read-scope guard does not catch the bulk gap, because cards.py references the scope elsewhere.

In the code: keep_stored_cost_values on relations in backend/app/api/v1/relations.py and card_write_service; bulk_update in backend/app/api/v1/cards.py; apply_response in backend/app/services/survey_apply.py; tests/services/test_card_read_scope_guard.py.
Importing an old bundle reopens the rights the migrations removed, including stakeholders.manage, which reopens the Cost Controller self-assignment.

In the code: _predates_edit_costs and with_legacy_edit_cost_grant in backend/app/services/workspace_io/applier.py; tests/services/test_workspace_io_legacy_edit_costs.py.
