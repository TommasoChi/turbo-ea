import pytest
from sqlalchemy.exc import IntegrityError

from app.models.card_cost_history import CardCostHistory
from tests.conftest import create_card

pytestmark = pytest.mark.anyio


async def test_a_row_is_unique_per_card_fiscal_year_field(db):
    card = await create_card(db, card_type="Application", name="ERP")
    db.add(
        CardCostHistory(card_id=card.id, fiscal_year=2025, field_key="costTotalAnnual", value=100)
    )
    await db.flush()
    db.add(
        CardCostHistory(card_id=card.id, fiscal_year=2025, field_key="costTotalAnnual", value=200)
    )
    with pytest.raises(IntegrityError):
        await db.flush()
