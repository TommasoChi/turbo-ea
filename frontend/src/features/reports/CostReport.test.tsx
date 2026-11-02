/**
 * Tests for the Cost report's card scope (#954) and its fiscal-year indicator.
 *
 * Scope: the risk is not the filter itself but its blast radius — the metric
 * strip, the treemap and the table footer are all derived separately, so a
 * scope applied in the wrong place leaves them disagreeing with each other.
 *
 * Fiscal year: the server shows the current year only and names it; the page
 * must say which year that is and never ask for another.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { createRef } from "react";
import CostReport from "./CostReport";

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock("@/api/client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
vi.mock("@/hooks/useSavedReport", () => ({ useSavedReport: vi.fn() }));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: vi.fn(),
}));
vi.mock("@/hooks/useCurrency", () => ({
  // `fmt` is an Intl-style formatter object, not a function.
  useCurrency: () => ({
    fmt: { format: (v: number) => `$${v}` },
    fmtShort: (v: number) => `$${v}`,
    symbol: "$",
    currency: "USD",
    loading: false,
    invalidate: () => {},
  }),
}));
// jsdom has no canvas: the charts are the shared test double, and a test reads the option the page built.
vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));
vi.mock("./SaveReportDialog", () => ({ default: () => null }));
// The report hides everything behind `costs.view`.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { permissions: { "costs.view": true } } }),
}));
vi.mock("@/components/CardDetailSidePanel", () => ({ default: () => null }));
// The trend chart's own fetching is tested in CostTrendChart.test.tsx; here only the years it is given.
const trendYearsSeen: number[][] = []; // every `years` array the stub was rendered with
vi.mock("./CostTrendChart", () => ({
  default: ({
    years,
    currentFiscalYear,
    typeParam,
    costField,
    components,
  }: {
    years: number[];
    currentFiscalYear: number;
    typeParam: string;
    costField: string;
    components: string[];
  }) => {
    trendYearsSeen.push(years);
    return (
      <div
        data-testid="cost-trend-chart"
        data-years={years.join(",")}
        data-current={currentFiscalYear}
        data-type={typeParam}
        data-field={costField}
        data-components={components.join(",")}
      />
    );
  },
}));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { echartState } from "@/test/echartMock";

const APP_TYPE = {
  key: "Application",
  label: "Application",
  color: "#0f7eb5",
  is_hidden: false,
  has_hierarchy: true,
  fields_schema: [
    {
      section: "Costs",
      fields: [
        { key: "costTotalAnnual", label: "Total Annual Cost", type: "cost" },
      ],
    },
  ],
};

const ITC_TYPE = {
  key: "ITComponent",
  label: "IT Component",
  color: "#8e24aa",
  is_hidden: false,
  has_hierarchy: false,
  fields_schema: [
    {
      section: "Cost",
      fields: [
        { key: "costTotalAnnual", label: "Total Annual Cost", type: "cost" },
      ],
    },
  ],
};

/** crm → crm-web (child).  erp is a separate root. */
const HIERARCHY = [
  { id: "crm", name: "CRM", type: "Application", parent_id: null },
  { id: "crm-web", name: "CRM Web", type: "Application", parent_id: "crm" },
  { id: "erp", name: "ERP", type: "Application", parent_id: null },
];

const COST_ITEMS = [
  { id: "crm", name: "CRM", cost: 100, attributes: {} },
  { id: "crm-web", name: "CRM Web", cost: 20, attributes: {} },
  { id: "erp", name: "ERP", cost: 500, attributes: {} },
];

let fyStart = 1;

/** The server echoes the REQUESTED year as `fiscal_year` (2026 when none is asked for). */
const requestedYear = (path: string) =>
  Number(new URL(path, "http://x").searchParams.get("fiscal_year") ?? 2026);

let consumedConfig: Record<string, unknown> | null = { view: "table" };

