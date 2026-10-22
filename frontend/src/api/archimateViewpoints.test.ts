import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from "@/api/client";
import {
  listViewpoints,
  getViewpoint,
  createViewpoint,
  updateViewpoint,
  deleteViewpoint,
  addViewpointObject,
  removeViewpointObject,
  uploadViewpointExample,
  deleteViewpointExample,
} from "./archimateViewpoints";
import type { ArchimateViewpoint } from "@/types";

const mockGet = vi.mocked(api.get);
const mockPost = vi.mocked(api.post);
const mockPatch = vi.mocked(api.patch);
const mockDelete = vi.mocked(api.delete);

const sampleViewpoint: ArchimateViewpoint = {
  key: "organization",
  name: "Organization",
  icon: "account_tree",
  description: null,
  layer: "business",
  is_standard: true,
  is_hidden: false,
  sort_order: 1,
  objects: ["BusinessActor"],
  examples: [],
};

describe("archimateViewpoints api client", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it("listViewpoints calls GET /metamodel/viewpoints", async () => {
    mockGet.mockResolvedValue([sampleViewpoint]);
    const result = await listViewpoints();
    expect(mockGet).toHaveBeenCalledWith("/metamodel/viewpoints");
    expect(result).toEqual([sampleViewpoint]);
  });

  it("listViewpoints(true) includes hidden rows", async () => {
    mockGet.mockResolvedValue([sampleViewpoint]);
    await listViewpoints(true);
    expect(mockGet).toHaveBeenCalledWith("/metamodel/viewpoints?include_hidden=true");
  });

  it("getViewpoint fetches one by key", async () => {
    mockGet.mockResolvedValue(sampleViewpoint);
    const result = await getViewpoint("organization");
    expect(mockGet).toHaveBeenCalledWith("/metamodel/viewpoints/organization");
    expect(result).toEqual(sampleViewpoint);
  });

  it("createViewpoint posts the body", async () => {
    mockPost.mockResolvedValue(sampleViewpoint);
    const body = { key: "custom", name: "Custom" };
    const result = await createViewpoint(body);
    expect(mockPost).toHaveBeenCalledWith("/metamodel/viewpoints", body);
    expect(result).toEqual(sampleViewpoint);
  });

  it("updateViewpoint patches by key", async () => {
    mockPatch.mockResolvedValue(sampleViewpoint);
    const body = { name: "Renamed" };
    const result = await updateViewpoint("organization", body);
    expect(mockPatch).toHaveBeenCalledWith("/metamodel/viewpoints/organization", body);
    expect(result).toEqual(sampleViewpoint);
  });

  it("deleteViewpoint calls DELETE by key", async () => {
    mockDelete.mockResolvedValue({ status: "deleted", key: "organization" });
    const result = await deleteViewpoint("organization");
    expect(mockDelete).toHaveBeenCalledWith("/metamodel/viewpoints/organization");
    expect(result).toEqual({ status: "deleted", key: "organization" });
  });

  it("addViewpointObject posts the enterprise_object_key", async () => {
    const added = { id: "o1", viewpoint_key: "organization", enterprise_object_key: "BusinessRole" };
    mockPost.mockResolvedValue(added);
    const result = await addViewpointObject("organization", "BusinessRole");
    expect(mockPost).toHaveBeenCalledWith("/metamodel/viewpoints/organization/objects", {
      enterprise_object_key: "BusinessRole",
    });
    expect(result).toEqual(added);
  });

  it("removeViewpointObject calls DELETE with key and object key", async () => {
    mockDelete.mockResolvedValue(undefined);
    await removeViewpointObject("organization", "BusinessRole");
    expect(mockDelete).toHaveBeenCalledWith(
      "/metamodel/viewpoints/organization/objects/BusinessRole",
    );
  });

  it("uploadViewpointExample posts name and xml", async () => {
    const example = { id: "e1", name: "Starter", viewpoint_key: "organization" };
    mockPost.mockResolvedValue(example);
    const result = await uploadViewpointExample("organization", "Starter", "<xml/>");
    expect(mockPost).toHaveBeenCalledWith("/metamodel/viewpoints/organization/examples", {
      name: "Starter",
      xml: "<xml/>",
    });
    expect(result).toEqual(example);
  });

  it("deleteViewpointExample calls DELETE with key and example id", async () => {
    mockDelete.mockResolvedValue(undefined);
    await deleteViewpointExample("organization", "e1");
    expect(mockDelete).toHaveBeenCalledWith("/metamodel/viewpoints/organization/examples/e1");
  });
});
