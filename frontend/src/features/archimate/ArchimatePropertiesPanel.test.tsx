import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { makeBridge } from "@/test/archimateBridge";
import type { Card, CardType } from "@/types";
import ArchimatePropertiesPanel, { type ArchimatePropertiesPanelProps } from "./ArchimatePropertiesPanel";
import type { ItemInfo } from "./engine/ArchimateEngine";

const CARD_TYPE: CardType = {
  key: "Application", label: "Application", icon: "apps", color: "#09f", has_hierarchy: false, has_successors: false,
  allow_card_logo: false, subtypes: [{ key: "web", label: "Web app" }], fields_schema: [
    { section: "Main", fields: [{ key: "owner", label: "Owner", type: "text" }] },
  ], built_in: true, is_hidden: false, sort_order: 0,
} as unknown as CardType;

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({ types: [CARD_TYPE], getType: (key: string) => (key === "Application" ? CARD_TYPE : undefined) }),
}));

const labels = makeBridge().labels;

const ELEMENT: ItemInfo = {
  id: "s1", kind: "element", type: "BusinessActor", name: "Customer", documentation: "Buys things",
  cardId: null, properties: [{ name: "owner", value: "Ann" }],
};
const RELATIONSHIP: ItemInfo = {
  id: "r1", kind: "relationship", type: "Serving", name: "", documentation: "", cardId: null, properties: [],
};
const NOTE: ItemInfo = { id: "n1", kind: "note", type: "Note", name: "Ask the team", documentation: "", cardId: null, properties: [] };

const CARD: Card = {
  id: "c1", type: "Application", subtype: "web", name: "CRM", description: "Customer relations",
  status: "ACTIVE", approval_status: "APPROVED", data_quality: 80, tags: [], stakeholders: [],
  attributes: { owner: "Ann", empty: "" },
};

function setup(over: Partial<ArchimatePropertiesPanelProps> = {}) {
  const handlers = {
    onName: vi.fn(), onDocumentation: vi.fn(), onProperties: vi.fn(), onStyle: vi.fn(),
    onDiagramName: vi.fn(), onDiagramDocumentation: vi.fn(), onDiagramProperties: vi.fn(), onOpenCardSheet: vi.fn(),
  };
  const props: ArchimatePropertiesPanelProps = {
    info: ELEMENT, selectedCount: 1, selectedIds: ["s1"], diagramName: "My diagram", diagramDescription: "",
    diagramProperties: [], labels,
    cardName: (id) => (id === "c1" ? "CRM" : undefined), linkedCard: null, linkedCardLoading: false,
    ...handlers, ...over,
  };
  const view = renderWithProviders(<ArchimatePropertiesPanel {...props} />, { theme: true });
  return { ...view, ...handlers, user: userEvent.setup() };
}

