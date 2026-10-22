import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ArchimateViewpointPicker from "./ArchimateViewpointPicker";

vi.mock("@/api/client", () => ({ api: { get: vi.fn() } }));
import { api } from "@/api/client";

describe("ArchimateViewpointPicker", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes("viewpoints-for-tab?tab=application")) {
        return Promise.resolve([
          { key: "application-cooperation", name: "Application Cooperation", icon: "hub", examples: [] },
        ]);
      }
      return Promise.resolve([]);
    });
  });

  it("lists only the tab's viewpoints in the combo, then shows a blank card for the selected one", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ArchimateViewpointPicker tab="application" onSelect={onSelect} />);
    await user.click(await screen.findByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Application Cooperation" }));
    expect(await screen.findByText(/blank/i)).toBeInTheDocument();
  });
});
