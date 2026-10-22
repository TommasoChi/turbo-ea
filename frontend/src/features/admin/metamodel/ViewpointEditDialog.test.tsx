import { describe, test, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ArchimateViewpoint, EnterpriseObject } from "@/types";
import ViewpointEditDialog from "./ViewpointEditDialog";

vi.mock("@/api/archimateViewpoints", () => ({
  createViewpoint: vi.fn(),
  updateViewpoint: vi.fn(),
  addViewpointObject: vi.fn(),
  removeViewpointObject: vi.fn(),
  uploadViewpointExample: vi.fn(),
  deleteViewpointExample: vi.fn(),
}));
vi.mock("@/api/enterpriseObjects", () => ({
  listEnterpriseObjects: vi.fn(),
}));

import { ApiError } from "@/api/client";
import {
  addViewpointObject,
  createViewpoint,
  deleteViewpointExample,
  removeViewpointObject,
  uploadViewpointExample,
} from "@/api/archimateViewpoints";
import { listEnterpriseObjects } from "@/api/enterpriseObjects";

const ENTERPRISE_OBJECTS: EnterpriseObject[] = [
  {
    key: "BusinessActor",
    name: "Business Actor",
    description: null,
    icon: "person",
    color: "#1976d2",
    layer: "business",
    aspect: "active",
    is_standard: true,
    is_locked: false,
    is_hidden: false,
    sort_order: 0,
    card_mappings: [],
  },
  {
    key: "BusinessRole",
    name: "Business Role",
    description: null,
    icon: "badge",
    color: "#1976d2",
    layer: "business",
    aspect: "active",
    is_standard: true,
    is_locked: false,
    is_hidden: false,
    sort_order: 1,
    card_mappings: [],
  },
];

const ORGANIZATION: ArchimateViewpoint = {
  key: "organization",
  name: "Organization",
  icon: "account_tree",
  description: null,
  layer: "business",
  is_standard: true,
  is_hidden: false,
  sort_order: 0,
  objects: [],
  examples: [],
};

beforeAll(() => {
  // jsdom's File has no text() (every supported browser does) -- same stub as ArchimateModeler.test.tsx.
  if (!File.prototype.text) {
    File.prototype.text = function (this: File) {
      return new Promise<string>((ok, fail) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result));
        r.onerror = () => fail(r.error);
        r.readAsText(this);
      });
    };
  }
});

