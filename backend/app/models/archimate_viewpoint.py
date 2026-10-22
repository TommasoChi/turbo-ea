from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class ArchimateViewpoint(Base, UUIDMixin, TimestampMixin):
    """Registry of ArchiMate viewpoints available in the catalog."""

    __tablename__ = "archimate_viewpoints"

    key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    icon: Mapped[str] = mapped_column(String(100), default="category")
    description: Mapped[str | None] = mapped_column(Text)
    # One of taxonomy.py's LAYERS keys.
    layer: Mapped[str] = mapped_column(String(32), nullable=False)
    is_standard: Mapped[bool] = mapped_column(Boolean, default=False)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class ArchimateViewpointObject(Base, UUIDMixin, TimestampMixin):
    """Bridge table: which enterprise objects a viewpoint allows."""

    __tablename__ = "archimate_viewpoint_objects"
    __table_args__ = (
        UniqueConstraint(
            "viewpoint_key",
            "enterprise_object_key",
            name="uq_archimate_viewpoint_objects_viewpoint_eo",
        ),
    )

    viewpoint_key: Mapped[str] = mapped_column(
        String(64), ForeignKey("archimate_viewpoints.key"), nullable=False
    )
    enterprise_object_key: Mapped[str] = mapped_column(
        String(64), ForeignKey("enterprise_objects.key"), nullable=False
    )


class ArchimateViewpointExample(Base, UUIDMixin, TimestampMixin):
    """Example diagram (ArchiMate Exchange Format XML) seeded for a viewpoint."""

    __tablename__ = "archimate_viewpoint_examples"

    viewpoint_key: Mapped[str] = mapped_column(
        String(64), ForeignKey("archimate_viewpoints.key"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    exchange_xml: Mapped[str] = mapped_column(Text, nullable=False)


class ArchimateViewpointTabCard(Base, UUIDMixin, TimestampMixin):
    """Which card type(s) a card detail tab suggests creating for a viewpoint."""

    __tablename__ = "archimate_viewpoint_tab_cards"
    __table_args__ = (
        UniqueConstraint(
            "viewpoint_key",
            "tab_key",
            "card_type_key",
            name="uq_archimate_viewpoint_tab_cards_viewpoint_tab_type",
        ),
    )

    viewpoint_key: Mapped[str] = mapped_column(
        String(64), ForeignKey("archimate_viewpoints.key"), nullable=False
    )
    # One of "business" / "application" / "technology".
    tab_key: Mapped[str] = mapped_column(String(32), nullable=False)
    card_type_key: Mapped[str] = mapped_column(
        String(100), ForeignKey("card_types.key"), nullable=False
    )
