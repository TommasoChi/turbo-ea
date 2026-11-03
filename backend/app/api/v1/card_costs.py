from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException, Path, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, parse_uuid
from app.api.v1.cost_history import _load_card_for_edit
from app.database import get_db
from app.models.user import User
from app.schemas.cost_items import KEY_PATTERN, CardCostsOut, CostItemWrite, YearCostsOut
from app.services import card_costs, cost_item_types
from app.services.card_costs import COST_ITEM_TYPES, CostError, YearCosts
from app.services.card_read_scope import require_card_readable
from app.services.fiscal_year import MAX_FISCAL_YEAR, MIN_FISCAL_YEAR, get_fiscal_year_start
from app.services.permission_service import PermissionService

router = APIRouter(tags=["card-costs"])

_KEY = Path(pattern=KEY_PATTERN)
_FY = Path(ge=MIN_FISCAL_YEAR, le=MAX_FISCAL_YEAR)
_STATUS = {"archived_item": 409}


async def _require_costs(db: AsyncSession, user: User, card_type: str) -> None:
    """Writes: the app-level ``costs.view`` plus a cost-bearing type."""
    await PermissionService.require_permission(db, user, "costs.view")
    if card_type not in COST_ITEM_TYPES:
        raise HTTPException(404, "Card not found")


async def _load_for_read(db: AsyncSession, user: User, card_id: str) -> uuid.UUID:
    card_uuid = parse_uuid(card_id)
    card_type = await require_card_readable(db, user, card_uuid, mode="module")
    # Reads follow how costTotalAnnual is redacted: costs.view or a stakeholder of the card.
    if not await PermissionService.can_view_costs(db, user, card_uuid):
        raise HTTPException(403, "Not enough permissions")
    if card_type not in COST_ITEM_TYPES:
        raise HTTPException(404, "Card not found")
    return card_uuid


def _out(yc: YearCosts) -> YearCostsOut:
    return YearCostsOut.model_validate(yc, from_attributes=True)


async def _write(
    db: AsyncSession,
    user: User,
    card_id: str,
    fiscal_year: int,
    op: Callable[[uuid.UUID], Awaitable[object]],
) -> YearCostsOut:
    card = await _load_card_for_edit(db, user, card_id)
    await _require_costs(db, user, card.type)
    try:
        new = await card_costs.apply_write(db, card, user.id, fiscal_year, lambda: op(card.id))
    except CostError as e:
        raise HTTPException(_STATUS.get(e.code, 422), e.code) from e
    await db.commit()
    return _out(new)


@router.get("/cards/{card_id}/costs", response_model=CardCostsOut)
async def get_card_costs(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card_uuid = await _load_for_read(db, user, card_id)
    years = await card_costs.get_window(db, card_uuid, await get_fiscal_year_start(db))
    return CardCostsOut(
        years=[_out(y) for y in years],
        catalogue=[cost_item_types.serialize(r) for r in await cost_item_types.list_items(db)],
    )


@router.get("/cards/{card_id}/costs/{fiscal_year}", response_model=YearCostsOut)
async def get_card_costs_year(
    card_id: str,
    fiscal_year: int = _FY,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card_uuid = await _load_for_read(db, user, card_id)
    return _out(
        await card_costs.get_year_row(db, card_uuid, fiscal_year, await get_fiscal_year_start(db))
    )


@router.put("/cards/{card_id}/costs/{fiscal_year}/items/{key}", response_model=YearCostsOut)
async def put_card_cost_item(
    card_id: str,
    body: CostItemWrite,
    fiscal_year: int = _FY,
    key: str = _KEY,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await _write(
        db,
        user,
        card_id,
        fiscal_year,
        lambda cid: card_costs.upsert_item(
            db, cid, fiscal_year, key, body.amount, body.renewal_date
        ),
    )


@router.delete("/cards/{card_id}/costs/{fiscal_year}/items/{key}", status_code=204)
async def delete_card_cost_item(
    card_id: str,
    fiscal_year: int = _FY,
    key: str = _KEY,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _write(
        db,
        user,
        card_id,
        fiscal_year,
        lambda cid: card_costs.delete_item(db, cid, fiscal_year, key),
    )
    return Response(status_code=204)


@router.post("/cards/{card_id}/costs/{fiscal_year}/confirm", response_model=YearCostsOut)
async def confirm_card_cost_year(
    card_id: str,
    fiscal_year: int = _FY,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await _write(
        db, user, card_id, fiscal_year, lambda cid: card_costs.confirm_year(db, cid, fiscal_year)
    )


@router.post(
    "/cards/{card_id}/costs/{fiscal_year}/items/{key}/copy-to-forecast",
    response_model=YearCostsOut,
)
async def copy_card_cost_to_forecast(
    card_id: str,
    fiscal_year: int = _FY,
    key: str = _KEY,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # The edit happens on the Forecast year, so that is the year the event diffs.
    sm = await get_fiscal_year_start(db)
    forecast = card_costs.current_fiscal_year(sm) + card_costs.FISCAL_YEAR_LOOKAHEAD
    return await _write(
        db,
        user,
        card_id,
        forecast,
        lambda cid: card_costs.copy_to_forecast(db, cid, fiscal_year, key),
    )