describe("ArchimatePropertiesPanel", () => {
  it("shows the diagram's own name, documentation and parameters when nothing is selected, plus a View placeholder", () => {
    setup({
      info: null, selectedCount: 0, diagramName: "My diagram", diagramDescription: "Landscape overview",
      diagramProperties: [{ name: "owner", value: "EA team" }],
    });
    expect(screen.getByRole("heading", { name: "My diagram" })).toBeInTheDocument();
    expect(screen.getByText("View")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Name")[0]).toHaveValue("My diagram");
    expect(screen.getByLabelText("Documentation")).toHaveValue("Landscape overview");
    expect(screen.getAllByLabelText("Name")[1]).toHaveValue("owner");
    expect(screen.getByLabelText("Value")).toHaveValue("EA team");
  });

  it("shows the viewpoint name in the View row when given, the generic label otherwise", () => {
    setup({ info: null, selectedCount: 0, viewpointName: "Requirements Realization Viewpoint" });
    expect(screen.getByText("Requirements Realization Viewpoint")).toBeInTheDocument();
    expect(screen.queryByText("View")).toBeNull();
  });

  it("commits the diagram's name and documentation on blur/Enter, and its parameters like an element's", async () => {
    const { user, onDiagramName, onDiagramDocumentation, onDiagramProperties } = setup({ info: null, selectedCount: 0 });
    const name = screen.getAllByLabelText("Name")[0];
    await user.clear(name);
    await user.type(name, "Renamed{Enter}");
    expect(onDiagramName).toHaveBeenCalledWith("Renamed");
    const doc = screen.getByLabelText("Documentation");
    await user.type(doc, "notes");
    await user.tab();
    expect(onDiagramDocumentation).toHaveBeenCalledWith("notes");
    await user.click(screen.getByRole("button", { name: "Add a property" }));
    await user.type(screen.getAllByLabelText("Name")[1], "k");
    await user.type(screen.getByLabelText("Value"), "v");
    await user.tab();
    expect(onDiagramProperties).toHaveBeenCalledWith([{ name: "k", value: "v" }]);
  });

  it("says how many are selected, and asks for one", () => {
    setup({ info: null, selectedCount: 3 });
    expect(screen.getByRole("heading", { name: "3 items selected" })).toBeInTheDocument();
    expect(screen.getByText("Select a single item to edit it.")).toBeInTheDocument();
    expect(screen.queryByText("View")).toBeNull();
  });

  it("shows an unlinked element: its layer and type, name, documentation, properties", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Customer" })).toBeInTheDocument();
    expect(screen.getByText(`${labels.layers.business} · ${labels.elements.BusinessActor}`)).toBeInTheDocument();
    expect(screen.getAllByLabelText("Name")[0]).toHaveValue("Customer");
    expect(screen.getByLabelText("Documentation")).toHaveValue("Buys things");
    expect(screen.getAllByLabelText("Name")[1]).toHaveValue("owner");
    expect(screen.getByLabelText("Value")).toHaveValue("Ann");
    expect(screen.getByText(`Linked card: ${labels.unlinked}`)).toBeInTheDocument();
  });

  it("falls back to the type's name for an unnamed element", () => {
    setup({ info: { ...ELEMENT, name: "" } });
    expect(screen.getByRole("heading", { name: labels.elements.BusinessActor })).toBeInTheDocument();
  });

  it("shows a relationship without a card line or a layer", () => {
    setup({ info: RELATIONSHIP });
    expect(screen.getByRole("heading", { name: labels.relationships.Serving })).toBeInTheDocument();
    expect(screen.queryByText(/Linked card/)).toBeNull();
    expect(screen.getByText("No properties")).toBeInTheDocument();
  });

  it("shows a fill color control for an element; changing it or resetting calls onStyle", async () => {
    const { user, onStyle } = setup({ info: { ...ELEMENT, fillColor: { r: 10, g: 20, b: 30 } } });
    const input = screen.getByLabelText("Fill color") as HTMLInputElement;
    expect(input.value).toBe("#0a141e");
    fireEvent.input(input, { target: { value: "#ff0000" } });
    expect(onStyle).toHaveBeenCalledWith(["s1"], { r: 255, g: 0, b: 0 });
    await user.click(screen.getByRole("button", { name: "Reset to the default color" }));
    expect(onStyle).toHaveBeenLastCalledWith(["s1"], null);
  });

  it("shows no fill color control for a relationship or a note", () => {
    setup({ info: RELATIONSHIP });
    expect(screen.queryByLabelText("Fill color")).toBeNull();
    setup({ info: NOTE });
    expect(screen.queryByLabelText("Fill color")).toBeNull();
  });

  it("shows a fill color control for a multi-selection, applying to every selected id", () => {
    const { onStyle } = setup({ info: null, selectedCount: 2, selectedIds: ["s1", "s2"] });
    const input = screen.getByLabelText("Fill color") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "#00ff00" } });
    expect(onStyle).toHaveBeenCalledWith(["s1", "s2"], { r: 0, g: 255, b: 0 });
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
    const props: ArchimatePropertiesPanelProps = {
      info: { ...ELEMENT, name: "Renamed" }, selectedCount: 1, selectedIds: ["s1"], diagramName: "d", diagramDescription: "",
      diagramProperties: [], labels, cardName: () => undefined, linkedCard: null, linkedCardLoading: false,
      onName: vi.fn(), onDocumentation: vi.fn(), onProperties: vi.fn(), onStyle: vi.fn(), onDiagramName: vi.fn(),
      onDiagramDocumentation: vi.fn(), onDiagramProperties: vi.fn(), onOpenCardSheet: vi.fn(),
    };
    rerender(<ArchimatePropertiesPanel {...props} />);
    expect(screen.getAllByLabelText("Name")[0]).toHaveValue("Renamed");
    expect(within(screen.getByRole("complementary")).getByRole("heading", { name: "Renamed" })).toBeInTheDocument();
  });

  describe("a note", () => {
    it("shows only its text, no documentation, card or properties section", () => {
      setup({ info: NOTE });
      expect(screen.getByRole("heading", { name: "Ask the team" })).toBeInTheDocument();
      expect(screen.getByLabelText("Text")).toHaveValue("Ask the team");
      expect(screen.queryByLabelText("Documentation")).toBeNull();
      expect(screen.queryByText(/Linked card/)).toBeNull();
      expect(screen.queryByRole("button", { name: "Properties" })).toBeNull();
    });

    it("falls back to the bridge's note label when empty, and commits its text through onName", async () => {
      const { user, onName } = setup({ info: { ...NOTE, name: "" } });
      expect(screen.getByRole("heading", { name: labels.note })).toBeInTheDocument();
      const text = screen.getByLabelText("Text");
      await user.type(text, "Check this");
      await user.tab();
      expect(onName).toHaveBeenCalledWith("n1", "Check this");
    });
  });

  describe("a linked element: the card is the source of truth", () => {
    it("shows a loading state before the card arrives", () => {
      setup({ info: { ...ELEMENT, cardId: "c1" }, linkedCard: null, linkedCardLoading: true });
      expect(screen.getByText(`Linked card: CRM`)).toBeInTheDocument();
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
      // The free-text Name field is gone, even though the element's own Properties section
      // (independent of the card) still has one for its "owner" property row.
      expect(screen.getAllByLabelText("Name")).toHaveLength(1);
    });

    it("shows the card's own name, type, subtype, status badges, description and attributes, all readonly", () => {
      setup({ info: { ...ELEMENT, cardId: "c1" }, linkedCard: CARD });
      expect(screen.getByRole("button", { name: `${labels.openCard}: CRM` })).toBeInTheDocument();
      expect(screen.getByText("Application")).toBeInTheDocument();
      expect(screen.getByText("Web app")).toBeInTheDocument();
      expect(screen.getByText("Customer relations")).toBeInTheDocument();
      expect(screen.getByText("Owner")).toBeInTheDocument();
      // "Ann" is both the card's own attribute value and the element's unrelated "owner" property value.
      expect(screen.getAllByText("Ann").length).toBeGreaterThan(0);
      expect(screen.queryByLabelText("Documentation")).toBeNull();
      // The free-text Name field is gone; only the element's own Properties section still has one.
      expect(screen.getAllByLabelText("Name")).toHaveLength(1);
      // the element's OWN properties (point 3) are untouched, in their own section
      expect(screen.getByRole("button", { name: "Properties" })).toBeInTheDocument();
    });

    it("opens the card sheet from the button", async () => {
      const { user, onOpenCardSheet } = setup({ info: { ...ELEMENT, cardId: "c1" }, linkedCard: CARD });
      await user.click(screen.getByRole("button", { name: `${labels.openCard}: CRM` }));
      expect(onOpenCardSheet).toHaveBeenCalledWith("c1");
    });

    it("never shows a linked block for a relationship (cardId is always null)", () => {
      setup({ info: RELATIONSHIP, linkedCard: CARD });
      expect(screen.queryByRole("button", { name: /CRM/ })).toBeNull();
    });
  });
});