beforeEach(() => {
  vi.clearAllMocks();
  echartState.reset();
  consumedConfig = { view: "table" };
  fyStart = 1;

  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith("/reports/cost-treemap")) {
      return Promise.resolve({
        items: COST_ITEMS,
        total: 620,
        components: ["licenseCost", "serviceCost"],
        fiscal_year: requestedYear(path),
        current_fiscal_year: 2026,
        fiscal_year_start: fyStart,
      }) as never;
    }
    if (path.startsWith("/reports/cost-sankey")) {
      return Promise.resolve({
        nodes: [
          { id: "crm", name: "CRM", type: "Application" },
          { id: "db", name: "DB", type: "ITComponent" },
        ],
        links: [{ source: 0, target: 1, value: 100 }],
        total: 100,
        fiscal_year: requestedYear(path),
        current_fiscal_year: 2026,
        fiscal_year_start: fyStart,
      }) as never;
    }
    // The scope hook's own hierarchy fetch.
    return Promise.resolve({
      items: HIERARCHY,
      total: HIERARCHY.length,
    }) as never;
  });

  vi.mocked(useMetamodel).mockReturnValue({
    types: [APP_TYPE, ITC_TYPE],
    relationTypes: [],
    loading: false,
    getType: (key: string) => (key === "Application" ? APP_TYPE : undefined),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  } as never);

  vi.mocked(useSavedReport).mockReturnValue({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: false,
    setSaveDialogOpen: vi.fn(),
    loadedConfig: null,
    consumeConfig: vi.fn(() => consumedConfig),
    resetSavedReport: vi.fn(),
    persistConfig: vi.fn(),
    resetAll: vi.fn(),
    reportType: "cost",
  } as never);

  vi.mocked(useThumbnailCapture).mockReturnValue({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: vi.fn(),
  } as never);
});

function renderCost() {
  return render(
    <MemoryRouter>
      <CostReport />
    </MemoryRouter>,
  );
}

const chart = () => document.querySelector(".report-chart-area") as HTMLElement;
const toolbar = () => document.querySelector(".report-toolbar") as HTMLElement;

describe("CostReport scope filter", () => {
  it("includes every card when unscoped", async () => {
    renderCost();
    await waitFor(() =>
      expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0),
    );
    expect(within(chart()).getAllByText("CRM").length).toBeGreaterThan(0);
    expect(within(toolbar()).getByText("All cards")).toBeInTheDocument();
  });

  it("narrows to the scoped subtree, and the total follows it", async () => {
    // Scoping to CRM keeps CRM + CRM Web (120) and drops ERP's 500 — the whole
    // point being that the metric strip must not keep reporting 620.
    consumedConfig = { view: "table", scopeIds: ["crm"] };
    renderCost();

    await waitFor(() =>
      expect(within(chart()).getAllByText("CRM").length).toBeGreaterThan(0),
    );
    expect(within(chart()).getAllByText("CRM Web").length).toBeGreaterThan(0);
    expect(within(chart()).queryByText("ERP")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(within(chart()).getAllByText("$120").length).toBeGreaterThan(0),
    );
    expect(within(chart()).queryByText("$620")).not.toBeInTheDocument();
  });

  it("issues no hierarchy request while unscoped", async () => {
    renderCost();
    await waitFor(() =>
      expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0),
    );

    const cardCalls = vi
      .mocked(api.get)
      .mock.calls.filter(([path]) => String(path).startsWith("/cards"));
    expect(cardCalls).toHaveLength(0);
  });

  it("drops a scoped id whose card no longer exists", async () => {
    consumedConfig = { view: "table", scopeIds: ["deleted-app"] };
    renderCost();

    await waitFor(() =>
      expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0),
    );
    expect(within(toolbar()).getByText("All cards")).toBeInTheDocument();
  });
});

const treemapPaths = () =>
  vi
    .mocked(api.get)
    .mock.calls.map(([path]) => String(path))
    .filter((path) => path.startsWith("/reports/cost-treemap"));
const hasYear = (y: string) => (path: string) => path.includes(`fiscal_year=${y}`);

