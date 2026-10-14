import type { ExportSheet, ReportExportData } from "@/features/reports/reportExport";
import type { ValueChainBand, ValueChainBandKey, ValueStreamRoot } from "@/types";

export interface ChainExportLabels {
  categories: string;
  band: string;
  category: string;
  processGroups: string;
  processes: string;
  valueStreams: string;
  valueGates: string;
  bands: Record<ValueChainBandKey, string>;
}

export interface StreamExportLabels {
  streams: string;
  processes: string;
  gates: string;
  capabilities: string;
  goals: string;
  leaf: string;
  parent: string;
  name: string;
  subtype: string;
  row: string;
  steps: string;
  type: string;
  group: string;
  description: string;
  subtypes: Record<string, string>;
}

const MAX_SHEET_NAME = 31; // Excel limit

/** Forbidden characters (`\ / ? * [ ] :`) become spaces; whitespace is collapsed. */
const cleanSheetName = (s: string): string => s.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim();

const text = (key: string, label: string) => ({ key, label, type: "text" as const });
const num = (key: string, label: string) => ({ key, label, type: "number" as const });

export function chainExportData(
  bands: ValueChainBand[],
  title: string,
  labels: ChainExportLabels,
  chartNode: HTMLElement | null,
): ReportExportData {
  const rows = bands.flatMap((band) =>
    band.boxes.map((box) => ({
      band: labels.bands[band.key],
      category: box.name,
      processGroups: box.group_count,
      processes: box.process_count,
      valueStreams: box.value_stream_count,
      valueGates: box.value_gate_count,
    })),
  );
  return {
    title,
    chartNode,
    sheets: [
      {
        name: cleanSheetName(labels.categories).slice(0, MAX_SHEET_NAME) || "Sheet",
        columns: [
          text("band", labels.band),
          text("category", labels.category),
          num("processGroups", labels.processGroups),
          num("processes", labels.processes),
          num("valueStreams", labels.valueStreams),
          num("valueGates", labels.valueGates),
        ],
        rows,
      },
    ],
  };
}

interface KindSheet extends Omit<ExportSheet, "name"> {
  kind: string;
}

function streamSheets(root: ValueStreamRoot, labels: StreamExportLabels): KindSheet[] {
  const leafName = new Map([...root.sequence, ...root.cross].map((l) => [l.id, l.name]));
  const leafOf = (id: string) => leafName.get(id) ?? "";
  return [
    {
      kind: labels.streams,
      columns: [text("leaf", labels.leaf), text("parent", labels.parent)],
      rows: [...root.sequence, ...root.cross].map((l) => ({ leaf: l.name, parent: l.parent_name ?? "" })),
    },
    {
      kind: labels.processes,
      columns: [text("name", labels.name), text("subtype", labels.subtype), num("row", labels.row), num("steps", labels.steps)],
      rows: Object.values(root.processes).map((p) => ({
        name: p.name,
        subtype: p.subtype ? (labels.subtypes[p.subtype] ?? p.subtype) : "",
        row: p.id in root.row_of_process ? root.row_of_process[p.id] + 1 : "",
        steps: p.element_count,
      })),
    },
    {
      kind: labels.gates,
      columns: [text("name", labels.name), text("leaf", labels.leaf), text("type", labels.type)],
      rows: root.gates.map((g) => ({ name: g.name, leaf: leafOf(g.leaf_id), type: g.objective_type ?? "" })),
    },
    {
      kind: labels.capabilities,
      columns: [text("name", labels.name), text("group", labels.group), text("leaf", labels.leaf)],
      rows: root.capabilities.map((c) => ({ name: c.name, group: c.group_name, leaf: leafOf(c.leaf_id) })),
    },
    {
      kind: labels.goals,
      columns: [text("name", labels.name), text("description", labels.description)],
      rows: root.goals.map((g) => ({ name: g.name, description: g.description ?? "" })),
    },
  ];
}

export function streamExportData(
  roots: ValueStreamRoot[],
  title: string,
  labels: StreamExportLabels,
  chartNode: HTMLElement | null,
): ReportExportData {
  const used = new Set<string>(); // lower-cased: Excel sheet names are case-insensitive
  const unique = (name: string): string => {
    let out = name;
    let n = 1;
    while (used.has(out.toLowerCase())) {
      const tag = ` ${++n}`;
      out = `${name.slice(0, MAX_SHEET_NAME - tag.length).trimEnd()}${tag}`;
    }
    used.add(out.toLowerCase());
    return out;
  };

  const sheets: ExportSheet[] = [];
  for (const root of roots) {
    for (const { kind, columns, rows } of streamSheets(root, labels)) {
      if (rows.length === 0) continue;
      // Clip the root name, not the kind, so the sheets of one root stay tellable apart.
      const tag = ` - ${kind}`;
      const head = cleanSheetName(root.name).slice(0, Math.max(0, MAX_SHEET_NAME - tag.length)).trimEnd();
      const name = cleanSheetName(`${head}${tag}`).slice(0, MAX_SHEET_NAME) || "Sheet";
      sheets.push({ name: unique(name), columns, rows });
    }
  }
  return { title, chartNode, sheets };
}
