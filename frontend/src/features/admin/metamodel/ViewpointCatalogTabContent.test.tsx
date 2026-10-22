import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ViewpointCatalogTabContent from "./ViewpointCatalogTabContent";

vi.mock("@/api/client", () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
import { api } from "@/api/client";

describe("ViewpointCatalogTabContent", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue([
      { key: "organization", name: "Organization", icon: "account_tree", layer: "business",
        is_standard: true, is_hidden: false, objects: ["BusinessActor"] },
    ]);
  });

  it("lists viewpoints with their layer badge and object count", async () => {
    render(<ViewpointCatalogTabContent />);
    expect(await screen.findByText("Organization")).toBeInTheDocument();
    // The layer chip renders the translated layer name (`layers.business` in
    // en/archimate.json is "Business"), not the raw backend value -- same
    // localization every sibling layer `Select` in this feature uses.
    expect(screen.getByText("Business")).toBeInTheDocument();
  });
});
