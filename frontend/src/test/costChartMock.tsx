/**
 * The test double for `@/components/charts/EChart` on the Cost report's page
 * tests. jsdom has no canvas, so the page's charts are drawn as plain DOM read
 * from the option the page built:
 *
 * - a Sankey is `data-testid="sankey"` carrying `data-nodes` (the node ids),
 *   `data-names` (the labels the chart prints) and `data-links` (index-based);
 * - a treemap is `data-testid="treemap"` holding an `<svg>` with one `<text>`
 *   per group name, card name, cost and change badge, and a
 *   `data-testid="treemap-tooltip"` with the first card's tooltip;
 * - a click on a card's `<g>` is delivered as ECharts would, with the datum.
 *
 * ```ts
 * vi.mock("@/components/charts/EChart", () => import("@/test/costChartMock").then((m) => m.costChartModule()));
 * ```
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- an option tree is plain JSON a test digs into */
import type { CSSProperties } from "react";

interface Props {
  option: any;
  onClick?: (p: unknown) => void;
  onContextMenu?: (p: unknown) => void;
  style?: CSSProperties;
}

/** The cards of a treemap series, flattened out of their groups. */
function leavesOf(data: any[]): any[] {
  return data.flatMap((d) => (d.children ? d.children : [d]));
}

function MockCostChart({ option, onClick, onContextMenu }: Props) {
  const s = option.series?.[0];
  if (s?.type === "sankey") {
    const ids: string[] = s.data.map((d: any) => d.name);
    const links = s.links.map((l: any) => ({
      source: ids.indexOf(l.source),
      target: ids.indexOf(l.target),
      value: l.value,
    }));
    return (
      <div
        data-testid="sankey"
        data-nodes={JSON.stringify(ids)}
        data-names={JSON.stringify(ids.map((id) => s.label.formatter({ name: id })))}
        data-links={JSON.stringify(links)}
      />
    );
  }
  if (s?.type === "treemap") {
    const groups: any[] = s.data.filter((d: any) => d.children);
    const leaves = leavesOf(s.data);
    const tooltip = leaves[0] ? option.tooltip.formatter({ data: leaves[0] }) : "";
    return (
      <div data-testid="treemap">
        <svg>
          {groups.map((g) => (
            <text key={`group:${g.name}`}>{g.name}</text>
          ))}
          {leaves.map((d, i) => {
            const printed: string = s.label.formatter({
              dataIndex: i,
              name: d.name,
              value: d.value,
              data: d,
            });
            const [name, ...rest] = printed.split("\n");
            const rich = [...rest.join("\n").matchAll(/\{\w+\|([^}]*)\}/g)].map((m) => m[1]);
            return (
              <g
                key={d.id ?? d.name}
                onClick={() => onClick?.({ data: d, name: d.name })}
                onContextMenu={() => onContextMenu?.({ data: d, name: d.name })}
              >
                <text>{name}</text>
                {rich.map((r, j) => (
                  <text key={j}>{r}</text>
                ))}
              </g>
            );
          })}
        </svg>
        <div data-testid="treemap-tooltip" dangerouslySetInnerHTML={{ __html: tooltip }} />
      </div>
    );
  }
  return <div data-testid="echart" />;
}

export function costChartModule(): { default: typeof MockCostChart; EXPORT_DPR: 2; ECHART_CLASS: string } {
  return { default: MockCostChart, EXPORT_DPR: 2, ECHART_CLASS: "echart-container" };
}
