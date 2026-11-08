import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  apiErrorMessage: (e: unknown, f: string) => (e instanceof Error && e.message ? e.message : f),
}));

import { api } from "@/api/client";
import type { LicenseType } from "@/types";
import LicenseItemDialog from "./LicenseItemDialog";

const options: LicenseType[] = [
  { id: "4", key: "dev", label: "Dev", sort_order: 1, archived: false, translations: {} },
];
const labels: Record<string, string> = { prod: "Prod", dev: "Dev" };
const cell = { metric: "users" as const, key: "prod", licensed: 100, actual: 80 as number | null };

function setup(over: Partial<React.ComponentProps<typeof LicenseItemDialog>> = {}) {
  const onChanged = vi.fn();
  const onClose = vi.fn();
  render(
    <LicenseItemDialog
      cardId="c1"
      fiscalYear={2026}
      forecastYear={2027}
      metrics={["users", "installations"]}
      cell={cell}
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

describe("LicenseItemDialog", () => {
  it("PUTs integers to the cell path", async () => {
    const { user, onChanged } = setup();
    expect(screen.getByLabelText("License type")).toHaveValue("Prod");
    const licensed = screen.getByLabelText("Licensed");
    await user.clear(licensed);
    await user.type(licensed, "150");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/cards/c1/licenses/2026/items/users/prod", {
        licensed: 150,
        actual: 80,
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("sends actual null when Actual is cleared", async () => {
    const { user } = setup();
    await user.clear(screen.getByLabelText("Actual"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/cards/c1/licenses/2026/items/users/prod", {
        licensed: 100,
        actual: null,
      }),
    );
  });

  it("refuses a fraction or a negative count", async () => {
    const { user } = setup();
    const licensed = screen.getByLabelText("Licensed");
    await user.clear(licensed);
    await user.type(licensed, "1.5");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.clear(licensed);
    await user.type(licensed, "-3");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("adds a cell by choosing metric and type", async () => {
    const { user } = setup({ cell: null, metrics: ["users", "installations"] });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
    await user.click(screen.getByLabelText("Metric"));
    await user.click(await screen.findByRole("option", { name: "Installations" }));
    await user.click(screen.getByLabelText("License type"));
    await user.click(await screen.findByRole("option", { name: "Dev" }));
    await user.type(screen.getByLabelText("Licensed"), "7");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/cards/c1/licenses/2026/items/installations/dev", {
        licensed: 7,
        actual: null,
      }),
    );
  });

  it("copies licensed to the Forecast year when ticked", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("checkbox", { name: "Copy licensed to Forecast (FY27)" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/cards/c1/licenses/2026/items/users/prod/copy-to-forecast",
      ),
    );
  });

  it("hides copy-to-forecast in the Forecast year and disables Actual", () => {
    setup({ fiscalYear: 2027, cell: { ...cell, actual: null } });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByLabelText("Actual")).toBeDisabled();
  });

  it("shows the server error for archived_type", async () => {
    const { user, onChanged } = setup();
    vi.mocked(api.put).mockRejectedValueOnce(new Error("archived_type"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("This license type is archived and cannot be added to a year."),
    ).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and says so when the saved counts' copy fails", async () => {
    const { user, onChanged } = setup();
    vi.mocked(api.post).mockRejectedValueOnce(new Error("year_out_of_range"));
    await user.click(screen.getByRole("checkbox", { name: /Copy licensed to Forecast/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/The counts were saved\./)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledWith({ keepOpen: true });
  });

  it("deletes the cell", async () => {
    const { user, onChanged } = setup();
    await user.click(screen.getByRole("button", { name: /Delete/ }));
    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith("/cards/c1/licenses/2026/items/users/prod"),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});
