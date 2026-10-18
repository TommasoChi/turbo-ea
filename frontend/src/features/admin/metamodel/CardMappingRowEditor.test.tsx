import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CardType, EnterpriseObject } from "@/types";
import CardMappingRowEditor from "./CardMappingRowEditor";

vi.mock("@/api/enterpriseObjects", () => ({
  addCardMapping: vi.fn(),
  removeCardMapping: vi.fn(),
}));

import { addCardMapping, removeCardMapping } from "@/api/enterpriseObjects";

const BASE_TYPE_FIELDS = {
  icon: "category",
  color: "#1976d2",
  has_hierarchy: false,
  has_successors: false,
  allow_card_logo: false,
  fields_schema: [],
};

const APPLICATION: CardType = {
  key: "Application",
  label: "Application",
  ...BASE_TYPE_FIELDS,
};

const DATA_OBJECT: CardType = {
  key: "DataObject",
  label: "Data Object",
  ...BASE_TYPE_FIELDS,
};

const IT_ASSET: CardType = {
  key: "ItAsset",
  label: "IT Asset",
  ...BASE_TYPE_FIELDS,
  subtypes: [
    { key: "server", label: "Server" },
    { key: "laptop", label: "Laptop" },
  ],
};

const TYPES: CardType[] = [APPLICATION, DATA_OBJECT, IT_ASSET];

const sample: EnterpriseObject = {
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
  card_mappings: [],
};

const sampleWithOneMapping: EnterpriseObject = {
  ...sample,
  card_mappings: [
    {
      id: "m1",
      enterprise_object_key: "BusinessObject",
      card_type_key: "Application",
      card_subtype_key: null,
    },
  ],
};

describe("CardMappingRowEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("adding a mapping with no subtypes posts card_subtype_key: null", async () => {
    render(<CardMappingRowEditor object={sample} types={TYPES} onChanged={vi.fn()} />);

    await userEvent.click(screen.getByLabelText("Card type"));
    await userEvent.click(screen.getByRole("option", { name: "Data Object" }));
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(addCardMapping).toHaveBeenCalledWith(sample.key, "DataObject", null);
  });

  test("adding a mapping with 'All subtypes' selected posts card_subtype_key: null", async () => {
    render(<CardMappingRowEditor object={sample} types={TYPES} onChanged={vi.fn()} />);

    await userEvent.click(screen.getByLabelText("Card type"));
    await userEvent.click(screen.getByRole("option", { name: "IT Asset" }));
    // The subtype picker defaults to "All subtypes" -- no extra click needed.
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(addCardMapping).toHaveBeenCalledWith(sample.key, "ItAsset", null);
  });

  test("adding a mapping with a specific subtype selected posts its key", async () => {
    render(<CardMappingRowEditor object={sample} types={TYPES} onChanged={vi.fn()} />);

    await userEvent.click(screen.getByLabelText("Card type"));
    await userEvent.click(screen.getByRole("option", { name: "IT Asset" }));
    await userEvent.click(screen.getByLabelText("Subtype"));
    await userEvent.click(screen.getByRole("option", { name: "Laptop" }));
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(addCardMapping).toHaveBeenCalledWith(sample.key, "ItAsset", "laptop");
  });

  test("the subtype picker only appears once a type with subtypes is selected", async () => {
    render(<CardMappingRowEditor object={sample} types={TYPES} onChanged={vi.fn()} />);

    expect(screen.queryByLabelText("Subtype")).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Card type"));
    await userEvent.click(screen.getByRole("option", { name: "IT Asset" }));

    expect(screen.getByLabelText("Subtype")).toBeInTheDocument();
  });

  test("the Add button is disabled until a card type is selected", () => {
    render(<CardMappingRowEditor object={sample} types={TYPES} onChanged={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  test("adding a mapping calls onChanged and resets the pickers", async () => {
    const onChanged = vi.fn();
    render(<CardMappingRowEditor object={sample} types={TYPES} onChanged={onChanged} />);

    await userEvent.click(screen.getByLabelText("Card type"));
    await userEvent.click(screen.getByRole("option", { name: "Application" }));
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  test("lists the object's current mappings, resolving type and subtype labels", () => {
    const withSubtypeMapping: EnterpriseObject = {
      ...sample,
      card_mappings: [
        { id: "m1", enterprise_object_key: sample.key, card_type_key: "Application", card_subtype_key: null },
        { id: "m2", enterprise_object_key: sample.key, card_type_key: "ItAsset", card_subtype_key: "laptop" },
      ],
    };
    render(<CardMappingRowEditor object={withSubtypeMapping} types={TYPES} onChanged={vi.fn()} />);

    expect(screen.getByText(/Application/)).toBeInTheDocument();
    expect(screen.getByText(/IT Asset/)).toBeInTheDocument();
    expect(screen.getByText(/Laptop/)).toBeInTheDocument();
  });

  test("removing a row calls removeCardMapping with its id", async () => {
    render(<CardMappingRowEditor object={sampleWithOneMapping} types={TYPES} onChanged={vi.fn()} />);

    await userEvent.click(screen.getByLabelText("Remove mapping"));

    expect(removeCardMapping).toHaveBeenCalledWith(
      sampleWithOneMapping.key,
      sampleWithOneMapping.card_mappings[0].id,
    );
  });

  test("removing a row calls onChanged", async () => {
    const onChanged = vi.fn();
    render(<CardMappingRowEditor object={sampleWithOneMapping} types={TYPES} onChanged={onChanged} />);

    await userEvent.click(screen.getByLabelText("Remove mapping"));

    expect(onChanged).toHaveBeenCalled();
  });
});
