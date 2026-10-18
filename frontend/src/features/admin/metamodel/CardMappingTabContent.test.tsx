import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { User } from "@/types";
import CardMappingTabContent from "./CardMappingTabContent";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/hooks/AuthContext", () => ({ useAuthContext: vi.fn() }));

import { api } from "@/api/client";
import { useAuthContext } from "@/hooks/AuthContext";

const BUSINESS_OBJECT = {
  key: "BusinessObject",
  name: "Business Object",
  description: null,
  icon: "description",
  color: "#c6c653",
  layer: "business",
  is_standard: true,
  is_locked: false,
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
  is_locked: false,
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
  // Grouping is the one standard row the backend seeds locked (is_locked:
  // true) -- a PATCH on a locked row 422s before the body is even read, so
  // its visibility toggle must be disabled rather than attempted.
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
    vi.mocked(useAuthContext).mockReturnValue({
      user: { id: "u1", permissions: { "*": true } } as unknown as User,
      refreshUser: vi.fn(),
    });
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
    await user.click(within(row).getByRole("button", { name: "Hidden" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/metamodel/enterprise-objects/BusinessObject", {
        is_hidden: true,
      }),
    );
  });

  it("disables the visibility toggle for a locked row and never attempts the PATCH", async () => {
    render(<CardMappingTabContent />);
    await screen.findByText("Grouping");

    const row = screen.getByTestId("eo-row-Grouping");
    const toggle = within(row).getByRole("button", {
      name: "This type is fixed and cannot be hidden.",
    });
    expect(toggle).toBeDisabled();

    // A real disabled <button> doesn't fire click handlers at all -- confirmed
    // by userEvent.click refusing outright with a `pointer-events: none`
    // error on this exact element. fireEvent bypasses that pointer-event
    // guard, so it still proves the handler never runs even if some future
    // change dropped the CSS/attribute disabling but kept `disabled` unset.
    fireEvent.click(toggle);
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("opens the New Architecture Object dialog and refetches the list on success", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({
      key: "AIModel",
      name: "AI Model",
      description: "",
      icon: "category",
      color: "#1976d2",
      layer: "strategy",
      is_standard: false,
      is_locked: false,
      is_hidden: false,
      sort_order: 0,
      card_mappings: [],
    });
    render(<CardMappingTabContent />);
    await screen.findByText("Business Object");

    await user.click(screen.getByRole("button", { name: /New Architecture Object/ }));
    await user.type(screen.getByLabelText("Key"), "AIModel");
    await user.type(screen.getByLabelText("Name"), "AI Model");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/metamodel/enterprise-objects",
        expect.objectContaining({ key: "AIModel", name: "AI Model" }),
      ),
    );
    // One call on mount, one more from `onCreated`'s refetch after the create.
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it("clicking a row's name opens its description popover", async () => {
    const user = userEvent.setup();
    render(<CardMappingTabContent />);
    await screen.findByText("Business Object");

    await user.click(screen.getByText("Business Object"));

    expect(screen.getByText("1 mapping")).toBeInTheDocument(); // row still rendered behind the popover
    expect(screen.getByLabelText("Edit description")).toBeInTheDocument(); // admin.metamodel via "*"
  });

  it("hides the edit-description pencil for a user without admin.metamodel", async () => {
    vi.mocked(useAuthContext).mockReturnValue({
      user: { id: "u2", permissions: { "admin.settings": true } } as unknown as User,
      refreshUser: vi.fn(),
    });
    const user = userEvent.setup();
    render(<CardMappingTabContent />);
    await screen.findByText("Business Object");

    await user.click(screen.getByText("Business Object"));

    expect(screen.queryByLabelText("Edit description")).not.toBeInTheDocument();
  });
});
