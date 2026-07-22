"""Sync ProcessElement EA links to the relations table.

When a user links an Application, DataObject, or ITComponent to a process
element, the corresponding EA relation should also exist in the `relations`
table so it shows up in the Relations tab, reports, and dependency graphs.
These three are neutral "uses/references" relations, so auto-syncing an
element-level link up to the process level is harmless and expected.

This module provides a single helper that ensures relations exist (additive
only — never auto-deletes, since the relation may have been created
independently).

Deliberately NOT included: Organization. `relProcessToOrg` ("is owned by")
carries a *governance/ownership* meaning at the process level — who is
accountable for the process as a whole — which is a different concept from
"this organization participates in one specific step"
(process_element_organizations). Auto-creating an ownership relation just
because someone linked an org to a single step would misrepresent
accountability, so Organization element-links are NOT synced here.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.relation import Relation

# Mapping from ProcessElement FK field → relation type key.
# All three have source = BusinessProcess, target = the linked type.
# Organization is intentionally absent — see the module docstring.
ELEMENT_LINK_RELATION_MAP: dict[str, str] = {
    "application_id": "relProcessToApp",
    "data_object_id": "relProcessToDataObj",
    "it_component_id": "relProcessToITC",
}


async def sync_element_relations(
    db: AsyncSession,
    process_id: uuid.UUID,
    linked_ids: dict[str, set[uuid.UUID]],
) -> int:
    """Ensure relations exist between a BusinessProcess and linked cards.

    Args:
        db: Async database session (caller is responsible for commit).
        process_id: The BusinessProcess card UUID.
        linked_ids: Dict mapping element FK field name to a set of target
                    card UUIDs.  e.g.
                    {"application_id": {uuid1, uuid2}, "data_object_id": {uuid3}}

    Returns:
        Number of new relations created.
    """
    created = 0

    for field, target_ids in linked_ids.items():
        rel_type = ELEMENT_LINK_RELATION_MAP.get(field)
        if not rel_type or not target_ids:
            continue

        # Load existing relations of this type for this process in one query
        existing = await db.execute(
            select(Relation.target_id).where(
                Relation.type == rel_type,
                Relation.source_id == process_id,
                Relation.target_id.in_(target_ids),
            )
        )
        already_linked = {row[0] for row in existing.all()}

        for tid in target_ids:
            if tid not in already_linked:
                db.add(
                    Relation(
                        type=rel_type,
                        source_id=process_id,
                        target_id=tid,
                        description="Auto-created from process flow element table",
                    )
                )
                created += 1

    return created
