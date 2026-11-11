"""Fresh schema enforces BO relationship concurrency invariants."""

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.relation import Relation
from tests.conftest import create_card

pytestmark = pytest.mark.anyio


@pytest.mark.parametrize("kind", ["er", "master"])
async def test_bo_unique_indexes_reject_conflicting_links(db, kind):
    obj = await create_card(db, card_type="DataObject", name="Object")
    other = await create_card(db, card_type="DataObject", name="Other")
    app = await create_card(db, card_type="Application", name="App")
    app2 = await create_card(db, card_type="Application", name="App 2")
    if kind == "er":
        first = Relation(type="relDataObjectToDataObject", source_id=obj.id, target_id=other.id)
        duplicate = Relation(type=first.type, source_id=other.id, target_id=obj.id)
    else:
        first = Relation(
            type="relAppToDataObj",
            source_id=app.id,
            target_id=obj.id,
            attributes={"dataOwnership": "master"},
        )
        duplicate = Relation(
            type=first.type,
            source_id=app2.id,
            target_id=obj.id,
            attributes={"dataOwnership": "master"},
        )
    db.add(first)
    await db.flush()
    with pytest.raises(IntegrityError):
        async with db.begin_nested():
            db.add(duplicate)
            await db.flush()
