import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import { api } from "@/api/client";
import { mockApi } from "@/test/apiMock";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

const PATH = "/settings/archimate-enabled";

async function load() {
  return import("./useArchimateEnabled");
}

beforeEach(() => {
  vi.resetModules();
  mockApi.reset();
  expect(api).toBe(mockApi.api);
});

describe("useArchimateEnabled", () => {
  it("starts disabled and adopts the server value", async () => {
    mockApi.on("get", PATH, { enabled: true });
    const { useArchimateEnabled } = await load();
    const { result } = renderHook(() => useArchimateEnabled());
    expect(result.current.archimateEnabled).toBe(false);
    expect(result.current.archimateLoaded).toBe(false);
    await waitFor(() => expect(result.current.archimateLoaded).toBe(true));
    expect(result.current.archimateEnabled).toBe(true);
  });

  it("stays disabled, and loaded, when the request fails", async () => {
    mockApi.fail("get", PATH);
    const { useArchimateEnabled } = await load();
    const { result } = renderHook(() => useArchimateEnabled());
    await waitFor(() => expect(result.current.archimateLoaded).toBe(true));
    expect(result.current.archimateEnabled).toBe(false);
  });

  it("issues ONE request for several simultaneous mounts", async () => {
    mockApi.on("get", PATH, { enabled: true });
    const { useArchimateEnabled } = await load();
    renderHook(() => useArchimateEnabled());
    renderHook(() => useArchimateEnabled());
    renderHook(() => useArchimateEnabled());
    await waitFor(() => expect(mockApi.callsOf("get", PATH).length).toBeGreaterThan(0));
    expect(mockApi.callsOf("get", PATH)).toHaveLength(1);
  });

  it("invalidateArchimateEnabled primes the cache and notifies mounted hooks", async () => {
    const { useArchimateEnabled, invalidateArchimateEnabled } = await load();
    invalidateArchimateEnabled(true); // primed before mount: no request needed
    const { result } = renderHook(() => useArchimateEnabled());
    expect(result.current.archimateLoaded).toBe(true);
    expect(result.current.archimateEnabled).toBe(true);
    act(() => invalidateArchimateEnabled(false));
    expect(result.current.archimateEnabled).toBe(false);
    expect(mockApi.callsOf("get", PATH)).toHaveLength(0);
  });

  it("invalidateArchimate() with no argument refetches", async () => {
    mockApi.on("get", PATH, { enabled: false });
    const { useArchimateEnabled, invalidateArchimateEnabled } = await load();
    invalidateArchimateEnabled(false);
    const { result } = renderHook(() => useArchimateEnabled());
    mockApi.on("get", PATH, { enabled: true });
    act(() => result.current.invalidateArchimate());
    await waitFor(() => expect(result.current.archimateEnabled).toBe(true));
  });
});
