import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import CostTrendChart from "./CostTrendChart";

let axisFormatter: ((v: number) => string) | undefined;

vi.mock("@/api/client", () => ({ api: { get: vi.fn() }, isAbortError: () => false }));
vi.mock("recharts", () => ({
  BarChart: ({ data, children }: { data: unknown; children?: React.ReactNode }) => (
    <div>
      <div data-testid="rows">{JSON.stringify(data)}</div>
      {children}
    </div>
  ),
  Bar: ({ dataKey, fill }: { dataKey: string; fill: string }) => (
    <i data-testid="bar" data-fill={fill}>
      {dataKey}
    </i>
  ),
  XAxis: ({ tickFormatter }: { tickFormatter?: (v: number) => string }) => {
    axisFormatter = tickFormatter;
    return null;
  },
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
import { api } from "@/api/client";

const rowsOf = () => JSON.parse(screen.getByTestId("rows").textContent ?? "[]");
const yearOf = (path: string) => new URLSearchParams(path.split("?")[1]).get("fiscal_year")!;
const barKeys = () => screen.queryAllByTestId("bar").map((b) => b.textContent);

const COMPONENTS = ["licenseCost", "serviceCost"];
const props = (over: Partial<React.ComponentProps<typeof CostTrendChart>> = {}) => ({
  typeParam: "Application",
  costField: "costTotalAnnual",
  components: COMPONENTS,
  years: [2025, 2026],
  currentFiscalYear: 2026,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation((path: string) => {
    const p = new URLSearchParams(path.split("?")[1]);
    const totals: Record<string, number> = {
      "licenseCost:2025": 100,
      "serviceCost:2025": 50,
      "licenseCost:2026": 120,
      "serviceCost:2026": 60,
    };
    return Promise.resolve({
      items: [],
      total: totals[`${p.get("cost_field")}:${p.get("fiscal_year")}`] ?? 0,
    }) as never;
  });
});

describe("CostTrendChart", () => {
  it("requests each component for each year with the component as cost_field", async () => {
    render(<CostTrendChart {...props()} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(4)); // 2 years x 2 components
    const paths = vi.mocked(api.get).mock.calls.map(([p]) => String(p));
    expect(paths).toContain(
      "/reports/cost-treemap?type=Application&cost_field=licenseCost&fiscal_year=2025",
    );
    expect(paths).toContain(
      "/reports/cost-treemap?type=Application&cost_field=serviceCost&fiscal_year=2026",
    );
    await waitFor(() =>
      expect(rowsOf()).toEqual([
        { fiscalYear: 2025, licenseCost: 100, serviceCost: 50 },
        { fiscalYear: 2026, licenseCost: 120, serviceCost: 60 },
      ]),
    );
  });

  it("draws one bar per component, keyed by the technical key, with distinct colours", async () => {
    render(<CostTrendChart {...props()} />);
    await waitFor(() => expect(barKeys()).toEqual(COMPONENTS));
    const fills = screen.getAllByTestId("bar").map((b) => b.getAttribute("data-fill"));
    expect(new Set(fills).size).toBe(2);
  });

  it("updates the bars and refetches when the component list changes", async () => {
    const { rerender } = render(<CostTrendChart {...props()} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(4));
    rerender(<CostTrendChart {...props({ components: ["licenseCost"] })} />);
    await waitFor(() => expect(barKeys()).toEqual(["licenseCost"]));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(6));
  });

  it("does not refetch for a new array with the same components", async () => {
    const years = [2025, 2026];
    const { rerender } = render(<CostTrendChart {...props({ years })} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(4));
    rerender(<CostTrendChart {...props({ years, components: [...COMPONENTS] })} />);
    await act(async () => {});
    expect(api.get).toHaveBeenCalledTimes(4);
  });

  it("labels the axis with FY names", async () => {
    render(<CostTrendChart {...props({ years: [2025, 2026, 2027] })} />);
    await waitFor(() => expect(axisFormatter).toBeDefined());
    expect(axisFormatter!(2027)).toBe("FY27 - Forecast");
    expect(axisFormatter!(2026)).toBe("FY26 - Current");
    expect(axisFormatter!(2025)).toBe("FY25");
  });

  it("never sends a group_by param", async () => {
    render(<CostTrendChart {...props({ years: [2025] })} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    for (const [p] of vi.mocked(api.get).mock.calls) expect(String(p)).not.toContain("group_by");
  });

  it("aborts the requests still in flight when the years change", async () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}) as never);
    const { rerender } = render(<CostTrendChart {...props({ years: [2025] })} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    const firstSignals = vi.mocked(api.get).mock.calls.map(([, opts]) => opts?.signal);

    rerender(<CostTrendChart {...props({ years: [2026] })} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(4));

    expect(firstSignals).toHaveLength(2);
    for (const signal of firstSignals) expect(signal?.aborted).toBe(true);
    const latestSignals = vi.mocked(api.get).mock.calls.slice(2).map(([, opts]) => opts?.signal);
    for (const signal of latestSignals) expect(signal?.aborted).toBe(false);
  });

  it("keeps the latest selection's rows when an older request resolves last", async () => {
    const pending: { year: string; resolve: (v: unknown) => void }[] = [];
    vi.mocked(api.get).mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          pending.push({ year: yearOf(path), resolve });
        }) as never,
    );
    const settle = (year: string, total: number) =>
      pending.filter((p) => p.year === year).forEach((p) => p.resolve({ items: [], total }));

    const { rerender } = render(<CostTrendChart {...props({ years: [2025] })} />);
    await waitFor(() => expect(pending).toHaveLength(2));
    rerender(<CostTrendChart {...props({ years: [2026] })} />);
    await waitFor(() => expect(pending).toHaveLength(4));

    settle("2026", 7);
    const latest = [{ fiscalYear: 2026, licenseCost: 7, serviceCost: 7 }];
    await waitFor(() => expect(rowsOf()).toEqual(latest));

    await act(async () => {
      settle("2025", 99); // the superseded request lands last
    });
    expect(rowsOf()).toEqual(latest);
  });
});
