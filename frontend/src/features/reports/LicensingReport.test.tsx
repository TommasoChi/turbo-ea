/**
 * The Licensing report page: request shape, metric cards, the trend above every view, the
 * Utilisation and By-license-type views and the drill. Charts are the shared test double.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import i18n from "@/i18n";
import LicensingReport from "./LicensingReport";

vi.mock("@/api/client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: ({ cardId, open }: { cardId: string | null; open: boolean }) =>
    open ? <div data-testid="side-panel">{cardId}</div> : null,
}));
vi.mock("@/components/CardPicker", () => ({
  default: ({ onChange }: { onChange: (v: { id: string; name: string; type: string } | null) => void }) => (
    <button onClick={() => onChange({ id: "plat", name: "Plat", type: "Platform" })}>pick-platform</button>
  ),
}));
vi.mock("@/components/CardScopeFilter", () => ({
  default: ({ onChange }: { onChange: (ids: string[]) => void }) => (
    <button onClick={() => onChange(["B"])}>scope-b</button>
  ),
}));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { echartState } from "@/test/echartMock";

const APP_TYPE = { key: "Application", label: "Application", color: "#0f7eb5", is_hidden: false, has_hierarchy: false, fields_schema: [] };
const ITC_TYPE = { key: "ITComponent", label: "IT Component", color: "#8e24aa", is_hidden: false, has_hierarchy: false, fields_schema: [] };

const cell = (licensed: number, actual: number | null, pct: number | null, status: string) => ({
  licensed, actual, pct, status, no_licence: false,
});
const ROW = (id: string, status: string, worst: number | null, by_type: Record<string, unknown>) => ({
  id, name: id, type: "Application", attributes: {}, status, worst_pct: worst, worst_no_licence: false,
  licensed_total: 10, actual_total: 5, by_type,
});
const ROWS = [
  ROW("A", "over", 120, { admin: cell(10, 12, 120, "over") }),
  ROW("B", "compliant", 50, { admin: cell(10, 5, 50, "compliant"), dev: cell(4, 1, 25, "compliant") }),
  ROW("C", "no_actual_data", null, { dev: cell(5, null, null, "no_data") }),
];
const YEARS = [2022, 2023, 2024, 2025, 2026, 2027];
const TREND = YEARS.map((fy) => ({
  fiscal_year: fy,
  cards: {
    A: { admin: { licensed: 10, actual: fy === 2027 ? null : 12 } },
    B: { admin: { licensed: 10, actual: fy === 2027 ? null : 5 } },
  },
}));
const LICENSE_TYPES = [
  { id: "1", key: "admin", label: "Admin", sort_order: 1, archived: false, translations: {} },
  { id: "2", key: "dev", label: "Dev", sort_order: 2, archived: false, translations: {} },
];
const report = (over = {}) => ({
  fiscal_year: 2026, current_fiscal_year: 2026, fiscal_year_start: 1, metric: "users", years: YEARS,
  license_types: LICENSE_TYPES, aggregate: null, rows: ROWS, trend: TREND, ...over,
});

const reportPaths = () =>
  vi.mocked(api.get).mock.calls.map(([p]) => String(p)).filter((p) => p.startsWith("/reports/licensing"));

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.clearAllMocks();
  echartState.reset();
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith("/reports/licensing")) {
      return Promise.resolve(
        path.includes("card_id=plat")
          ? report({ aggregate: { id: "plat", name: "Plat", type: "Platform" }, rows: ROWS.map((r) => ({ ...r, status: null })) })
          : report(),
      ) as never;
    }
    return Promise.resolve({
      items: ROWS.map((r) => ({ id: r.id, name: r.name, type: "Application", parent_id: null })),
      total: 3,
    }) as never;
  });
  vi.mocked(useMetamodel).mockReturnValue({
    types: [APP_TYPE, ITC_TYPE], relationTypes: [], loading: false, getType: () => undefined,
    getRelationsForType: () => [], invalidateCache: vi.fn(),
  } as never);
});

function renderReport() {
  return render(
    <MemoryRouter>
      <LicensingReport />
    </MemoryRouter>,
  );
}
const card = (label: string) => screen.getByText(label).closest(".MuiPaper-root") as HTMLElement;
const util = () => echartState.byName("Utilisation per card");
const trend = () => echartState.byName("Licensed and actual counts per fiscal year");
const trendBars = () => trend().option.series.filter((s: { type: string }) => s.type === "bar");

describe("LicensingReport", () => {
  it("requests /reports/licensing with type, metric and no fiscal_year by default", async () => {
    renderReport();
    await waitFor(() => expect(reportPaths()).toHaveLength(1));
    expect(reportPaths()[0]).toBe("/reports/licensing?type=Application&metric=users");
  });

  it("metric cards count statuses and follow the license type filter", async () => {
    renderReport();
    await waitFor(() => expect(card("Over-licensed")).toHaveTextContent("1"));
    expect(card("Compliant")).toHaveTextContent("1");
    expect(card("Approaching")).toHaveTextContent("0");
    expect(card("No actual data")).toHaveTextContent("1");

    await userEvent.click(screen.getByRole("combobox", { name: "License type" }));
    await userEvent.click(await screen.findByRole("option", { name: "Dev" }));
    // Only B and C hold a Dev cell: B compliant, C no data.
    await waitFor(() => expect(card("Over-licensed")).toHaveTextContent("0"));
    expect(card("Compliant")).toHaveTextContent("1");
    expect(card("No actual data")).toHaveTextContent("1");
    expect(reportPaths()).toHaveLength(1);
  });

  it("does not offer the Forecast year", async () => {
    renderReport();
    await waitFor(() => expect(reportPaths()).toHaveLength(1));
    await userEvent.click(screen.getByRole("combobox", { name: "Fiscal year" }));
    const names = within(await screen.findByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
    expect(names).toEqual(["FY26 - Current", "FY25", "FY24", "FY23", "FY22"]);
  });

  it("shows the trend above the view, with the licensed marker", async () => {
    renderReport();
    await waitFor(() => expect(trendBars()).toHaveLength(1));
    expect(trendBars()[0].data).toEqual([17, 17, 17, 17, 17, 0]);
    const scatter = trend().option.series.find((s: { type: string }) => s.type === "scatter");
    expect(scatter.name).toBe("Licensed");
    expect(scatter.data).toEqual([20, 20, 20, 20, 20, 20]);
  });

  it("scope and drill re-sum the trend without a new request", async () => {
    renderReport();
    await waitFor(() => expect(trendBars()).toHaveLength(1));
    await userEvent.click(screen.getByText("scope-b"));
    await waitFor(() => expect(trendBars()[0].data[0]).toBe(5));
    act(() => util().onContextMenu?.({ data: { id: "B" } }));
    expect(trendBars()[0].data[0]).toBe(5);
    expect(reportPaths()).toHaveLength(1);
  });

  it("right click drills and Back climbs; left click opens the side panel", async () => {
    renderReport();
    await waitFor(() => expect(util().option.yAxis.data).toEqual(["A", "B", "C"]));
    act(() => util().onClick?.({ data: { id: "A" } }));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("A");

    act(() => util().onContextMenu?.({ data: { id: "B" } }));
    await waitFor(() => expect(util().option.yAxis.data).toEqual(["B"]));
    expect(trendBars()[0].data[0]).toBe(5);
    await userEvent.click(screen.getByRole("button", { name: /Back/ }));
    await waitFor(() => expect(util().option.yAxis.data).toHaveLength(3));
    expect(screen.getByText("Click: open card · Right click: analyse")).toBeInTheDocument();
  });

  it("by-type view sums the scope per license type and has no drill", async () => {
    renderReport();
    await waitFor(() => expect(reportPaths()).toHaveLength(1));
    await userEvent.click(screen.getByRole("button", { name: "By license type" }));
    const bt = echartState.byName("Licensed and actual counts per license type");
    expect(bt.option.xAxis.data).toEqual(["Admin", "Dev"]);
    expect(bt.option.series[0].data.map((d: { value: number }) => d.value)).toEqual([20, 9]);
    expect(bt.option.series[1].data.map((d: { value: number }) => d.value)).toEqual([17, 1]);
    expect(bt.onContextMenu).toBeUndefined();
  });

  it("picking a Platform sends card_id, hides metric cards and resets the drill", async () => {
    renderReport();
    await waitFor(() => expect(util().option.yAxis.data).toHaveLength(3));
    act(() => util().onContextMenu?.({ data: { id: "B" } }));
    await waitFor(() => expect(util().option.yAxis.data).toEqual(["B"]));
    await userEvent.click(screen.getByRole("button", { name: "By license type" }));
    await userEvent.click(screen.getByText("pick-platform"));
    await waitFor(() => expect(reportPaths().some((p) => p.includes("card_id=plat"))).toBe(true));
    expect(screen.queryByText("Over-licensed")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Utilisation" }));
    await waitFor(() => expect(util().option.yAxis.data).toHaveLength(3));
  });
});
