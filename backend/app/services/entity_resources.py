"""Ownership of entity-scoped files and links (``card_id`` NULL rows).

A ``file_attachments`` / ``documents`` row with ``entity_type`` ``ext.<key>.*`` belongs to an
extension and is only reachable through that extension's bridge, under the extension's own
permission. The core document routes (which gate on ``documents.*`` alone) must treat such a
row as non-existent, or any ``documents.view`` holder could read it by id.
"""

EXTENSION_ENTITY_PREFIX = "ext."


def is_extension_owned(entity_type: str | None) -> bool:
    return entity_type is not None and entity_type.startswith(EXTENSION_ENTITY_PREFIX)
