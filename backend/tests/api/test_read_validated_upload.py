"""``read_validated_upload`` called directly: what it reads, how much, in which order, and the
exact 400 it answers, so no write path can drift from the shared rule."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.services import attachment_upload as fa
from app.services.attachment_validation import MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_MB

PDF = b"%PDF-1.7\n" + b"x" * 64


class _Upload:
    """The slice of ``UploadFile`` the helper uses; records every read."""

    def __init__(self, filename, data):
        self.filename = filename
        self._data = data
        self.reads: list[int] = []

    async def read(self, size=-1):
        self.reads.append(size)
        return self._data[:size] if size >= 0 else self._data


async def _refused(upload, message=None):
    with pytest.raises(HTTPException) as exc:
        await fa.read_validated_upload(upload)
    assert exc.value.status_code == 400
    if message is not None:
        assert exc.value.detail == message
    return exc.value.detail


async def test_a_good_file_returns_its_format_and_the_whole_body():
    up = _Upload("Report.PDF", PDF)
    fmt, data = await fa.read_validated_upload(up)
    assert fmt.extension == ".pdf"
    assert data == PDF
    assert up.reads == [MAX_ATTACHMENT_BYTES + 1]


async def test_a_bad_name_is_refused_before_any_read():
    up = _Upload("malware.exe", PDF)
    detail = await _refused(up)
    assert detail  # the resolver's own message, not a generic one
    assert up.reads == []
    no_name = _Upload("", PDF)
    await _refused(no_name)
    assert no_name.reads == []
    none_name = _Upload(None, PDF)
    await _refused(none_name)
    assert none_name.reads == []


async def test_the_size_cap_is_inclusive_and_the_message_names_it():
    at_cap = PDF + b"y" * (MAX_ATTACHMENT_BYTES - len(PDF))
    assert len(at_cap) == MAX_ATTACHMENT_BYTES
    fmt, data = await fa.read_validated_upload(_Upload("a.pdf", at_cap))
    assert len(data) == MAX_ATTACHMENT_BYTES
    over = at_cap + b"z"
    await _refused(_Upload("a.pdf", over), f"File exceeds maximum size of {MAX_ATTACHMENT_MB} MB")


async def test_an_oversize_body_is_never_read_past_one_extra_byte():
    up = _Upload("a.pdf", PDF + b"y" * (MAX_ATTACHMENT_BYTES + 5000))
    await _refused(up)
    assert up.reads == [MAX_ATTACHMENT_BYTES + 1]


async def test_an_empty_file_and_a_lying_extension_are_refused_with_the_validator_message():
    await _refused(_Upload("a.pdf", b""), "File is empty")
    detail = await _refused(_Upload("a.pdf", b"MZ not a pdf at all"))
    assert detail == "File content does not match its '.pdf' extension."


async def test_only_the_head_of_the_file_is_sniffed(monkeypatch):
    seen = {}

    def fake(fmt, head):
        seen["len"] = len(head)

    monkeypatch.setattr(fa, "validate_content", fake)
    body = PDF + b"q" * 5000
    fmt, data = await fa.read_validated_upload(_Upload("a.pdf", body))
    assert seen["len"] == fa.SNIFF_BYTES == 1024
    assert data == body
