# Backlog

Things noticed while working on `fix/cost-report` that are out of scope for it. One entry each: what, why it matters, rough size.

## Extend relations to subtypes

**What.** Relation types are defined between card *types* only (for example Application → ITComponent), never between *subtypes*. Cardinality (`1:1`, `1:n`, `n:m`) is also set per relation type, so it cannot differ by subtype.

**Why it matters.** Found while specifying "Group by linked card" in the cost report (`2026-10-30-cost-report-types-sankey-fullscreen-design.md`): every relation on the instance is `n:m`, so no linked card can be offered as a group. Subtype-level relations and cardinality would let a relation be `n:1` for one subtype only.

**Size.** Believed very high: touches the metamodel, relation validation, every relation writer (`relation_orientation.py`), the metamodel editor, importers, workspace transfer and the UI pickers. Needs its own brainstorm and spec before any estimate.
