import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("@/api/archimateViewpoints", () => ({
  listViewpoints: vi.fn(),
}));

import { api } from "@/api/client";
import { listViewpoints } from "@/api/archimateViewpoints";
import {
  createDiagram,
  listViewpointsForTab,
  getSuggestedCards,
  getViewpointExampleXml,
} from "./diagrams";
import type { ArchimateViewpointForPicker } from "@/types";

const mockGet = vi.mocked(api.get);
const mockPost = vi.mocked(api.post);
const mockListViewpoints = vi.mocked(listViewpoints);

const picker: ArchimateViewpointForPicker = {
  key: "organization",
  name: "Organization",
  icon: "account_tree",
  examples: [],
};

describe("diagrams api client", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockListViewpoints.mockReset();
  });

  it("createDiagram posts the body", async () => {
    const created = { id: "d1", name: "New", kind: "archimate", card_ids: [] };
    mockPost.mockResolvedValue(created);
    const body = { name: "New", kind: "archimate" as const, viewpoint_key: "organization" };
    const result = await createDiagram(body);
    expect(mockPost).toHaveBeenCalledWith("/diagrams", body);
    expect(result).toEqual(created);
  });

  it("listViewpointsForTab(null) delegates to the unscoped listViewpoints", async () => {
    mockListViewpoints.mockResolvedValue([picker]);
    const result = await listViewpointsForTab(null);
    expect(mockListViewpoints).toHaveBeenCalledWith();
    expect(mockGet).not.toHaveBeenCalled();
    expect(result).toEqual([picker]);
  });

  it("listViewpointsForTab(tab) calls the scoped endpoint", async () => {
    mockGet.mockResolvedValue([picker]);
    const result = await listViewpointsForTab("business");
    expect(mockGet).toHaveBeenCalledWith("/diagrams/viewpoints-for-tab?tab=business");
    expect(mockListViewpoints).not.toHaveBeenCalled();
    expect(result).toEqual([picker]);
  });

  it("getSuggestedCards calls the suggested-cards endpoint with the tab", async () => {
    mockGet.mockResolvedValue(["Application"]);
    const result = await getSuggestedCards("organization", "application");
    expect(mockGet).toHaveBeenCalledWith(
      "/diagrams/viewpoints-for-tab/organization/suggested-cards?tab=application",
    );
    expect(result).toEqual(["Application"]);
  });

  it("getViewpointExampleXml fetches one example's xml by viewpoint and id", async () => {
    const example = { id: "e1", name: "Starter", xml: "<xml/>" };
    mockGet.mockResolvedValue(example);
    const result = await getViewpointExampleXml("organization", "e1");
    expect(mockGet).toHaveBeenCalledWith("/diagrams/viewpoints-for-tab/organization/examples/e1");
    expect(result).toEqual(example);
  });
});
