---
type: "query"
date: "2026-07-30T00:07:07.476773+00:00"
question: "Come deve essere implementata una extension Turbo EA e quali bridge backend G1 servono alla Product SWOT?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["Extension SDK", "EventBus", "PermissionService", "Document", "FileAttachment", "Notification"]
---

# Q: Come deve essere implementata una extension Turbo EA e quali bridge backend G1 servono alla Product SWOT?

## Answer

Expanded from original query via graph vocabulary: [extension, sdk, event, notification, document, permission, relation, card]. Turbo EA backend SDK 1.2 exposes extension_context(key) with a permission-shaped read-only Core Query Gateway, EventBus-backed generic audit, generic link/file resources, and in-app notifications. Bridge mutations join the request AsyncSession and never commit. There is no native Card, relation, Risk, Objective, or Initiative write bridge. Migration 128 adds entity_type/entity_id to audit and exactly-one Card-or-generic ownership to documents and file attachments. Compatibility requires equal major and extension minor less than or equal to core minor. Full backend tests, Ruff, Docker rebuild, Alembic 128 and runtime health all passed.

## Outcome

- Signal: useful

## Source Nodes

- Extension SDK
- EventBus
- PermissionService
- Document
- FileAttachment
- Notification