import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/api/client", () => ({ api: { get: vi.fn() }, isAbortError: () => false }));
import { api } from "@/api/client";
import { useCostBreakdown } from "./useCostBreakdown";

const RESPONSE = {
  nodes: [
    { id: "group:fin", name: "Finance", type: "Group" },
    { id: "item:lic", name: "Licences", type: "CostItem" },
    { id: "a", name: "SAP", type: "Application", cost: 15, costs: { lic: 10, __other__: 5 } },
    { id: "b", name: "DB", type: "ITComponent", cost: 7, costs: { lic: 7 } },
  ],
  links: [],
  total: 22,
};
const args = (over = {}) => ({ enabled: true, typeParam: "Application", groupBy: "", fiscalYear: null, ...over });

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue(RESPONSE as never);
});

describe("useCostBreakdown", () => {
  it("maps card nodes to their total and per-item costs and ignores group and item nodes", async () => {
    const { result } = renderHook(() => useCostBreakdown(args()));
    expect(result.current.breakdown).toBeNull();
    await waitFor(() => expect(result.current.breakdown).not.toBeNull());
    expect([...result.current.breakdown!.keys()]).toEqual(["a", "b"]);
    expect(result.current.breakdown!.get("a")).toEqual({ total: 15, items: { lic: 10, __other__: 5 } });
  });

  it("asks the Sankey endpoint for the TCO with group_by and fiscal_year", async () => {
    renderHook(() => useCostBreakdown(args({ groupBy: "field:tier", fiscalYear: 2027 })));
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const q = new URLSearchParams(String(vi.mocked(api.get).mock.calls[0][0]).split("?")[1]);
    expect(String(vi.mocked(api.get).mock.calls[0][0])).toMatch(/^\/reports\/cost-sankey\?/);
    expect(q.get("type")).toBe("Application");
    expect(q.get("cost_field")).toBe("costTotalAnnual");
    expect(q.get("group_by")).toBe("field:tier");
    expect(q.get("fiscal_year")).toBe("2027");
  });

  it("does not call the API when disabled", async () => {
    const { result } = renderHook(() => useCostBreakdown(args({ enabled: false })));
    await act(async () => {});
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.breakdown).toBeNull();
  });

  it("drops a stale response when the arguments change", async () => {
    const pending: ((v: unknown) => void)[] = [];
    vi.mocked(api.get).mockImplementation(() => new Promise((r) => pending.push(r)) as never);
    const { result, rerender } = renderHook((p) => useCostBreakdown(p), { initialProps: args() });
    await waitFor(() => expect(pending).toHaveLength(1));
    rerender(args({ typeParam: "ITComponent" }));
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => {
      pending[1]({ ...RESPONSE, nodes: [{ id: "b", name: "DB", type: "ITComponent", cost: 7, costs: { lic: 7 } }] });
    });
    await act(async () => {
      pending[0](RESPONSE); // the superseded request lands last
    });
    expect([...result.current.breakdown!.keys()]).toEqual(["b"]);
  });
});