async function openPicker() {
  const picker = screen.getAllByRole("combobox", { name: /fiscal year/i })[0];
  await userEvent.click(picker);
  return screen.findByRole("listbox");
}
async function optionNames() {
  const listbox = await openPicker();
  const names = within(listbox)
    .getAllByRole("option")
    .map((o) => o.textContent);
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  return names;
}
async function pick(name: string) {
  const listbox = await openPicker();
  await userEvent.click(within(listbox).getByRole("option", { name }));
}

describe("CostReport fiscal year", () => {
  const indicator = () =>
    document.querySelector('[data-testid="cost-fiscal-year"]');

  it("explains the live-card rule on the chip only while Current is selected", async () => {
    renderCost();
    await waitFor(() => expect(indicator()).not.toBeNull());
    await userEvent.hover(indicator() as Element);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      /Annual costs of the cards live in this fiscal year/,
    );
    await userEvent.unhover(indicator() as Element);
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());

    await pick("FY25");
    await waitFor(() => expect(indicator()).toHaveTextContent("FY25"));
    await userEvent.hover(indicator() as Element);
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("names the current fiscal year the figures are for", async () => {
    renderCost();
    await waitFor(() => expect(indicator()).not.toBeNull());
    expect(indicator()).toHaveTextContent("Fiscal year: FY26 - Current");
    expect(
      within(toolbar()).getByText("Fiscal year: FY26 - Current"),
    ).toBeInTheDocument();
    expect(document.querySelector(".report-print-params")).toHaveTextContent(
      "FY26 - Current",
    );
  });

  it("names the year the same whatever month the fiscal year starts in", async () => {
    fyStart = 10;
    renderCost();
    await waitFor(() =>
      expect(indicator()).toHaveTextContent("Fiscal year: FY26 - Current"),
    );
  });

  it("names a picked past year without a suffix, in the chip and the parameters line", async () => {
    renderCost();
    await waitFor(() => expect(indicator()).not.toBeNull());
    await pick("FY25");
    await waitFor(() =>
      expect(indicator()).toHaveTextContent("Fiscal year: FY25"),
    );
    expect(indicator()).not.toHaveTextContent("Current");
    const params = document.querySelector(".report-print-params");
    expect(params).toHaveTextContent("FY25");
    expect(params).not.toHaveTextContent("FY25 - ");
  });

  it("never asks the server for a particular year", async () => {
    renderCost();
    await waitFor(() => expect(indicator()).not.toBeNull());
    const calls = vi
      .mocked(api.get)
      .mock.calls.map(([path]) => String(path))
      .filter((path) => path.startsWith("/reports/cost-treemap"));
    expect(calls.length).toBeGreaterThan(0);
    for (const path of calls) expect(path).not.toContain("fiscal_year");
  });

  it("offers no year picker", async () => {
    renderCost();
    await waitFor(() => expect(indicator()).not.toBeNull());
    expect(document.querySelector(".MuiSlider-root")).toBeNull();
  });

  it("offers a fiscal-year picker and re-requests the treemap with it", async () => {
    renderCost();
    await waitFor(() =>
      expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0),
    );
    await pick("FY25");

    await waitFor(() => expect(treemapPaths().some(hasYear("2025"))).toBe(true));
  });

  it("offers forecast, current and four past years in that order", async () => {
    renderCost();
    await waitFor(() => expect(indicator()).not.toBeNull());
    expect(await optionNames()).toEqual([
      "FY27 - Forecast",
      "FY26 - Current",
      "FY25",
      "FY24",
      "FY23",
      "FY22",
    ]);
  });

  it("selecting the forecast requests fiscal_year=2027", async () => {
    renderCost();
    await waitFor(() => expect(indicator()).not.toBeNull());
    await pick("FY27 - Forecast");
    await waitFor(() => expect(treemapPaths().some(hasYear("2027"))).toBe(true));
  });

  it("selecting current requests no fiscal_year", async () => {
    renderCost();
    await waitFor(() => expect(indicator()).not.toBeNull());
    await pick("FY25");
    await waitFor(() => expect(treemapPaths().some(hasYear("2025"))).toBe(true));
    vi.mocked(api.get).mockClear();
    await pick("FY26 - Current");
    await waitFor(() => expect(treemapPaths().length).toBeGreaterThan(0));
    for (const path of treemapPaths()) expect(path).not.toContain("fiscal_year");
  });

  it("keeps the list anchored on the current year after picking a past year", async () => {
    renderCost();
    await waitFor(() => expect(indicator()).not.toBeNull());
    const before = await optionNames();
    await pick("FY24");
    await waitFor(() => expect(treemapPaths().some(hasYear("2024"))).toBe(true));
    await waitFor(() =>
      expect(indicator()).toHaveTextContent("Fiscal year: FY24"),
    );
    expect(await optionNames()).toEqual(before);
  });

  it("opens on Current when a saved year equals the current year", async () => {
    consumedConfig = { view: "table", fiscalYearParam: 2026 };
    renderCost();
    await waitFor(() => expect(indicator()).not.toBeNull());
    await waitFor(() =>
      expect(
        screen.getAllByRole("combobox", { name: /fiscal year/i })[0],
      ).toHaveTextContent("FY26 - Current"),
    );
    await waitFor(() => expect(treemapPaths().length).toBeGreaterThan(1));
    expect(treemapPaths().at(-1)).not.toContain("fiscal_year");
  });

  it("opens on Current when a saved year is outside the offered years", async () => {
    consumedConfig = { view: "table", fiscalYearParam: 2010 };
    renderCost();
    await waitFor(() => expect(indicator()).not.toBeNull());
    await waitFor(() =>
      expect(
        screen.getAllByRole("combobox", { name: /fiscal year/i })[0],
      ).toHaveTextContent("FY26 - Current"),
    );
    expect(treemapPaths().at(-1)).not.toContain("fiscal_year");
  });

  it("keeps a saved year that is among the offered ones", async () => {
    consumedConfig = { view: "table", fiscalYearParam: 2027 };
    renderCost();
    await waitFor(() =>
      expect(
        screen.getAllByRole("combobox", { name: /fiscal year/i })[0],
      ).toHaveTextContent("FY27 - Forecast"),
    );
    expect(treemapPaths().some(hasYear("2027"))).toBe(true);
  });
});

