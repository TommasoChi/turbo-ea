import { OTHER_GROUP } from "./costColors";

/**
 * The key of one report row. Grouped by provider a card appears once per provider, so a
 * map keyed on the card id alone would merge its shares.
 */
export function costRowKey(id: string, group: string | undefined, byProvider: boolean): string {
  return byProvider ? `${id}|${group ?? OTHER_GROUP}` : id;
}
