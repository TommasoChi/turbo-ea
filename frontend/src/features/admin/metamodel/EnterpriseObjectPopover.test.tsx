import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EnterpriseObject } from "@/types";
import EnterpriseObjectPopover from "./EnterpriseObjectPopover";

vi.mock("@/api/enterpriseObjects", () => ({
  updateEnterpriseObject: vi.fn(),
}));

import { updateEnterpriseObject } from "@/api/enterpriseObjects";

const sample: EnterpriseObject = {
  key: "BusinessActor",
  name: "Business Actor",
  description: "An organizational entity capable of performing behavior.",
  icon: "person",
  color: "#fdc55f",
  layer: "business",
  is_standard: true,
  is_locked: false,
  is_hidden: false,
  sort_order: 0,
  card_mappings: [],
};

describe("EnterpriseObjectPopover", () => {
  let el: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateEnterpriseObject).mockResolvedValue({ ...sample, description: "New description." });
    el = document.createElement("button");
    document.body.appendChild(el);
  });

  afterEach(() => {
    el.remove();
  });

  test("shows the icon, name and description read-only without canEdit", () => {
    render(<EnterpriseObjectPopover object={sample} anchorEl={el} onClose={vi.fn()} canEdit={false} />);
    expect(screen.getByText(sample.name)).toBeInTheDocument();
    expect(screen.getByText(sample.description!)).toBeInTheDocument();
    expect(screen.queryByLabelText("Edit description")).not.toBeInTheDocument();
  });

  test("renders nothing open when anchorEl is null", () => {
    render(<EnterpriseObjectPopover object={sample} anchorEl={null} onClose={vi.fn()} canEdit={false} />);
    expect(screen.queryByText(sample.name)).not.toBeInTheDocument();
  });

  test("pencil opens an editable field and Save persists it", async () => {
    render(<EnterpriseObjectPopover object={sample} anchorEl={el} onClose={vi.fn()} canEdit={true} />);
    await userEvent.click(screen.getByLabelText("Edit description"));
    await userEvent.clear(screen.getByRole("textbox"));
    await userEvent.type(screen.getByRole("textbox"), "New description.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(updateEnterpriseObject).toHaveBeenCalledWith(sample.key, { description: "New description." });
  });

  test("Cancel discards the edit without saving", async () => {
    render(<EnterpriseObjectPopover object={sample} anchorEl={el} onClose={vi.fn()} canEdit={true} />);
    await userEvent.click(screen.getByLabelText("Edit description"));
    await userEvent.clear(screen.getByRole("textbox"));
    await userEvent.type(screen.getByRole("textbox"), "Discarded text");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(updateEnterpriseObject).not.toHaveBeenCalled();
    expect(screen.getByText(sample.description!)).toBeInTheDocument();
  });

  test("after a successful save, the field returns to read-only showing the new text", async () => {
    render(<EnterpriseObjectPopover object={sample} anchorEl={el} onClose={vi.fn()} canEdit={true} />);
    await userEvent.click(screen.getByLabelText("Edit description"));
    await userEvent.clear(screen.getByRole("textbox"));
    await userEvent.type(screen.getByRole("textbox"), "New description.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    expect(screen.getByText("New description.")).toBeInTheDocument();
  });
});
