import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PpmRisk } from "@/types";
import PpmRiskSummary from "./PpmRiskSummary";

interface ChartProps {
  option: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  labelledBy?: string;
  onLegendSelectChanged?: (p: { name: string; selected: Record<string, boolean> }) => void;
}
interface MatrixProps {
  risks: readonly PpmRisk[];
  size?: string;
}

const mocks = vi.hoisted(() => ({
  charts: [] as ChartProps[],
  matrices: [] as MatrixProps[],
}));

vi.mock("@/components/charts/EChart", () => ({
  default: (props: ChartProps) => {
    mocks.charts.push(props);
    return <div role="img" aria-labelledby={props.labelledBy} />;
  },
}));
vi.mock("./PpmRiskMatrix", () => ({
  default: (props: MatrixProps) => {
    mocks.matrices.push(props);
    return <div data-testid="matrix" />;
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

/** The latest option of the chart whose visible title is `title`. */
const chartTitled = (title: string) => {
  const last = [...mocks.charts]
    .reverse()
    .find((c) => c.labelledBy && document.getElementById(c.labelledBy)?.textContent === title);
  if (!last) throw new Error(`no chart titled ${title}`);
  return last;
};
const donut = () => chartTitled("How exposed are we?");
const tile = (name: string) => screen.getByText(name).parentElement as HTMLElement;
const lastMatrix = () => mocks.matrices[mocks.matrices.length - 1];
const hideBands = (selected: Record<string, boolean>) =>
  act(() => donut().onLegendSelectChanged?.({ name: "High", selected }));

beforeEach(() => {
  mocks.charts.length = 0;
  mocks.matrices.length = 0;
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

  it("names each chart and the heat map by its visible title", () => {
    render(<PpmRiskSummary risks={RISKS} />);
    expect(screen.getByRole("img", { name: "How exposed are we?" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Where do the risks stand?" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Where do the risks sit?" })).toBeInTheDocument();
  });

  it("a legend click removes the band from the centre total and the selection survives a re-render", () => {
    const { rerender } = render(<PpmRiskSummary risks={RISKS} />);
    hideBands({ High: false, Medium: true, Low: true });
    expect(donut().option.title.text).toBe("2");
    expect(donut().option.legend.selected).toEqual({ High: false, Medium: true, Low: true });
    rerender(<PpmRiskSummary risks={[...RISKS]} />);
    expect(donut().option.legend.selected.High).toBe(false);
    expect(donut().option.title.text).toBe("2");
  });

  it("keeps a hidden band hidden when the risks change, and the total follows the new counts", () => {
    const { rerender } = render(<PpmRiskSummary risks={RISKS} />);
    hideBands({ High: false, Medium: true, Low: true });
    rerender(
      <PpmRiskSummary risks={[...RISKS, risk("r6", "open", 5, 5), risk("r7", "open", 3, 3)]} />,
    );
    expect(donut().option.legend.selected.High).toBe(false);
    expect(donut().option.title.text).toBe("3");
  });

  it("hiding every band shows 0", () => {
    render(<PpmRiskSummary risks={RISKS} />);
    hideBands({ High: false, Medium: false, Low: false });
    expect(donut().option.title.text).toBe("0");
  });

  it("keeps both chart options when only an unrelated prop changes, so the charts do not replay", () => {
    const { rerender } = render(<PpmRiskSummary risks={RISKS} />);
    const [donutBefore, statusBefore] = [donut().option, chartTitled("Where do the risks stand?").option];
    rerender(<PpmRiskSummary risks={RISKS} onManage={() => {}} />);
    expect(donut().option).toBe(donutBefore);
    expect(chartTitled("Where do the risks stand?").option).toBe(statusBefore);
  });

  it("builds a new donut option when a legend click changes the selection", () => {
    render(<PpmRiskSummary risks={RISKS} />);
    const before = donut().option;
    hideBands({ High: false });
    expect(donut().option).not.toBe(before);
  });

  it("is a region named by its title in every state", () => {
    const { rerender } = render(<PpmRiskSummary risks={null} />);
    expect(screen.getByRole("region", { name: "Risk Management" })).toBeInTheDocument();
    rerender(<PpmRiskSummary risks={[]} />);
    expect(screen.getByRole("region", { name: "Risk Management" })).toBeInTheDocument();
    rerender(<PpmRiskSummary risks={RISKS} />);
    expect(screen.getByRole("region", { name: "Risk Management" })).toHaveTextContent("Total");
  });

  it("lets the three tiles wrap on a narrow screen", () => {
    render(<PpmRiskSummary risks={RISKS} />);
    const row = tile("Total").parentElement!;
    expect(getComputedStyle(row).flexWrap).toBe("wrap");
  });

  it("the status bars list the five statuses", () => {
    render(<PpmRiskSummary risks={RISKS} />);
    const opt = chartTitled("Where do the risks stand?").option;
    expect(opt.yAxis.data).toEqual(["Open", "Mitigating", "Mitigated", "Closed", "Accepted"]);
    expect(opt.series[0].data.map((d: { value: number }) => d.value)).toEqual([2, 1, 1, 1, 0]);
  });

  it("draws a compact heat map over the active risks only", () => {
    render(<PpmRiskSummary risks={RISKS} />);
    expect(lastMatrix().size).toBe("compact");
    expect(lastMatrix().risks.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("with no active risk the centre, Open, High open and heat map are all empty", () => {
    render(<PpmRiskSummary risks={[risk("r1", "closed", 5, 5), risk("r2", "accepted", 4, 4)]} />);
    expect(tile("Total")).toHaveTextContent("2");
    expect(tile("Open")).toHaveTextContent("0");
    expect(tile("High open")).toHaveTextContent("0");
    expect(donut().option.title.text).toBe("0");
    expect(lastMatrix().risks).toHaveLength(0);
  });

  it("Manage appears only with onManage, is named for the risks and calls it", async () => {
    const onManage = vi.fn();
    const { rerender } = render(<PpmRiskSummary risks={RISKS} />);
    expect(screen.getByText("Risk Management")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage risks" })).not.toBeInTheDocument();
    rerender(<PpmRiskSummary risks={RISKS} onManage={onManage} />);
    await userEvent.click(screen.getByRole("button", { name: "Manage risks" }));
    expect(onManage).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Manage")).toBeInTheDocument();
  });

  it("an empty list shows the empty state and no charts", () => {
    render(<PpmRiskSummary risks={[]} />);
    expect(screen.getByText("No risks yet")).toBeInTheDocument();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("shows a loading line while the risks are not loaded", () => {
    render(<PpmRiskSummary risks={null} />);
    expect(screen.getByText("Loading risks…")).toBeInTheDocument();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });
});
