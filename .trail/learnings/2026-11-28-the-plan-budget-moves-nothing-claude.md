---
title: The Plan Budget moves nothing, so a Legacy cost can no longer be assigned to a budget from the UI
author: Claude
date: 2026-11-28
branch: feat/initiative-pages-a
id: l-7c1d4e92
scope: repo
status: active
src: agent
touches:
  - frontend/src/features/ppm/PpmFinanceTree.tsx
  - frontend/src/features/ppm/PpmFinancialRowForm.tsx
  - backend/app/schemas/ppm.py
  - ".claude/rules/ppm.md"
---

## Decided

- The Plan Budget tree (`PpmFinanceTree` / `PpmFinancialRowForm`) only creates, edits and deletes. Every move or assign action is gone, "Assign to budget" included: the owner's instruction was "solo crea modifica cancella".
- Accepted consequence: a Legacy Cost Item (one with no budget) can no longer be assigned to a budget from the UI. Spec R10 wanted to keep "Assign"; the owner's instruction superseded it.
- The API still accepts a parent change on PATCH (`PpmCostLineUpdate`, `PpmInvoiceUpdate`). The UI never sends it.

## Tried and ruled out

- Keeping only "Assign to budget" for Legacy costs: dropped, because it is still a move.

## Watch out

- If someone brings the move back because it looks missing, it was removed on purpose. Ask the owner how Legacy costs should be handled before doing it.

In the code: `frontend/src/features/ppm/PpmFinanceTree.tsx`, `frontend/src/features/ppm/PpmFinancialRowForm.tsx`, `backend/app/schemas/ppm.py`, `.claude/rules/ppm.md`.
