import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  apiErrorMessage: (e: unknown, f: string) => (e instanceof Error && e.message ? e.message : f),
  isAbortError: () => false,
}));
vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));

import { api, ApiError } from "@/api/client";
import { echartState } from "@/test/echartMock";
import type {
  CardLicensesResponse,
  LicenseMetricResult,
  LicenseTypeResult,
  YearLicenses,
} from "@/types";
import LicensingSection from "./LicensingSection";

const FY = 2026;
const BAR_LABEL = "Licensed and actual counts per license type";
const tr = (
  key: string,
  licensed: number,
  actual: number | null,
  over: Partial<LicenseTypeResult> = {},
): LicenseTypeResult => ({
  key,
  licensed,
  actual,
  pct: actual == null || licensed === 0 ? null : Math.round((actual / licensed) * 1000) / 10,
  no_licence: false,
  status: actual == null ? "no_data" : actual > licensed ? "over" : "compliant",
  ...over,
});
const metric = (
  m: LicenseMetricResult["metric"],
  types: LicenseTypeResult[],
  status: LicenseMetricResult["status"],
): LicenseMetricResult => ({
  metric: m,
  types,
  has_actual: types.some((x) => x.actual != null),
  status,
  worst_pct: null,
  worst_no_licence: false,
  licensed_total: types.reduce((s, x) => s + x.licensed, 0),
  actual_total: types.some((x) => x.actual != null)
    ? types.reduce((s, x) => s + (x.actual ?? 0), 0)
    : null,
});
const year = (fy: number, over: Partial<YearLicenses> = {}): YearLicenses => ({
  fiscal_year: fy,
  is_current: fy === FY,
  is_forecast: fy === FY + 1,
  confirmed: true,
  fallback_from: null,
  metrics: [],
  status: fy === FY + 1 ? null : "compliant",
  ...over,
});
const response = (over: Partial<CardLicensesResponse> = {}): CardLicensesResponse => ({
  can_edit: true,
  licensing_model: ["users", "installations"],
  catalogue: [
    { id: "1", key: "prod", label: "Prod", sort_order: 1, archived: false, translations: {} },
    { id: "2", key: "dev", label: "Dev", sort_order: 2, archived: false, translations: {} },
    { id: "3", key: "qa", label: "QA", sort_order: 3, archived: false, translations: {} },
    { id: "4", key: "old", label: "Legacy", sort_order: 4, archived: true, translations: {} },
  ],
  years: [2022, 2023, 2024, 2025, 2026, 2027].map((fy) =>
    fy === FY
      ? year(fy, {
          status: "over",
          metrics: [
            metric("users", [tr("prod", 100, 50), tr("dev", 10, 12), tr("qa", 5, null)], "over"),
            metric("installations", [tr("prod", 20, 10)], "compliant"),
          ],
        })
      : fy === FY + 1
        ? year(fy, {
            confirmed: false,
            fallback_from: FY,
            metrics: [
              metric("users", [tr("prod", 100, null)], "no_actual_data"),
              metric("installations", [], "no_actual_data"),
            ],
          })
        : year(fy),
  ),
  ...over,
});

function mockGet(r: CardLicensesResponse | Error) {
  vi.mocked(api.get).mockImplementation(
    () => (r instanceof Error ? Promise.reject(r) : Promise.resolve(r)) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  echartState.reset();
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.put).mockResolvedValue({} as never);
});

