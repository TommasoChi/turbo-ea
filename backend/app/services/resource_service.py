"""Shared policy for extension-owned binary resources.

An upload is what its bytes say, not what the client calls it: the name picks the format and
``attachment_validation`` proves the content, exactly as for a card attachment.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.attachment_upload import UPLOADS_DISABLED_MESSAGE, uploads_enabled
from app.services.attachment_validation import (
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENT_MB,
    InvalidAttachmentError,
    validate_attachment,
)


class ResourcePolicyError(ValueError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


async def validate_file_upload(db: AsyncSession, *, name: str, data: bytes) -> str:
    """The canonical MIME to store; raises ``ResourcePolicyError`` otherwise."""
    if not await uploads_enabled(db):
        raise ResourcePolicyError(403, UPLOADS_DISABLED_MESSAGE)
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise ResourcePolicyError(400, f"File exceeds maximum size of {MAX_ATTACHMENT_MB} MB")
    try:
        return validate_attachment(name, data)
    except InvalidAttachmentError as exc:
        raise ResourcePolicyError(400, str(exc)) from exc
