/**
 * The Cost report's Sankey, as an ECharts option. Pure: `CostReport.tsx` hands
 * in the nodes and links the page keeps (cost items -> groups -> cards) and the
 * chart chrome, and gets back the option `EChart` draws.
 *
 * A node is a bar coloured by its kind (`costSankeyNodeColor`): a cost item in
 * the brand blue, a group, or a card in its card type's colour. ECharts needs a
 * unique `name` per node, so the node id is the name and the label formatter
 * maps it back to the card's own name, shortened to `MAX_LABEL`. Labels of the
 * last column sit right of its bars, in the room `sankeyInset` keeps for them.
 */
import type { EChartsCoreOption } from "echarts/core";
import type { EChartsChrome } from "@/components/charts/echartsTheme";
import { base, escapeHtml, tooltip, type ChartChromeContext } from "@/components/charts/chrome";
import { sankeyInset } from "@/features/dashboard/charts/buildOption";
import { brand, CARD_TYPE_COLORS, CATEGORICAL_COLORS, DEFAULT_LAYER_COLOR } from "@/theme";

const MAX_LABEL = 24;

/** A node's colour by kind: cost item, group, or the card's type. */
export function costSankeyNodeColor(type: string): string {
  if (type === "CostItem") return brand.primary;
  if (type === "Group") return CATEGORICAL_COLORS[7];
  return CARD_TYPE_COLORS[type as keyof typeof CARD_TYPE_COLORS] ?? DEFAULT_LAYER_COLOR;
}

export interface CostSankeyNodeIn {
  id: string;
  name: string;
  type: string;
}

export interface CostSankeyLinkIn {
  /** Index into the nodes. */
  source: number;
  target: number;
  value: number;
}

export interface CostSankeyOptions {
  chrome: EChartsChrome;
  isRtl: boolean;
  /** A cost as the workspace's currency prints it. */
  format: (v: number) => string;
}

/** A name shortened to `MAX_LABEL` characters, with an ellipsis. */
export function shortenSankeyLabel(name: string): string {
  return name.length > MAX_LABEL ? `${name.slice(0, MAX_LABEL - 1)}…` : name;
}

/** The Sankey of the kept nodes and links. */
export function buildCostSankeyOption(
  nodes: CostSankeyNodeIn[],
  links: CostSankeyLinkIn[],
  o: CostSankeyOptions,
): EChartsCoreOption {
  const ctx: ChartChromeContext = { theme: o.chrome, isRtl: o.isRtl, valueFormatter: o.format };
  const nameOf = new Map(nodes.map((n) => [n.id, n.name]));
  // The last column's labels sit right of its bars: keep room for them.
  const hasOutgoing = new Set(links.map((l) => nodes[l.source]?.id));
  const inset = sankeyInset(
    nodes.filter((n) => !hasOutgoing.has(n.id)).map((n) => shortenSankeyLabel(n.name)),
  );
  const arrow = o.isRtl ? "←" : "→";
  return {
    ...base(ctx),
    tooltip: tooltip(ctx, {
      trigger: "item",
      formatter: (p: {
        dataType?: string;
        name?: string;
        value?: number;
        data?: { source?: string; target?: string };
      }) => {
        const v = escapeHtml(o.format(Number(p.value ?? 0)));
        if (p.dataType === "edge" && p.data) {
          const from = escapeHtml(nameOf.get(p.data.source ?? "") ?? "");
          const to = escapeHtml(nameOf.get(p.data.target ?? "") ?? "");
          return `${from} ${arrow} ${to}: ${v}`;
        }
        return `${escapeHtml(nameOf.get(p.name ?? "") ?? "")}: ${v}`;
      },
    }),
    series: [
      {
        type: "sankey",
        left: 8,
        right: inset,
        top: 8,
        bottom: 8,
        nodeWidth: 14,
        nodeGap: 12,
        draggable: false,
        emphasis: { focus: "adjacency" },
        label: {
          color: ctx.theme.textPrimary,
          fontSize: 12,
          formatter: (p: { name?: string }) => shortenSankeyLabel(nameOf.get(p.name ?? "") ?? ""),
        },
        lineStyle: { color: "gradient", opacity: 0.35, curveness: 0.5 },
        itemStyle: { borderColor: ctx.theme.surface, borderWidth: 1 },
        data: nodes.map((n) => ({ name: n.id, itemStyle: { color: costSankeyNodeColor(n.type) } })),
        links: links.map((l) => ({
          source: nodes[l.source].id,
          target: nodes[l.target].id,
          value: l.value,
        })),
      },
    ],
  };
}
