import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "@/i18n";
import CostFilters from "./CostFilters";
import { EMPTY_CARD_FILTERS } from "./cardFilters";

vi.mock("@/api/client", () => ({ api: { get: vi.fn() }, isAbortError: () => false }));
vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";

const field = (key: string, label: string) => ({
  key,
  label,
  type: "single_select",
  options: [
    { key: "high", label: "High" },
    { key: "low", label: "Low" },
  ],
});
const TYPES = [
  {
    key: "Application",
    label: "Application",
    is_hidden: false,
    has_hierarchy: true,
    subtypes: [],
    fields_schema: [{ section: "Details", fields: [field("businessCriticality", "Criticality")] }],
  },
  {
    key: "ITComponent",
    label: "IT Component",
    is_hidden: false,
    has_hierarchy: false,
    subtypes: [],
    fields_schema: [],
  },
  {
    key: "Provider",
    label: "Provider",
    is_hidden: false,
    has_hierarchy: false,
    subtypes: [],
    fields_schema: [],
  },
];
const OPTIONS = (typeKey: string) => ({
  fields_schema: [],
  relation_types: [
    {
      key: typeKey === "Application" ? "relProviderToApp" : "relProviderToITC",
      label: "provides",
      reverse_label: "is provided by",
      source_type_key: "Provider",
      target_type_key: typeKey,
      other_type_key: "Provider",
    },
  ],
  groupable_types: { Provider: [{ id: "p1", name: "Acme" }] },
  tag_groups: [],
});

const props = (over = {}) => ({
  typeKeys: ["Application"],
  value: {},
  onChange: vi.fn(),
  collapsed: false,
  onToggle: vi.fn(),
  ...over,
});

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.clearAllMocks();
  vi.mocked(useMetamodel).mockReturnValue({
    types: TYPES,
    relationTypes: [],
    loading: false,
  } as never);
  vi.mocked(api.get).mockImplementation(
    (path: string) =>
      Promise.resolve(OPTIONS(new URL(path, "http://x").searchParams.get("type")!)) as never,
  );
});

describe("CostFilters", () => {
  it("renders one section per selected type, labelled with the type name", async () => {
    render(<CostFilters {...props({ typeKeys: ["Application", "ITComponent"] })} />);
    expect(await screen.findByText("Application Filters")).toBeInTheDocument();
    expect(screen.getByText("IT Component Filters")).toBeInTheDocument();
    const types = vi
      .mocked(api.get)
      .mock.calls.map(([p]) => new URL(String(p), "http://x").searchParams.get("type"));
    expect(types.sort()).toEqual(["Application", "ITComponent"]);
  });

  it("Application only shows no IT Component section", async () => {
    render(<CostFilters {...props()} />);
    expect(await screen.findByText("Application Filters")).toBeInTheDocument();
    expect(screen.queryByText("IT Component Filters")).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("shows Provider among the Related by facets and the type's fields", async () => {
    render(<CostFilters {...props()} />);
    expect(await screen.findByRole("combobox", { name: "Provider" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Criticality" })).toBeInTheDocument();
  });

  it("changing a filter calls onChange with that type's value", async () => {
    const onChange = vi.fn();
    render(<CostFilters {...props({ onChange, typeKeys: ["Application", "ITComponent"] })} />);
    const [provider] = await screen.findAllByRole("combobox", { name: "Provider" });
    fireEvent.mouseDown(provider);
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Acme"));
    expect(onChange).toHaveBeenCalledWith({
      Application: { ...EMPTY_CARD_FILTERS, relationFilters: { Provider: ["p1"] } },
    });
  });

  it("shows the unavailable text while the options load and when they fail, with the section kept", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("boom"));
    render(<CostFilters {...props()} />);
    expect(await screen.findByText("Application Filters")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("Filters are unavailable right now")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("combobox", { name: "Criticality" })).not.toBeInTheDocument();
  });

  it("calls onToggle from the section header", async () => {
    const onToggle = vi.fn();
    render(<CostFilters {...props({ onToggle })} />);
    await userEvent.click(await screen.findByText("Application Filters"));
    expect(onToggle).toHaveBeenCalled();
  });
});
