---
title: Check whether a surviving ORM join mutant is equivalent
author: Tom
date: 2026-11-27
branch: feat/visibility-cones-phase-2
id: l-804c3e23
scope: repo
status: active
src: agent
---

## Decided

When removing an explicit SQLAlchemy ON clause leaves the same join through a single foreign key, verify the compiled condition and retain the existing permission tests. Prefer removing the redundant clause over adding a test that only checks SQL spelling or a mutation suppression. Check the module-specific floor even when the aggregate mutation score passes.

## Tried and ruled out

A test that only checks SQL spelling cannot distinguish an authorization regression because both forms produce the same join. The existing scoped tests are the behavior check.

## Watch out

In the code: `Stakeholder.card_id` is the sole foreign key from Stakeholder to Card. On PR #95, two equivalent survivors left the aggregate score at 97.2% while `permission_service.py` fell below its 98% floor at 96.7%. Verify the foreign key remains unambiguous before applying this simplification elsewhere.
