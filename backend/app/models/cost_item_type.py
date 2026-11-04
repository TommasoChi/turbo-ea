from __future__ import annotations

from sqlalchemy import Boolean, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class CostItemType(Base, UUIDMixin, TimestampMixin):
    """A line of the cost-item catalogue (e.g. "licences"). ``key`` is what
    ``card_costs.items`` is keyed by; it never changes and a row is archived,
    never deleted, so recorded amounts keep a name."""

    __tablename__ = "cost_item_types"

    key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    archived: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    translations: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
