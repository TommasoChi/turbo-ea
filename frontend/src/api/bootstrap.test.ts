import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { api } from "@/api/client";
import { mockApi } from "@/test/apiMock";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useBpmEnabled", () => ({
  useBpmEnabled: () => ({ bpmEnabled: true, bpmLoaded: true }),
  invalidateBpmEnabled: vi.fn(),
}));

const BOOTSTRAP = "/settings/bootstrap";
const VC_PATH = "/settings/value-chain-enabled";

const BODY = {
  currency: "USD",
  date_format: "YYYY-MM-DD",
  app_title: "Turbo EA",
  navbar_bg: "#1976d2",
  navbar_fg: "#ffffff",
  bpm_enabled: true,
  ppm_enabled: true,
  turbolens_enabled: true,
  grc_enabled: true,
  sponsor_button_enabled: true,
  file_uploads_enabled: true,
  enabled_locales: ["en"],
  fiscal_year_start: 1,
  archive_retention_days: 30,
  bpm_row_order: [],
  show_principles_tab: true,
  compliance_regulations: [],
  resource_types: [],
  login_tagline: "",
  login_tagline_hidden: false,
  login_help_text: "",
  login_help_link: "",
  smtp_configured: false,
};

async function load() {
  const bootstrap = await import("./bootstrap");
  const vc = await import("@/hooks/useValueChainEnabled");
  return { ...bootstrap, ...vc };
}

beforeEach(() => {
  vi.resetModules();
  mockApi.reset();
  expect(api).toBe(mockApi.api);
});

describe("primeBootstrap — value chain", () => {
  it("primes the value-chain flag so a fresh hook makes no request of its own", async () => {
    mockApi.on("get", BOOTSTRAP, { ...BODY, value_chain_enabled: false });
    const { primeBootstrap, resetBootstrap, useValueChainEnabled } = await load();
    resetBootstrap();
    await primeBootstrap();
    const { result } = renderHook(() => useValueChainEnabled());
    expect(result.current.valueChainLoaded).toBe(true);
    expect(result.current.valueChainRawEnabled).toBe(false);
    expect(mockApi.callsOf("get", VC_PATH)).toHaveLength(0);
  });

  it("leaves the cache untouched when the body has no value_chain_enabled", async () => {
    mockApi.on("get", BOOTSTRAP, BODY);
    mockApi.on("get", VC_PATH, { enabled: false });
    const { primeBootstrap, resetBootstrap, useValueChainEnabled } = await load();
    resetBootstrap();
    await primeBootstrap();
    const { result } = renderHook(() => useValueChainEnabled());
    await waitFor(() => expect(result.current.valueChainRawEnabled).toBe(false));
    expect(mockApi.callsOf("get", VC_PATH)).toHaveLength(1);
  });
});
