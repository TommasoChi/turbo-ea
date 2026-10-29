"""A 422 for a non-finite number must be a 422, not a 500 (VAPT 2026-10-29)."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from app.main import validation_error_handler


class _Body(BaseModel):
    value: float = Field(ge=0, allow_inf_nan=False)


def _client() -> TestClient:
    app = FastAPI()
    app.add_exception_handler(RequestValidationError, validation_error_handler)

    @app.post("/echo")
    async def echo(body: _Body):
        return body

    return TestClient(app)


@pytest.mark.parametrize("raw", ["NaN", "Infinity", "-Infinity", "1e999", "-1e999"])
def test_non_finite_number_is_a_422_not_a_500(raw):
    resp = _client().post(
        "/echo", content=f'{{"value": {raw}}}', headers={"content-type": "application/json"}
    )
    assert resp.status_code == 422
    assert resp.json()["detail"][0]["loc"] == ["body", "value"]


def test_ordinary_validation_error_keeps_the_default_shape():
    resp = _client().post("/echo", json={"value": -1})
    assert resp.status_code == 422
    detail = resp.json()["detail"][0]
    assert detail["loc"] == ["body", "value"]
    assert detail["type"] == "greater_than_equal"
