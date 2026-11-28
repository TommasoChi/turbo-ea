"""Read current Organization positions for per-card inherited grants."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.postgresql import array
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.card import Card
from app.models.stakeholder import Stakeholder
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.models.user import User


async def organization_cones_enabled(db: AsyncSession) -> bool:
    """Phase 2 cannot activate inheritance in deployed requests."""
    return False


def valid_organization_positions():
    root = aliased(Card)
    valid = (
        select(root.id.label("id"))
        .where(
            root.type == "Organization",
            root.status == "ACTIVE",
            root.organization_cone_state == "connected",
            root.parent_id.is_(None),
        )
        .cte("valid_positions", recursive=True)
    )
    child = aliased(Card)
    valid = valid.union(
        select(child.id)
        .join(valid, child.parent_id == valid.c.id)
        .where(
            child.type == "Organization",
            child.status == "ACTIVE",
            child.organization_cone_state == "connected",
        )
    )
    return valid


def organization_subordinate_positions(user_id: UUID):
    valid = valid_organization_positions()
    assignment = aliased(Stakeholder)
    definition = aliased(StakeholderRoleDefinition)
    holder = aliased(User)
    positions = (
        select(assignment.card_id.label("position_id"), assignment.user_id.label("holder_id"))
        .join(valid, valid.c.id == assignment.card_id)
        .join(
            definition,
            and_(definition.card_type_key == "Organization", definition.key == assignment.role),
        )
        .join(holder, holder.id == assignment.user_id)
        .where(
            definition.is_archived.is_(False),
            definition.is_position_role.is_(True),
            holder.is_active.is_(True),
            or_(holder.access_expires_at.is_(None), holder.access_expires_at >= func.now()),
        )
        .cte("position_holders")
    )
    descendants = (
        select(positions.c.position_id.label("id"), array([positions.c.position_id]).label("path"))
        .where(positions.c.holder_id == user_id)
        .cte("position_descendants", recursive=True)
    )
    descendant = aliased(Card)
    descendants = descendants.union_all(
        select(descendant.id, descendants.c.path + array([descendant.id]))
        .join(descendants, descendant.parent_id == descendants.c.id)
        .join(valid, valid.c.id == descendant.id)
        .where(~(descendant.id == func.any(descendants.c.path)))
    )
    return (
        select(
            positions.c.holder_id,
            positions.c.position_id,
            descendants.c.path,
        )
        .join(descendants, descendants.c.id == positions.c.position_id)
        .where(positions.c.holder_id != user_id, func.cardinality(descendants.c.path) > 1)
        .distinct()
    )


def organization_subordinate_ids(user_id: UUID):
    positions = organization_subordinate_positions(user_id).subquery()
    return select(positions.c.holder_id).distinct()


async def organization_path_is_orphaned(db: AsyncSession, card: Card) -> bool:
    """Detect a durable orphan marker before a parent edge is rewritten."""
    parent: Card | None = card
    visited: set[UUID] = set()
    while parent is not None and parent.id not in visited:
        visited.add(parent.id)
        if parent.organization_cone_state == "orphaned":
            return True
        parent = await db.get(Card, parent.parent_id) if parent.parent_id else None
    return False


def inherited_stakeholder_grants(user_id: UUID, candidate_ids: set[UUID]):
    """Current inherited role grants for only the requested target cards."""
    sources = organization_subordinate_positions(user_id).subquery()
    return (
        select(
            Stakeholder.card_id,
            Stakeholder.role,
            StakeholderRoleDefinition.permissions,
            sources.c.holder_id,
            sources.c.path,
        )
        .select_from(Stakeholder)
        .join(Card, Card.id == Stakeholder.card_id)
        .join(sources, sources.c.holder_id == Stakeholder.user_id)
        .join(
            StakeholderRoleDefinition,
            (StakeholderRoleDefinition.card_type_key == Card.type)
            & (StakeholderRoleDefinition.key == Stakeholder.role),
        )
        .where(
            Stakeholder.card_id.in_(candidate_ids), StakeholderRoleDefinition.is_archived.is_(False)
        )
    )
