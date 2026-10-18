import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CardMappingTabContent from "./CardMappingTabContent";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from "@/api/client";

const BUSINESS_OBJECT = {
  key: "BusinessObject",
  name: "Business Object",
  description: null,
  icon: "description",
  color: "#c6c653",
  layer: "business",
  is_standard: true,
  is_locked: true,
  is_hidden: false,
  sort_order: 14,
  card_mappings: [
    {
      id: "m1",
      enterprise_object_key: "BusinessObject",
      card_type_key: "Application",
      card_subtype_key: null,
    },
  ],
};

const DATA_OBJECT = {
  key: "DataObject",
  name: "Data Object",
  description: null,
  icon: "database",
  color: "#53c6c6",
  layer: "application",
  is_standard: true,
  is_locked: true,
  is_hidden: true,
  sort_order: 9,
  card_mappings: [],
};

const GROUPING = {
  key: "Grouping",
  name: "Grouping",
  description: null,
  icon: "group_work",
  color: "#8c8c8c",
  layer: null,
  is_standard: true,
  is_locked: true,
  is_hidden: false,
  sort_order: 60,
  card_mappings: [],
};

describe("CardMappingTabContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue([BUSINESS_OBJECT, DATA_OBJECT, GROUPING]);
  });

  it("fetches with include_hidden=true (hidden rows stay visible on this admin screen)", async () => {
    render(<CardMappingTabContent />);
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/metamodel/enterprise-objects?include_hidden=true"),
    );
  });

  it("lists every Enterprise Object grouped by layer", async () => {
    render(<CardMappingTabContent />);
    expect(await screen.findByText("Business Object")).toBeVisible();
    expect(screen.getByText("Data Object")).toBeVisible();
    expect(screen.getByText("Business")).toBeInTheDocument();
    expect(screen.getByText("Application")).toBeInTheDocument();
  });

  it("puts the layer-less rows (Grouping, Location, AndJunction, OrJunction) in their own Other section", async () => {
    render(<CardMappingTabContent />);
    expect(await screen.findByText("Grouping")).toBeVisible();
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("shows each row's card-mapping count", async () => {
    render(<CardMappingTabContent />);
    expect(await screen.findByText("1 mapping")).toBeInTheDocument();
    // Both DataObject and Grouping have zero mappings -- two rows share the text.
    expect(within(screen.getByTestId("eo-row-DataObject")).getByText("0 mappings")).toBeInTheDocument();
    expect(within(screen.getByTestId("eo-row-Grouping")).getByText("0 mappings")).toBeInTheDocument();
  });

  it("toggling visibility calls updateEnterpriseObject with is_hidden flipped", async () => {
    const user = userEvent.setup();
    vi.mocked(api.patch).mockResolvedValue({ ...BUSINESS_OBJECT, is_hidden: true });
    render(<CardMappingTabContent />);
    await screen.findByText("Business Object");

    const row = screen.getByTestId("eo-row-BusinessObject");
    await user.click(within(row).getByRole("button"));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/metamodel/enterprise-objects/BusinessObject", {
        is_hidden: true,
      }),
    );
  });
});