describe("CostReport card-type selector and Sankey view", () => {
  it("offers only Application and ITComponent in the card-type selector", async () => {
    const { getByLabelText, findAllByRole } = renderCost();
    await waitFor(() =>
      expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0),
    );
    const select = getByLabelText(/card type/i);
    await userEvent.click(select);
    const options = (await findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual([
      "Application",
      "IT Component",
      "Application + IT Component",
    ]);
  });

  it("renders a Sankey toggle button and switches the panel on click", async () => {
    const { findByRole, findByTestId } = renderCost();
    await waitFor(() =>
      expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0),
    );
    const sankeyBtn = await findByRole("button", {
      name: /sankey chart view/i,
    });
    await userEvent.click(sankeyBtn);
    expect(await findByTestId("cost-sankey-panel")).toBeInTheDocument();
  });

  it("renders cost item, group and card nodes from the payload, groups between", async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/reports/cost-sankey"))
        return Promise.resolve({
          nodes: [
            { id: "item:costTotalAnnual", name: "Licences", type: "CostItem" },
            { id: "group:EMEA", name: "EMEA", type: "Group" },
            { id: "crm", name: "CRM", type: "Application" },
          ],
          links: [
            { source: 0, target: 1, value: 100 },
            { source: 1, target: 2, value: 100 },
          ],
          total: 100,
          fiscal_year: 2026,
          current_fiscal_year: 2026,
          fiscal_year_start: 1,
        }) as never;
      return Promise.resolve({ items: COST_ITEMS, total: 620, fiscal_year: 2026, current_fiscal_year: 2026, fiscal_year_start: 1 }) as never;
    });
    const { findByTestId, findByRole } = renderCost();
    await userEvent.click(await findByRole("button", { name: /sankey chart view/i }));
    await findByTestId("cost-sankey-panel");
    const s = echartState.last().option.series[0];
    const label = (id: string) => s.label.formatter({ name: id });
    const ids: string[] = s.data.map((d: { name: string }) => d.name);
    // Item and group nodes are named for what they are; the flow runs item -> group -> card.
    expect(ids.map(label)).toEqual(["Total Annual Cost", "EMEA", "CRM"]);
    expect(s.links.map((l: { source: string; target: string }) => [label(l.source), label(l.target)])).toEqual([
      ["Total Annual Cost", "EMEA"],
      ["EMEA", "CRM"],
    ]);
    const fill = (id: string) => s.data.find((d: { name: string }) => d.name === id).itemStyle.color;
    expect(fill(ids[0])).not.toBe(fill(ids[1]));
  });

  it("shows the no-data message for an empty Sankey payload", async () => {
    vi.mocked(api.get).mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith("/reports/cost-sankey")
          ? { nodes: [], links: [], total: 0, fiscal_year: 2026, current_fiscal_year: 2026, fiscal_year_start: 1 }
          : { items: COST_ITEMS, total: 620, fiscal_year: 2026, current_fiscal_year: 2026, fiscal_year_start: 1 },
      ) as never,
    );
    const { findByText, findByRole } = renderCost();
    await userEvent.click(await findByRole("button", { name: /sankey chart view/i }));
    expect(await findByText("No cost data found.")).toBeInTheDocument();
  });

  it("no longer renders the cost-source (aggregate) control", async () => {
    const { queryByLabelText } = renderCost();
    await waitFor(() =>
      expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0),
    );
    expect(queryByLabelText(/cost source/i)).not.toBeInTheDocument();
  });
});

