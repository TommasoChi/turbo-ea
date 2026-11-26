import uuid

from pydantic import BaseModel, ConfigDict


class CostScopeItem(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    parent_id: uuid.UUID | None
    alias: str | None


class CostFilterOptionsOut(BaseModel):
    """What the cost report's relation filters offer; the page reads nothing else."""

    relation_types: list[dict]
    groupable_types: dict[str, list[dict]]


class CostScopeResponse(BaseModel):
    items: list[CostScopeItem]
    total: int


class CostReportNode(BaseModel):
    model_config = ConfigDict(extra="allow")

    logo_updated_at: str | None = None
    costs: dict[str, float] | None = None


class CostTreemapResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    items: list[CostReportNode]
    group_names: dict[str, str] | None = None


class CostSankeyResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    nodes: list[CostReportNode]
