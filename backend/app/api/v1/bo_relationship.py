"""BO Relationship graph, card panel, and shared drawing writes."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.api.v1.cards import card_detail_response, redact_bo_card_references
from app.database import get_db
from app.models.user import User
from app.schemas.bo_relationship import (
    BoApplicationGroup,
    BoApplicationPage,
    BoDetail,
    BoGraph,
    BoLayoutResult,
    BoLayoutUpdate,
    BoMasterUpdate,
)
from app.services import bo_relationship as service
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/bo-relationship", tags=["bo-relationship"])


@router.get("", response_model=BoGraph)
async def get_graph(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("boRelationship.view")),
):
    return await service.get_bo_graph(db, user)


@router.put("/layout", response_model=BoLayoutResult)
async def save_layout(
    body: BoLayoutUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("boRelationship.edit")),
):
    result = await service.save_bo_layout(db, user, body)
    await db.commit()
    return result


@router.put("/objects/{object_id}/master", response_model=BoApplicationGroup)
async def update_master(
    object_id: uuid.UUID,
    body: BoMasterUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("boRelationship.edit")),
):
    grouping = await service.set_bo_master(db, user, object_id, body.application_id)
    await db.commit()
    return grouping


@router.get("/objects/{object_id}/detail", response_model=BoDetail)
async def get_object_detail(
    object_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("boRelationship.view")),
):
    read_scope = await service.bo_read_scope(db, user)
    card = await service.get_bo_card(db, read_scope, object_id, detail=True)
    response = await card_detail_response(db, user, card)
    await redact_bo_card_references(db, user, card, response, read_scope)
    effective = (await PermissionService.get_effective_card_permissions(db, user, object_id))[
        "effective"
    ]
    may_edit = await PermissionService.has_app_permission(db, user, "boRelationship.edit")
    permissions = {key: may_edit and value for key, value in effective.items()}
    permissions["can_view"] = True
    permissions["can_view_costs"] = effective["can_view_costs"]
    return BoDetail(card=response, permissions=permissions)


@router.get("/applications", response_model=BoApplicationPage)
async def search_applications(
    search: str | None = Query(None, max_length=200),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("boRelationship.edit")),
):
    return await service.search_bo_applications(db, user, search, page, page_size)
