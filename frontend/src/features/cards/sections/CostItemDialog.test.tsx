import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  apiErrorMessage: (e: unknown, f: string) => (e instanceof Error && e.message ? e.message : f),
}));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ symbol: "EUR" }) }));

import { api } from "@/api/client";
import type { CostItemType, CostLine } from "@/types";
import CostItemDialog from "./CostItemDialog";

const line: CostLine = { key: "lic", amount: 100, renewal_date: "2026-03-01", archived: false };
const options: CostItemType[] = [
  { id: "4", key: "cloud", label: "Cloud", sort_order: 1, archived: false, translations: {} },
];
const labels: Record<string, string> = { lic: "Licences", cloud: "Cloud" };
const AMOUNT = "Annual amount (EUR)";

function setup(over: Partial<React.ComponentProps<typeof CostItemDialog>> = {}) {
  const onChanged = vi.fn();
  const onClose = vi.fn();
  render(
    <CostItemDialog
      cardId="c1"
      fiscalYear={2026}
      forecastYear={2027}
      line={line}
      options={options}
      labelOf={(k) => labels[k] ?? k}
      onClose={onClose}
      onChanged={onChanged}
      {...over}
    />,
  );
  return { onChanged, onClose, user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.put).mockResolvedValue({} as never);
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.delete).mockResolvedValue({} as never);
});

describe("CostItemDialog", () => {
  it("edits with the item fixed and saves amount and renewal date", async () => {
    const { user, onChanged } = setup();
    expect(screen.getByLabelText("Item")).toHaveValue("Licences");
    expect(screen.getByLabelText("Item")).toHaveAttribute("readonly");
    const amount = screen.getByLabelText(AMOUNT);
    await user.clear(amount);
    await user.type(amount, "250");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/cards/c1/costs/2026/items/lic", {
        amount: 250,
        renewal_date: "2026-03-01",
      }),
    );
    expect(api.post).not.toHaveBeenCalled();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("copies to the Forecast year when ticked, only for years before it", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("checkbox", { name: "Copy to Forecast (FY27)" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/cards/c1/costs/2026/items/lic/copy-to-forecast"),
    );
  });

  it("reloads the section but keeps the dialog when the saved amount's copy fails", async () => {
    const { user, onChanged } = setup();
    vi.mocked(api.post).mockRejectedValueOnce(new Error("year_out_of_range"));
    await user.click(screen.getByRole("checkbox", { name: "Copy to Forecast (FY27)" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/The amount was saved\. year_out_of_range/)).toBeInTheDocument();
    expect(api.put).toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith({ keepOpen: true });
  });

  it("does not offer the copy on the Forecast year itself", () => {
    setup({ fiscalYear: 2027 });
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("deletes the line", async () => {
    const { user, onChanged } = setup();
    await user.click(screen.getByRole("button", { name: /Delete/ }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/cards/c1/costs/2026/items/lic"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("adds a chosen item with an empty renewal date as null, and has no Delete", async () => {
    const { user } = setup({ line: null });
    expect(screen.getByText(/Add cost item/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Cloud" }));
    await user.type(screen.getByLabelText(AMOUNT), "40");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/cards/c1/costs/2026/items/cloud", {
        amount: 40,
        renewal_date: null,
      }),
    );
  });

  it("refuses a negative amount and shows a server error", async () => {
    const { user, onChanged } = setup();
    const amount = screen.getByLabelText(AMOUNT);
    await user.clear(amount);
    await user.type(amount, "-5");
    expect(screen.getByText("Enter a valid amount")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.clear(amount);
    await user.type(amount, "5");
    vi.mocked(api.put).mockRejectedValueOnce(new Error("archived_item"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("archived_item")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
