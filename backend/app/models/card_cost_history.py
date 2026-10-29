from __future__ import annotations

import uuid

from sqlalchemy import Float, ForeignKey, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class CardCostHistory(Base, UUIDMixin, TimestampMixin):
    """One cost field's value for one card, for one fiscal year."""

    __tablename__ = "card_cost_history"
    __table_args__ = (UniqueConstraint("card_id", "fiscal_year", "field_key"),)

    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    fiscal_year: Mapped[int] = mapped_column(nullable=False)
    field_key: Mapped[str] = mapped_column(Text, nullable=False)
    value: Mapped[float] = mapped_column(Float, default=0)