describe("CostReport custom columns", () => {
  it("offers every field of the current card type, in table view", async () => {
    vi.mocked(useMetamodel).mockReturnValue({
      types: [
        {
          ...APP_TYPE,
          fields_schema: [
            {
              section: "Extra",
              fields: [{ key: "alias", label: "Alias", type: "text" }],
            },
            ...APP_TYPE.fields_schema,
          ],
        },
        ITC_TYPE,
      ],
      relationTypes: [],
      loading: false,
      getType: (key: string) => (key === "Application" ? APP_TYPE : undefined),
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
    } as never);
    const { findByRole } = renderCost();
    await waitFor(() =>
      expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0),
    );
    await userEvent.click(await screen.findByRole("button", { name: /table view/i }));
    const picker = await findByRole("combobox", { name: /columns/i });
    await userEvent.click(picker);
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toContain("Total Annual Cost");
  });

  it("persists and restores picked columns", async () => {
    consumedConfig = { view: "table", extraColumns: ["costTotalAnnual"] };
    renderCost();
    await waitFor(() =>
      expect(
        within(toolbar()).getByRole("combobox", { name: /columns/i }),
      ).toHaveTextContent("1"),
    );
  });

  it("renders picked columns in pick order, not picker order", async () => {
    vi.mocked(useMetamodel).mockReturnValue({
      types: [
        {
          ...APP_TYPE,
          fields_schema: [
            ...APP_TYPE.fields_schema,
            {
              section: "Extra",
              fields: [{ key: "alias", label: "Alias", type: "text" }],
            },
          ],
        },
        ITC_TYPE,
      ],
      relationTypes: [],
      loading: false,
      getType: () => APP_TYPE,
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
    } as never);
    consumedConfig = {
      view: "table",
      extraColumns: ["costTotalAnnual", "alias"],
    };
    renderCost();
    await screen.findByRole("table");
    const headers = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers.indexOf("Total Annual Cost")).toBeLessThan(
      headers.indexOf("Alias"),
    );
  });

  it("drops a picked column the new type does not define", async () => {
    vi.mocked(useMetamodel).mockReturnValue({
      types: [
        {
          ...APP_TYPE,
          fields_schema: [
            ...APP_TYPE.fields_schema,
            {
              section: "Extra",
              fields: [{ key: "alias", label: "Alias", type: "text" }],
            },
          ],
        },
        ITC_TYPE,
      ],
      relationTypes: [],
      loading: false,
      getType: (key: string) =>
        key === "Application" ? APP_TYPE : key === "ITComponent" ? ITC_TYPE : undefined,
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
    } as never);
    consumedConfig = { view: "table", extraColumns: ["alias"] };
    renderCost();
    await screen.findByRole("table");
    expect(screen.getByRole("columnheader", { name: "Alias" })).toBeInTheDocument();
    const select = screen.getByLabelText(/card type/i);
    await userEvent.click(select);
    await userEvent.click(await screen.findByRole("option", { name: "IT Component" }));
    await waitFor(() =>
      expect(screen.queryByRole("columnheader", { name: "Alias" })).not.toBeInTheDocument(),
    );
  });
});

