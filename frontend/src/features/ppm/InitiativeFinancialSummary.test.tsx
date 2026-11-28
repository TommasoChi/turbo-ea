import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useCurrency", () => import("@/test/hooks").then((m) => m.useCurrencyModule()));

import { mockApi } from "@/test/apiMock";
import InitiativeFinancialSummary from "./InitiativeFinancialSummary";

const PATH = "/ppm/initiatives/i1/financials";
const side = (total: string, derived: boolean) => ({ capex: "0", opex: "0", total, derived });

beforeEach(() => mockApi.reset());

describe("InitiativeFinancialSummary", () => {
  it("draws one Total bar from card_comparison with its percentage and derived flags", async () => {
    mockApi.on("get", PATH, {
      initiative_id: "i1",
      card_comparison: { budget: side("100", false), actual: side("70", true) },
    });
    render(<InitiativeFinancialSummary initiativeId="i1" revision={0} />);
    expect(await screen.findByText("Total")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "70");
    expect(bar).toHaveAttribute("data-derived-actual", "true");
    expect(bar).not.toHaveAttribute("data-derived-budget");
    expect(screen.getByText(/\(70%\)/)).toBeInTheDocument();
  });

  it("draws nothing when the reader has no comparison", async () => {
    mockApi.on("get", PATH, { initiative_id: "i1", card_comparison: null });
    const { container } = render(<InitiativeFinancialSummary initiativeId="i1" revision={0} />);
    await waitFor(() => expect(mockApi.callsOf("get", PATH)).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });

  it("draws nothing when the request fails", async () => {
    mockApi.fail("get", PATH, 500);
    const { container } = render(<InitiativeFinancialSummary initiativeId="i1" revision={0} />);
    await waitFor(() => expect(mockApi.callsOf("get", PATH)).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });
});
