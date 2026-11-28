---
title: The translator and docs-keeper run on Haiku by the owner's decision
author: Claude
date: 2026-11-28
branch: chore/agent-models
---

## Decided
- From 2026-11-28 every review agent runs on Opus with effort high, the development agents on Sonnet with effort medium, and the translator (`/translate`) and docs-keeper on Haiku with effort medium. The owner overrode the earlier choice of Sonnet for the translator.

## Watch out
- No test checks that French calls a card « fiche » and not « carte » in manual pages or seed translations: `check_locales.py apply` flags « carte » only in UI JSON values. Read the first Haiku `/translate` output by hand.
- The guard test pins the model of the translator only. Moving any other agent to another model or effort, or letting the SETUP.md agent table drift from the frontmatter, fails nothing.

In the code: `.claude/agents/*.md` frontmatter (`model`, `effort`), `.claude/skills/translate/SKILL.md`, `backend/tests/services/test_agent_instructions_budget.py`, `scripts/i18n/check_locales.py` (`fr_carte_violation`).
