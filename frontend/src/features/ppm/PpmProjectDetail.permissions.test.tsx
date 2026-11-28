/**
 * PpmProjectDetail — what each tab is told about the reader's rights on this
 * initiative: write tabs get `canEdit` (ppm.manage and card edit), the cost
 * tab gets its own (ppm.manage and cost edit), and without cost access the
 * Budget & Costs tab is not offered while every other tab keeps its place.
 */
import { act, screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, userWith } from "@/test/render";
import PpmProjectDetail from "./PpmProjectDetail";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/api/client", () => ({
  api: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    status = 0;
  },
}));

type Flag = { canEdit?: boolean; canViewCosts?: boolean };
const { stub } = vi.hoisted(() => ({
  stub: (name: string) => ({
    default: (p: Flag) => (
      <div data-testid={name}>{String(p.canEdit)}/{String(p.canViewCosts)}</div>
    ),
  }),
}));
vi.mock("./PpmOverviewTab", () => stub("overview-tab"));
vi.mock("./PpmReportsTab", () => stub("reports-tab"));
vi.mock("./PpmCostTab", () => stub("cost-tab"));
vi.mock("./PpmRiskTab", () => stub("risks-tab"));
vi.mock("./PpmTaskBoard", () => stub("tasks-tab"));
vi.mock("./PpmGanttTab", () => stub("gantt-tab"));
vi.mock("@/features/cards/CardDetailContent", () => ({ default: () => null }));
vi.mock("@/hooks/useCardSubtypeLabel", () => ({
  useCardSubtypeLabel: () => (_type: string, subtype: string) => subtype,
}));

const INITIATIVE = {
  id: "i1", type: "Initiative", name: "ERP Replacement", subtype: null, description: null,
  status: "ACTIVE", approval_status: "DRAFT", data_quality: 0, attributes: {}, lifecycle: {},
  parent_id: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
};

function load(effective: Record<string, boolean>) {
  get.mockImplementation((path: string) => {
    if (path === "/cards/i1") return Promise.resolve(INITIATIVE);
    if (path === "/cards/i1/my-permissions") return Promise.resolve({ effective });
    if (path === "/ppm/initiatives/i1/rollup") return Promise.resolve(null);
    return Promise.resolve([]);
  });
}

function renderPage(tab: string, permissions: string[]) {
  return renderWithProviders(<PpmProjectDetail />, {
    route: `/ppm/i1?tab=${tab}`,
    routes: [{ path: "/ppm/:id" }],
    user: userWith(...permissions),
  });
}

beforeEach(() => get.mockReset());

function Landing() {
  const { pathname, search } = useLocation();
  return <output data-testid="landing">{pathname + search}</output>;
}

function renderWithLanding(route: string) {
  return renderWithProviders(<PpmProjectDetail />, {
    route,
    routes: [{ path: "/ppm/:id" }, { path: "/ppm", element: <Landing /> }],
    user: userWith("ppm.view"),
  });
}

const backArrow = () => screen.getByRole("button", { name: "Back" });

describe("PpmProjectDetail back arrows", () => {
  it("the header arrow goes to the portfolio tab", async () => {
    load({ can_view_costs: true, can_edit: true });
    const { user } = renderWithLanding("/ppm/i1");
    await screen.findByTestId("overview-tab");
    await user.click(backArrow());
    expect(screen.getByTestId("landing")).toHaveTextContent("/ppm?tab=portfolio");
  });

  it("the arrow of the error state goes to the portfolio tab", async () => {
    get.mockImplementation((path: string) =>
      path === "/cards/i1" ? Promise.reject(new Error("boom")) : Promise.resolve([]),
    );
    const { user } = renderWithLanding("/ppm/i1");
    await screen.findByText("boom");
    await user.click(backArrow());
    expect(screen.getByTestId("landing")).toHaveTextContent("/ppm?tab=portfolio");
  });
});

