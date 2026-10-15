import { screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { makeChainResponse } from "@/test/fixtures/valueChain";
import { hookState } from "@/test/hooks";
import { mockApi } from "@/test/apiMock";
import { renderWithProviders, userWith } from "@/test/render";
import type { ValueChainResponse } from "@/types";
import ValueChainPage from "./ValueChainPage";

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
const exportXlsx = vi.hoisted(() => vi.fn());
vi.mock("@/features/reports/reportExport", async (importActual) => ({
  ...(await importActual<typeof import("@/features/reports/reportExport")>()),
  exportReportToXlsx: exportXlsx,
}));

const t = i18n.getFixedT("en", "valuechain");
const tr = i18n.getFixedT("en", "reports");

const BAND_LABELS = ["management", "core", "support", "not_set"].map((k) => t(`band.${k}`));
const BAND_LABEL_RE = new RegExp(`^(${BAND_LABELS.join("|")})$`);
const ROW_ORDER = "/settings/bpm-row-order";

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

function renderPage(user = undefined as ReturnType<typeof userWith> | undefined) {
  return renderWithProviders(<ValueChainPage />, {
    route: "/value-chain",
    routes: [{ path: "/value-chain" }, { path: "*", element: <Where /> }],
    ...(user && { user }),
  });
}

/** Band labels in DOM order. */
const bandOrder = () => screen.getAllByText(BAND_LABEL_RE).map((el) => el.textContent);
const labelsOf = (...keys: string[]) => keys.map((k) => t(`band.${k}`));

function serve(chain: ValueChainResponse = makeChainResponse(), rowOrder = ["core", "management", "support"]) {
  mockApi.on("get", "/reports/value-chain", chain);
  mockApi.on("get", ROW_ORDER, { row_order: rowOrder });
}

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  exportXlsx.mockReset();
  serve();
});

