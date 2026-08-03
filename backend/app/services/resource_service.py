"""Shared policy for card and extension-owned binary resources."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_settings import AppSettings

MAX_FILE_SIZE = 10 * 1024 * 1024

ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "image/png",
    "image/jpeg",
    "image/svg+xml",
    "text/plain",
}


class ResourcePolicyError(ValueError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


async def validate_file_upload(
    db: AsyncSession,
    *,
    mime_type: str,
    data: bytes,
) -> None:
    settings_result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    settings_row = settings_result.scalar_one_or_none()
    general = (settings_row.general_settings if settings_row else None) or {}
    if not general.get("fileUploadsEnabled", True):
        raise ResourcePolicyError(
            403,
            "File uploads are disabled by the administrator",
        )
    if mime_type not in ALLOWED_MIME_TYPES:
        raise ResourcePolicyError(
            400,
            f"File type '{mime_type}' is not allowed. "
            "Accepted: PDF, DOCX, XLSX, PPTX, PNG, JPG, SVG, TXT.",
        )
    if len(data) > MAX_FILE_SIZE:
        raise ResourcePolicyError(
            400,
            f"File exceeds maximum size of {MAX_FILE_SIZE // (1024 * 1024)} MB",
        )
