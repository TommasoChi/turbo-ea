import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from "@/api/client";
import {
  listEnterpriseObjects,
  createEnterpriseObject,
  updateEnterpriseObject,
  addCardMapping,
  removeCardMapping,
} from "./enterpriseObjects";
import type { EnterpriseObject } from "@/types";

const mockGet = vi.mocked(api.get);
const mockPost = vi.mocked(api.post);
const mockPatch = vi.mocked(api.patch);
const mockDelete = vi.mocked(api.delete);

const sampleEnterpriseObject: EnterpriseObject = {
  key: "capability",
  name: "Capability",
  description: null,
  icon: "category",
  color: "#1976d2",
  layer: "strategy",
  is_standard: true,
  is_locked: true,
  is_hidden: false,
  sort_order: 1,
  card_mappings: [
    { id: "m1", enterprise_object_key: "capability", card_type_key: "Application", card_subtype_key: null },
  ],
};

describe("enterpriseObjects api client", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it("listEnterpriseObjects calls GET /metamodel/enterprise-objects", async () => {
    mockGet.mockResolvedValue([sampleEnterpriseObject]);
    const result = await listEnterpriseObjects();
    expect(mockGet).toHaveBeenCalledWith("/metamodel/enterprise-objects");
    expect(result).toEqual([sampleEnterpriseObject]);
  });

  it("listEnterpriseObjects(true) includes hidden rows", async () => {
    mockGet.mockResolvedValue([sampleEnterpriseObject]);
    await listEnterpriseObjects(true);
    expect(mockGet).toHaveBeenCalledWith("/metamodel/enterprise-objects?include_hidden=true");
  });

  it("createEnterpriseObject posts the body", async () => {
    mockPost.mockResolvedValue(sampleEnterpriseObject);
    const body = { key: "custom", name: "Custom" };
    const result = await createEnterpriseObject(body);
    expect(mockPost).toHaveBeenCalledWith("/metamodel/enterprise-objects", body);
    expect(result).toEqual(sampleEnterpriseObject);
  });

  it("updateEnterpriseObject patches by key", async () => {
    mockPatch.mockResolvedValue(sampleEnterpriseObject);
    const body = { name: "Renamed" };
    const result = await updateEnterpriseObject("capability", body);
    expect(mockPatch).toHaveBeenCalledWith("/metamodel/enterprise-objects/capability", body);
    expect(result).toEqual(sampleEnterpriseObject);
  });

  it("addCardMapping posts card_type_key and defaults card_subtype_key to null", async () => {
    const mapping = sampleEnterpriseObject.card_mappings[0];
    mockPost.mockResolvedValue(mapping);
    const result = await addCardMapping("capability", "Application");
    expect(mockPost).toHaveBeenCalledWith("/metamodel/enterprise-objects/capability/card-mappings", {
      card_type_key: "Application",
      card_subtype_key: null,
    });
    expect(result).toEqual(mapping);
  });

  it("addCardMapping forwards an explicit card_subtype_key", async () => {
    mockPost.mockResolvedValue(sampleEnterpriseObject.card_mappings[0]);
    await addCardMapping("capability", "Application", "Microservice");
    expect(mockPost).toHaveBeenCalledWith("/metamodel/enterprise-objects/capability/card-mappings", {
      card_type_key: "Application",
      card_subtype_key: "Microservice",
    });
  });

  it("removeCardMapping calls DELETE with key and mapping id", async () => {
    mockDelete.mockResolvedValue(undefined);
    await removeCardMapping("capability", "m1");
    expect(mockDelete).toHaveBeenCalledWith(
      "/metamodel/enterprise-objects/capability/card-mappings/m1",
    );
  });
});