describe("ValueChainPage", () => {
  it("renders the title and the bands in the saved row order with not_set last, with counts", async () => {
    renderPage();
    expect(await screen.findByText(t("band.core"))).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: t("page.chain.title") })).toBeInTheDocument();
    expect(bandOrder()).toEqual(labelsOf("core", "management", "support", "not_set"));
    // The core band shows the house: its two level-one streams, not its one category box.
    expect(screen.getByText(t("band.core")).nextElementSibling).toHaveTextContent("(2)");
    expect(screen.getByText(t("band.management")).nextElementSibling).toHaveTextContent("(1)");
    expect(screen.getByText(t("band.support")).nextElementSibling).toHaveTextContent("(2)");
    expect(screen.getByText(t("band.not_set")).nextElementSibling).toHaveTextContent("(0)");
  });

  it("shows only the house for the core band and the category boxes for the others", async () => {
    renderPage();
    await screen.findByText("Hire-to-Retire");
    expect(screen.getAllByText("Lead-to-Order")).toHaveLength(1);
    expect(screen.getByText(t("house.customerRequest"))).toBeInTheDocument();
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("Plan-to-Report")).toBeInTheDocument();
    expect(screen.getByText("Procure-to-Pay")).toBeInTheDocument();
  });

  it("lets an admin reorder: PATCHes the order without not_set and reorders the bands", async () => {
    mockApi.on("get", ROW_ORDER, { row_order: ["core", "management", "support", "not_set"] });
    mockApi.on("patch", ROW_ORDER, { row_order: [] });
    const { user } = renderPage();
    await screen.findByText(t("band.core"));

    // One pair of arrows per real band, none on not_set.
    expect(screen.getAllByRole("button", { name: t("actions.moveUp") })).toHaveLength(3);
    const downs = screen.getAllByRole("button", { name: t("actions.moveDown") });
    expect(downs).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: t("actions.moveUp") })[0]).toBeDisabled();
    expect(downs[2]).toBeDisabled();

    await user.click(downs[0]);
    await waitFor(() => expect(bandOrder()).toEqual(labelsOf("management", "core", "support", "not_set")));
    const patches = mockApi.callsOf("patch", ROW_ORDER);
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toEqual({ row_order: ["management", "core", "support"] });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("moves a band up from the arrow on a later band", async () => {
    mockApi.on("patch", ROW_ORDER, { row_order: [] });
    const { user } = renderPage();
    await screen.findByText(t("band.core"));
    await user.click(screen.getAllByRole("button", { name: t("actions.moveUp") })[2]);
    await waitFor(() => expect(bandOrder()).toEqual(labelsOf("core", "support", "management", "not_set")));
    expect(mockApi.callsOf("patch", ROW_ORDER)[0].body).toEqual({
      row_order: ["core", "support", "management"],
    });
  });

  it("shows no reorder arrows without the admin.settings permission", async () => {
    renderPage(userWith("bpm.value_chain"));
    await screen.findByText(t("band.core"));
    expect(screen.queryByRole("button", { name: t("actions.moveUp") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("actions.moveDown") })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: t("actions.collapse") })).toHaveLength(4);
  });

  it("restores the previous order and warns when saving the order fails", async () => {
    mockApi.fail("patch", ROW_ORDER);
    const { user } = renderPage();
    await screen.findByText(t("band.core"));
    await user.click(screen.getAllByRole("button", { name: t("actions.moveDown") })[0]);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(t("error.reorder"));
    expect(alert).toHaveClass("MuiAlert-standardWarning");
    expect(alert.closest(".report-chart-area")).toBeNull();
    expect(alert.closest(".report-toolbar")).not.toBeNull();
    expect(bandOrder()).toEqual(labelsOf("core", "management", "support", "not_set"));

    await user.click(within(alert).getByRole("button"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("rolls a failed move back to the last order that was saved, not to the server's", async () => {
    let calls = 0;
    mockApi.on("patch", ROW_ORDER, () => {
      if (++calls === 2) throw new Error("boom");
      return { row_order: [] };
    });
    const { user } = renderPage();
    await screen.findByText(t("band.core"));
    await user.click(screen.getAllByRole("button", { name: t("actions.moveDown") })[0]);
    await waitFor(() => expect(bandOrder()).toEqual(labelsOf("management", "core", "support", "not_set")));

    await user.click(screen.getAllByRole("button", { name: t("actions.moveDown") })[1]);
    await screen.findByRole("alert");
    expect(bandOrder()).toEqual(labelsOf("management", "core", "support", "not_set"));
    expect(mockApi.callsOf("patch", ROW_ORDER)[1].body).toEqual({
      row_order: ["management", "support", "core"],
    });
  });

  it("clears the reorder warning on the next attempt", async () => {
    let calls = 0;
    mockApi.on("patch", ROW_ORDER, () => {
      if (++calls === 1) throw new Error("boom");
      return { row_order: [] };
    });
    const { user } = renderPage();
    await screen.findByText(t("band.core"));
    await user.click(screen.getAllByRole("button", { name: t("actions.moveDown") })[0]);
    await screen.findByRole("alert");
    await user.click(screen.getAllByRole("button", { name: t("actions.moveDown") })[0]);
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(bandOrder()).toEqual(labelsOf("management", "core", "support", "not_set"));
  });

  it("opens the card side panel from a category name and from a chevron", async () => {
    const { user } = renderPage();
    await screen.findByText("Hire-to-Retire");
    expect(screen.getByTestId("card-panel")).toHaveAttribute("data-open", "false");
    expect(screen.getByTestId("card-panel")).toBeEmptyDOMElement();

    await user.click(screen.getByText("Hire-to-Retire"));
    expect(screen.getByTestId("card-panel")).toHaveTextContent("s1");
    expect(screen.getByTestId("card-panel")).toHaveAttribute("data-open", "true");

    await user.click(screen.getByText("Delivery"));
    expect(screen.getByTestId("card-panel")).toHaveTextContent("l1b");
  });

  it("drills into the value stream map from the + of a box that has children", async () => {
    const { user } = renderPage();
    await screen.findByText("Hire-to-Retire");
    expect(
      screen.queryByRole("button", { name: t("box.drillDown", { name: "Procure-to-Pay" }) }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t("box.drillDown", { name: "Hire-to-Retire" }) }));
    expect(await screen.findByTestId("where")).toHaveTextContent("/value-chain/value-stream?category=s1");
  });

  it("encodes the category id in the drill-down URL", async () => {
    const chain = makeChainResponse();
    chain.bands[2].boxes[0].id = "a b&c";
    serve(chain);
    const { user } = renderPage();
    await user.click(
      await screen.findByRole("button", { name: t("box.drillDown", { name: "Hire-to-Retire" }) }),
    );
    expect(await screen.findByTestId("where")).toHaveTextContent(
      "/value-chain/value-stream?category=a%20b%26c",
    );
  });

  it("collapses and expands a single band", async () => {
    const { user } = renderPage();
    await screen.findByText("Plan-to-Report");
    const toggles = screen.getAllByRole("button", { name: t("actions.collapse") });
    expect(toggles).toHaveLength(4);
    expect(toggles[1]).toHaveAttribute("aria-expanded", "true");

    await user.click(toggles[1]); // management
    expect(screen.queryByText("Plan-to-Report")).not.toBeInTheDocument();
    expect(screen.getByText("Hire-to-Retire")).toBeInTheDocument();
    expect(screen.getByText("Sales")).toBeInTheDocument();
    const expand = screen.getByRole("button", { name: t("actions.expand") });
    expect(expand).toHaveAttribute("aria-expanded", "false");

    await user.click(expand);
    expect(screen.getByText("Plan-to-Report")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("actions.expand") })).not.toBeInTheDocument();
  });

  it("collapses the core house", async () => {
    const { user } = renderPage();
    await screen.findByText("Sales");
    await user.click(screen.getAllByRole("button", { name: t("actions.collapse") })[0]);
    expect(screen.queryByText("Sales")).not.toBeInTheDocument();
    expect(screen.queryByText(t("house.customerRequest"))).not.toBeInTheDocument();
  });

  it("shows the empty placeholder for a band with no category, and only that band", async () => {
    renderPage();
    await screen.findByText(t("band.core"));
    expect(screen.getAllByText(t("empty.band"))).toHaveLength(1);
    const notSet = screen.getByText(t("band.not_set"));
    expect(notSet.closest("div")!.parentElement).toHaveTextContent(t("empty.band"));
  });

  it("shows the house placeholder for a core band without level-one streams", async () => {
    const chain = makeChainResponse();
    chain.bands[1].boxes = [];
    chain.core_house = { level_one: [], level_two: {}, level_three: {} };
    serve(chain);
    renderPage();
    expect(await screen.findByText(t("house.empty"))).toBeInTheDocument();
    expect(screen.getAllByText(t("empty.band"))).toHaveLength(1);
    expect(screen.getByText(t("band.core")).nextElementSibling).toHaveTextContent("(0)");
  });

  it("shows a spinner while the first load is in flight", async () => {
    mockApi.on("get", "/reports/value-chain", () => new Promise(() => {}));
    renderPage();
    expect(await screen.findByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText(t("band.core"))).not.toBeInTheDocument();
  });

  it("shows the load error and no spinner when the first load fails", async () => {
    mockApi.fail("get", "/reports/value-chain");
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(t("error.load"));
    expect(alert).toHaveClass("MuiAlert-standardError");
    expect(alert.closest(".report-chart-area")).toBeNull();
    expect(alert.closest(".report-toolbar")).not.toBeNull();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(t("band.core"))).not.toBeInTheDocument();
  });

  it("falls back to the default band order when the row order cannot be read", async () => {
    mockApi.fail("get", ROW_ORDER);
    renderPage();
    await screen.findByText(t("band.core"));
    expect(bandOrder()).toEqual(labelsOf("management", "core", "support", "not_set"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("exports the categories with translated labels and the chart area", async () => {
    const { user } = renderPage();
    await screen.findByText("Hire-to-Retire");
    await user.click(screen.getByRole("button", { name: tr("shell.moreActions") }));
    await user.click(await screen.findByText(tr("shell.exportXlsx")));

    await waitFor(() => expect(exportXlsx).toHaveBeenCalledTimes(1));
    const data = exportXlsx.mock.calls[0][0];
    expect(data.title).toBe(t("page.chain.title"));
    expect(data.chartNode).toBeInstanceOf(HTMLElement);
    expect(data.chartNode).toHaveTextContent("Hire-to-Retire");
    expect(data.sheets[0].name).toBe(t("sheet.categories"));
    expect(data.sheets[0].columns.map((c: { label: string }) => c.label)).toEqual([
      t("col.band"),
      t("col.category"),
      t("col.processGroups"),
      t("col.processes"),
      t("col.valueStreams"),
      t("col.valueGates"),
    ]);
    // Rows follow the on-screen band order and use the band labels, not raw keys.
    expect(data.sheets[0].rows.map((r: { band: string; category: string }) => [r.band, r.category])).toEqual([
      [t("band.core"), "Lead-to-Order"],
      [t("band.management"), "Plan-to-Report"],
      [t("band.support"), "Hire-to-Retire"],
      [t("band.support"), "Procure-to-Pay"],
    ]);
  });
});
