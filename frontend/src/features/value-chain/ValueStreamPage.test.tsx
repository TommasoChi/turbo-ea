import { act, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { makeCardType, makeField, makeOption, makeSection } from "@/test/fixtures/metamodel";
import { makeStreamRoot } from "@/test/fixtures/valueChain";
import { hookState, withMetamodel } from "@/test/hooks";
import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import type { ValueStreamResponse, ValueStreamRoot } from "@/types";
import { STREAM_BAND_ORDER_STORAGE_KEY } from "./valueChainModel";
import { exportValueStreamToWord, type WordExportInput } from "./valueChainExport";
import ValueStreamPage from "./ValueStreamPage";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: ({ cardId, open }: { cardId: string | null; open: boolean }) => (
    <div data-testid="card-panel" data-open={String(open)}>
      {cardId}
    </div>
  ),
}));
vi.mock("@/components/ProcessDetailSidePanel", () => ({
  default: ({ processId, open }: { processId: string | null; open: boolean }) => (
    <div data-testid="process-panel" data-open={String(open)}>
      {processId}
    </div>
  ),
}));
vi.mock("@/components/ProcessFlowPreview", () => ({
  default: ({ processId, open }: { processId: string | null; open: boolean }) => (
    <div data-testid="flow-panel" data-open={String(open)}>
      {processId}
    </div>
  ),
}));
vi.mock("./valueChainExport", async (importActual) => ({
  ...(await importActual<typeof import("./valueChainExport")>()),
  exportValueStreamToWord: vi.fn(),
}));
const exportXlsx = vi.hoisted(() => vi.fn());
vi.mock("@/features/reports/reportExport", async (importActual) => ({
  ...(await importActual<typeof import("@/features/reports/reportExport")>()),
  exportReportToXlsx: exportXlsx,
}));

const t = i18n.getFixedT("en", "valuechain");
const tr = i18n.getFixedT("en", "reports");

const NONE = "/reports/value-chain/r-cat?related=none";
const APPS = "/reports/value-chain/r-cat?related=applications";
const BAND_LABEL_RE = new RegExp(`^(${["gate", "vs", "process", "cap"].map((k) => t(`stream.band.${k}`)).join("|")})$`);
const bandOrder = () => screen.getAllByText(BAND_LABEL_RE).map((el) => el.textContent);
const labelsOf = (...keys: string[]) => keys.map((k) => t(`stream.band.${k}`));

const METAMODEL = [
  makeCardType({
    key: "Objective",
    color: "#33691e",
    fields_schema: [
      makeSection({
        fields: [
          makeField({
            key: "objectiveType",
            type: "single_select",
            label: "Objective kind",
            options: [makeOption({ key: "strategic", label: "Strategic", color: "#c2185b" })],
          }),
        ],
      }),
    ],
  }),
  makeCardType({
    key: "BusinessProcess",
    fields_schema: [
      makeSection({
        fields: [
          makeField({
            key: "processType",
            type: "single_select",
            label: "Process kind",
            options: [
              makeOption({ key: "management", label: "Management", color: "#00796b" }),
              makeOption({ key: "support", label: "Support", color: "#8e24aa" }),
            ],
          }),
        ],
      }),
    ],
  }),
];

/** The fixture root with every `related` list emptied, as the API sends it for `related=none`. */
function withoutRelated(root: ValueStreamRoot = makeStreamRoot()): ValueStreamRoot {
  const processes = Object.fromEntries(Object.entries(root.processes).map(([id, p]) => [id, { ...p, related: [] }]));
  return { ...root, processes };
}

const response = (...roots: ValueStreamRoot[]): ValueStreamResponse => ({ roots });

function Where() {
  const { pathname } = useLocation();
  return <div data-testid="where">{pathname}</div>;
}

function renderPage(search = "?category=r-cat", exportWord?: (input: WordExportInput) => Promise<void>) {
  return renderWithProviders(<ValueStreamPage exportWord={exportWord} />, {
    route: `/value-chain/value-stream${search}`,
    routes: [{ path: "/value-chain/value-stream" }, { path: "*", element: <Where /> }],
  });
}

