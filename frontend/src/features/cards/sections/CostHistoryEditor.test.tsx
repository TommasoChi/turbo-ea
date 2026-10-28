import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CostHistoryEditor from "./CostHistoryEditor";

vi.mock("@/api/client", () => ({ api: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
import { api } from "@/api/client";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({
    rows: [{ fiscal_year: 2024, field_key: "costTotalAnnual", value: 321 }],
  } as never);
  vi.mocked(api.put).mockResolvedValue({ fiscal_year: 2025, field_key: "costTotalAnnual", value: 500 } as never);
});

describe("CostHistoryEditor", () => {
  it("lists every saved year for the field", async () => {
    render(<CostHistoryEditor cardId="erp" fieldKey="costTotalAnnual" fieldLabel="Total Annual Cost" />);
    expect(await screen.findByText("2024")).toBeInTheDocument();
    expect(screen.getByText("$321")).toBeInTheDocument();
  });

  it("adds a new year via the API and shows it", async () => {
    const user = userEvent.setup();
    render(<CostHistoryEditor cardId="erp" fieldKey="costTotalAnnual" fieldLabel="Total Annual Cost" />);
    await screen.findByText("2024");
    await user.type(screen.getByLabelText(/fiscal year/i), "2025");
    await user.type(screen.getByLabelText(/value/i), "500");
    await user.click(screen.getByRole("button", { name: /add/i }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      "/cards/erp/cost-history",
      { fiscal_year: 2025, field_key: "costTotalAnnual", value: 500 },
    ));
  });

  it("deletes a year via the API", async () => {
    const user = userEvent.setup();
    render(<CostHistoryEditor cardId="erp" fieldKey="costTotalAnnual" fieldLabel="Total Annual Cost" />);
    await screen.findByText("2024");
    await user.click(screen.getByRole("button", { name: /delete 2024/i }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/cards/erp/cost-history/2024/costTotalAnnual"));
  });
});
