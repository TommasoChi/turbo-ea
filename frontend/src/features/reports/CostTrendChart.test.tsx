import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import CostTrendChart from "./CostTrendChart";

vi.mock("@/api/client", () => ({ api: { get: vi.fn() }, isAbortError: () => false }));
vi.mock("recharts", () => ({
  BarChart: ({ data }: { data: unknown }) => <div data-testid="rows">{JSON.stringify(data)}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
import { api } from "@/api/client";

const rowsOf = () => JSON.parse(screen.getByTestId("rows").textContent ?? "[]");
const yearOf = (path: string) => new URLSearchParams(path.split("?")[1]).get("fiscal_year")!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation((path: string) => {
    const p = new URLSearchParams(path.split("?")[1]);
    const field = p.get("cost_field");
    const fy = p.get("fiscal_year");
    const totals: Record<string, number> = {
      "softwareLicensingCost:2025": 100,
      "applicationManagementServicesCost:2025": 50,
      "infrastruttureCost:2025": 20,
      "softwareLicensingCost:2026": 120,
      "applicationManagementServicesCost:2026": 60,
      "infrastruttureCost:2026": 25,
    };
    return Promise.resolve({ items: [], total: totals[`${field}:${fy}`] ?? 0 }) as never;
  });
});

describe("CostTrendChart", () => {
  it("fetches each category field for each year and renders a bar per year", async () => {
    render(<CostTrendChart cardTypeKey="Application" years={[2025, 2026]} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(6)); // 2 years x 3 fields
    expect(screen.getByTestId("cost-trend-chart")).toBeInTheDocument();
    await waitFor(() =>
      expect(rowsOf()).toEqual([
        {
          fiscalYear: 2025,
          softwareLicensingCost: 100,
          applicationManagementServicesCost: 50,
          infrastruttureCost: 20,
        },
        {
          fiscalYear: 2026,
          softwareLicensingCost: 120,
          applicationManagementServicesCost: 60,
          infrastruttureCost: 25,
        },
      ]),
    );
  });

  it("handles a type with no category fields by rendering a zero series, not erroring", async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [], total: 0 } as never);
    render(<CostTrendChart cardTypeKey="Team" years={[2025]} />);
    expect(await screen.findByTestId("cost-trend-chart")).toBeInTheDocument();
  });

  it("is unaffected by group_by — never sends a group_by param", async () => {
    render(<CostTrendChart cardTypeKey="Application" years={[2025]} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const calls = vi.mocked(api.get).mock.calls.map(([p]) => String(p));
    for (const c of calls) expect(c).not.toContain("group_by");
  });

  it("aborts the requests still in flight when the years change", async () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}) as never);
    const { rerender } = render(<CostTrendChart cardTypeKey="Application" years={[2025]} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(3));
    const firstSignals = vi.mocked(api.get).mock.calls.map(([, opts]) => opts?.signal);

    rerender(<CostTrendChart cardTypeKey="Application" years={[2026]} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(6));

    expect(firstSignals).toHaveLength(3);
    for (const signal of firstSignals) expect(signal?.aborted).toBe(true);
    const latestSignals = vi.mocked(api.get).mock.calls.slice(3).map(([, opts]) => opts?.signal);
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

    const { rerender } = render(<CostTrendChart cardTypeKey="Application" years={[2025]} />);
    await waitFor(() => expect(pending).toHaveLength(3));
    rerender(<CostTrendChart cardTypeKey="Application" years={[2026]} />);
    await waitFor(() => expect(pending).toHaveLength(6));

    settle("2026", 7);
    const latest = [
      {
        fiscalYear: 2026,
        softwareLicensingCost: 7,
        applicationManagementServicesCost: 7,
        infrastruttureCost: 7,
      },
    ];
    await waitFor(() => expect(rowsOf()).toEqual(latest));

    await act(async () => {
      settle("2025", 99); // the superseded request lands last
    });
    expect(rowsOf()).toEqual(latest);
  });
});
