import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ArchimateViewpointPicker from "./ArchimateViewpointPicker";

vi.mock("@/api/client", () => ({ api: { get: vi.fn() } }));
import { api } from "@/api/client";

describe("ArchimateViewpointPicker", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
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

  it("shows an empty combo rather than crashing when the viewpoint list can't be loaded", async () => {
    vi.mocked(api.get).mockReset().mockImplementation(() => Promise.reject(new Error("boom")));
    const user = userEvent.setup();
    render(<ArchimateViewpointPicker tab="application" onSelect={vi.fn()} />);
    await user.click(await screen.findByRole("combobox"));
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("picking Blank resolves the tab's suggested cards and passes them to onSelect", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes("viewpoints-for-tab?tab=application")) {
        return Promise.resolve([
          { key: "application-cooperation", name: "Application Cooperation", icon: "hub", examples: [] },
        ]);
      }
      if (url.includes("suggested-cards")) {
        return Promise.resolve([{ card_type_key: "Application", enterprise_object_key: null }]);
      }
      if (url.includes("/cards?page_size=500")) return Promise.resolve({ items: [] });
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ArchimateViewpointPicker tab="application" onSelect={onSelect} />);
    await user.click(await screen.findByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Application Cooperation" }));
    await user.click(await screen.findByText(/blank/i));
    await vi.waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        "application-cooperation",
        expect.any(String),
        ["Application"],
        "Application Cooperation",
        [],
      ),
    );
  });

  it("falls back to no suggested cards when that fetch fails", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes("viewpoints-for-tab?tab=application")) {
        return Promise.resolve([
          { key: "application-cooperation", name: "Application Cooperation", icon: "hub", examples: [] },
        ]);
      }
      if (url.includes("suggested-cards")) return Promise.reject(new Error("boom"));
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ArchimateViewpointPicker tab="application" onSelect={onSelect} />);
    await user.click(await screen.findByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Application Cooperation" }));
    await user.click(await screen.findByText(/blank/i));
    await vi.waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        "application-cooperation",
        expect.any(String),
        [],
        "Application Cooperation",
        [],
      ),
    );
  });

  it("picking an example card fetches its xml and passes it to onSelect, fetching suggested cards without a tab for the unscoped picker", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/metamodel/viewpoints") {
        return Promise.resolve([
          {
            key: "organization",
            name: "Organization",
            icon: "hub",
            examples: [{ id: "ex1", name: "Starter" }],
          },
        ]);
      }
      if (url.includes("/examples/ex1")) return Promise.resolve({ id: "ex1", name: "Starter", xml: "<xml/>" });
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ArchimateViewpointPicker tab={null} onSelect={onSelect} />);
    await user.click(await screen.findByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Organization" }));
    await user.click(await screen.findByText("Starter"));
    await vi.waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith("organization", "<xml/>", [], "Organization", []),
    );
    const suggestedCardsCall = vi
      .mocked(api.get)
      .mock.calls.find((c) => String(c[0]).includes("suggested-cards"));
    expect(suggestedCardsCall).toBeDefined();
    expect(String(suggestedCardsCall![0])).not.toContain("?tab=");
  });

  it("materializes the picked card as a real node on the starting diagram", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes("viewpoints-for-tab?tab=application")) {
        return Promise.resolve([
          { key: "application-cooperation", name: "Application Cooperation", icon: "hub", examples: [] },
        ]);
      }
      if (url.includes("suggested-cards")) {
        return Promise.resolve([
          { card_type_key: "Application", enterprise_object_key: "ApplicationComponent" },
        ]);
      }
      if (url.includes("/cards?page_size=500")) {
        return Promise.resolve({
          items: [
            { id: "card-1", name: "CRM", type: "Application" },
            { id: "card-2", name: "Unrelated", type: "BusinessProcess" },
          ],
        });
      }
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ArchimateViewpointPicker tab="application" onSelect={onSelect} />);
    await user.click(await screen.findByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Application Cooperation" }));
    const cardInput = await screen.findByLabelText("Linked Cards");
    await user.click(cardInput);
    await user.click(await screen.findByRole("option", { name: /CRM/ }));
    // Only cards of an eligible type are offered — "Unrelated" never appears.
    expect(screen.queryByRole("option", { name: /Unrelated/ })).toBeNull();
    await user.click(await screen.findByText(/blank/i));
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalled());
    const [, xml, , , linkedCardIds] = onSelect.mock.calls[0];
    expect(xml as string).toContain("CRM");
    expect(xml as string).toContain("card-1");
    expect(linkedCardIds).toEqual(["card-1"]);
  });
});