describe("ViewpointEditDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listEnterpriseObjects).mockResolvedValue(ENTERPRISE_OBJECTS);
  });

  test("create mode posts the form's values and hides the allowed-objects editor", async () => {
    vi.mocked(createViewpoint).mockResolvedValue({
      key: "myView",
      name: "My View",
      icon: "category",
      description: "A description",
      layer: "business",
      is_standard: false,
      is_hidden: false,
      sort_order: 1,
      objects: [],
      examples: [],
    });
    const onSaved = vi.fn();
    render(<ViewpointEditDialog open viewpoint={null} onClose={vi.fn()} onSaved={onSaved} />);

    // The allowed-objects editor needs a persisted viewpoint to attach to --
    // it stays hidden (with the "save first" note) until create succeeds.
    expect(screen.queryByLabelText("Add object")).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Key"), "myView");
    await userEvent.type(screen.getByLabelText("Name"), "My View");
    await userEvent.type(screen.getByLabelText("Description"), "A description");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(createViewpoint).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "myView",
          name: "My View",
          description: "A description",
        }),
      ),
    );
    expect(onSaved).toHaveBeenCalled();

    // Create switches the dialog in place to edit mode -- the objects editor
    // unlocks without closing, so an admin can start allowing objects right away.
    expect(await screen.findByLabelText("Add object")).toBeInTheDocument();
  });

  test("save button is disabled until a create-mode key and name are both filled", () => {
    render(<ViewpointEditDialog open viewpoint={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("adding an allowed object posts it and renders a removable chip", async () => {
    vi.mocked(addViewpointObject).mockResolvedValue({
      id: "vo1",
      viewpoint_key: "organization",
      enterprise_object_key: "BusinessActor",
    });
    render(<ViewpointEditDialog open viewpoint={ORGANIZATION} onClose={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.click(await screen.findByLabelText("Add object"));
    await userEvent.click(await screen.findByRole("option", { name: "Business Actor" }));
    // The button's accessible name includes the leading icon's own text node
    // ("add"), so it's "add Add" rather than a bare "Add".
    await userEvent.click(screen.getByRole("button", { name: /add/i }));

    await waitFor(() =>
      expect(addViewpointObject).toHaveBeenCalledWith("organization", "BusinessActor"),
    );
    expect(await screen.findByText("Business Actor")).toBeInTheDocument();
  });

  test("removing an allowed object's chip calls removeViewpointObject", async () => {
    vi.mocked(removeViewpointObject).mockResolvedValue(undefined);
    render(
      <ViewpointEditDialog
        open
        viewpoint={{ ...ORGANIZATION, objects: ["BusinessActor"] }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const chip = (await screen.findByText("Business Actor")).closest(".MuiChip-root") as HTMLElement;
    const deleteIcon = chip.querySelector(".MuiChip-deleteIcon") as HTMLElement;
    await userEvent.click(deleteIcon);

    await waitFor(() =>
      expect(removeViewpointObject).toHaveBeenCalledWith("organization", "BusinessActor"),
    );
    expect(screen.queryByText("Business Actor")).not.toBeInTheDocument();
  });

  test("examples stay hidden until the viewpoint exists", () => {
    render(<ViewpointEditDialog open viewpoint={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByLabelText("Example name")).not.toBeInTheDocument();
  });

  test("uploading an example posts the file's text and lists it", async () => {
    vi.mocked(uploadViewpointExample).mockResolvedValue({ id: "ex1", name: "Sample" });
    const onSaved = vi.fn();
    render(<ViewpointEditDialog open viewpoint={ORGANIZATION} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.type(screen.getByLabelText("Example name"), "Sample");
    const file = new File(["<model/>"], "sample.archimate", { type: "application/xml" });
    await userEvent.upload(screen.getByTestId("viewpoint-example-file"), file);

    await waitFor(() =>
      expect(uploadViewpointExample).toHaveBeenCalledWith("organization", "Sample", "<model/>"),
    );
    expect(await screen.findByText("Sample")).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalled();
  });

  test("a 422 upload shows the validator's issues inline and lists nothing", async () => {
    vi.mocked(uploadViewpointExample).mockRejectedValue(
      new ApiError("Invalid ArchiMate model", 422, {
        message: "Invalid ArchiMate model",
        issues: [
          { code: "unknown_element_type", message: "Unknown element type 'Foo'", ref: "e1" },
          { code: "bad_relationship", message: "Serving is not allowed here", ref: "r1" },
        ],
      }),
    );
    render(<ViewpointEditDialog open viewpoint={ORGANIZATION} onClose={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Example name"), "Broken");
    await userEvent.upload(
      screen.getByTestId("viewpoint-example-file"),
      new File(["<bad/>"], "broken.xml", { type: "application/xml" }),
    );

    expect(await screen.findByText("Unknown element type 'Foo'")).toBeInTheDocument();
    expect(screen.getByText("Serving is not allowed here")).toBeInTheDocument();
    expect(screen.getByText(/not a valid ArchiMate model/)).toBeInTheDocument();
    expect(screen.getByText("No examples yet.")).toBeInTheDocument();
  });

  test("deleting an example's chip calls deleteViewpointExample", async () => {
    vi.mocked(deleteViewpointExample).mockResolvedValue(undefined);
    render(
      <ViewpointEditDialog
        open
        viewpoint={{ ...ORGANIZATION, examples: [{ id: "ex1", name: "Sample" }] }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const chip = (await screen.findByText("Sample")).closest(".MuiChip-root") as HTMLElement;
    await userEvent.click(chip.querySelector(".MuiChip-deleteIcon") as HTMLElement);

    await waitFor(() => expect(deleteViewpointExample).toHaveBeenCalledWith("organization", "ex1"));
    expect(screen.queryByText("Sample")).not.toBeInTheDocument();
  });
});
