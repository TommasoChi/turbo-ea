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


class BoApplicationLink(BaseModel):
    id: UUID
    object_id: UUID
    application: BoApplication
    is_master: bool


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


class BoObjectDraft(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=500)
    subtype: str = Field(min_length=1, max_length=100)
    isPersonalData: bool = False  # noqa: N815 - existing metamodel key
    isPaymentData: bool = False  # noqa: N815 - existing metamodel key


class BoRelationDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: UUID
    target_id: UUID
    cardinality: Literal["1:1", "1:n", "n:1", "n:m"] | None = None

    @model_validator(mode="after")
    def validate_endpoints(self):
        if self.source_id == self.target_id:
            raise ValueError("An ER relation requires two distinct business objects")
        return self


class BoApplicationLinkDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    object_id: UUID
    application_id: UUID
    role: Literal["master", "slave", "unclassified"]


class BoDetail(BaseModel):
    card: CardResponse
    permissions: dict[str, bool]


class BoInventoryItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

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
    skip_unavailable_relations: bool = Field(
        default=False,
        description="Save authorized deltas and report unavailable edge IDs as conflicts.",
    )
    accepted_inventory_changes: list[BoAcceptedInventoryChange] = Field(default_factory=list)
    saved_drafts: list[BoInventoryItem] = Field(default_factory=list, max_length=5000)

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
    unavailable_drafts: list[BoInventoryItem]


class BoInventoryChange(BoAcceptedInventoryChange):
    change: Literal["added", "updated", "removed"]
    before: BoNode | BoEdge | BoApplicationLink | None
    after: BoNode | BoEdge | BoApplicationLink | None


class BoInventoryChanges(BaseModel):
    changes: list[BoInventoryChange]


class BoDraftComparison(BaseModel):
    model_config = ConfigDict(extra="forbid")

    removed_relation_ids: list[UUID] = Field(default_factory=list, max_length=5000)