describe("CostReport trend chart", () => {
  const ready = async () => {
    consumedConfig = { view: "chart" };
    renderCost();
    await waitFor(() => expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0));
  };
  const pickYear = async (name: string) => {
    const picker = screen.getAllByRole("combobox", { name: /fiscal year/i })[0];
    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole("option", { name }));
  };

  it("chart hidden on Current and on a past year", async () => {
    await ready();
    expect(screen.queryByTestId("cost-trend-chart")).not.toBeInTheDocument();
    await pickYear("FY25");
    await waitFor(() =>
      expect(screen.getAllByRole("combobox", { name: /fiscal year/i })[0]).toHaveTextContent("FY25"),
    );
    expect(screen.queryByTestId("cost-trend-chart")).not.toBeInTheDocument();
  });

  it("chart shown on Forecast with the components, five past years oldest first", async () => {
    await ready();
    await pickYear("FY27 - Forecast");
    const trend = await screen.findByTestId("cost-trend-chart");
    expect(trend).toHaveAttribute("data-years", "2022,2023,2024,2025,2026,2027");
    expect(trend).toHaveAttribute("data-current", "2026");
    expect(trend).toHaveAttribute("data-components", "licenseCost,serviceCost");
    expect(trend).toHaveAttribute("data-field", "costTotalAnnual");
  });

  it("chart hidden when the response carries no components", async () => {
    const base = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (path: string, ...rest: never[]) => {
      const r = (await base(path, ...rest)) as Record<string, unknown>;
      return path.startsWith("/reports/cost-treemap") ? { ...r, components: [] } : r;
    });
    await ready();
    await pickYear("FY27 - Forecast");
    await waitFor(() =>
      expect(screen.getAllByRole("combobox", { name: /fiscal year/i })[0]).toHaveTextContent("Forecast"),
    );
    expect(screen.queryByTestId("cost-trend-chart")).not.toBeInTheDocument();
  });

  it("chart refetches when the card type changes", async () => {
    await ready();
    await pickYear("FY27 - Forecast");
    expect(await screen.findByTestId("cost-trend-chart")).toHaveAttribute("data-type", "Application");
    await userEvent.click(screen.getByLabelText(/card type/i));
    await userEvent.click(await screen.findByRole("option", { name: "IT Component" }));
    await waitFor(() =>
      expect(screen.getByTestId("cost-trend-chart")).toHaveAttribute("data-type", "ITComponent"),
    );
    expect(
      vi.mocked(api.get).mock.calls.some(
        ([p]) => String(p).startsWith("/reports/cost-treemap") && String(p).includes("type=ITComponent"),
      ),
    ).toBe(true);
  });

  it("treemap fills the panel in fullscreen and is 450 high otherwise", async () => {
    await ready();
    const style = () => echartState.last().style;
    expect(style()).toEqual({ height: 450 });
    const panel = screen.getByTestId("fullscreen-panel");
    Object.defineProperty(document, "fullscreenElement", { value: panel, configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(style()).toEqual({ flex: 1, minHeight: 0 });
    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(style()).toEqual({ height: 450 });
  });
});


