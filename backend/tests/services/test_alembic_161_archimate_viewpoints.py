"""Migration 161 adds the ArchimateViewpoint catalog and its bridge/example/
tab-card tables, plus diagrams.viewpoint_key (ArchiMate Viewpoint Catalog, task 1)."""

from __future__ import annotations

from sqlalchemy import text


async def test_archimate_viewpoint_tables_exist(db):
    for table in (
        "archimate_viewpoints",
        "archimate_viewpoint_objects",
        "archimate_viewpoint_examples",
        "archimate_viewpoint_tab_cards",
    ):
        result = await db.execute(
            text("SELECT column_name FROM information_schema.columns WHERE table_name = :t"),
            {"t": table},
        )
        assert {row[0] for row in result}, f"{table} has no columns — table missing"

    result = await db.execute(
        text("SELECT column_name FROM information_schema.columns WHERE table_name = 'diagrams'")
    )
    assert "viewpoint_key" in {row[0] for row in result}
