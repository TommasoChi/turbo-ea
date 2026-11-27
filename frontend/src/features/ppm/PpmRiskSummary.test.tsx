import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PpmRisk } from "@/types";
import PpmRiskSummary from "./PpmRiskSummary";

interface ChartProps {
  option: Record<string, unknown> & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  ariaLabel?: string;
  onLegendSelectChanged?: (p: { name: string; selected: Record<string, boolean> }) => void;
}

const charts = vi.hoisted(() => ({ calls: [] as ChartProps[] }));

vi.mock("@/components/charts/EChart", () => ({
  default: (props: ChartProps) => {
    charts.calls.push(props);
    return <div data-testid="echart" data-label={props.ariaLabel} />;
  },
}));

const risk = (
  id: string,
  status: PpmRisk["status"],
  probability: number,
  impact: number,
): PpmRisk =>
  ({ id, status, probability, impact, risk_score: probability * impact }) as PpmRisk;

// active: r1 high, r2 medium, r3 low; inactive: r4 closed high, r5 mitigated
const RISKS = [
  risk("r1", "open", 5, 4),
  risk("r2", "mitigating", 3, 3),
  risk("r3", "open", 1, 2),
  risk("r4", "closed", 5, 5),
  risk("r5", "mitigated", 2, 2),
];

const chartNamed = (label: RegExp) => {
  const last = [...charts.calls].reverse().find((c) => label.test(c.ariaLabel ?? ""));
  if (!last) throw new Error(`no chart ${label}`);
  return last;
};
const donut = () => chartNamed(/exposed/i);
const tile = (name: string) => screen.getByText(name).parentElement as HTMLElement;

beforeEach(() => {
  charts.calls.length = 0;
});

describe("PpmRiskSummary", () => {
  it("shows Total, Open and High open from the active risks", () => {
    render(<PpmRiskSummary risks={RISKS} />);
    expect(tile("Total")).toHaveTextContent("5");
    expect(tile("Open")).toHaveTextContent("3");
    expect(tile("High open")).toHaveTextContent("1");
  });

  it("donut centre total is the active count", () => {
    render(<PpmRiskSummary risks={RISKS} />);
    expect(donut().option.title.text).toBe("3");
    const data = donut().option.series[0].data;
    expect(data.map((d: { name: string; value: number }) => [d.name, d.value])).toEqual([
      ["High", 1],
      ["Medium", 1],
      ["Low", 1],
    ]);
  });

  it("a legend click removes the band from the centre total and the selection survives a re-render", () => {
    const { rerender } = render(<PpmRiskSummary risks={RISKS} />);
    act(() =>
      donut().onLegendSelectChanged?.({
        name: "High",
        selected: { High: false, Medium: true, Low: true },
      }),
    );
    expect(donut().option.title.text).toBe("2");
    expect(donut().option.legend.selected).toEqual({ High: false, Medium: true, Low: true });
    rerender(<PpmRiskSummary risks={[...RISKS]} />);
    expect(donut().option.legend.selected.High).toBe(false);
    expect(donut().option.title.text).toBe("2");
  });

  it("hiding every band shows 0", () => {
    render(<PpmRiskSummary risks={RISKS} />);
    act(() =>
      donut().onLegendSelectChanged?.({
        name: "Low",
        selected: { High: false, Medium: false, Low: false },
      }),
    );
    expect(donut().option.title.text).toBe("0");
  });

  it("the status bars list the five statuses", () => {
    render(<PpmRiskSummary risks={RISKS} />);
    const opt = chartNamed(/stand/i).option;
    const cats = (Array.isArray(opt.yAxis) ? opt.yAxis[0] : opt.yAxis).data;
    expect(cats).toEqual(["Open", "Mitigating", "Mitigated", "Closed", "Accepted"]);
    expect(opt.series[0].data.map((d: { value: number } | number) =>
      typeof d === "number" ? d : d.value,
    )).toEqual([2, 1, 1, 1, 0]);
  });

  it("draws the heat map over the active risks", () => {
    const { container } = render(<PpmRiskSummary risks={RISKS} />);
    expect(container.querySelectorAll("[data-row]")).toHaveLength(25);
  });

  it("Manage appears only with onManage and calls it", async () => {
    const onManage = vi.fn();
    const { rerender } = render(<PpmRiskSummary risks={RISKS} />);
    expect(screen.getByText("Risk Management")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage" })).not.toBeInTheDocument();
    rerender(<PpmRiskSummary risks={RISKS} onManage={onManage} />);
    await userEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(onManage).toHaveBeenCalledTimes(1);
  });

  it("an empty list shows the empty state and no charts", () => {
    render(<PpmRiskSummary risks={[]} />);
    expect(screen.getByText("No risks yet")).toBeInTheDocument();
    expect(screen.queryAllByTestId("echart")).toHaveLength(0);
  });

  it("shows a loading line while the risks are not loaded", () => {
    render(<PpmRiskSummary risks={null} />);
    expect(screen.getByText("Loading risks…")).toBeInTheDocument();
    expect(screen.queryAllByTestId("echart")).toHaveLength(0);
  });
});