describe("CostReport Sankey from per-card costs", () => {
  const NODES = [
    { id: "item:lic", name: "Licences", type: "CostItem" },
    { id: "item:host", name: "Hosting", type: "CostItem" },
    { id: "group:G", name: "G", type: "Group" },
    { id: "crm", name: "CRM", type: "Application", cost: 100, costs: { lic: 100 } },
    { id: "erp", name: "ERP", type: "Application", cost: 100, costs: { host: 100 } },
  ];
  const LINKS = [
    { source: 0, target: 2, value: 100 },
    { source: 1, target: 2, value: 100 },
    { source: 2, target: 3, value: 100 },
    { source: 2, target: 4, value: 100 },
  ];
  const mockSankey = (nodes = NODES, links = LINKS) =>
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/reports/cost-sankey"))
        return Promise.resolve({
          nodes,
          links,
          total: 200,
          fiscal_year: 2026,
          current_fiscal_year: 2026,
          fiscal_year_start: 1,
        }) as never;
      return Promise.resolve({ items: HIERARCHY, total: HIERARCHY.length }) as never;
    });
  type Seen = {
    nodes: { name: string }[];
    links: { source: number; target: number; value: number }[];
  };
  // The Sankey option names a node by its id; its label formatter maps back to the card's name.
  const sankeySeen = (): Seen => {
    const s = echartState.last().option.series[0];
    const ids: string[] = s.data.map((d: { name: string }) => d.name);
    return {
      nodes: ids.map((id) => ({ name: s.label.formatter({ name: id }) })),
      links: s.links.map((l: { source: string; target: string; value: number }) => ({
        source: ids.indexOf(l.source),
        target: ids.indexOf(l.target),
        value: l.value,
      })),
    };
  };
  const flow = (d: Seen, from: string, to: string) =>
    d.links.find((l) => d.nodes[l.source].name === from && d.nodes[l.target].name === to)?.value;

  it("re-sums the item -> group flows over the cards the scope keeps", async () => {
    consumedConfig = { view: "sankey", scopeIds: ["crm"] };
    mockSankey();
    renderCost();
    await screen.findByTestId("cost-sankey-panel");
    await waitFor(() => {
      const d = sankeySeen();
      expect(d.nodes.map((n) => n.name)).not.toContain("Hosting");
    });
    const d = sankeySeen();
    expect(d.links).toHaveLength(2);
    expect(flow(d, "Licences", "G")).toBe(100);
    expect(flow(d, "G", "CRM")).toBe(100);
  });

  it("keeps in = out for every group when unscoped", async () => {
    consumedConfig = { view: "sankey" };
    mockSankey();
    renderCost();
    await screen.findByTestId("cost-sankey-panel");
    const d = sankeySeen();
    const g = d.nodes.findIndex((n) => n.name === "G");
    const sum = (f: (l: Seen["links"][number]) => boolean) =>
      d.links.filter(f).reduce((n, l) => n + l.value, 0);
    expect(sum((l) => l.target === g)).toBe(sum((l) => l.source === g));
  });

  it("fills the summary tiles from the kept card nodes in Sankey view", async () => {
    consumedConfig = { view: "sankey" };
    mockSankey(
      [
        { id: "item:lic", name: "Licences", type: "CostItem" },
        { id: "crm", name: "CRM", type: "Application", cost: 100, costs: { lic: 100 } },
        { id: "erp", name: "ERP", type: "Application", cost: 50, costs: { lic: 50 } },
      ],
      [
        { source: 0, target: 1, value: 100 },
        { source: 0, target: 2, value: 50 },
      ],
    );
    renderCost();
    await screen.findByTestId("cost-sankey-panel");
    const tile = (label: string) =>
      screen.getByText(label).closest(".MuiPaper-root") as HTMLElement;
    expect(within(tile("Total Cost")).getByText("$150")).toBeInTheDocument();
    expect(within(tile("Items")).getByText("2")).toBeInTheDocument();
    expect(within(tile("Top Cost Driver")).getByText("CRM")).toBeInTheDocument();
  });
});
