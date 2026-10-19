import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CardType } from "@/types";
import RelationsMappingTabContent from "./RelationsMappingTabContent";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from "@/api/client";

/** BusinessActor -(Assignment)-> BusinessProcess is a standard spec example
 *  (RELATION_TABLE["BusinessActor"]["BusinessProcess"] === "fiotv"). */
const ACTOR = {
  key: "BusinessActor",
  name: "Business Actor",
  description: null,
  icon: "person",
  color: "#c6c653",
  layer: "business",
  aspect: "active",
  is_standard: true,
  is_locked: false,
  is_hidden: false,
  sort_order: 1,
  card_mappings: [
    { id: "m1", enterprise_object_key: "BusinessActor", card_type_key: "Owner", card_subtype_key: null },
  ],
};

/** Maps to TWO card types, to exercise the ambiguous-side picker. */
const PROCESS = {
  key: "BusinessProcess",
  name: "Business Process",
  description: null,
  icon: "sync_alt",
  color: "#c6c653",
  layer: "business",
  aspect: "behavior",
  is_standard: true,
  is_locked: false,
  is_hidden: false,
  sort_order: 2,
  card_mappings: [
    { id: "m2", enterprise_object_key: "BusinessProcess", card_type_key: "Process", card_subtype_key: null },
    { id: "m3", enterprise_object_key: "BusinessProcess", card_type_key: "Workflow", card_subtype_key: null },
  ],
};

/** No card mapping at all -- exercises the "no card type mapped" message. */
const OBJ = {
  key: "BusinessObject",
  name: "Business Object",
  description: null,
  icon: "description",
  color: "#c6c653",
  layer: "business",
  aspect: "passive",
  is_standard: true,
  is_locked: false,
  is_hidden: false,
  sort_order: 3,
  card_mappings: [],
};

/** Hidden -- RELATION_TABLE["BusinessProcess"]["DataObject"] also allows
 *  Access, but this must never appear as a selectable target. */
const HIDDEN_OBJ = {
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
  sort_order: 4,
  card_mappings: [],
};

const TYPES: CardType[] = [
  { key: "Owner", label: "Owner", icon: "person", color: "#333", has_hierarchy: false } as never,
  { key: "Process", label: "Process", icon: "sync_alt", color: "#333", has_hierarchy: false } as never,
  { key: "Workflow", label: "Workflow", icon: "sync_alt", color: "#333", has_hierarchy: false } as never,
];

/** Owner -(Assignment)-> Process, functionally named "runs". */
const RT_OWNER_PROCESS = {
  key: "relOwnerProcess",
  label: "runs",
  reverse_label: "is run by",
  source_type_key: "Owner",
  target_type_key: "Process",
  cardinality: "1:n",
  built_in: false,
  is_hidden: false,
  sort_order: 0,
  attributes_schema: [],
  source_visible: true,
  source_mandatory: false,
  target_visible: true,
  target_mandatory: false,
  archimate_type: "Assignment",
  archimate_access: null,
  archimate_reversed: false,
};

describe("RelationsMappingTabContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith("/metamodel/enterprise-objects")) {
        return Promise.resolve([ACTOR, PROCESS, OBJ, HIDDEN_OBJ]) as never;
      }
      if (url.startsWith("/metamodel/relation-types")) {
        return Promise.resolve([RT_OWNER_PROCESS]) as never;
      }
      throw new Error(`unexpected GET ${url}`);
    });
  });

  it("fetches enterprise objects (including hidden) and relation types", async () => {
    render(<RelationsMappingTabContent types={TYPES} />);
    await screen.findByText("Business Actor");
    expect(api.get).toHaveBeenCalledWith("/metamodel/enterprise-objects?include_hidden=true");
    expect(api.get).toHaveBeenCalledWith("/metamodel/relation-types?include_hidden=true");
  });

  it("lists the 11 ArchiMate relationship columns with a definition tooltip", async () => {
    render(<RelationsMappingTabContent types={TYPES} />);
    await screen.findByText("Business Actor");
    for (const rel of ["Composition", "Assignment", "Serving", "Access", "Association"]) {
      expect(screen.getByText(rel)).toBeInTheDocument();
    }
  });

  it("dims a hidden object's own row, same as Card Mapping", async () => {
    render(<RelationsMappingTabContent types={TYPES} />);
    const row = (await screen.findByText("Data Object")).closest("tr")!;
    expect(row).toHaveStyle({ opacity: "0.55" });
  });

  // `RELATIONSHIP_TYPES` order; a <td> always renders for every column
  // (empty when a row has no valid target), so position is stable even
  // though `getAllByRole("combobox")` would skip the empty ones.
  const COLUMN_INDEX: Record<string, number> = {
    Composition: 2,
    Aggregation: 3,
    Assignment: 4,
    Realization: 5,
    Serving: 6,
    Access: 7,
    Influence: 8,
    Triggering: 9,
    Flow: 10,
    Specialization: 11,
    Association: 12,
  };

  function cellFor(row: HTMLElement, relationship: string): HTMLElement {
    return within(row).getAllByRole("cell")[COLUMN_INDEX[relationship]];
  }

  it("excludes a hidden object from every target picker", async () => {
    const user = userEvent.setup();
    render(<RelationsMappingTabContent types={TYPES} />);
    await screen.findByText("Business Process");

    const row = screen.getByText("Business Process").closest("tr")!;
    await user.click(within(cellFor(row, "Access")).getByRole("combobox"));

    expect(await screen.findByRole("option", { name: "Business Object" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Data Object" })).not.toBeInTheDocument();
  });

  it("auto-resolves to the RelationType's functional label when each side maps to exactly one card type", async () => {
    const user = userEvent.setup();
    render(<RelationsMappingTabContent types={TYPES} />);
    await screen.findByText("Business Actor");

    const row = screen.getByText("Business Actor").closest("tr")!;
    const cell = cellFor(row, "Assignment");
    await user.click(within(cell).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Business Process" }));

    // Business Process maps to two card types -- resolve the ambiguity to
    // "Process". Both this picker and the target picker are unlabelled
    // (MUI gives an unlabelled Select no accessible name), so the only
    // reliable selector is position: the card-type picker is the second
    // combobox to appear in the cell.
    const comboboxes = await within(cell).findAllByRole("combobox");
    expect(comboboxes).toHaveLength(2);
    await user.click(comboboxes[1]);
    await user.click(await screen.findByRole("option", { name: "Process" }));

    // Owner (Actor's one card type) -> Process matches RT_OWNER_PROCESS.
    expect(await within(cell).findByText("runs")).toBeInTheDocument();
  });

  it("shows a no-card-type-mapped note for an object with zero card mappings", async () => {
    const user = userEvent.setup();
    render(<RelationsMappingTabContent types={TYPES} />);
    await screen.findByText("Business Process");

    const row = screen.getByText("Business Process").closest("tr")!;
    const cell = cellFor(row, "Access");
    await user.click(within(cell).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Business Object" }));

    expect(
      await within(cell).findByText("Business Object has no card type mapped"),
    ).toBeInTheDocument();
  });
});
