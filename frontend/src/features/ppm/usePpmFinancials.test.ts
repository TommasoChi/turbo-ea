import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { financialAmountFormatter, usePpmFinancials, usePpmLatestReport, usePpmRisks, usePpmSchedule } from "./usePpmFinancials";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
  isAbortError: (error: Error) => error.name === "AbortError",
}));

const get = vi.mocked(api.get);

beforeEach(() => get.mockReset());

describe.each([
  ["financials", usePpmFinancials],
  ["schedule", usePpmSchedule],
] as const)("protected %s query", (suffix, read) => {
  it("removes the previous initiative immediately and ignores a late response after denial", async () => {
    let resolveLate: (value: { initiative_id: string }) => void = () => {};
    const late = new Promise<{ initiative_id: string }>((resolve) => {
      resolveLate = resolve;
    });
    const denied = new Error("Forbidden");
    get
      .mockResolvedValueOnce({ initiative_id: "old" })
      .mockImplementationOnce(() => late)
      .mockRejectedValueOnce(denied);
    const { result, rerender } = renderHook(({ id }) => read(id), {
      initialProps: { id: "old" },
    });
    await waitFor(() => expect(result.current.data?.initiative_id).toBe("old"));
    act(() => result.current.refetch());
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    rerender({ id: "denied" });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.error).toBe(denied));
    await act(async () => resolveLate({ initiative_id: "old" }));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBe(denied);
    expect(get).toHaveBeenLastCalledWith("/ppm/initiatives/denied/" + suffix, {
      signal: expect.any(AbortSignal),
    });
  });

  it("drops a successful payload from a different initiative", async () => {
    get.mockResolvedValueOnce({ initiative_id: "other" });
    const { result } = renderHook(() => read("active"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeUndefined();
  });
});

describe("financial amounts", () => {
  it("formats authoritative decimal text without conversion to a floating point amount", () => {
    const format = financialAmountFormatter("USD", "en-US");
    expect(format("30.11")).toBe("$30.11");
    expect(format("70.02")).toBe("$70.02");
    expect(format("-0.230")).toBe("-$0.230");
    expect(format("9007199254740993.001")).toBe("$9,007,199,254,740,993.001");
    expect(format(null)).toBe("—");
    expect(financialAmountFormatter("EUR", "it-IT")("12030.04")).toBe("12.030,04\u00a0€");
  });
});

describe("usePpmLatestReport", () => {
  it("returns the first report, the server's newest, and ignores a previous initiative's answer", async () => {
    get
      .mockResolvedValueOnce([
        { id: "b", report_date: "2026-03-01" },
        { id: "c", report_date: "2026-02-01" },
        { id: "a", report_date: "2026-01-01" },
      ])
      .mockResolvedValueOnce([]);
    const { result, rerender } = renderHook(({ id }) => usePpmLatestReport(id), {
      initialProps: { id: "i1" },
    });
    await waitFor(() => expect(result.current.data?.id).toBe("b"));
    expect(get).toHaveBeenCalledWith("/ppm/initiatives/i1/reports", { signal: expect.any(AbortSignal) });
    rerender({ id: "i2" });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
  });

  it("trusts the server's order instead of re-sorting", async () => {
    get.mockResolvedValueOnce([
      { id: "first", report_date: "2026-01-01" },
      { id: "second", report_date: "2026-03-01" },
    ]);
    const { result } = renderHook(() => usePpmLatestReport("i1"));
    await waitFor(() => expect(result.current.data?.id).toBe("first"));
  });

  it("reloads when refetchKey changes", async () => {
    get.mockResolvedValueOnce([{ id: "old", report_date: "2026-01-01", created_at: "x" }]);
    get.mockResolvedValueOnce([{ id: "new", report_date: "2026-02-01", created_at: "x" }]);
    const { result, rerender } = renderHook(({ key }) => usePpmLatestReport("i1", key), {
      initialProps: { key: 0 },
    });
    await waitFor(() => expect(result.current.data?.id).toBe("old"));
    rerender({ key: 1 });
    await waitFor(() => expect(result.current.data?.id).toBe("new"));
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][0]).toBe(get.mock.calls[0][0]);
  });
});

describe("usePpmRisks", () => {
  it("reads the initiative's risks, drops the previous initiative's and reloads on refetchKey", async () => {
    get
      .mockResolvedValueOnce([{ id: "r1" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "r2" }, { id: "r3" }]);
    const { result, rerender } = renderHook(({ id, key }) => usePpmRisks(id, key), {
      initialProps: { id: "i1", key: 0 },
    });
    await waitFor(() => expect(result.current.data?.map((r) => r.id)).toEqual(["r1"]));
    expect(get).toHaveBeenCalledWith("/ppm/initiatives/i1/risks", { signal: expect.any(AbortSignal) });
    rerender({ id: "i2", key: 0 });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).toEqual([]));
    rerender({ id: "i2", key: 1 });
    await waitFor(() => expect(result.current.data).toHaveLength(2));
  });

  it("reads nothing without an initiative and gives null on an error", async () => {
    const none = renderHook(() => usePpmRisks(null));
    expect(none.result.current.data).toBeNull();
    expect(get).not.toHaveBeenCalled();
    get.mockRejectedValueOnce(new Error("Forbidden"));
    const denied = renderHook(() => usePpmRisks("i1"));
    await waitFor(() => expect(denied.result.current.error).toBeTruthy());
    expect(denied.result.current.data).toBeNull();
  });
});
