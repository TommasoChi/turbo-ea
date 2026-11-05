import { OTHERS_KEY } from "./costColors";

/** Where the report is zoomed: a raw group key (`__others__` for the folded groups) and/or a card id. */
export interface Drill {
  group?: string;
  cardId?: string;
}
export type Crumb = { kind: "root" | "group" | "card"; label: string; target: Drill };

export function crumbsOf(
  drill: Drill,
  labels: { root: string; group: (k: string) => string; card: (id: string) => string },
): Crumb[] {
  const crumbs: Crumb[] = [{ kind: "root", label: labels.root, target: {} }];
  if (drill.group !== undefined)
    crumbs.push({ kind: "group", label: labels.group(drill.group), target: { group: drill.group } });
  if (drill.cardId !== undefined) crumbs.push({ kind: "card", label: labels.card(drill.cardId), target: { ...drill } });
  return crumbs;
}

export function backOf(drill: Drill): Drill {
  return drill.cardId !== undefined && drill.group !== undefined ? { group: drill.group } : {};
}

export function applyDrill<T extends { id: string; group?: string }>(
  items: T[],
  drill: Drill,
  foldedKeys: Set<string>,
): T[] {
  return items.filter((it) => {
    if (drill.group !== undefined) {
      const inGroup =
        drill.group === OTHERS_KEY ? foldedKeys.has(it.group ?? "") : it.group === drill.group;
      if (!inGroup) return false;
    }
    return drill.cardId === undefined || it.id === drill.cardId;
  });
}
