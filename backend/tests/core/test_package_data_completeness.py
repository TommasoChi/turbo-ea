"""Recurrence guard: every non-Python data file under ``app/`` is declared in
``pyproject.toml``'s ``[tool.setuptools.package-data]``.

``taxonomy.py``'s ``_table()`` reads ``relation_table.json`` by path at
import/call time -- a plain ``pip install backend/`` (the Docker image's own
install step) only carries a data file into the installed package if its
subpackage and pattern are declared here. A new ``*.json``/``*.pack`` file
added under ``app/services/<subpackage>/`` without a matching entry installs
fine (no error at build time) and then raises ``FileNotFoundError`` the first
time the code that reads it actually runs -- exactly what happened when
``relation_table.json`` shipped without one, and again when the ArchiMate
viewpoint example fixtures (``*.xml``) shipped without their own entry.

This walks the real file tree rather than hard-coding file names, so a
future data file gets the same check for free.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = BACKEND_ROOT / "app"
SERVICES_ROOT = APP_ROOT / "services"


def _package_data() -> dict[str, list[str]]:
    data = tomllib.loads((BACKEND_ROOT / "pyproject.toml").read_text("utf-8"))
    return data["tool"]["setuptools"]["package-data"]


def _data_files() -> set[Path]:
    return {p for ext in ("*.json", "*.pack", "*.xml") for p in SERVICES_ROOT.rglob(ext)}


def _covered_files(package_data: dict[str, list[str]]) -> set[Path]:
    covered: set[Path] = set()
    for package_name, patterns in package_data.items():
        # "app.services.archimate" -> app/services/archimate (drop the leading "app").
        pkg_dir = APP_ROOT.joinpath(*package_name.split(".")[1:])
        for pattern in patterns:
            covered.update(pkg_dir.glob(pattern))
    return covered


def test_every_data_file_is_covered_by_a_package_data_pattern():
    uncovered = _data_files() - _covered_files(_package_data())
    assert uncovered == set(), (
        "data file(s) not covered by [tool.setuptools.package-data] -- "
        f"add an entry or the installed package silently drops them: "
        f"{sorted(str(p.relative_to(BACKEND_ROOT)) for p in uncovered)}"
    )