describe("LicensingSection", () => {
  it("renders nothing on 403 and on 404", async () => {
    for (const status of [403, 404]) {
      mockGet(new ApiError("nope", status, null));
      const { container, unmount } = render(<LicensingSection cardId="c1" />);
      await waitFor(() => expect(api.get).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 20));
      expect(container).toBeEmptyDOMElement();
      unmount();
      vi.clearAllMocks();
    }
  });

  it("one block per tracked metric with type tiles and status pills", async () => {
    mockGet(response());
    render(<LicensingSection cardId="c1" />);
    expect(await screen.findByText("FY26 - Current")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/cards/c1/licenses", expect.anything());
    const users = screen.getByTestId("license-block-users");
    const installs = screen.getByTestId("license-block-installations");
    expect(within(users).getAllByTestId(/license-tile-users-/)).toHaveLength(3);
    expect(within(installs).getAllByTestId(/license-tile-/)).toHaveLength(1);
    const dev = within(users).getByTestId("license-tile-users-dev");
    expect(dev).toHaveTextContent("12 / 10");
    expect(dev).toHaveTextContent("120 %");
    expect(dev).toHaveTextContent("Over-licensed");
    expect(within(users).getByTestId("license-tile-users-prod")).toHaveTextContent("Compliant");
    expect(within(users).getByTestId("license-tile-users-qa")).toHaveTextContent("No data");
    // one bar per metric, one series per type
    const bars = echartState.props.filter((c) => c.ariaLabel?.startsWith(BAR_LABEL));
    expect(bars).toHaveLength(2);
    expect(bars[0].option.series.map((s: { name: string }) => s.name)).toEqual([
      "Prod",
      "Dev",
      "QA",
    ]);
  });

  it("carried-forward banner with Confirm only when can_edit", async () => {
    mockGet(response());
    const user = userEvent.setup();
    const first = render(<LicensingSection cardId="c1" />);
    await user.click(await screen.findByRole("button", { name: "Next fiscal year" }));
    expect(
      screen.getByText(
        "No license counts entered for FY27 yet. Showing the licensed counts of FY26, not confirmed.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm FY27" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/cards/c1/licenses/2027/confirm"));
    first.unmount();

    mockGet(response({ can_edit: false }));
    render(<LicensingSection cardId="c1" />);
    await user.click(await screen.findByRole("button", { name: "Next fiscal year" }));
    expect(screen.queryByRole("button", { name: /^Confirm/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Add license" })).toBeNull();
  });

  it("Forecast tiles say licensed only", async () => {
    mockGet(response());
    const user = userEvent.setup();
    render(<LicensingSection cardId="c1" />);
    await user.click(await screen.findByRole("button", { name: "Next fiscal year" }));
    const tile = screen.getByTestId("license-tile-users-prod");
    expect(tile).toHaveTextContent("licensed only");
    expect(tile).toHaveTextContent("100");
    expect(tile).not.toHaveTextContent("Compliant");
  });

  it("empty model shows the hint and calls onEditModel", async () => {
    mockGet(
      response({
        licensing_model: [],
        years: response().years.map((y) => ({ ...y, metrics: [] })),
      }),
    );
    const user = userEvent.setup();
    const onEditModel = vi.fn();
    render(<LicensingSection cardId="c1" onEditModel={onEditModel} />);
    expect(await screen.findByText(/Choose which metrics this card tracks/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Add license" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEditModel).toHaveBeenCalled();
  });

  it("opens the edit dialog from a tile and reloads after a save", async () => {
    mockGet(response());
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<LicensingSection cardId="c1" onChanged={onChanged} />);
    await user.click(await screen.findByTestId("license-tile-users-dev"));
    expect(await screen.findByText(/Edit license/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/cards/c1/licenses/2026/items/users/dev", {
        licensed: 10,
        actual: 12,
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(1));
  });

  it("is read-only without edit rights: tiles do not open", async () => {
    mockGet(response({ can_edit: false }));
    const user = userEvent.setup();
    render(<LicensingSection cardId="c1" />);
    await user.click(await screen.findByTestId("license-tile-users-dev"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers Add with the active catalogue types", async () => {
    mockGet(response());
    const user = userEvent.setup();
    render(<LicensingSection cardId="c1" />);
    await user.click(await screen.findByRole("button", { name: "+ Add license" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByLabelText("License type"));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Prod", "Dev", "QA"]);
  });
});
