---
title: Verify permission revocation with committed writes and separate caches
author: Tom
date: 2026-11-28
branch: feat/visibility-cones-phase-2
id: l-3ab68465
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - VERSION
  - backend/app/api/v1/cards.py
  - backend/app/api/v1/metamodel.py
  - backend/app/api/v1/migration.py
  - backend/app/api/v1/mutation_batches.py
  - backend/app/api/v1/roles.py
  - backend/app/api/v1/servicenow.py
  - backend/app/api/v1/stakeholder_roles.py
  - backend/app/api/v1/stakeholders.py
---

## Decided
Test revocation with two PostgreSQL sessions and commit the writer’s change. Keep the reader’s permission cache warm and separate from the writer’s.

## Tried and ruled out
The normal test fixture leaves rows uncommitted, so a second session cannot see them. A check that clears the reader’s cache can pass even when production keeps stale permissions.

## Watch out
Separate cache dictionaries in one process exercise that behavior, but do not verify a separate worker process.
