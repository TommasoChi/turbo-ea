"""Shared helper for the workspace-transfer legacy role-permission tests."""

from __future__ import annotations

from sqlalchemy import delete, select

from app.services.workspace_io import apply_bundle, build_bundle, parse_bundle
from tests.conftest import create_user


async def reimported_role_permissions(
    db, roles: dict, *, app_version, wipe=True, fork=False, keep_edit_costs=False
) -> dict:
    """Export ``roles`` (key -> permissions), stamp the bundle as written by
    ``app_version`` (``None`` leaves the manifest without one) and import it
    back; returns each role's stored permissions (``card.edit_costs`` left out
    unless ``keep_edit_costs``, which these cases do not concern)."""
    from app.models.card_type import CardType
    from app.models.stakeholder_role_definition import StakeholderRoleDefinition

    user = await create_user(db, email="view-costs-ws@test.com", role="admin")
    db.add(
        CardType(
            key="Application", label="Application", icon="apps", color="#0f7eb5", fields_schema=[]
        )
    )
    await db.flush()
    for key, permissions in roles.items():
        db.add(
            StakeholderRoleDefinition(
                card_type_key="Application", key=key, label=key.title(), permissions=permissions
            )
        )
    await db.flush()

    bundle = parse_bundle(await build_bundle(db))
    if not fork:
        from app.services.workspace_io import schema

        bundle.sheets.pop(schema.SHEET_COST_ITEM_TYPES, None)
    if app_version is None:
        bundle.manifest.pop("app_version", None)
    else:
        bundle.manifest["app_version"] = app_version

    if wipe:
        await db.execute(delete(StakeholderRoleDefinition))
    else:
        # The applier's update path: the rows stay, carrying something else.
        for srd in (await db.execute(select(StakeholderRoleDefinition))).scalars().all():
            srd.permissions = {"card.edit": True}
    await db.flush()

    result = await apply_bundle(db, bundle, user)
    assert result.total_failed == 0, result.as_dict()
    rows = await db.execute(
        select(
            StakeholderRoleDefinition.key, StakeholderRoleDefinition.permissions
        ).execution_options(populate_existing=True)
    )
    return {
        key: permissions
        if keep_edit_costs
        else {k: v for k, v in permissions.items() if k != "card.edit_costs"}
        for key, permissions in rows.all()
    }
