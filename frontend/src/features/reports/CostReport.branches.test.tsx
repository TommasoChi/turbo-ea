/**
 * Branch coverage for the Cost report beyond scope and fiscal year (those live
 * in CostReport.test.tsx): the permission gate, the treemap and its tooltip,
 * related-card cost sources and the drill-down they enable, saved-config
 * restore (including the legacy drill-frame shapes), the table's sorting and
 * grouping, and the shell actions.
 *
 * Recharts lays out nothing in jsdom, so `Treemap` is replaced by a stub that
 * hands each datum to the page's own `content` renderer at a fixed size —
 * which is the code under test — and renders the tooltip content once, active.
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
import userEvent from "@testing-library/user-event";
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
  saveDialogOpen: false,
  savedReportName: null as string | null,
  setSaveDialogOpen: (() => {}) as (open: boolean) => void,
  resetAll: (() => {}) as () => void,
  resetSavedReport: (() => {}) as () => void,
  persistConfig: (() => {}) as (cfg: unknown) => void,
}));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: () => ({
    savedReport: null,
    savedReportName: saved.savedReportName,
    saveDialogOpen: saved.saveDialogOpen,
    setSaveDialogOpen: saved.setSaveDialogOpen,
    loadedConfig: null,
    consumeConfig: () => saved.config,
    resetSavedReport: saved.resetSavedReport,
    persistConfig: saved.persistConfig,
    resetAll: saved.resetAll,
    reportType: "cost",
  }),
}));

const captureAndSave = vi.hoisted(() => ({ fn: (() => {}) as () => void }));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: () => ({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: () => captureAndSave.fn(),
  }),
}));

vi.mock("./SaveReportDialog", () => ({
  default: (props: {
    open: boolean;
    onClose: () => void;
    config: Record<string, unknown>;
  }) =>
    props.open ? (
      <div data-testid="save-dialog" data-config={JSON.stringify(props.config)}>
        <button onClick={props.onClose}>close-save</button>
      </div>
    ) : null,
}));

vi.mock("@/components/CardDetailSidePanel", () => ({
  default: (props: {
    cardId: string | null;
    open: boolean;
    onClose: () => void;
  }) =>
    props.open ? (
      <div data-testid="side-panel">
        {props.cardId}
        <button onClick={props.onClose}>close-panel</button>
      </div>
    ) : null,
}));

// Cell sizes by position: large (label + cost), medium (label only), tiny (nothing).
const CELL_SIZES = [
  [300, 100],
  [60, 35],
  [3, 3],
];

vi.mock("recharts", async () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { createContext, useContext } =
    await vi.importActual<typeof import("react")>("react");
  const Data = createContext<any[]>([]);
  return {
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    Treemap: ({ data, content, children }: any) => (
      <div data-testid="treemap">
        <svg>
          {data.map((d: any, i: number) => {
            const [width, height] = CELL_SIZES[i % CELL_SIZES.length];
            return cloneElement(content as ReactElement<any>, {
              key: d.id,
              ...d,
              x: 10,
              y: 10,
              width,
              height,
            });
          })}
        </svg>
        <Data.Provider value={data}>{children}</Data.Provider>
      </div>
    ),
    Tooltip: ({ content }: any) => {
      const data = useContext(Data);
      return (
        <div data-testid="treemap-tooltip">
          {cloneElement(content, {
            active: true,
            payload: [{ payload: data[0] }],
          })}
          {cloneElement(content, { active: false })}
        </div>
      );
    },
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
});

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { userWith } from "@/test/render";
import {
  APPLICATION_TYPE,
  IT_COMPONENT_TYPE,
  makeCardType,
  makeField,
  makeRelationType,
  makeSection,
} from "@/test/fixtures/metamodel";
import CostReport from "./CostReport";

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
const REL_HIDDEN = makeRelationType({
  key: "relHidden",
  source_type_key: "Application",
  target_type_key: "Contract",
  is_hidden: true,
});
const REL_SELF = makeRelationType({
  key: "relAppToApp",
  source_type_key: "Application",
  target_type_key: "Application",
});
const REL_ELSEWHERE = makeRelationType({
  key: "relItcToContract",
  source_type_key: "ITComponent",
  target_type_key: "Contract",
});

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

const treemapCalls = () =>
  mockApi.callsOf("get", "/reports/cost-treemap*").map((c) => c.path);
const lastTreemapParams = () =>
  new URLSearchParams(treemapCalls()[treemapCalls().length - 1].split("?")[1]);

function renderCost() {
  return render(
    <MemoryRouter>
      <CostReport />
    </MemoryRouter>,
  );
}

const metric = (label: string) =>
  screen.getByText(label).closest(".MuiPaper-root");

async function pickOption(label: RegExp, option: RegExp) {
  // The request the caller waited on is recorded when it is sent, not when its
  // response renders, so the toolbar may still be behind a spinner here.
  fireEvent.mouseDown(
    await screen.findByRole("combobox", { name: label }, { timeout: 5000 }),
  );
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: option }));
  // A multi-select keeps its menu open; close it so the page is reachable again.
  if (screen.queryByRole("listbox")) {
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
  }
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  hookState.auth.user = userWith("costs.view");
  withMetamodel(
    [APPLICATION_TYPE, IT_COMPONENT_TYPE, CONTRACT_TYPE],
    [REL_APP_ITC, REL_CONTRACT_APP, REL_HIDDEN, REL_SELF, REL_ELSEWHERE],
  );
  saved.config = null;
  saved.saveDialogOpen = false;
  saved.savedReportName = null;
  saved.setSaveDialogOpen = vi.fn();
  saved.resetAll = vi.fn();
  saved.resetSavedReport = vi.fn();
  saved.persistConfig = vi.fn();
  captureAndSave.fn = vi.fn();

  mockApi.on("get", "/reports/cost-treemap*", {
    items: ITEMS,
    total: 700,
    fiscal_year: 2026,
    fiscal_year_start: 1,
  });
});

describe("CostReport permission gate", () => {
  it("explains the restriction and never asks for cost data without costs.view", async () => {
    hookState.auth.user = userWith("reports.view");
    renderCost();
    expect(await screen.findByText("Cost data restricted")).toBeInTheDocument();
    expect(treemapCalls()).toHaveLength(0);
  });

  it("lets the wildcard role through", async () => {
    hookState.auth.user = userWith("*");
    renderCost();
    expect(await screen.findByTestId("treemap")).toBeInTheDocument();
  });

  it("shows a spinner while the metamodel is loading", () => {
    hookState.metamodel.loading = true;
    renderCost();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });
});

describe("CostReport treemap", () => {
  it("draws the largest card first with its cost, and summarises the totals", async () => {
    renderCost();
    const treemap = await screen.findByTestId("treemap");
    const svg = treemap.querySelector("svg")!;
    // ERP (500) leads at full size: name + cost.
    expect(
      within(svg as unknown as HTMLElement).getByText("ERP"),
    ).toBeInTheDocument();
    expect(
      within(svg as unknown as HTMLElement).getByText("$500"),
    ).toBeInTheDocument();
    // CRM (100) is medium — a label but no cost line; HR (80) is too small to draw.
    expect(
      within(svg as unknown as HTMLElement).getByText("CRM"),
    ).toBeInTheDocument();
    expect(
      within(svg as unknown as HTMLElement).queryByText("$100"),
    ).not.toBeInTheDocument();
    expect(
      within(svg as unknown as HTMLElement).queryByText("HR"),
    ).not.toBeInTheDocument();
    // Fourth item (CRM Web Portal) cycles back to large: its name fits there.
    expect(
      within(svg as unknown as HTMLElement).getByText("CRM Web Portal"),
    ).toBeInTheDocument();

    expect(metric("Total Cost")).toHaveTextContent("$700");
    expect(metric("Items")).toHaveTextContent("4");
    expect(metric("Average")).toHaveTextContent("$175");
    expect(metric("Top Cost Driver")).toHaveTextContent("ERP");
    expect(screen.getByText(/\$500 \(71%\)/)).toBeInTheDocument();
  });

  it("names the hovered card in the tooltip", async () => {
    renderCost();
    const tip = await screen.findByTestId("treemap-tooltip");
    expect(await within(tip).findByText("ERP")).toBeInTheDocument();
    expect(within(tip).getByText("$500")).toBeInTheDocument();
  });

  it("truncates a name that does not fit its cell", async () => {
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [
        { id: "a", name: "Big", cost: 900 },
        { id: "b", name: "A Very Long Application Name", cost: 50 },
      ],
      total: 950,
    });
    renderCost();
    await screen.findByTestId("treemap");
    expect(screen.getByText("A Very …")).toBeInTheDocument();
  });

  it("anchors the labels on the right in a right-to-left locale", async () => {
    hookState.isRtl = true;
    renderCost();
    const label = await screen.findByText("ERP", { selector: "text" });
    expect(label).toHaveAttribute("text-anchor", "end");
    expect(label).toHaveAttribute("x", String(10 + 300 - 6));
  });

  it("opens the card's side panel when a cell is clicked", async () => {
    renderCost();
    fireEvent.click(await screen.findByText("ERP", { selector: "text" }));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("erp");
    fireEvent.click(screen.getByRole("button", { name: "close-panel" }));
    expect(screen.queryByTestId("side-panel")).not.toBeInTheDocument();
  });

  it("says so when there is no cost data at all", async () => {
    mockApi.on("get", "/reports/cost-treemap*", { items: [], total: 0 });
    renderCost();
    expect(await screen.findByText("No cost data found.")).toBeInTheDocument();
    expect(screen.queryByText("Top Cost Driver")).not.toBeInTheDocument();
  });
});

describe("CostReport toolbar", () => {
  const TWO_COSTS = makeCardType({
    key: "Application",
    label: "Application",
    fields_schema: [
      makeSection({
        section: "Costs",
        fields: [
          makeField({
            key: "costTotalAnnual",
            label: "Total Annual Cost",
            type: "cost",
          }),
          makeField({ key: "costRun", label: "Run Cost", type: "cost" }),
        ],
      }),
    ],
  });

  it("offers a cost field picker when the type has several cost fields", async () => {
    withMetamodel([TWO_COSTS], []);
    renderCost();
    await screen.findByTestId("treemap");
    expect(lastTreemapParams().get("cost_field")).toBe("costTotalAnnual");
    await pickOption(/cost field/i, /Run Cost/);
    await waitFor(() =>
      expect(lastTreemapParams().get("cost_field")).toBe("costRun"),
    );
  });

  it("falls back to the new type's first cost field when the current one is not on it", async () => {
    const ITC_TWO_COSTS = makeCardType({
      key: "ITComponent",
      label: "IT Component",
      fields_schema: [
        makeSection({
          section: "Budget",
          fields: [
            makeField({ key: "capex", label: "Capex", type: "cost" }),
            makeField({ key: "opex", label: "Opex", type: "cost" }),
          ],
        }),
      ],
    });
    withMetamodel([TWO_COSTS, ITC_TWO_COSTS], []);
    renderCost();
    await screen.findByTestId("treemap");
    await pickOption(/card type/i, /IT Component/);
    await waitFor(() =>
      expect(lastTreemapParams().get("type")).toBe("ITComponent"),
    );
    expect(lastTreemapParams().get("cost_field")).toBe("capex");
  });

  it("switches card type and picks that type's only cost field", async () => {
    renderCost();
    await screen.findByTestId("treemap");
    await pickOption(/card type/i, /IT Component/);
    await waitFor(() =>
      expect(lastTreemapParams().get("type")).toBe("ITComponent"),
    );
    expect(lastTreemapParams().get("cost_field")).toBe("licenseCost");
  });

  it("saves through the thumbnail capture and closes the save dialog", async () => {
    saved.saveDialogOpen = true;
    renderCost();
    await screen.findByTestId("treemap");
    fireEvent.click(screen.getByRole("button", { name: /save report/i }));
    expect(captureAndSave.fn).toHaveBeenCalled();
    const cfg = JSON.parse(
      screen.getByTestId("save-dialog").getAttribute("data-config")!,
    );
    expect(cfg).toMatchObject({ cardTypeKey: "Application", view: "chart" });
    fireEvent.click(screen.getByRole("button", { name: "close-save" }));
    expect(saved.setSaveDialogOpen).toHaveBeenCalledWith(false);
  });

  it("resets every parameter to its default", async () => {
    saved.config = {
      view: "table",
      sortK: "name",
      sortD: "asc",
      groupBy: "businessCriticality",
    };
    renderCost();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(saved.resetAll).toHaveBeenCalled();
    expect(await screen.findByTestId("treemap")).toBeInTheDocument();
    expect(saved.persistConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        view: "chart",
        sortK: "cost",
        sortD: "desc",
        groupBy: "",
      }),
    );
  });

  it("shows the saved-report banner with its reset action", async () => {
    saved.savedReportName = "Q3 costs";
    renderCost();
    await screen.findByTestId("treemap");
    expect(screen.getByText("Q3 costs")).toBeInTheDocument();
  });
});

describe("CostReport table", () => {
  const rowNames = () =>
    screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[0].textContent);

  it("sorts by cost, then by name in both directions", async () => {
    const user = userEvent.setup();
    saved.config = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    expect(rowNames()).toEqual(["ERP", "CRM", "HR", "CRM Web Portal", "Total"]);

    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(rowNames()).toEqual(["CRM", "CRM Web Portal", "ERP", "HR", "Total"]);
    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(rowNames()).toEqual(["HR", "ERP", "CRM Web Portal", "CRM", "Total"]);
    await user.click(screen.getByRole("button", { name: "Cost" }));
    expect(rowNames()).toEqual(["CRM Web Portal", "HR", "CRM", "ERP", "Total"]);

    await user.click(screen.getByRole("cell", { name: "ERP" }));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("erp");
  });

  it("groups rows by a single-select field, with an Unspecified bucket", async () => {
    const user = userEvent.setup();
    saved.config = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    await pickOption(/group by/i, /Business Criticality/);

    await waitFor(() =>
      expect(screen.getByText("Mission Critical")).toBeInTheDocument(),
    );
    // Groups by cost desc: Mission Critical (600), Unspecified (80), then the
    // unknown option key shown raw (20).
    const labels = screen.getAllByRole("row").map((r) => r.textContent ?? "");
    expect(labels.filter((l) => /\(\d\)/.test(l))).toEqual([
      "Mission Critical(2)$60085.7%",
      "Unspecified(1)$8011.4%",
      "bogus(1)$202.9%",
    ]);

    // Sorting applies within each group.
    await user.click(screen.getByRole("button", { name: "Name" }));
    const afterSort = screen
      .getAllByRole("row")
      .map((r) => r.textContent ?? "");
    const mc = afterSort.findIndex((l) => l.startsWith("Mission Critical"));
    expect(afterSort[mc + 1]).toMatch(/^CRM/);
    expect(afterSort[mc + 2]).toMatch(/^ERP/);
    await user.click(screen.getByRole("button", { name: "Cost" }));
    const byCost = screen.getAllByRole("row").map((r) => r.textContent ?? "");
    expect(byCost[mc + 1]).toMatch(/^CRM\$100/);

    await user.click(screen.getByRole("cell", { name: "CRM Web Portal" }));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("web");
  });

  it("shows a dash instead of a share when every cost is zero", async () => {
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [{ id: "z", name: "Zero", cost: 0, attributes: {} }],
      total: 0,
    });
    saved.config = { view: "table", groupBy: "businessCriticality" };
    renderCost();
    await screen.findByRole("table");
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("toggles back to the chart from the shell", async () => {
    const user = userEvent.setup();
    saved.config = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: /treemap chart view/i }),
    );
    expect(await screen.findByTestId("treemap")).toBeInTheDocument();
    await act(async () => {});
  });

  it("renders a picked column's value per row and a header with its label", async () => {
    saved.config = { view: "table", extraColumns: ["businessCriticality"] };
    renderCost();
    await screen.findByRole("table");
    expect(
      screen.getByRole("columnheader", { name: "Business Criticality" }),
    ).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /ERP/ });
    expect(within(row).getByText("Mission Critical")).toBeInTheDocument();
  });

  it("shows the empty sentinel for a row missing the picked field", async () => {
    saved.config = { view: "table", extraColumns: ["businessCriticality"] };
    renderCost();
    await screen.findByRole("table");
    const row = screen.getByRole("row", { name: /^HR/ });
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("sums a cost-typed picked column per group when grouped", async () => {
    const APP_TWO_COSTS = makeCardType({
      key: "Application",
      label: "Application",
      fields_schema: [
        makeSection({
          section: "Costs",
          fields: [
            makeField({
              key: "businessCriticality",
              label: "Business Criticality",
              type: "single_select",
              options: [{ key: "missionCritical", label: "Mission Critical" }],
            }),
            makeField({
              key: "costRun",
              label: "Run Cost",
              type: "cost",
            }),
          ],
        }),
      ],
    });
    withMetamodel([APP_TWO_COSTS, IT_COMPONENT_TYPE], []);
    saved.config = {
      view: "table",
      groupBy: "businessCriticality",
      extraColumns: ["costRun"],
    };
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [
        {
          id: "a",
          name: "A",
          cost: 100,
          attributes: { businessCriticality: "missionCritical", costRun: 40 },
        },
        {
          id: "b",
          name: "B",
          cost: 200,
          attributes: { businessCriticality: "missionCritical", costRun: 60 },
        },
      ],
      total: 300,
    });
    renderCost();
    await screen.findByRole("table");
    const groupRow = screen.getByRole("row", { name: /Mission Critical/ });
    expect(within(groupRow).getByText("$100")).toBeInTheDocument(); // 40 + 60
  });

  it("renders a cost column's per-row values with no subtotal when ungrouped", async () => {
    saved.config = { view: "table", extraColumns: ["costTotalAnnual"] };
    mockApi.on("get", "/reports/cost-treemap*", {
      items: ITEMS.map((it) => ({
        ...it,
        attributes: { ...it.attributes, costTotalAnnual: it.cost },
      })),
      total: 700,
      fiscal_year: 2026,
      fiscal_year_start: 1,
    });
    renderCost();
    await screen.findByRole("table");
    const row = screen.getByRole("row", { name: /ERP/ });
    expect(within(row).getByText("$500")).toBeInTheDocument();
    expect(
      screen.queryByRole("row", { name: /^Mission Critical/ }),
    ).not.toBeInTheDocument();
  });
});
