from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class Relation(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "relations"

    # References ``relation_types.key`` (denormalised, no FK constraint).
    # TEXT to match the widened key column — source-imported custom
    # relation types can exceed 100 chars.
    type: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    attributes: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    description: Mapped[str | None] = mapped_column(Text)

    source = relationship("Card", foreign_keys=[source_id], lazy="noload")
    target = relationship("Card", foreign_keys=[target_id], lazy="noload")


Index(
    "uq_bo_er_pair",
    text("least(source_id, target_id)"),
    text("greatest(source_id, target_id)"),
    unique=True,
    postgresql_where=text("type = 'relDataObjectToDataObject'"),
    _table=Relation.__table__,
)
Index(
    "uq_bo_master",
    Relation.target_id,
    unique=True,
    postgresql_where=text("type = 'relAppToDataObj' AND attributes->>'dataOwnership' = 'master'"),
)