const rootName = () => screen.findByRole("button", { name: "Hire-to-Retire" });
const wordName = (key: string) => new RegExp(`^description ${t(`actions.${key}`)}$`);

async function chooseRelated(user: ReturnType<typeof renderPage>["user"], label: string) {
  await user.click(screen.getByRole("combobox", { name: new RegExp(`^${t("stream.showRelated")}`) }));
  await user.click(await screen.findByRole("option", { name: label }));
}

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  exportXlsx.mockReset();
  vi.mocked(exportValueStreamToWord).mockReset();
  withMetamodel(METAMODEL);
  mockApi.on("get", NONE, response(withoutRelated()));
});

describe("ValueStreamPage", () => {
  it("(1) fetches the category's map with related=none and renders it under the page title", async () => {
    renderPage();
    await rootName();
    expect(mockApi.calls.map((c) => c.path)).toEqual([NONE]);
    expect(screen.getByRole("heading", { name: t("page.stream.title") })).toBeInTheDocument();
    expect(screen.getByText("Sourcing")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("(1) encodes the category id in the request", async () => {
    mockApi.on("get", "/reports/value-chain/a%20b%26c?related=none", response(makeStreamRoot()));
    renderPage("?category=a%20b%26c");
    await rootName();
    expect(mockApi.calls.map((c) => c.path)).toEqual(["/reports/value-chain/a%20b%26c?related=none"]);
  });

  it("shows a spinner, not the map, while the first load is in flight", async () => {
    mockApi.on("get", NONE, () => new Promise(() => {}));
    renderPage();
    expect(await screen.findByRole("progressbar")).toHaveClass("MuiCircularProgress-root");
    expect(screen.queryByRole("button", { name: "Hire-to-Retire" })).toBeNull();
  });

  it("(2) refetches with related=applications, keeping the previous map behind a progress bar", async () => {
    let resolveApps: (v: ValueStreamResponse) => void = () => {};
    mockApi.on("get", APPS, () => new Promise<ValueStreamResponse>((resolve) => (resolveApps = resolve)));
    const { user } = renderPage();
    await rootName();
    expect(screen.queryByText("Workday")).toBeNull();

    await chooseRelated(user, t("stream.related.applications"));
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveClass("MuiLinearProgress-root");
    expect(bar.closest(".report-chart-area")).toBeNull();
    expect(screen.getByRole("button", { name: "Hire-to-Retire" })).toBeInTheDocument();
    expect(screen.getByText("Sourcing")).toBeInTheDocument();
    expect(mockApi.calls.map((c) => c.path)).toEqual([NONE, APPS]);

    await act(async () => resolveApps(response(makeStreamRoot())));
    expect(await screen.findByText("Workday")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("(3) keeps the map and shows the error above it when a refetch fails", async () => {
    mockApi.fail("get", APPS, 500);
    const { user } = renderPage();
    await rootName();
    await chooseRelated(user, t("stream.related.applications"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(t("error.load"));
    expect(alert).toHaveClass("MuiAlert-standardError");
    expect(alert.closest(".report-chart-area")).toBeNull();
    const name = screen.getByRole("button", { name: "Hire-to-Retire" });
    expect(alert.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Sourcing")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows the load error and no map when the first load fails", async () => {
    mockApi.fail("get", NONE, 500);
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(t("error.load"));
    expect(alert).toHaveClass("MuiAlert-standardError");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(t("stream.band.vs"))).toBeNull();
  });

  it("(4) a 404 shows the not-found warning and no map", async () => {
    mockApi.fail("get", NONE, 404);
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(t("error.notFound"));
    expect(alert).toHaveClass("MuiAlert-standardWarning");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText(t("stream.band.vs"))).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("(5) without a category shows the info alert and calls no API", async () => {
    renderPage("");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(t("stream.noCategory"));
    expect(alert).toHaveClass("MuiAlert-standardInfo");
    expect(screen.getByRole("button", { name: t("actions.back") })).toBeInTheDocument();
    await act(async () => {});
    expect(mockApi.calls).toEqual([]);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("(6) a category without roots shows the no-roots alert", async () => {
    mockApi.on("get", NONE, response());
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(t("stream.noRoots"));
    expect(alert).toHaveClass("MuiAlert-standardInfo");
    expect(screen.queryByText(t("stream.band.vs"))).toBeNull();
  });

  it("(7) persists the band order and reads it back on the next mount", async () => {
    const { user, unmount } = renderPage();
    await rootName();
    expect(bandOrder()).toEqual(labelsOf("gate", "vs", "process", "cap"));
    const vsHeader = within(screen.getByText(t("stream.band.vs")).parentElement!);
    await user.click(vsHeader.getByRole("button", { name: t("actions.moveUp") }));
    expect(bandOrder()).toEqual(labelsOf("vs", "gate", "process", "cap"));
    expect(JSON.parse(localStorage.getItem(STREAM_BAND_ORDER_STORAGE_KEY)!)).toEqual(["vs", "gate", "process", "cap"]);
    unmount();

    renderPage();
    await rootName();
    expect(bandOrder()).toEqual(labelsOf("vs", "gate", "process", "cap"));
  });

  it("(7) falls back to the default order when storage cannot be read, and still moves when it cannot be written", async () => {
    localStorage.setItem(STREAM_BAND_ORDER_STORAGE_KEY, JSON.stringify(["vs", "gate", "process", "cap"]));
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      const { user } = renderPage();
      await rootName();
      expect(bandOrder()).toEqual(labelsOf("gate", "vs", "process", "cap"));
      const capHeader = within(screen.getByText(t("stream.band.cap")).parentElement!);
      await user.click(capHeader.getByRole("button", { name: t("actions.moveUp") }));
      expect(bandOrder()).toEqual(labelsOf("gate", "vs", "cap", "process"));
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("(8) opens the card, process and flow panels from the map", async () => {
    const { user } = renderPage();
    await user.click(await rootName());
    expect(screen.getByTestId("card-panel")).toHaveTextContent("r1");
    expect(screen.getByTestId("card-panel")).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("process-panel")).toHaveAttribute("data-open", "false");

    await user.click(screen.getByText("Post job ad"));
    expect(screen.getByTestId("process-panel")).toHaveTextContent("p-solo");
    expect(screen.getByTestId("process-panel")).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("flow-panel")).toHaveAttribute("data-open", "false");

    const interview = screen.getByText("Interview").closest("[data-process]") as HTMLElement;
    await user.click(within(interview).getByRole("button", { name: t("actions.viewFlow") }));
    expect(screen.getByTestId("flow-panel")).toHaveTextContent("p-span");
    expect(screen.getByTestId("flow-panel")).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("process-panel")).toHaveTextContent("p-solo");
  });

  it("(9) renders the full map for a user without bpm.view, with no flow buttons", async () => {
    const root = withoutRelated();
    for (const p of Object.values(root.processes)) p.element_count = 0;
    mockApi.on("get", "/reports/value-chain/r-cat*", response(root));
    const { user } = renderPage();
    await rootName();
    for (const name of ["Sourcing", "Screen CVs", "Post job ad", "Interview", "Reporting"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: t("actions.viewFlow") })).toBeNull();
    await chooseRelated(user, t("stream.related.applications"));
    await waitFor(() => expect(mockApi.calls).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
    expect(screen.getByText("Sourcing")).toBeInTheDocument();
    expect(screen.queryByText("Workday")).toBeNull();
  });

  it("(10) the back button returns to the value chain", async () => {
    const { user } = renderPage();
    await rootName();
    await user.click(screen.getByRole("button", { name: t("actions.back") }));
    expect(await screen.findByTestId("where")).toHaveTextContent("/value-chain");
  });

  it("colours and labels the selects from the metamodel, with translated fallbacks", async () => {
    const { user } = renderPage();
    await rootName();
    // processType legend: metamodel options + Not set.
    expect(screen.getByText("Management")).toBeInTheDocument();
    expect(screen.getByText("Support")).toBeInTheDocument();
    expect(screen.getByText(t("legend.notSet"))).toBeInTheDocument();
    const colorBy = screen.getByRole("combobox", { name: new RegExp(`^${t("stream.colorBy")}`) });
    expect(colorBy).toHaveTextContent("Process kind");
    await user.click(colorBy);
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual([
      t("stream.colorBy.none"),
      "Process kind",
      t("stream.colorBy.maturity"),
      t("stream.colorBy.automationLevel"),
      t("stream.colorBy.riskLevel"),
    ]);
  });

  it("colours the gates by the metamodel's objective types once chosen, and the processes by default", async () => {
    const { user } = renderPage();
    await rootName();
    await user.click(within(screen.getByText(t("stream.band.gate")).parentElement!).getByRole("button", { name: t("actions.expand") }));
    const pill = screen.getByText("Budget approved").closest("button")!;
    expect(pill).toHaveStyle({ backgroundColor: "rgb(51, 105, 30)" }); // the metamodel Objective colour
    expect(screen.queryByText("Strategic")).toBeNull();

    const [gateColorBy, processColorBy] = screen.getAllByRole("combobox", { name: new RegExp(`^${t("stream.colorBy")}`) });
    await user.click(gateColorBy);
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual([
      t("stream.colorBy.none"),
      "Objective kind",
    ]);
    await user.click(screen.getByRole("option", { name: "Objective kind" }));
    expect(pill).toHaveStyle({ backgroundColor: "rgb(194, 24, 91)" });
    expect(screen.getByText("Strategic")).toBeInTheDocument();

    expect(screen.getByText("Management")).toBeInTheDocument();
    await user.click(processColorBy);
    await user.click(await screen.findByRole("option", { name: t("stream.colorBy.none") }));
    expect(screen.queryByText("Management")).toBeNull();
  });

  it("exports the roots with translated labels, metamodel objective types and the chart area", async () => {
    const { user } = renderPage();
    await rootName();
    await user.click(screen.getByRole("button", { name: tr("shell.moreActions") }));
    await user.click(await screen.findByText(tr("shell.exportXlsx")));

    await waitFor(() => expect(exportXlsx).toHaveBeenCalledTimes(1));
    const data = exportXlsx.mock.calls[0][0];
    expect(data.title).toBe(t("page.stream.title"));
    expect(data.chartNode).toBeInstanceOf(HTMLElement);
    expect(data.chartNode).toHaveTextContent("Hire-to-Retire");
    const sheet = (kind: string) =>
      data.sheets.find((s: { name: string }) => s.name === `Hire-to-Retire - ${t(kind)}`);
    expect(sheet("sheet.gates").columns.map((c: { label: string }) => c.label)).toEqual([
      t("col.name"),
      t("col.leaf"),
      t("col.type"),
    ]);
    expect(sheet("sheet.gates").rows).toEqual([
      { name: "Budget approved", leaf: "Attract", type: "Strategic" },
      { name: "Quarterly review", leaf: "Plan and monitor", type: t("legend.notSet") },
    ]);
    expect(sheet("sheet.processes").rows[0]).toEqual({ name: "Sourcing", subtype: t("stream.subtype.group"), row: 1, steps: 9 });
    expect(data.sheets.map((s: { name: string }) => s.name)).toEqual(
      ["sheet.streams", "sheet.processes", "sheet.gates", "sheet.capabilities", "sheet.goals"].map(
        (k) => `Hire-to-Retire - ${t(k)}`,
      ),
    );
  });

  describe("Save as Word", () => {
    const TWO_ROOTS = response(withoutRelated(), withoutRelated(makeStreamRoot({ id: "r2", name: "Order-to-Cash" })));

    it("is offered by default, wired to the real export", async () => {
      vi.mocked(exportValueStreamToWord).mockResolvedValue();
      const { user } = renderPage();
      await rootName();
      await user.click(screen.getByRole("button", { name: wordName("saveWord") }));
      expect(exportValueStreamToWord).toHaveBeenCalledTimes(1);
    });

    it("hands the export the root's data and the translated labels", async () => {
      vi.mocked(exportValueStreamToWord).mockResolvedValue();
      vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 15, 12) });
      try {
        const { user } = renderPage();
        await rootName();
        await user.click(screen.getByRole("button", { name: wordName("saveWord") }));
      } finally {
        vi.useRealTimers();
      }
      const input = vi.mocked(exportValueStreamToWord).mock.calls[0][0];
      expect(input.rootName).toBe("Hire-to-Retire");
      expect(input.goals).toEqual(["Improve talent management"]);
      expect(input.labels).toEqual({
        subtitle: "Value Stream Map – October 15, 2026",
        goalsHeading: "Business goals",
        processesHeading: "Business processes",
        noGoals: "No business goal is linked to this value stream.",
        noProcesses: "No business process is linked to this value stream.",
        imageDescription: "Hire-to-Retire value stream map",
        snapshotFailed: "Could not read the diagram snapshot.",
        failed: "Failed to generate the Word document.",
      });
      expect(input.labels.subtitle).not.toContain("Hire-to-Retire");
    });

    it("keeps two processes that share a name", async () => {
      const root = withoutRelated();
      const [[id, process]] = Object.entries(root.processes);
      mockApi.on(
        "get",
        NONE,
        response({ ...root, processes: { ...root.processes, dup: { ...process, id: "dup", name: root.processes[id].name } } }),
      );
      vi.mocked(exportValueStreamToWord).mockResolvedValue();
      const { user } = renderPage();
      await rootName();
      await user.click(screen.getByRole("button", { name: wordName("saveWord") }));
      const names = vi.mocked(exportValueStreamToWord).mock.calls[0][0].processNames;
      expect(names).toHaveLength(Object.keys(root.processes).length + 1);
      expect(names.filter((n) => n === root.processes[id].name)).toHaveLength(2);
    });

    it("exports one root with its goals and sorted process names, disabling every button meanwhile", async () => {
      mockApi.on("get", NONE, TWO_ROOTS);
      let finish: () => void = () => {};
      const exportWord = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
      const { user } = renderPage("?category=r-cat", exportWord);
      await rootName();
      const [first, second] = screen.getAllByRole("button", { name: wordName("saveWord") });
      await user.click(second);

      expect(exportWord).toHaveBeenCalledTimes(1);
      const input = (exportWord.mock.calls[0] as unknown as [WordExportInput])[0];
      expect(input.rootName).toBe("Order-to-Cash");
      expect(input.goals).toEqual(["Improve talent management"]);
      expect(input.processNames).toEqual(["Interview", "Post job ad", "Reporting", "Screen CVs", "Sourcing"]);
      expect(input.node).toHaveTextContent("Order-to-Cash");
      expect(input.node).not.toHaveTextContent("Hire-to-Retire");
      expect(first).toBeDisabled();
      expect(screen.getByRole("button", { name: wordName("savingWord") })).toBeDisabled();

      await act(async () => finish());
      expect(screen.getAllByRole("button", { name: wordName("saveWord") }).map((b) => b.hasAttribute("disabled"))).toEqual([
        false,
        false,
      ]);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("shows a dismissible error when the export fails and re-enables the buttons", async () => {
      const exportWord = vi.fn(async () => {
        throw new Error("Could not read the diagram snapshot.");
      });
      const { user } = renderPage("?category=r-cat", exportWord);
      await rootName();
      await user.click(screen.getByRole("button", { name: wordName("saveWord") }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Could not read the diagram snapshot.");
      expect(alert).toHaveClass("MuiAlert-standardError");
      expect(alert.closest(".report-chart-area")).toBeNull();
      expect(screen.getByRole("button", { name: wordName("saveWord") })).toBeEnabled();
      await user.click(within(alert).getByRole("button"));
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("falls back to the translated message for a non-Error or message-less rejection", async () => {
      const exportWord = vi.fn<(input: WordExportInput) => Promise<void>>();
      exportWord.mockRejectedValueOnce("nope").mockRejectedValueOnce(new Error(""));
      const { user } = renderPage("?category=r-cat", exportWord);
      await rootName();
      for (let i = 0; i < 2; i++) {
        await user.click(screen.getByRole("button", { name: wordName("saveWord") }));
        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent(t("export.failed"));
        await user.click(within(alert).getByRole("button"));
      }
      expect(exportWord).toHaveBeenCalledTimes(2);
    });
  });
});
