"""Request contracts for stakeholder role definitions."""

import re

from pydantic import BaseModel, Field, field_validator

from app.core.permissions import ALL_CARD_PERMISSION_KEYS, strip_legacy_card_permissions

# Stakeholder role keys follow the same camelCase grammar as every other
# metamodel key (card types, fields, options, relation types, subtypes) — see
# ``frontend/src/components/KeyInput.tsx``. This deliberately matches the shared
# KeyInput component: the two used to disagree (the UI stripped underscores and
# allowed uppercase, this pattern required snake_case), so a key the UI happily
# accepted was rejected here with a raw regex in the error message (#907).
#
# Only *new* keys are validated. Pre-existing snake_case keys — from an older
# install, the API, or a workspace-transfer bundle — are never re-validated on
# read or update, so they keep working untouched.
ROLE_KEY_PATTERN = re.compile(r"^[a-zA-Z][a-zA-Z0-9]{2,49}$")
_KEY_RULE = "Key must be 3-50 characters, start with a letter, and contain only letters and digits (camelCase)"  # noqa: E501


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class StakeholderRoleCreate(BaseModel):
    key: str = Field(..., min_length=3, max_length=50)
    label: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    color: str = "#757575"
    permissions: dict[str, bool] = {}
    # Whether holding this role fills the card's data-quality stakeholders
    # slot. Passive roles (observer and friends) should be created with
    # this off so watching a card never stands in for owning it.
    counts_for_quality: bool = True
    translations: dict = {}
    is_position_role: bool = False

    @field_validator("key")
    @classmethod
    def validate_key(cls, v: str) -> str:
        if not ROLE_KEY_PATTERN.match(v):
            raise ValueError(_KEY_RULE)
        return v

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, v: dict[str, bool]) -> dict[str, bool]:
        # Stale keys migration 024 left behind are dropped rather than rejected,
        # so a client echoing a legacy map back (the admin UI round-trips what it
        # was served) can still save. Anything else unknown is still an error.
        v = strip_legacy_card_permissions(v)
        unknown = set(v.keys()) - ALL_CARD_PERMISSION_KEYS
        if unknown:
            raise ValueError(f"Unknown permission keys: {', '.join(sorted(unknown))}")
        return v


class StakeholderRoleUpdate(BaseModel):
    # A key may be changed only while the role is unused — see ``_role_usage``.
    key: str | None = Field(None, min_length=3, max_length=50)
    label: str | None = None
    description: str | None = None
    color: str | None = None
    permissions: dict[str, bool] | None = None
    sort_order: int | None = None
    counts_for_quality: bool | None = None
    translations: dict | None = None
    is_position_role: bool | None = None

    @field_validator("is_position_role")
    @classmethod
    def validate_position_role(cls, v: bool | None) -> bool:
        if v is None:
            raise ValueError("is_position_role cannot be null")
        return v

    @field_validator("key")
    @classmethod
    def validate_key(cls, v: str | None) -> str | None:
        if v is not None and not ROLE_KEY_PATTERN.match(v):
            raise ValueError(_KEY_RULE)
        return v

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, v: dict[str, bool] | None) -> dict[str, bool] | None:
        if v is not None:
            # Dropping the legacy keys here also cleans them out of the stored
            # row on the next save, so a role repairs itself as it is edited.
            v = strip_legacy_card_permissions(v)
            unknown = set(v.keys()) - ALL_CARD_PERMISSION_KEYS
            if unknown:
                raise ValueError(f"Unknown permission keys: {', '.join(sorted(unknown))}")
        return v
