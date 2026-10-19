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
  aspect: null,
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
  aspect: "passive",
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
  aspect: null,
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

  it("omits the expand control for a locked row -- no UI path reaches its mapping editor", async () => {
    render(<CardMappingTabContent />);
    await screen.findByText("Grouping");

    const lockedRow = screen.getByTestId("eo-row-Grouping");
    expect(within(lockedRow).queryByLabelText("Edit card mappings")).not.toBeInTheDocument();

    // Contrast with an unlocked row, which does get the control.
    const unlockedRow = screen.getByTestId("eo-row-BusinessObject");
    expect(within(unlockedRow).getByLabelText("Edit card mappings")).toBeInTheDocument();
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

  it("reopening the popover after an edit shows the NEW description, not the stale cached one -- regression: the popover is unmounted on close and never refetched, so reopening it showed the pre-edit text until some unrelated page load", async () => {
    const user = userEvent.setup();
    vi.mocked(api.patch).mockResolvedValue({ ...BUSINESS_OBJECT, description: "Updated description." });
    // The refetch after save (api.get call #2) returns the object with the new description --
    // this is what the reopened popover must read, not the stale BUSINESS_OBJECT in its closure.
    vi.mocked(api.get).mockResolvedValueOnce([BUSINESS_OBJECT, DATA_OBJECT, GROUPING])
      .mockResolvedValueOnce([{ ...BUSINESS_OBJECT, description: "Updated description." }, DATA_OBJECT, GROUPING]);
    render(<CardMappingTabContent />);
    await screen.findByText("Business Object");

    await user.click(screen.getByText("Business Object"));
    await user.click(screen.getByLabelText("Edit description"));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "Updated description.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));

    // The STILL-OPEN popover must already show the new text at this exact moment -- this is
    // where the regression was invisible before: a `fetchObjects` that still set `loading(true)`
    // unmounted the whole tab (including this open popover) and remounted it from an `infoObject`
    // snapshot taken back at the original click, so it would blink out and reappear
    // mispositioned/stale right here, not just on a later reopen.
    expect(screen.getByText("Updated description.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); // back to read-only, not mid-edit

    // Close via the Popover's backdrop, then reopen the same row's popover -- a fresh mount,
    // reading from `objects`. NOT Escape: confirmed (via document.activeElement instrumentation,
    // removed after use) that this is unrelated to the remount bug fixed above -- after Save,
    // the Save button (which held focus) unmounts and jsdom/the browser drops focus to
    // `document.body` with no trap re-claiming it, so a later Escape keydown never reaches the
    // Popover's close handler at all (confirmed: a popover opened WITHOUT an edit cycle keeps
    // focus trapped inside its own paper and Escape closes it fine). That is a separate,
    // pre-existing focus-management gap in EnterpriseObjectPopover's save() flow, not something
    // introduced or fixed by this remediation -- flagged for the controller, not fixed here.
    await user.click(document.querySelector(".MuiBackdrop-root")!);
    await waitFor(() => expect(screen.queryByText("Updated description.")).not.toBeInTheDocument());
    await user.click(screen.getByText("Business Object"));
    expect(await screen.findByText("Updated description.")).toBeInTheDocument();
  });

  it("collapses and re-expands a layer section on header click", async () => {
    const user = userEvent.setup();
    render(<CardMappingTabContent />);
    await screen.findByText("Business Object");

    await user.click(screen.getByText("Business"));
    expect(screen.queryByText("Business Object")).not.toBeInTheDocument();

    await user.click(screen.getByText("Business"));
    expect(await screen.findByText("Business Object")).toBeVisible();
  });

  it("clicking an aspect icon sets it, clicking the same one again clears it", async () => {
    const user = userEvent.setup();
    vi.mocked(api.patch).mockResolvedValue({ ...BUSINESS_OBJECT, aspect: "passive" });
    render(<CardMappingTabContent />);
    await screen.findByText("Business Object");

    const row = screen.getByTestId("eo-row-BusinessObject");
    await user.click(within(row).getByRole("button", { name: "Passive" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/metamodel/enterprise-objects/BusinessObject", {
        aspect: "passive",
      }),
    );

    const dataRow = screen.getByTestId("eo-row-DataObject");
    await user.click(within(dataRow).getByRole("button", { name: "Passive" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/metamodel/enterprise-objects/DataObject", {
        aspect: null,
      }),
    );
  });

  it("an aspect already set on a row renders pressed, with a filled check icon -- the others on that row don't", async () => {
    render(<CardMappingTabContent />);
    await screen.findByText("Data Object");

    // DATA_OBJECT is seeded aspect: "passive".
    const row = screen.getByTestId("eo-row-DataObject");
    const passiveBtn = within(row).getByRole("button", { name: "Passive" });
    const behaviorBtn = within(row).getByRole("button", { name: "Behavior" });
    expect(passiveBtn).toHaveAttribute("aria-pressed", "true");
    expect(behaviorBtn).toHaveAttribute("aria-pressed", "false");
    expect(passiveBtn.textContent).toContain("check_circle");
    expect(behaviorBtn.textContent).toContain("radio_button_unchecked");
  });

  it("hides the aspect columns for a row outside the Aspects grid (Grouping, layer: Other)", async () => {
    render(<CardMappingTabContent />);
    await screen.findByText("Grouping");

    const row = screen.getByTestId("eo-row-Grouping");
    expect(within(row).queryByRole("button", { name: "Passive" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Behavior" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Active" })).not.toBeInTheDocument();
  });

  it("shows the table's column headers", async () => {
    render(<CardMappingTabContent />);
    await screen.findByText("Business Object");

    expect(screen.getByText("Architecture Object")).toBeInTheDocument();
    expect(screen.getByText("Passive")).toBeInTheDocument();
    expect(screen.getByText("Behavior")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Mapping")).toBeInTheDocument();
  });

  it("swaps the layer header's chevron icon between collapsed and expanded", async () => {
    const user = userEvent.setup();
    render(<CardMappingTabContent />);
    await screen.findByText("Business Object");

    const header = screen.getByText("Business").closest("button")!;
    expect(header.textContent).toContain("expand_more");

    await user.click(header);
    expect(header.textContent).toContain("chevron_right");
  });

  it("clicking the expand control opens the row's card-mapping editor, clicking again closes it", async () => {
    const user = userEvent.setup();
    render(<CardMappingTabContent />);
    await screen.findByText("Business Object");

    const row = screen.getByTestId("eo-row-BusinessObject");
    await user.click(within(row).getByLabelText("Edit card mappings"));
    expect(await screen.findByRole("combobox")).toBeInTheDocument();

    await user.click(within(row).getByLabelText("Edit card mappings"));
    await waitFor(() => expect(screen.queryByRole("combobox")).not.toBeInTheDocument());
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
