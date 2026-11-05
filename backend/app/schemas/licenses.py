from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.cost_items import KEY_PATTERN


class LicenseTypeCreate(BaseModel):
    key: str = Field(..., pattern=KEY_PATTERN)
    label: str = Field(..., min_length=1, max_length=100)
    translations: dict[str, str] | None = None


class LicenseTypeUpdate(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=100)
    translations: dict[str, str] | None = None
    archived: bool | None = None
    sort_order: int | None = Field(None, ge=0, le=2147483647)


class LicenseTypeOut(BaseModel):
    id: str
    key: str
    label: str
    sort_order: int
    archived: bool
    translations: dict[str, str] = {}
