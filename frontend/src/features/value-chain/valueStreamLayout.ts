import type { ValueStreamLeaf, ValueStreamRoot, ValueStreamTreeItem } from "@/types";
import type { StreamBandKey } from "./valueChainModel";

export const COL_W = 210; // px — one fixed column per leaf so every band aligns
export const GUTTER_PX = 12; // breathing room between a band frame and its content
export const GOAL_STRIP_W = 20; // blank separator before the goal panel
export const CHEVRON_H = 56;
export const GATE_H = 44;

export function bandRowSpans(rowCount: number): Record<StreamBandKey, number> {
  return { gate: 4, vs: 4, process: 3 + Math.max(1, rowCount), cap: 2 };
}

export function bandRowStarts(order: readonly StreamBandKey[], rowCount: number) {
  const spans = bandRowSpans(rowCount);
  const starts = {} as Record<StreamBandKey, number>;
  let cursor = 1;
  for (const key of order) {
    starts[key] = cursor;
    cursor += spans[key];
  }
  return { starts, total: cursor - 1 };
}

export interface LeafRun {
  parentId: string | null;
  parentName: string | null;
  leaves: ValueStreamLeaf[];
  startCol: number;
}
export interface StreamGeometry {
  runs: LeafRun[];
  colByLeafId: Record<string, number>;
  totalSlots: number;
  lastCol: number;
}

/** Leaf columns start at grid line 2: line 1 is the leading flexible track. */
export function buildGeometry(sequence: ValueStreamLeaf[]): StreamGeometry {
  const runs: LeafRun[] = [];
  let col = 2;
  for (const leaf of sequence) {
    const last = runs[runs.length - 1];
    if (last && last.parentId === leaf.parent_id) {
      last.leaves.push(leaf);
    } else {
      runs.push({ parentId: leaf.parent_id, parentName: leaf.parent_name, leaves: [leaf], startCol: col });
    }
    col += 1;
  }
  const colByLeafId: Record<string, number> = {};
  for (const run of runs) run.leaves.forEach((leaf, i) => (colByLeafId[leaf.id] = run.startCol + i));
  return { runs, colByLeafId, totalSlots: col - 2, lastCol: col - 1 };
}

export function gridTemplateColumns(totalSlots: number, hasGoals: boolean): string {
  const slots = `repeat(${totalSlots || 1}, ${COL_W}px)`;
  return hasGoals
    ? `minmax(0, 1fr) ${slots} ${GOAL_STRIP_W}px minmax(min-content, 1fr)`
    : `minmax(0, 1fr) ${slots} minmax(0, 1fr)`;
}

export interface ProcessPlacement {
  key: string;
  items: ValueStreamTreeItem[];
  gridColumn: string;
  row: number;
}

export function groupByLeaf<T extends { leaf_id: string }>(items: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const list = out.get(item.leaf_id);
    if (list) list.push(item);
    else out.set(item.leaf_id, [item]);
  }
  return out;
}

/** Where every Process-band box goes: spans, cross-cutting boxes, then each leaf column per level row. */
export function planProcessPlacements(root: ValueStreamRoot, geometry: StreamGeometry): ProcessPlacement[] {
  const rowOf = (id: string) => root.row_of_process[id] ?? 0;
  const out: ProcessPlacement[] = [];

  for (const span of root.spans) {
    const first = geometry.colByLeafId[span.leaf_ids[0]];
    const last = geometry.colByLeafId[span.leaf_ids[span.leaf_ids.length - 1]];
    if (first === undefined || last === undefined) continue;
    out.push({
      key: `span-${span.process_id}`,
      items: [{ id: span.process_id, children: [] }],
      gridColumn: `${first} / ${last + 1}`,
      row: rowOf(span.process_id),
    });
  }

  for (const item of root.cross_processes) {
    out.push({
      key: `cross-${item.id}`,
      items: [item],
      gridColumn: `2 / ${geometry.lastCol + 1}`,
      row: rowOf(item.id),
    });
  }

  for (const leaf of root.sequence) {
    const col = geometry.colByLeafId[leaf.id];
    const byRow = new Map<number, ValueStreamTreeItem[]>();
    for (const item of root.leaf_processes[leaf.id] ?? []) {
      const row = rowOf(item.id);
      byRow.set(row, [...(byRow.get(row) ?? []), item]);
    }
    for (const [row, items] of byRow) {
      out.push({ key: `${leaf.id}-row${row}`, items, gridColumn: `${col}`, row });
    }
  }
  return out;
}
