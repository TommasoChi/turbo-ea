/**
 * Cost report behaviour the coverage-oriented suites ran but never checked
 * (CostReport.test.tsx covers scope + fiscal year, CostReport.branches.test.tsx
 * the branches): the exact print parameters, how a saved configuration is
 * restored and persisted, out-of-order answers, how each treemap cell is drawn
 * at its size, the table's per-group ordering and shares, and which toolbar
 * controls appear when.
 *
 * Recharts lays out nothing in jsdom, so `Treemap` is a stub that hands each
 * datum to the page's own `content` renderer at a size the test chooses (by
 * card name), and renders the tooltip once per datum plus the two inert cases.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { cloneElement, createRef, type ReactElement } from "react";

vi.mock("@/api/client", () =>
  import("@/test/apiMock").then((m) => m.apiClientModule()),
);
vi.mock("@/hooks/useMetamodel", () =>
  import("@/test/hooks").then((m) => m.useMetamodelModule()),
);
vi.mock("@/hooks/useCurrency", () =>
  import("@/test/hooks").then((m) => m.useCurrencyModule()),
);
vi.mock("@/hooks/useAuth", () =>
  import("@/test/hooks").then((m) => m.useAuthModule()),
);
vi.mock("@/hooks/useIsRtl", () =>
  import("@/test/hooks").then((m) => m.useIsRtlModule()),
);

const saved = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  loadedConfig: null as Record<string, unknown> | null,
  reportTypes: [] as string[],
  setSaveDialogOpen: (() => {}) as (open: boolean) => void,
  resetAll: (() => {}) as () => void,
  persistConfig: (() => {}) as (cfg: Record<string, unknown>) => void,
}));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: (reportType: string) => {
    saved.reportTypes.push(reportType);
    return {
      savedReport: null,
      savedReportName: null,
      saveDialogOpen: false,
      setSaveDialogOpen: saved.setSaveDialogOpen,
      loadedConfig: saved.loadedConfig,
      consumeConfig: () => saved.config,
      resetSavedReport: () => {},
      persistConfig: saved.persistConfig,
      resetAll: saved.resetAll,
      reportType,
    };
  },
}));

vi.mock("@/hooks/useThumbnailCapture", () => ({
  // Saving captures a thumbnail first, then hands over to the page's callback.
  useThumbnailCapture: (onCaptured: () => void) => ({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: () => onCaptured(),
  }),
}));

vi.mock("@/features/reports/SaveReportDialog", () => ({ default: () => null }));

vi.mock("@/components/CardDetailSidePanel", () => ({
  default: (props: { cardId: string | null; open: boolean }) =>
    props.open ? <div data-testid="side-panel">{props.cardId}</div> : null,
}));

/** Cell sizes by card name; anything unlisted is drawn large (300×100). */
const chart = vi.hoisted(() => ({
  sizes: {} as Record<string, [number, number]>,
}));

vi.mock("recharts", async () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { createContext, useContext } =
    await vi.importActual<typeof import("react")>("react");
  const Data = createContext<any[]>([]);
  return {
    ResponsiveContainer: ({ children, height }: any) => (
      <div data-testid="chart-container" data-height={String(height)}>
        {children}
      </div>
    ),
    Treemap: ({ data, content, children }: any) => (
      <div data-testid="treemap">
        <svg>
          {data.map((d: any, i: number) => {
            const [width, height] = chart.sizes[d.name] ?? [300, 100];
            return (
              <g key={i} data-cell={d.name}>
                {cloneElement(content as ReactElement<any>, {
                  ...d,
                  x: 10,
                  y: 10,
                  width,
                  height,
                })}
              </g>
            );
          })}
        </svg>
        <Data.Provider value={data}>{children}</Data.Provider>
      </div>
    ),
    Tooltip: ({ content }: any) => {
      const data = useContext(Data);
      return (
        <div data-testid="treemap-tooltip">
          {data.map((d: any, i: number) => (
            <div key={i} data-tip={d.name}>
              {cloneElement(content, {
                active: true,
                payload: [{ payload: d }],
              })}
            </div>
          ))}
          <div data-tip="inactive">
            {cloneElement(content, {
              active: false,
              payload: [{ payload: data[0] }],
            })}
          </div>
          <div data-tip="nopayload">
            {cloneElement(content, { active: true })}
          </div>
        </div>
      );
    },
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
});

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeUser, renderWithProviders, userWith } from "@/test/render";
import {
  APPLICATION_TYPE,
  HIDDEN_TYPE,
  IT_COMPONENT_TYPE,
  makeCardType,
  makeField,
  makeOption,
  makeRelationType,
  makeSection,
} from "@/test/fixtures/metamodel";
import CostReport from "./CostReport";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                            */
/* ------------------------------------------------------------------ */

const CONTRACT_TYPE = makeCardType({
  key: "Contract",
  label: "Contract",
  fields_schema: [
    makeSection({
      section: "Money",
      fields: [
        makeField({
          key: "contractValue",
          label: "Contract Value",
          type: "cost",
        }),
      ],
    }),
  ],
});

