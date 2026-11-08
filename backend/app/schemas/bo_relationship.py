"""Wire models for the shared BO drawing."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, model_validator

from app.schemas.card import CardResponse


class BoNode(BaseModel):
    id: UUID
    name: str
    subtype: str | None
    isPersonalData: bool  # noqa: N815 - existing metamodel key
    isPaymentData: bool  # noqa: N815 - existing metamodel key


class BoEdge(BaseModel):
    id: UUID
    source: UUID
    target: UUID
    cardinality: str | None


class BoPosition(BaseModel):
    x: FiniteFloat
    y: FiniteFloat


class BoApplication(BaseModel):
    id: UUID
    name: str


class BoApplicationGroup(BaseModel):
    master: BoApplication | None = None
    slaves: list[BoApplication] = Field(default_factory=list)
    unclassified: list[BoApplication] = Field(default_factory=list)


class BoApplicationPage(BaseModel):
    items: list[BoApplication]
    total: int


class BoCapabilities(BaseModel):
    can_manage_master: bool


class BoGraph(BaseModel):
    nodes: list[BoNode]
    edges: list[BoEdge]
    positions: dict[UUID, BoPosition]
    applications: dict[UUID, BoApplicationGroup]
    snapshot_revision: UUID | None
    capabilities: BoCapabilities


class BoMasterUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    application_id: UUID | None


class BoDetail(BaseModel):
    card: CardResponse
    permissions: dict[str, bool]


class BoInventoryItem(BaseModel):
    kind: Literal["node", "edge", "application_link"]
    id: UUID


class BoAcceptedInventoryChange(BoInventoryItem):
    """An item and the comparison revision issued for that item."""

    model_config = ConfigDict(extra="forbid")

    revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class BoLayoutUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    snapshot_revision: UUID | None = None
    positions: dict[UUID, BoPosition] = Field(default_factory=dict)
    auto_positions: dict[UUID, BoPosition] = Field(default_factory=dict)
    removed_relation_ids: set[UUID] = Field(default_factory=set)
    restored_relation_ids: set[UUID] = Field(default_factory=set)
    accepted_inventory_changes: list[BoAcceptedInventoryChange] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_deltas(self):
        if self.removed_relation_ids & self.restored_relation_ids:
            raise ValueError("A relation cannot be both removed and restored")
        keys = {(item.kind, item.id) for item in self.accepted_inventory_changes}
        if len(keys) != len(self.accepted_inventory_changes):
            raise ValueError("An inventory item can only be accepted once")
        return self


class BoLayoutResult(BoGraph):
    inventory_conflicts: list[BoInventoryItem]
