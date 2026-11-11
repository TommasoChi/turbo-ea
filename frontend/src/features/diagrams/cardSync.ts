/**
 * The `POST /cards` body for a card created on the canvas.
 *
 * Both ways of pushing a pending card to the inventory — syncing that one
 * card and **Sync all** — build it here, so they cannot drift. They did: each
 * sent the type and the name alone, so the description typed in the
 * Create-card dialog never reached the card (#1210).
 */
import type { ScannedPendingFS } from "./drawio-shapes";

export function cardCreatePayload(
  item: Pick<ScannedPendingFS, "type" | "name" | "description" | "subtype">,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { type: item.type, name: item.name };
  // `CardCreate.description` is `str | None`: a blank is "none", not "".
  const description = item.description?.trim();
  if (description) payload.description = description;
  if (item.subtype) payload.subtype = item.subtype;
  return payload;
}

export function canSyncPendingCard(item: Pick<ScannedPendingFS, "type" | "subtype">, options: { key: string }[]): boolean {
  return item.type !== "DataObject" || options.some((option) => option.key === item.subtype);
}

export function syncAllMessageKey(items: Pick<ScannedPendingFS, "type" | "subtype">[], options: { key: string }[]): string {
  return items.some((item) => !canSyncPendingCard(item, options))
    ? "editor.subtypeRequired"
    : "editor.syncComplete";
}
