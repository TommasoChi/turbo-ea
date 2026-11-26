---
title: A transfer section matched by natural key must remap its ids before the match; a wiped-inventory test never reaches that branch
author: Tom
date: 2026-11-26
branch: feat/cost-provider-and-filters
cost: { minutes: 180, tokens: 841533 }
id: l-0802a74d
scope: repo
status: active
src: agent
touches:
  - backend/app/api/v1/card_costs.py
  - backend/app/services/cost_filters.py
  - backend/app/services/cost_providers.py
  - backend/app/services/cost_report.py
  - backend/tests/api/test_card_costs_api.py
  - backend/tests/api/test_read_scope_sentinel_sweep.py
  - backend/tests/api/test_reports_cost_filters.py
  - backend/tests/services/test_cost_filters.py
  - backend/tests/services/test_cost_providers.py
  - backend/app/api/v1/reports.py
---

## Decided
The workspace applier now runs a section's `rewrite` on the row's values before it compares them with an existing row found by natural key. CardCosts was the first section to have both a natural key and ids inside a blob (the provider id of a cost item): the match branch copied the source values and moved on, so a foreign provider id landed on the target's own cost row.

## Tried and ruled out
A round-trip test that wipes the inventory first. Every row is then created and never matched, so it passes with the bug in place.

## Watch out
The regression test needs a target that already holds the matched card and a (card, year) cost row under another primary key. The next section that gets both a natural key and ids in a blob needs the same kind of test.

In the code: backend/app/services/workspace_io/entities.py (natural-key branch of apply_entity_section), backend/tests/services/test_workspace_io_id_remap.py::test_import_over_an_existing_cost_row_under_another_pk_still_remaps_the_provider.
