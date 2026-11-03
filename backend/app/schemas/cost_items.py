from __future__ import annotations

from pydantic import BaseModel, Field

KEY_PATTERN = r"^[A-Za-z][A-Za-z0-9_]{0,63}$"


class CostItemTypeCreate(BaseModel):
    key: str = Field(..., pattern=KEY_PATTERN)
    label: str = Field(..., min_length=1, max_length=100)
    translations: dict[str, str] | None = None


class CostItemTypeUpdate(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=100)
    translations: dict[str, str] | None = None
    archived: bool | None = None
    sort_order: int | None = None
