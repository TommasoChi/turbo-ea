from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class CardLicense(Base, UUIDMixin, TimestampMixin):
    """One card's licenses for one fiscal year.

    ``items`` is ``{metric: {license_type_key: {"licensed": int, "actual": int | None}}}``.
    """

    __tablename__ = "card_licenses"
    __table_args__ = (
        UniqueConstraint("card_id", "fiscal_year", name="uq_card_licenses_card_year"),
        Index("ix_card_licenses_card_id", "card_id"),
    )

    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), nullable=False
    )
    fiscal_year: Mapped[int] = mapped_column(Integer, nullable=False)
    items: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
