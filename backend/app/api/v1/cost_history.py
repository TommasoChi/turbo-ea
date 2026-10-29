from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, parse_uuid
from app.database import get_db
from app.models.card import Card
from app.models.card_cost_history import CardCostHistory
from app.models.card_type import CardType
from app.models.user import User
from app.services.card_read_scope import require_card_readable
from app.services.cost_field_filter import cost_field_keys_from_card_schema
from app.services.fiscal_year import (
    MAX_FISCAL_YEAR,
    MIN_FISCAL_YEAR,
    fiscal_year_window,
    get_fiscal_year_start,
)
from app.services.permission_service import PermissionService

router = APIRouter(tags=["cost-history"])

_SAFE_KEY_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")


class CostHistoryRow(BaseModel):
    fiscal_year: int = Field(ge=MIN_FISCAL_YEAR, le=MAX_FISCAL_YEAR)
    field_key: str
    value: float = Field(ge=0, allow_inf_nan=False)


class CostHistoryList(BaseModel):
    rows: list[CostHistoryRow]


async def _load_card_for_edit(db: AsyncSession, user: User, card_id: str) -> Card:
    card_uuid = parse_uuid(card_id)
    await require_card_readable(db, user, card_uuid, mode="module")
    if not await PermissionService.check_permission(
        db, user, "inventory.edit", card_uuid, "card.edit"
    ):
        raise HTTPException(403, "Not enough permissions")
    card = (await db.execute(select(Card).where(Card.id == card_uuid))).scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")
    return card


async def _cost_field_keys_for_card(db: AsyncSession, card: Card) -> frozenset[str]:
    type_def = (
        await db.execute(select(CardType).where(CardType.key == card.type))
    ).scalar_one_or_none()
    return cost_field_keys_from_card_schema(type_def.fields_schema if type_def else None)


@router.get("/cards/{card_id}/cost-history", response_model=CostHistoryList)
async def list_cost_history(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await _load_card_for_edit(db, user, card_id)
    rows = (
        (await db.execute(select(CardCostHistory).where(CardCostHistory.card_id == card.id)))
        .scalars()
        .all()
    )
    return CostHistoryList(
        rows=[
            CostHistoryRow(fiscal_year=r.fiscal_year, field_key=r.field_key, value=r.value)
            for r in rows
        ]
    )


@router.put("/cards/{card_id}/cost-history", response_model=CostHistoryRow)
async def upsert_cost_history(
    card_id: str,
    body: CostHistoryRow,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await _load_card_for_edit(db, user, card_id)
    oldest, newest = fiscal_year_window(await get_fiscal_year_start(db))
    if not oldest <= body.fiscal_year <= newest:
        raise HTTPException(422, f"fiscal_year must be between {oldest} and {newest}")
    if not _SAFE_KEY_RE.match(body.field_key):
        raise HTTPException(400, f"Invalid field_key: {body.field_key!r}")
    cost_keys = await _cost_field_keys_for_card(db, card)
    if cost_keys and body.field_key not in cost_keys:
        raise HTTPException(400, f"Unknown cost field '{body.field_key}' for this card")

    row = (
        await db.execute(
            select(CardCostHistory).where(
                CardCostHistory.card_id == card.id,
                CardCostHistory.fiscal_year == body.fiscal_year,
                CardCostHistory.field_key == body.field_key,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = CardCostHistory(
            card_id=card.id,
            fiscal_year=body.fiscal_year,
            field_key=body.field_key,
            value=body.value,
        )
        db.add(row)
    else:
        row.value = body.value
    await db.commit()
    return CostHistoryRow(fiscal_year=row.fiscal_year, field_key=row.field_key, value=row.value)


@router.delete("/cards/{card_id}/cost-history/{fiscal_year}/{field_key}", status_code=204)
async def delete_cost_history(
    card_id: str,
    fiscal_year: int = Path(ge=MIN_FISCAL_YEAR, le=MAX_FISCAL_YEAR),
    field_key: str = Path(),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await _load_card_for_edit(db, user, card_id)
    row = (
        await db.execute(
            select(CardCostHistory).where(
                CardCostHistory.card_id == card.id,
                CardCostHistory.fiscal_year == fiscal_year,
                CardCostHistory.field_key == field_key,
            )
        )
    ).scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.commit()
