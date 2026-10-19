from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class EnterpriseObject(Base, UUIDMixin, TimestampMixin):
    """Registry of ArchiMate element types available to the editor."""

    __tablename__ = "enterprise_objects"

    key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str] = mapped_column(String(100), default="category")
    color: Mapped[str] = mapped_column(String(20), default="#1976d2")
    # One of taxonomy.py's LAYERS keys, or NULL for the four "Other" rows
    # (Grouping/Location/AndJunction/OrJunction).
    layer: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # ArchiMate's structural aspect: "passive" | "behavior" | "active", or NULL
    # for rows the standard itself does not classify under a single aspect --
    # Motivation and Other elements, and the handful of composite types
    # (Product, Plateau, Gap, Grouping, Location) that span all three. Fixed
    # by the spec for a standard row (seeded, never admin-edited); a custom
    # row's admin chooses it, since nothing in the spec does that for them.
    aspect: Mapped[str | None] = mapped_column(String(16), nullable=True)
    is_standard: Mapped[bool] = mapped_column(Boolean, default=False)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class EnterpriseObjectCardMapping(Base, UUIDMixin, TimestampMixin):
    """Bridge table: which card types/subtypes map to which enterprise object."""

    __tablename__ = "enterprise_object_card_mappings"
    __table_args__ = (
        # nulls_not_distinct: without it, Postgres treats every NULL
        # card_subtype_key as distinct, so two "all subtypes" rows for the
        # same (enterprise_object_key, card_type_key) pair would not collide.
        UniqueConstraint(
            "enterprise_object_key",
            "card_type_key",
            "card_subtype_key",
            name="uq_enterprise_object_card_mappings_eo_type_subtype",
            postgresql_nulls_not_distinct=True,
        ),
    )

    enterprise_object_key: Mapped[str] = mapped_column(
        String(64), ForeignKey("enterprise_objects.key"), nullable=False
    )
    card_type_key: Mapped[str] = mapped_column(
        String(100), ForeignKey("card_types.key"), nullable=False
    )
    # NULL = applies to all subtypes of card_type_key.
    card_subtype_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
