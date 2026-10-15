import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import { api } from "@/api/client";
import { mockApi } from "@/test/apiMock";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
const bpm = vi.hoisted(() => ({ enabled: true, loaded: true }));
vi.mock("@/hooks/useBpmEnabled", () => ({
  useBpmEnabled: () => ({ bpmEnabled: bpm.enabled, bpmLoaded: bpm.loaded }),
}));

const PATH = "/settings/value-chain-enabled";

async function load() {
  return import("./useValueChainEnabled");
}

beforeEach(() => {
  vi.resetModules();
  mockApi.reset();
  bpm.enabled = true;
  bpm.loaded = true;
  expect(api).toBe(mockApi.api);
});

describe("useValueChainEnabled", () => {
  it("starts enabled and adopts the server value", async () => {
    mockApi.on("get", PATH, { enabled: false });
    const { useValueChainEnabled } = await load();
    const { result } = renderHook(() => useValueChainEnabled());
    expect(result.current.valueChainRawEnabled).toBe(true);
    await waitFor(() => expect(result.current.valueChainLoaded).toBe(true));
    expect(result.current.valueChainRawEnabled).toBe(false);
    expect(result.current.valueChainEnabled).toBe(false);
  });

  it("is off whenever BPM is off, but the raw flag keeps its own value", async () => {
    mockApi.on("get", PATH, { enabled: true });
    bpm.enabled = false;
    const { useValueChainEnabled } = await load();
    const { result } = renderHook(() => useValueChainEnabled());
    await waitFor(() => expect(result.current.valueChainLoaded).toBe(true));
    expect(result.current.valueChainRawEnabled).toBe(true);
    expect(result.current.valueChainEnabled).toBe(false);
  });

  it("is not loaded until BPM is loaded too", async () => {
    mockApi.on("get", PATH, { enabled: true });
    bpm.loaded = false;
    const { useValueChainEnabled } = await load();
    const { result } = renderHook(() => useValueChainEnabled());
    await waitFor(() => expect(mockApi.callsOf("get", PATH)).toHaveLength(1));
    expect(result.current.valueChainLoaded).toBe(false);
  });

  it("defaults to enabled when the request fails", async () => {
    mockApi.fail("get", PATH);
    const { useValueChainEnabled } = await load();
    const { result } = renderHook(() => useValueChainEnabled());
    await waitFor(() => expect(result.current.valueChainLoaded).toBe(true));
    expect(result.current.valueChainRawEnabled).toBe(true);
  });

  it("issues ONE request for several simultaneous mounts", async () => {
    mockApi.on("get", PATH, { enabled: true });
    const { useValueChainEnabled } = await load();
    renderHook(() => useValueChainEnabled());
    renderHook(() => useValueChainEnabled());
    renderHook(() => useValueChainEnabled());
    await waitFor(() => expect(mockApi.callsOf("get", PATH).length).toBeGreaterThan(0));
    expect(mockApi.callsOf("get", PATH)).toHaveLength(1);
  });

  it("invalidateValueChainEnabled primes the cache and notifies mounted hooks", async () => {
    const { useValueChainEnabled, invalidateValueChainEnabled } = await load();
    invalidateValueChainEnabled(false); // primed before mount: no request needed
    const { result } = renderHook(() => useValueChainEnabled());
    expect(result.current.valueChainLoaded).toBe(true);
    expect(result.current.valueChainRawEnabled).toBe(false);
    act(() => invalidateValueChainEnabled(true));
    expect(result.current.valueChainRawEnabled).toBe(true);
    expect(mockApi.callsOf("get", PATH)).toHaveLength(0);
  });

  it("invalidateValueChain() with no argument refetches", async () => {
    mockApi.on("get", PATH, { enabled: true });
    const { useValueChainEnabled, invalidateValueChainEnabled } = await load();
    invalidateValueChainEnabled(true);
    const { result } = renderHook(() => useValueChainEnabled());
    mockApi.on("get", PATH, { enabled: false });
    act(() => result.current.invalidateValueChain());
    await waitFor(() => expect(result.current.valueChainRawEnabled).toBe(false));
  });
});