/** Application with a second cost field, so a cost field picker exists. */
const APP_TWO_COSTS = makeCardType({
  ...APPLICATION_TYPE,
  fields_schema: [
    ...APPLICATION_TYPE.fields_schema,
    makeSection({
      section: "Run",
      fields: [makeField({ key: "costRun", label: "Run Cost", type: "cost" })],
    }),
  ],
});

const REL_APP_ITC = makeRelationType({
  key: "relAppToITC",
  source_type_key: "Application",
  target_type_key: "ITComponent",
});
const REL_CONTRACT_APP = makeRelationType({
  key: "relContractToApp",
  source_type_key: "Contract",
  target_type_key: "Application",
});
const REL_ITC_CONTRACT = makeRelationType({
  key: "relItcToContract",
  source_type_key: "ITComponent",
  target_type_key: "Contract",
});
const RELATIONS = [REL_APP_ITC, REL_CONTRACT_APP, REL_ITC_CONTRACT];

const ITEMS = [
  {
    id: "crm",
    name: "CRM",
    cost: 100,
    attributes: { businessCriticality: "missionCritical" },
  },
  {
    id: "web",
    name: "CRM Web Portal",
    cost: 20,
    attributes: { businessCriticality: "bogus" },
  },
  {
    id: "erp",
    name: "ERP",
    cost: 500,
    attributes: { businessCriticality: "missionCritical" },
  },
  { id: "hr", name: "HR", cost: 80, attributes: {} },
];

/** crm → web (child); erp and hr are separate roots. */
const HIERARCHY = [
  { id: "crm", name: "CRM", type: "Application", parent_id: null },
  { id: "web", name: "CRM Web Portal", type: "Application", parent_id: "crm" },
  { id: "erp", name: "ERP", type: "Application", parent_id: null },
  { id: "hr", name: "HR", type: "Application", parent_id: null },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function renderCost() {
  return render(
    <MemoryRouter>
      <CostReport />
    </MemoryRouter>,
  );
}

const params = (path: string) => new URLSearchParams(path.split("?")[1]);
const treemapCalls = () =>
  mockApi.callsOf("get", "/reports/cost-treemap*").map((c) => c.path);
const lastTreemapParams = () =>
  params(treemapCalls()[treemapCalls().length - 1]);
const toolbar = () => document.querySelector(".report-toolbar") as HTMLElement;
const metricValue = (label: string) =>
  screen.getByText(label).closest(".MuiPaper-root")!.querySelector("h5")!
    .textContent;
const cell = (name: string) =>
  document.querySelector(`[data-cell="${name}"]`) as Element;
const tip = (name: string) =>
  document.querySelector(`[data-tip="${name}"]`) as HTMLElement;
const rowTexts = () =>
  screen.getAllByRole("row").map((r) => r.textContent ?? "");

/** The print-only parameter strip, as [label, value] pairs. */
function printParams(): [string, string][] {
  return Array.from(document.querySelectorAll(".report-print-params > *")).map(
    (el) => {
      const strong = el.querySelector("strong")?.textContent ?? "";
      const rest = (el.textContent ?? "")
        .slice(strong.length)
        .replace(/\|$/, "")
        .trim();
      return [strong.replace(/:$/, ""), rest];
    },
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Let an already-answered request's continuation land. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function pickOption(label: RegExp, option: RegExp) {
  fireEvent.mouseDown(
    await screen.findByRole("combobox", { name: label }, { timeout: 5000 }),
  );
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: option }));
  if (screen.queryByRole("listbox")) {
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
  }
}

async function optionsOf(label: RegExp): Promise<string[]> {
  fireEvent.mouseDown(
    await screen.findByRole("combobox", { name: label }, { timeout: 5000 }),
  );
  const listbox = await screen.findByRole("listbox");
  const out = within(listbox)
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");
  fireEvent.keyDown(listbox, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
  );
  return out;
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  hookState.auth.user = userWith("costs.view");
  withMetamodel(
    [APPLICATION_TYPE, IT_COMPONENT_TYPE, CONTRACT_TYPE],
    RELATIONS,
  );
  saved.config = null;
  saved.loadedConfig = null;
  saved.reportTypes = [];
  saved.setSaveDialogOpen = vi.fn();
  saved.resetAll = vi.fn();
  saved.persistConfig = vi.fn();
  chart.sizes = {};

  mockApi.on("get", "/cards*", { items: HIERARCHY, total: HIERARCHY.length });
  mockApi.on("get", "/reports/cost-treemap*", {
    items: ITEMS,
    total: 700,
    fiscal_year: 2026,
    fiscal_year_start: 1,
  });
});

/* ------------------------------------------------------------------ */
/*  Loading and requests                                                */
/* ------------------------------------------------------------------ */

