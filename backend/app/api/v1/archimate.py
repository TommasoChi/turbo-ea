"""ArchiMate helpers: model validation (the editor, the API and MCP share one rule set)."""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.diagrams import require_archimate_permission
from app.database import get_db
from app.models.user import User
from app.services.archimate.validate import validate_exchange

router = APIRouter(prefix="/archimate", tags=["archimate"])


class ValidateBody(BaseModel):
    xml: str


@router.post("/validate")
async def validate(
    body: ValidateBody,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_archimate_permission(db, user, None, "view")
    # CPU-bound parse: keep it off the event loop.
    issues = await run_in_threadpool(validate_exchange, body.xml)
    return {"valid": not issues, "issues": [asdict(i) for i in issues]}
