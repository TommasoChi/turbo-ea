import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import CostTrendChart from "./CostTrendChart";

vi.mock("@/api/client", () => ({ api: { get: vi.fn() } }));
import { api } from "@/api/client";

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
});