describe("CostReport loading and requests", () => {
  it("shows a spinner, not an empty report, until the first answer arrives", async () => {
    const pending = deferred<unknown>();
    mockApi.on("get", "/reports/cost-treemap*", () => pending.promise);
    renderCost();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("No cost data found.")).not.toBeInTheDocument();
    expect(screen.queryByText("Total Cost")).not.toBeInTheDocument();

    await act(async () => pending.resolve({ items: ITEMS, total: 700 }));
    expect(await screen.findByTestId("treemap")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("asks for the default cost field from the very first request", async () => {
    renderCost();
    await screen.findByTestId("treemap");
    expect(treemapCalls().length).toBeGreaterThan(0);
    for (const path of treemapCalls())
      expect(params(path).get("cost_field")).toBe("costTotalAnnual");
  });

  it("sends the report request with an abort signal", async () => {
    renderCost();
    await screen.findByText("ERP", { selector: "text" });
    const calls = mockApi.api.get.mock.calls.filter(([p]) =>
      String(p).startsWith("/reports/cost-treemap"),
    );
    expect(
      (calls[0]?.[1] as { signal?: unknown } | undefined)?.signal,
    ).toBeInstanceOf(AbortSignal);
  });

  it("ignores a root answer that lands after a newer one", async () => {
    withMetamodel([APP_TWO_COSTS], []);
    const stale = deferred<unknown>();
    mockApi.on("get", "/reports/cost-treemap*", (path: string) =>
      params(path).get("cost_field") === "costRun"
        ? stale.promise
        : { items: ITEMS, total: 700 },
    );
    renderCost();
    await screen.findByText("ERP", { selector: "text" });
    await pickOption(/cost field/i, /Run Cost/);
    await waitFor(() =>
      expect(lastTreemapParams().get("cost_field")).toBe("costRun"),
    );
    await pickOption(/cost field/i, /Total Annual Cost/);
    await waitFor(() =>
      expect(lastTreemapParams().get("cost_field")).toBe("costTotalAnnual"),
    );
    await settle();

    await act(async () =>
      stale.resolve({
        items: [{ id: "old", name: "Stale", cost: 999 }],
        total: 999,
      }),
    );
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
    expect(screen.getByText("ERP", { selector: "text" })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  Fiscal year                                                         */
/* ------------------------------------------------------------------ */

describe("CostReport fiscal year", () => {
  const chip = () => screen.queryByTestId("cost-fiscal-year");

  it("names no year when the answer gives the year without its start month", async () => {
    mockApi.on("get", "/reports/cost-treemap*", {
      items: ITEMS,
      total: 700,
      fiscal_year: 2026,
    });
    renderCost();
    await screen.findByTestId("treemap");
    expect(chip()).toBeNull();
    expect(printParams().map(([l]) => l)).not.toContain("Fiscal year");
  });

  it("names no year when the answer gives the start month without the year", async () => {
    mockApi.on("get", "/reports/cost-treemap*", {
      items: ITEMS,
      total: 700,
      fiscal_year_start: 1,
    });
    renderCost();
    await screen.findByTestId("treemap");
    expect(chip()).toBeNull();
  });

  it("explains the year on hover", async () => {
    renderCost();
    fireEvent.mouseOver(await screen.findByTestId("cost-fiscal-year"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      /Annual costs of the cards live in this fiscal year/,
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Print parameters                                                    */
/* ------------------------------------------------------------------ */

describe("CostReport print parameters", () => {
  it("states only the card type and the fiscal year by default", async () => {
    saved.config = { view: "chart" };
    renderCost();
    await screen.findByTestId("treemap");
    await waitFor(() =>
      expect(printParams()).toEqual([
        ["Type", "Application"],
        ["Fiscal year", "FY 2026"],
      ]),
    );
  });

  it("names a restored card type by its label", async () => {
    saved.config = { cardTypeKey: "ITComponent" };
    renderCost();
    await waitFor(() =>
      expect(lastTreemapParams().get("type")).toBe("ITComponent"),
    );
    await waitFor(() =>
      expect(printParams()[0]).toEqual(["Type", "IT Component"]),
    );
  });

  it("falls back to Application for a saved type the cost report no longer supports", async () => {
    saved.config = { cardTypeKey: "Gone" };
    renderCost();
    await waitFor(() =>
      expect(lastTreemapParams().get("type")).toBe("Application"),
    );
    expect(await screen.findByTestId("treemap")).toBeInTheDocument();
    await waitFor(() =>
      expect(printParams()[0]).toEqual(["Type", "Application"]),
    );
  });

  it("states the chosen cost field when the type has several", async () => {
    withMetamodel([APP_TWO_COSTS, IT_COMPONENT_TYPE, CONTRACT_TYPE], RELATIONS);
    renderCost();
    await screen.findByTestId("treemap");
    await waitFor(() =>
      expect(printParams()).toEqual([
        ["Type", "Application"],
        ["Fiscal year", "FY 2026"],
        ["Cost Field", "Total Annual Cost"],
      ]),
    );
    await pickOption(/cost field/i, /Run Cost/);
    await waitFor(() =>
      expect(printParams()).toContainEqual(["Cost Field", "Run Cost"]),
    );
  });

  it("states the grouping and the table view", async () => {
    saved.config = { view: "table", groupBy: "businessCriticality" };
    renderCost();
    await screen.findByRole("table");
    await waitFor(() =>
      expect(printParams()).toEqual([
        ["Type", "Application"],
        ["Fiscal year", "FY 2026"],
        ["Group By", "Business Criticality"],
        ["View", "Table"],
      ]),
    );
  });

  it("states a grouping field it no longer knows by its key and lists the rows ungrouped", async () => {
    saved.config = { view: "table", groupBy: "retired" };
    renderCost();
    await screen.findByRole("table");
    await waitFor(() =>
      expect(printParams()).toContainEqual(["Group By", "retired"]),
    );
    expect(
      rowTexts()
        .slice(1)
        .map((r) => r.replace(/\$.*/, "")),
    ).toEqual(["ERP", "CRM", "HR", "CRM Web Portal", "Total"]);
  });

  it("states the scope", async () => {
    saved.config = { scopeIds: ["crm"] };
    renderCost();
    await screen.findByTestId("treemap");
    await waitFor(() =>
      expect(printParams()).toContainEqual(["Scope", "1 card"]),
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Drill-down                                                          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Treemap cells and tooltip                                           */
/* ------------------------------------------------------------------ */

describe("CostReport treemap cells", () => {
  // [name, cost, size] — costs fix the order, so each cell's palette index too.
  const SIZED: [string, number, [number, number]][] = [
    ["Big", 1100, [300, 100]],
    ["W4", 1000, [4, 100]],
    ["W3", 900, [3, 100]],
    ["H4", 800, [100, 4]],
    ["H3", 700, [100, 3]],
    ["L51", 600, [51, 31]],
    ["L50", 500, [50, 100]],
    ["L30", 400, [100, 30]],
    ["C71", 300, [71, 46]],
    ["ABCDEFGHIJ", 200, [70, 100]],
    ["C45", 100, [100, 45]],
  ];

  beforeEach(() => {
    chart.sizes = Object.fromEntries(SIZED.map(([n, , s]) => [n, s]));
    mockApi.on("get", "/reports/cost-treemap*", {
      items: SIZED.map(([name, cost]) => ({
        id: name.toLowerCase(),
        name,
        cost,
      })),
      total: 6600,
    });
  });

  const drawn = (name: string) => cell(name).querySelector("rect") !== null;
  const texts = (name: string) =>
    Array.from(cell(name).querySelectorAll("text"));

  it("draws, labels and prices each cell according to its size", async () => {
    renderCost();
    await screen.findByText("Big", { selector: "text" });

    // Too small in either direction: nothing at all.
    expect(drawn("W3")).toBe(false);
    expect(drawn("H3")).toBe(false);
    expect(drawn("W4")).toBe(true);
    expect(drawn("H4")).toBe(true);
    expect(texts("W4")).toHaveLength(0);
    expect(texts("H4")).toHaveLength(0);

    // A label needs more than 50 wide and 30 high.
    expect(texts("L51").map((t) => t.textContent)).toEqual(["L51"]);
    expect(texts("L50")).toHaveLength(0);
    expect(texts("L30")).toHaveLength(0);

    // A cost line needs more than 70 wide and 45 high.
    expect(texts("C71").map((t) => t.textContent)).toEqual(["C71", "$300"]);
    expect(texts("C45").map((t) => t.textContent)).toEqual(["C45"]);
    // A name exactly as long as the cell fits is shown whole.
    expect(texts("ABCDEFGHIJ").map((t) => t.textContent)).toEqual([
      "ABCDEFGHIJ",
    ]);
  });

  it("places the label and the cost in the cell's top-left corner", async () => {
    renderCost();
    await screen.findByText("Big", { selector: "text" });
    const [label, cost] = texts("Big");
    expect(label).toHaveAttribute("x", "16");
    expect(label).toHaveAttribute("y", "26");
    expect(cost).toHaveTextContent("$1100");
    expect(cost).toHaveAttribute("x", "16");
    expect(cost).toHaveAttribute("y", "40");
  });

  it("cycles the palette by position", async () => {
    renderCost();
    await screen.findByText("Big", { selector: "text" });
    const fill = (name: string) =>
      cell(name).querySelector("rect")!.getAttribute("fill");
    expect(fill("Big")).toBe("#1565c0");
    expect(fill("W4")).toBe("#1976d2");
    expect(fill("C45")).toBe("#1565c0");
  });
});

describe("CostReport treemap tooltip", () => {
  it("names the hovered card, its cost and its share, and nothing when inactive", async () => {
    renderCost();
    await screen.findByTestId("treemap-tooltip");
    expect(tip("ERP")).toHaveTextContent("ERP");
    expect(tip("ERP")).toHaveTextContent("$500");
    // 500 of 700.
    expect(tip("ERP")).toHaveTextContent("ERP$50071.4% of total");
    expect(tip("inactive")).toBeEmptyDOMElement();
    expect(tip("nopayload")).toBeEmptyDOMElement();
  });

  it("leaves the share out when the panel totals nothing", async () => {
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [{ id: "z", name: "Zero", cost: 0 }],
      total: 0,
    });
    renderCost();
    await screen.findByTestId("treemap-tooltip");
    expect(tip("Zero").textContent).toBe("Zero$0");
  });
});

/* ------------------------------------------------------------------ */
/*  Permission                                                          */
/* ------------------------------------------------------------------ */

describe("CostReport permission", () => {
  it("restricts a signed-out session, under the report's own title", async () => {
    hookState.auth.user = null;
    renderCost();
    expect(await screen.findByText("Cost data restricted")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Cost Analysis" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/You don't have permission to view cost reports/),
    ).toBeInTheDocument();
    expect(treemapCalls()).toHaveLength(0);
  });

  it("restricts a user record that carries no permission map", async () => {
    hookState.auth.user = makeUser({ role: "member", permissions: undefined });
    renderCost();
    expect(await screen.findByText("Cost data restricted")).toBeInTheDocument();
  });

  it("shows a spinner, not an empty report, the moment costs.view is granted", async () => {
    hookState.auth.user = userWith("reports.view");
    const pending = deferred<unknown>();
    mockApi.on("get", "/reports/cost-treemap*", () => pending.promise);
    const view = renderCost();
    expect(await screen.findByText("Cost data restricted")).toBeInTheDocument();

    hookState.auth.user = userWith("costs.view");
    view.rerender(
      <MemoryRouter>
        <CostReport />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("progressbar")).toBeInTheDocument();
    await waitFor(() => expect(treemapCalls()).toHaveLength(1));
    expect(screen.queryByText("Cost data restricted")).not.toBeInTheDocument();
    expect(screen.queryByText("No cost data found.")).not.toBeInTheDocument();
    expect(screen.queryByText("Total Cost")).not.toBeInTheDocument();

    await act(async () => pending.resolve({ items: ITEMS, total: 700 }));
    expect(await screen.findByTestId("treemap")).toBeInTheDocument();
    expect(metricValue("Total Cost")).toBe("$700");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("forgets the costs it showed when costs.view is withdrawn, so a regrant spins first", async () => {
    const view = renderCost();
    await screen.findByTestId("treemap");
    expect(metricValue("Total Cost")).toBe("$700");
    const page = () => (
      <MemoryRouter>
        <CostReport />
      </MemoryRouter>
    );

    hookState.auth.user = userWith("reports.view");
    view.rerender(page());
    expect(await screen.findByText("Cost data restricted")).toBeInTheDocument();

    const pending = deferred<unknown>();
    mockApi.on("get", "/reports/cost-treemap*", () => pending.promise);
    hookState.auth.user = userWith("costs.view");
    view.rerender(page());
    await waitFor(() => expect(treemapCalls()).toHaveLength(2));
    // The figures from before the withdrawal are not shown as if current.
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByTestId("treemap")).not.toBeInTheDocument();
    expect(screen.queryByText("Total Cost")).not.toBeInTheDocument();

    await act(async () =>
      pending.resolve({ items: [{ id: "n", name: "New", cost: 5 }], total: 5 }),
    );
    expect(await screen.findByTestId("treemap")).toBeInTheDocument();
    expect(metricValue("Total Cost")).toBe("$5");
  });

  it("titles the report", async () => {
    renderCost();
    await screen.findByTestId("treemap");
    expect(
      screen.getByRole("heading", { name: "Cost Analysis" }),
    ).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  Saved configuration                                                 */
/* ------------------------------------------------------------------ */

describe("CostReport saved configuration", () => {
  const lastPersisted = () =>
    vi.mocked(saved.persistConfig).mock.calls[
      vi.mocked(saved.persistConfig).mock.calls.length - 1
    ][0];

  it("persists every parameter at its default when the saved config sets none", async () => {
    saved.config = { view: "chart" };
    renderCost();
    await screen.findByTestId("treemap");
    await waitFor(() =>
      expect(lastPersisted()).toEqual({
        cardTypeKey: "Application",
        costField: "costTotalAnnual",
        groupBy: "",
        view: "chart",
        sortK: "cost",
        sortD: "desc",
        scopeIds: [],
        extraColumns: [],
        fiscalYearParam: null,
      }),
    );
  });

  it("persists a parameter as soon as it changes", async () => {
    renderCost();
    await screen.findByTestId("treemap");
    fireEvent.click(screen.getByRole("button", { name: /table view/i }));
    await screen.findByRole("table");
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({ view: "table" }),
    );
  });

  it("restores the sort column", async () => {
    saved.config = { view: "table", sortK: "name" };
    renderCost();
    await screen.findByRole("table");
    expect(
      rowTexts()
        .slice(1, 5)
        .map((r) => r.replace(/\$.*/, "")),
    ).toEqual(["HR", "ERP", "CRM Web Portal", "CRM"]);
  });

  it("restores the sort direction", async () => {
    saved.config = { view: "table", sortD: "asc" };
    renderCost();
    await screen.findByRole("table");
    expect(
      rowTexts()
        .slice(1, 5)
        .map((r) => r.replace(/\$.*/, "")),
    ).toEqual(["CRM Web Portal", "HR", "CRM", "ERP"]);
  });

  it("keeps only string scope ids", async () => {
    saved.config = { scopeIds: ["crm", 5, null] };
    renderCost();
    await screen.findByTestId("treemap");
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({ scopeIds: ["crm"] }),
    );
  });

  it("keeps the scope of a saved report that names another card type", async () => {
    // The page opens on Application; the report scopes IT Components. The
    // scope is restored for its own type, so the type change cannot drop it.
    saved.config = { cardTypeKey: "ITComponent", scopeIds: ["crm"] };
    renderCost();
    await screen.findByTestId("treemap");
    expect(await within(toolbar()).findByText("1 card")).toBeInTheDocument();
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({
        cardTypeKey: "ITComponent",
        scopeIds: ["crm"],
      }),
    );
  });

  it("ignores a saved card type that is not a string, keeping the page's type and its scope", async () => {
    // A hand-edited or corrupt config: the type stays on the default and the
    // scope is kept for it.
    saved.config = { cardTypeKey: 7, scopeIds: ["crm"] };
    renderCost();
    await screen.findByTestId("treemap");
    expect(lastTreemapParams().get("type")).toBe("Application");
    expect(await within(toolbar()).findByText("1 card")).toBeInTheDocument();
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({
        cardTypeKey: "Application",
        scopeIds: ["crm"],
      }),
    );
  });

  it("applies a saved report that finishes loading after the page mounted", async () => {
    const view = renderCost();
    await screen.findByTestId("treemap");
    saved.config = { view: "table" };
    saved.loadedConfig = { view: "table" };
    view.rerender(
      <MemoryRouter>
        <CostReport />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("keeps the default cost field when the saved config names none", async () => {
    // Two cost fields, so the auto-select does not step in and mask the restore.
    withMetamodel([APP_TWO_COSTS], []);
    saved.config = { view: "chart" };
    renderCost();
    await screen.findByTestId("treemap");
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({ costField: "costTotalAnnual" }),
    );
    for (const path of treemapCalls())
      expect(params(path).get("cost_field")).toBe("costTotalAnnual");
  });

  it("restores a cost field other than the type's first", async () => {
    withMetamodel([APP_TWO_COSTS], []);
    saved.config = { costField: "costRun" };
    renderCost();
    await screen.findByTestId("treemap");
    await waitFor(() =>
      expect(lastTreemapParams().get("cost_field")).toBe("costRun"),
    );
    expect(
      screen.getByRole("combobox", { name: /cost field/i }),
    ).toHaveTextContent("Run Cost");
  });
});

/* ------------------------------------------------------------------ */
/*  Reset                                                               */
/* ------------------------------------------------------------------ */

describe("CostReport reset", () => {
  it("clears the cost field and scope", async () => {
    withMetamodel([APP_TWO_COSTS, IT_COMPONENT_TYPE, CONTRACT_TYPE], RELATIONS);
    saved.config = { costField: "costRun", scopeIds: ["crm"] };
    renderCost();
    await screen.findByText("CRM", { selector: "text" });

    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(saved.resetAll).toHaveBeenCalled();
    await waitFor(() => {
      const p = lastTreemapParams();
      expect(p.get("cost_field")).toBe("costTotalAnnual");
    });
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({
          costField: "costTotalAnnual",
          scopeIds: [],
        }),
      ),
    );
  });

  it("returns to the Application type", async () => {
    saved.config = { cardTypeKey: "ITComponent" };
    renderCost();
    await waitFor(() =>
      expect(lastTreemapParams().get("type")).toBe("ITComponent"),
    );
    await screen.findByTestId("treemap");
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await waitFor(() =>
      expect(lastTreemapParams().get("type")).toBe("Application"),
    );
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ cardTypeKey: "Application" }),
      ),
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Toolbar                                                             */
/* ------------------------------------------------------------------ */

describe("CostReport toolbar", () => {
  it("offers None plus each single-select and yes/no field as a grouping, in table view only", async () => {
    saved.config = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    // The multi-select Regions cannot put a card in one group, so it is not offered.
    expect(await optionsOf(/group by/i)).toEqual([
      "None",
      "Business Criticality",
      "Cloud Hosted",
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: /treemap chart view/i }),
    );
    await screen.findByTestId("treemap");
    expect(
      screen.queryByRole("combobox", { name: /group by/i }),
    ).not.toBeInTheDocument();
  });

  it("drops the grouping picker when the new type has nothing to group by", async () => {
    saved.config = { view: "table" };
    renderCost();
    await screen.findByRole("combobox", { name: /group by/i });
    await pickOption(/card type/i, /IT Component/);
    await waitFor(() =>
      expect(lastTreemapParams().get("type")).toBe("ITComponent"),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("combobox", { name: /group by/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it("groups a value no option names by its raw value", async () => {
    const SVC = makeCardType({
      key: "ITComponent",
      label: "IT Component",
      fields_schema: [
        makeSection({
          fields: [
            makeField({
              key: "tier",
              label: "Tier",
              type: "single_select",
              options: [makeOption({ key: "silver", label: "Silver" })],
            }),
            makeField({ key: "svcCost", label: "Service Cost", type: "cost" }),
          ],
        }),
      ],
    });
    withMetamodel([APPLICATION_TYPE, SVC], []);
    saved.config = {
      cardTypeKey: "ITComponent",
      view: "table",
      groupBy: "tier",
    };
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [
        { id: "g", name: "Gold One", cost: 30, attributes: { tier: "gold" } },
        { id: "n", name: "No Attributes", cost: 10 },
      ],
      total: 40,
    });
    renderCost();
    await screen.findByRole("table");
    await waitFor(() =>
      expect(rowTexts().filter((r) => /\(\d\)/.test(r))).toEqual([
        "gold(1)$3075.0%",
        "Unspecified(1)$1025.0%",
      ]),
    );
  });

  it("groups by a yes/no field as Yes / No / Unspecified", async () => {
    const SVC = makeCardType({
      key: "ITComponent",
      label: "IT Component",
      fields_schema: [
        makeSection({
          fields: [
            makeField({ key: "tier", label: "Tier", type: "single_select" }),
            makeField({ key: "managed", label: "Managed", type: "boolean" }),
            makeField({ key: "svcCost", label: "Service Cost", type: "cost" }),
          ],
        }),
      ],
    });
    withMetamodel([APPLICATION_TYPE, SVC], []);
    saved.config = {
      cardTypeKey: "ITComponent",
      view: "table",
      groupBy: "managed",
    };
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [
        {
          id: "y",
          name: "Managed One",
          cost: 50,
          attributes: { managed: true },
        },
        { id: "f", name: "Self Run", cost: 30, attributes: { managed: false } },
        {
          id: "l",
          name: "Legacy Yes",
          cost: 10,
          attributes: { managed: "Yes" },
        },
        { id: "n", name: "No Attributes", cost: 10 },
      ],
      total: 100,
    });
    renderCost();
    await screen.findByRole("table");
    await waitFor(() =>
      expect(rowTexts().filter((r) => /\(\d\)/.test(r))).toEqual([
        "Yes(2)$6060.0%",
        "No(1)$3030.0%",
        "Unspecified(1)$1010.0%",
      ]),
    );
    // A single-select with no options cannot group: only the yes/no field is offered.
    expect(await optionsOf(/group by/i)).toEqual(["None", "Managed"]);
  });

  it("offers no cost field picker for a type with a single cost field", async () => {
    renderCost();
    await screen.findByTestId("treemap");
    expect(
      screen.queryByRole("combobox", { name: /cost field/i }),
    ).not.toBeInTheDocument();
  });

  it("never offers a type the cost report does not support, even if readable", async () => {
    withMetamodel(
      [APPLICATION_TYPE, IT_COMPONENT_TYPE, CONTRACT_TYPE, HIDDEN_TYPE],
      RELATIONS,
    );
    renderCost();
    await screen.findByTestId("treemap");
    expect(await optionsOf(/card type/i)).toEqual([
      "Application",
      "IT Component",
    ]);
  });

  it("offers Application and IT Component to a reports user who may not browse the inventory", async () => {
    renderWithProviders(<CostReport />, { user: userWith("costs.view") });
    await screen.findByTestId("treemap");
    expect(await optionsOf(/card type/i)).toEqual([
      "Application",
      "IT Component",
    ]);
  });
});

/* ------------------------------------------------------------------ */
/*  Summary metrics and panels                                          */
/* ------------------------------------------------------------------ */

describe("CostReport summary and panels", () => {
  it("averages to zero, not NaN, when there is no cost data", async () => {
    mockApi.on("get", "/reports/cost-treemap*", { items: [], total: 0 });
    renderCost();
    expect(await screen.findByText("No cost data found.")).toBeInTheDocument();
    expect(metricValue("Average")).toBe("$0");
    expect(metricValue("Items")).toBe("0");
  });

  it("gives a top driver that costs nothing a zero share", async () => {
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [{ id: "z", name: "Zero", cost: 0 }],
      total: 0,
    });
    renderCost();
    await screen.findByTestId("treemap");
    expect(screen.getByText("$0 (0%)")).toBeInTheDocument();
  });

  it("gives the panel the full height", async () => {
    renderCost();
    await screen.findByTestId("treemap");
    expect(
      screen
        .getAllByTestId("chart-container")
        .map((c) => c.getAttribute("data-height")),
    ).toEqual(["450"]);
  });
});

/* ------------------------------------------------------------------ */
/*  Table                                                               */
/* ------------------------------------------------------------------ */

describe("CostReport table", () => {
  // Name order, cost order, arrival order and its reverse all differ.
  const GROUP_ITEMS = [
    {
      id: "a",
      name: "Alpha",
      cost: 500,
      attributes: { businessCriticality: "missionCritical" },
    },
    {
      id: "z",
      name: "Zulu",
      cost: 10,
      attributes: { businessCriticality: "missionCritical" },
    },
    {
      id: "m",
      name: "Mango",
      cost: 900,
      attributes: { businessCriticality: "missionCritical" },
    },
  ];

  it("orders cards inside each group by the active sort and shares each of the total", async () => {
    mockApi.on("get", "/reports/cost-treemap*", {
      items: GROUP_ITEMS,
      total: 1410,
    });
    saved.config = { view: "table", groupBy: "businessCriticality" };
    renderCost();
    await screen.findByRole("table");
    await waitFor(() =>
      expect(rowTexts()).toEqual([
        "NameCost% of Total",
        "Mission Critical(3)$1410100.0%",
        "Mango$90063.8%",
        "Alpha$50035.5%",
        "Zulu$100.7%",
        "Total$1410100%",
      ]),
    );
    const names = () =>
      rowTexts()
        .slice(2, 5)
        .map((r) => r.replace(/\$.*/, ""));

    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(names()).toEqual(["Alpha", "Mango", "Zulu"]);
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(names()).toEqual(["Zulu", "Mango", "Alpha"]);
    fireEvent.click(screen.getByRole("button", { name: "Cost" }));
    expect(names()).toEqual(["Zulu", "Alpha", "Mango"]);
  });

  it("lists each card's share of the total", async () => {
    saved.config = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    expect(rowTexts()).toEqual([
      "NameCost% of Total",
      "ERP$50071.4%",
      "CRM$10014.3%",
      "HR$8011.4%",
      "CRM Web Portal$202.9%",
      "Total$700100%",
    ]);
  });

  it("shows a dash for the share when nothing costs anything", async () => {
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [{ id: "z", name: "Zero", cost: 0 }],
      total: 0,
    });
    saved.config = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    expect(rowTexts()).toEqual([
      "NameCost% of Total",
      "Zero$0—",
      "Total$0100%",
    ]);
  });

  it("marks the sorted column and its direction, and flips cost first", async () => {
    saved.config = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    const state = (name: string) => {
      const label = screen.getByRole("button", { name });
      const cls = label.querySelector("svg")?.getAttribute("class") ?? "";
      return [
        label.classList.contains("Mui-active"),
        cls.match(/iconDirection(\w*)/)?.[1],
      ];
    };
    expect(state("Cost")).toEqual([true, "Desc"]);
    expect(state("Name")).toEqual([false, "Asc"]);

    // Clicking the active descending column flips it to ascending.
    fireEvent.click(screen.getByRole("button", { name: "Cost" }));
    expect(state("Cost")).toEqual([true, "Asc"]);
    expect(
      rowTexts()
        .slice(1, 5)
        .map((r) => r.replace(/\$.*/, "")),
    ).toEqual(["CRM Web Portal", "HR", "CRM", "ERP"]);

    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(state("Name")).toEqual([true, "Asc"]);
    expect(state("Cost")).toEqual([false, "Asc"]);
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(state("Name")).toEqual([true, "Desc"]);
    expect(state("Cost")).toEqual([false, "Asc"]);
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ sortK: "name", sortD: "desc" }),
      ),
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Scope chip and saving                                               */
/* ------------------------------------------------------------------ */

describe("CostReport scope chip", () => {
  it("counts the scoped cards, and clearing the scope widens the report back", async () => {
    saved.config = { scopeIds: ["crm"] };
    renderCost();
    await screen.findByTestId("treemap");
    const label = await within(toolbar()).findByText("1 card");
    await waitFor(() =>
      expect(
        screen.queryByText("ERP", { selector: "text" }),
      ).not.toBeInTheDocument(),
    );

    fireEvent.click(
      label.closest(".MuiChip-root")!.querySelector(".MuiChip-deleteIcon")!,
    );
    expect(await within(toolbar()).findByText("All cards")).toBeInTheDocument();
    expect(
      await screen.findByText("ERP", { selector: "text" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ scopeIds: [] }),
      ),
    );
  });

  it("opens the scope picker with the report's own title and help", async () => {
    renderCost();
    await screen.findByTestId("treemap");
    fireEvent.click(within(toolbar()).getByText("All cards"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Scope to cards")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Cards beneath a selected card are included automatically.",
      ),
    ).toBeInTheDocument();
  });

  it("explains the scope chip on hover", async () => {
    renderCost();
    await screen.findByTestId("treemap");
    fireEvent.mouseOver(within(toolbar()).getByText("All cards"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Show only the selected cards and everything beneath them",
    );
  });
});

describe("CostReport saving", () => {
  it("saves as a cost report and opens the save dialog once the thumbnail is captured", async () => {
    renderCost();
    await screen.findByTestId("treemap");
    expect(new Set(saved.reportTypes)).toEqual(new Set(["cost"]));
    fireEvent.click(screen.getByRole("button", { name: /save report/i }));
    expect(saved.setSaveDialogOpen).toHaveBeenCalledWith(true);
  });
});
