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
vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({ fmt: { format: (v: number) => `EUR ${v}` }, symbol: "EUR" }),
}));
vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({ formatDate: (v: string) => `d:${v}` }),
}));
vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));

import { api, ApiError } from "@/api/client";
import i18n from "@/i18n";
import { echartState } from "@/test/echartMock";
import { toIsoDate } from "@/lib/dates";
import type { CardCostsResponse, YearCosts } from "@/types";
import CostsSection from "./CostsSection";

const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toIsoDate(d);
};
const FY = 2026;
const year = (fy: number, over: Partial<YearCosts> = {}): YearCosts => ({
  fiscal_year: fy,
  is_current: fy === FY,
  is_forecast: fy === FY + 1,
  confirmed: true,
  fallback_from: null,
  items: [],
  tco: 0,
  ...over,
});
const catalogue = (): CardCostsResponse["catalogue"] => [
  { id: "1", key: "lic", label: "Licences", sort_order: 1, archived: false, translations: {} },
  { id: "2", key: "sup", label: "Support", sort_order: 2, archived: false, translations: {} },
  { id: "3", key: "old", label: "Legacy", sort_order: 3, archived: true, translations: {} },
  { id: "4", key: "cloud", label: "Cloud", sort_order: 4, archived: false, translations: {} },
];
const response = (over: Partial<CardCostsResponse> = {}): CardCostsResponse => ({
  can_edit: true,
  catalogue: catalogue(),
  years: [2022, 2023, 2024, 2025, 2026, 2027].map((fy) =>
    fy === FY
      ? year(fy, {
          tco: 180,
          items: [
            { key: "lic", amount: 100, renewal_date: inDays(30), archived: false },
            { key: "sup", amount: 50, renewal_date: inDays(300), archived: false },
            { key: "old", amount: 30, renewal_date: null, archived: true },
          ],
        })
      : fy === FY + 1
        ? year(fy, {
            confirmed: false,
            fallback_from: FY,
            tco: 150,
            items: [{ key: "lic", amount: 100, renewal_date: null, archived: false }],
          })
        : year(fy),
  ),
  ...over,
});

function mockGet(r: CardCostsResponse | Error) {
  vi.mocked(api.get).mockImplementation(
    () => (r instanceof Error ? Promise.reject(r) : Promise.resolve(r)) as never,
  );
}
const renderSection = (canEdit = true) => render(<CostsSection cardId="c1" canEdit={canEdit} />);

beforeEach(() => {
  vi.clearAllMocks();
  echartState.reset();
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.put).mockResolvedValue({} as never);
  vi.mocked(api.delete).mockResolvedValue({} as never);
});

describe("CostsSection", () => {
  it("shows the current year, its TCO and one tile per line", async () => {
    mockGet(response());
    renderSection();
    expect(await screen.findByText("FY26 - Current")).toBeInTheDocument();
    expect(screen.getByText("EUR 180")).toBeInTheDocument();
    expect(screen.getByTestId("cost-tile-lic")).toHaveTextContent("Licences");
    expect(screen.getByTestId("cost-tile-sup")).toHaveTextContent("EUR 50");
    expect(screen.getAllByTestId(/cost-tile-/)).toHaveLength(3);
    expect(api.get).toHaveBeenCalledWith("/cards/c1/costs", expect.anything());
  });

  it("marks an archived line and still counts it in the TCO", async () => {
    mockGet(response());
    renderSection();
    const tile = await screen.findByTestId("cost-tile-old");
    expect(tile).toHaveTextContent("Legacy (archived)");
    expect(tile).toHaveTextContent("still counted in the TCO");
    expect(screen.getByText("EUR 180")).toBeInTheDocument();
    expect(echartState.last().option.series.map((s: { name: string }) => s.name)).toContain(
      "Legacy",
    );
  });

  it("flags a renewal that is near", async () => {
    mockGet(response());
    renderSection();
    const near = await screen.findByTestId("cost-tile-lic");
    const far = screen.getByTestId("cost-tile-sup");
    const nearOf = (el: HTMLElement) =>
      within(el).getByText(/renewal/).getAttribute("data-near");
    expect(nearOf(near)).toBe("true");
    expect(nearOf(far)).toBe("false");
  });

  it("navigates between the six years, disabling the arrows at the ends", async () => {
    mockGet(response());
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("FY26 - Current");
    const prev = screen.getByRole("button", { name: "Previous fiscal year" });
    const next = screen.getByRole("button", { name: "Next fiscal year" });
    expect(prev).toBeEnabled();
    await user.click(next);
    expect(screen.getByText("FY27 - Forecast")).toBeInTheDocument();
    expect(next).toBeDisabled();
    for (let i = 0; i < 5; i++) await user.click(prev);
    expect(screen.getByText("FY22")).toBeInTheDocument();
    expect(prev).toBeDisabled();
  });

  it("shows the fallback banner of an unconfirmed year and confirms it", async () => {
    mockGet(response());
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "Next fiscal year" }));
    expect(
      screen.getByText("No amounts entered for FY27 yet. Showing the items of FY26, not confirmed."),
    ).toBeInTheDocument();
    expect(screen.getByText("TCO (from FY26)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm FY27" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/cards/c1/costs/2027/confirm"));
  });

  it("offers in Add only active catalogue items not set for the year", async () => {
    mockGet(response());
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "+ Add item" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox"));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Cloud"]);
  });

  it("opens the edit dialog from a tile", async () => {
    mockGet(response());
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByTestId("cost-tile-sup"));
    expect(await screen.findByText(/Edit cost item/)).toBeInTheDocument();
  });

  it("reloads and reports after a save from the dialog", async () => {
    mockGet(response());
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<CostsSection cardId="c1" canEdit onChanged={onChanged} />);
    await user.click(await screen.findByTestId("cost-tile-sup"));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(1));
  });

  it("is read-only without edit rights: no Add, no Confirm, tiles do not open", async () => {
    mockGet(response());
    const user = userEvent.setup();
    renderSection(false);
    await user.click(await screen.findByRole("button", { name: "Next fiscal year" }));
    expect(screen.queryByRole("button", { name: "+ Add item" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Confirm/ })).toBeNull();
    await user.click(screen.getByTestId("cost-tile-lic"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is read-only when the server says the caller cannot edit", async () => {
    mockGet(response({ can_edit: false }));
    renderSection(true);
    await screen.findByTestId("cost-tile-lic");
    expect(screen.queryByRole("button", { name: "+ Add item" })).toBeNull();
  });

  it.each([403, 404])("renders nothing when the server answers %i", async (status) => {
    mockGet(new ApiError("refused", status, null));
    const { container } = renderSection();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("shows an inline error, not nothing, when loading fails otherwise", async () => {
    mockGet(new ApiError("boom", 500, null));
    renderSection();
    expect(await screen.findByText("Could not load the costs of this card.")).toBeInTheDocument();
  });

  it("swaps the year arrows in a right-to-left language", async () => {
    mockGet(response());
    await i18n.changeLanguage("ar");
    try {
      renderSection();
      const icons = () =>
        screen.getAllByRole("button").map((b) => b.textContent).filter((x) => x?.startsWith("chevron"));
      await waitFor(() => expect(icons()).toEqual(["chevron_right", "chevron_left"]));
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