describe("PpmProjectDetail permissions", () => {
  it("hands the write tabs canEdit = ppm.manage and card edit", async () => {
    load({ can_view_costs: true, can_edit: true, can_edit_costs: false });
    renderPage("risks", ["ppm.view", "ppm.manage"]);
    await waitFor(() => expect(screen.getByTestId("risks-tab")).toHaveTextContent("true"));
  });

  it("hands the write tabs canEdit false when the card is not editable", async () => {
    load({ can_view_costs: true, can_edit: false, can_edit_costs: true });
    renderPage("risks", ["ppm.view", "ppm.manage"]);
    await waitFor(() => expect(screen.getByTestId("risks-tab")).toHaveTextContent("false"));
  });

  it("hands the write tabs canEdit false without ppm.manage", async () => {
    load({ can_view_costs: true, can_edit: true, can_edit_costs: true });
    renderPage("risks", ["ppm.view"]);
    await waitFor(() => expect(screen.getByTestId("risks-tab")).toHaveTextContent("false"));
  });

  it("gives the cost tab its own canEdit: a cost editor without card edit may edit costs", async () => {
    load({ can_view_costs: true, can_edit: false, can_edit_costs: true });
    renderPage("cost", ["ppm.view", "ppm.manage"]);
    await waitFor(() => expect(screen.getByTestId("cost-tab")).toHaveTextContent("true"));
  });

  it("gives the cost tab canEdit false for a card editor without cost edit", async () => {
    load({ can_view_costs: true, can_edit: true, can_edit_costs: false });
    renderPage("cost", ["ppm.view", "ppm.manage"]);
    await waitFor(() => expect(screen.getByTestId("cost-tab")).toHaveTextContent("false"));
  });

  it("tells the overview whether costs are visible", async () => {
    load({ can_view_costs: false, can_edit: true, can_edit_costs: false });
    renderPage("overview", ["ppm.view", "ppm.manage"]);
    await waitFor(() => expect(screen.getByTestId("overview-tab")).toHaveTextContent("false"));
  });

  it("offers no Budget & Costs tab without cost access", async () => {
    load({ can_view_costs: false, can_edit: true, can_edit_costs: false });
    renderPage("overview", ["ppm.view"]);
    await screen.findByTestId("overview-tab");
    expect(screen.queryByRole("tab", { name: "Budget & Costs" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(6);
  });

  it("offers the Budget & Costs tab with cost access", async () => {
    load({ can_view_costs: true, can_edit: true, can_edit_costs: false });
    renderPage("overview", ["ppm.view"]);
    expect(await screen.findByRole("tab", { name: "Budget & Costs" })).toBeInTheDocument();
  });

  it("keeps the other tabs on their own `tab` parameter without cost access", async () => {
    load({ can_view_costs: false, can_edit: true, can_edit_costs: false });
    renderPage("risks", ["ppm.view"]);
    expect(await screen.findByTestId("risks-tab")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Risk Management" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens the overview when `tab=cost` is asked for without cost access", async () => {
    load({ can_view_costs: false, can_edit: true, can_edit_costs: false });
    renderPage("cost", ["ppm.view"]);
    expect(await screen.findByTestId("overview-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("cost-tab")).not.toBeInTheDocument();
  });

  it("clicking a tab after the hidden one opens that tab", async () => {
    load({ can_view_costs: false, can_edit: true, can_edit_costs: false });
    const user = userEvent.setup();
    renderPage("overview", ["ppm.view"]);
    await screen.findByTestId("overview-tab");
    await user.click(screen.getByRole("tab", { name: "Tasks" }));
    expect(await screen.findByTestId("tasks-tab")).toBeInTheDocument();
  });

  it("shows nothing writable and no cost tab until the permissions answer", async () => {
    let answer!: (v: unknown) => void;
    get.mockImplementation((path: string) => {
      if (path === "/cards/i1") return Promise.resolve(INITIATIVE);
      if (path === "/cards/i1/my-permissions") return new Promise((r) => { answer = r; });
      if (path === "/ppm/initiatives/i1/rollup") return Promise.resolve(null);
      return Promise.resolve([]);
    });
    renderPage("cost", ["ppm.view", "ppm.manage"]);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/cards/i1/my-permissions", expect.anything()));
    expect(screen.queryByTestId("cost-tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    await act(async () => {
      answer({ effective: { can_view_costs: true, can_edit_costs: true, can_edit: true } });
    });
    expect(await screen.findByTestId("cost-tab")).toHaveTextContent("true");
  });

  it("stays closed when the permissions cannot be read", async () => {
    get.mockImplementation((path: string) => {
      if (path === "/cards/i1") return Promise.resolve(INITIATIVE);
      if (path === "/cards/i1/my-permissions") return Promise.reject(new Error("boom"));
      if (path === "/ppm/initiatives/i1/rollup") return Promise.resolve(null);
      return Promise.resolve([]);
    });
    renderPage("cost", ["ppm.view", "ppm.manage"]);
    expect(await screen.findByTestId("overview-tab")).toHaveTextContent("false/false");
    expect(screen.queryByRole("tab", { name: "Budget & Costs" })).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith(expect.stringContaining("/financials"), expect.anything());
  });
});
