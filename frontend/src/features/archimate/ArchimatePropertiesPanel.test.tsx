import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { makeBridge } from "@/test/archimateBridge";
import ArchimatePropertiesPanel, { type ArchimatePropertiesPanelProps } from "./ArchimatePropertiesPanel";
import type { ItemInfo } from "./engine/ArchimateEngine";

const labels = makeBridge().labels;

const ELEMENT: ItemInfo = {
  id: "s1", kind: "element", type: "BusinessActor", name: "Customer", documentation: "Buys things",
  cardId: null, properties: [{ name: "owner", value: "Ann" }],
};
const RELATIONSHIP: ItemInfo = {
  id: "r1", kind: "relationship", type: "Serving", name: "", documentation: "", cardId: null, properties: [],
};

function setup(over: Partial<ArchimatePropertiesPanelProps> = {}) {
  const handlers = { onName: vi.fn(), onDocumentation: vi.fn(), onProperties: vi.fn() };
  const props: ArchimatePropertiesPanelProps = {
    info: ELEMENT, selectedCount: 1, diagramName: "My diagram", labels,
    cardName: (id) => (id === "c1" ? "CRM" : undefined), ...handlers, ...over,
  };
  const view = renderWithProviders(<ArchimatePropertiesPanel {...props} />, { theme: true });
  return { ...view, ...handlers, user: userEvent.setup() };
}

describe("ArchimatePropertiesPanel", () => {
  it("shows the diagram, with a hint, when nothing is selected", () => {
    setup({ info: null, selectedCount: 0 });
    expect(screen.getByRole("heading", { name: "My diagram" })).toBeInTheDocument();
    expect(screen.getByText("Select an element or a relationship to see its properties.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("says how many are selected, and asks for one", () => {
    setup({ info: null, selectedCount: 3 });
    expect(screen.getByRole("heading", { name: "3 items selected" })).toBeInTheDocument();
    expect(screen.getByText("Select a single item to edit it.")).toBeInTheDocument();
  });

  it("shows an element: its layer and type, name, documentation, properties and that it has no card", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Customer" })).toBeInTheDocument();
    expect(screen.getByText(`${labels.layers.business} · ${labels.elements.BusinessActor}`)).toBeInTheDocument();
    expect(screen.getAllByLabelText("Name")[0]).toHaveValue("Customer");
    expect(screen.getByLabelText("Documentation")).toHaveValue("Buys things");
    expect(screen.getAllByLabelText("Name")[1]).toHaveValue("owner");
    expect(screen.getByLabelText("Value")).toHaveValue("Ann");
    expect(screen.getByText(`Linked card: ${labels.unlinked}`)).toBeInTheDocument();
  });

  it("falls back to the type's name for an unnamed element, and names the linked card", () => {
    setup({ info: { ...ELEMENT, name: "", cardId: "c1" } });
    expect(screen.getByRole("heading", { name: labels.elements.BusinessActor })).toBeInTheDocument();
    expect(screen.getByText("Linked card: CRM")).toBeInTheDocument();
  });

  it("shows a relationship without a card line or a layer", () => {
    setup({ info: RELATIONSHIP });
    expect(screen.getByRole("heading", { name: labels.relationships.Serving })).toBeInTheDocument();
    expect(screen.queryByText(/Linked card/)).toBeNull();
    expect(screen.getByText("No properties")).toBeInTheDocument();
  });

  it("commits the name on blur and on Enter, the documentation on blur; one change, not one per key", async () => {
    const { user, onName, onDocumentation } = setup();
    const name = screen.getAllByLabelText("Name")[0];
    await user.clear(name);
    await user.type(name, "Client");
    expect(onName).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onName).toHaveBeenCalledTimes(1);
    expect(onName).toHaveBeenCalledWith("s1", "Client");

    const doc = screen.getByLabelText("Documentation");
    await user.type(doc, " a lot{Enter}");
    expect(onDocumentation).not.toHaveBeenCalled(); // Enter is a new line in a multi-line field
    await user.tab();
    expect(onDocumentation).toHaveBeenCalledWith("s1", "Buys things a lot\n");
  });

  it("adds, edits and removes a property", async () => {
    const { user, onProperties } = setup();
    await user.click(screen.getByRole("button", { name: "Add a property" }));
    const names = screen.getAllByLabelText("Name").slice(1);
    const values = screen.getAllByLabelText("Value");
    expect(names).toHaveLength(2);
    await user.type(names[1], "tier");
    await user.type(values[1], "1");
    await user.tab();
    expect(onProperties).toHaveBeenLastCalledWith("s1", [{ name: "owner", value: "Ann" }, { name: "tier", value: "1" }]);

    const remove = screen.getAllByRole("button", { name: "Remove the property" });
    await user.click(remove[0]);
    expect(onProperties).toHaveBeenLastCalledWith("s1", [{ name: "tier", value: "1" }]);
  });

  it("collapses a section from its header", async () => {
    const { user } = setup();
    const main = screen.getByRole("button", { name: "Main" });
    expect(main).toHaveAttribute("aria-expanded", "true");
    await user.click(main);
    expect(main).toHaveAttribute("aria-expanded", "false");
  });

  it("starts from the stored value again when the item changes under it (an undo)", () => {
    const { rerender } = setup();
    const props = { info: { ...ELEMENT, name: "Renamed" }, selectedCount: 1, diagramName: "d", labels, cardName: () => undefined, onName: vi.fn(), onDocumentation: vi.fn(), onProperties: vi.fn() };
    rerender(<ArchimatePropertiesPanel {...props} />);
    expect(screen.getAllByLabelText("Name")[0]).toHaveValue("Renamed");
    expect(within(screen.getByRole("complementary")).getByRole("heading", { name: "Renamed" })).toBeInTheDocument();
  });
});
