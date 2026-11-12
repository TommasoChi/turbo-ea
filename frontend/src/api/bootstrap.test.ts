/**
 * `primeBootstrap` pushes `/settings/bootstrap` into the per-hook singleton
 * caches. These tests cover the retention windows the Audit log reads, and
 * the value-chain / archimate feature flags; each test re-imports fresh
 * modules because both the primer and the hooks memoise at module level.
 */
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
const ARCHIMATE_PATH = "/settings/archimate-enabled";
const AUDIT_LOG_RETENTION_PATH = "/settings/audit-log-retention-days";

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
  gamification_enabled: false,
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
  const archimate = await import("@/hooks/useArchimateEnabled");
  const auditLog = await import("@/hooks/useAuditLogRetentionDays");
  return { ...bootstrap, ...vc, ...archimate, ...auditLog };
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

describe("primeBootstrap — archimate", () => {
  it("primes the archimate flag so a fresh hook makes no request of its own", async () => {
    mockApi.on("get", BOOTSTRAP, { ...BODY, archimate_enabled: true });
    const { primeBootstrap, resetBootstrap, useArchimateEnabled } = await load();
    resetBootstrap();
    await primeBootstrap();
    const { result } = renderHook(() => useArchimateEnabled());
    expect(result.current.archimateLoaded).toBe(true);
    expect(result.current.archimateEnabled).toBe(true);
    expect(mockApi.callsOf("get", ARCHIMATE_PATH)).toHaveLength(0);
  });

  it("leaves the cache untouched when the body has no archimate_enabled", async () => {
    mockApi.on("get", BOOTSTRAP, BODY);
    mockApi.on("get", ARCHIMATE_PATH, { enabled: true });
    const { primeBootstrap, resetBootstrap, useArchimateEnabled } = await load();
    resetBootstrap();
    await primeBootstrap();
    const { result } = renderHook(() => useArchimateEnabled());
    await waitFor(() => expect(result.current.archimateEnabled).toBe(true));
    expect(mockApi.callsOf("get", ARCHIMATE_PATH)).toHaveLength(1);
  });
});

describe("primeBootstrap — audit-log retention", () => {
  it("primes both retention windows from one bootstrap read", async () => {
    mockApi.on("get", BOOTSTRAP, {
      ...BODY,
      audit_log_retention_days: 180,
      mutation_batch_retention_days: 21,
    });
    const { primeBootstrap, resetBootstrap, useAuditLogRetentionDays } = await load();
    resetBootstrap();
    await primeBootstrap();

    // The hook is now primed: mounting it must not fetch its own endpoint.
    const { result } = renderHook(() => useAuditLogRetentionDays());
    expect(result.current.auditLogRetentionDays).toBe(180);
    expect(result.current.mutationBatchRetentionDays).toBe(21);
    expect(mockApi.callsOf("get", AUDIT_LOG_RETENTION_PATH)).toHaveLength(0);
  });

  it("keeps 0 (keep forever) rather than treating it as missing", async () => {
    mockApi.on("get", BOOTSTRAP, {
      ...BODY,
      audit_log_retention_days: 0,
      mutation_batch_retention_days: 15,
    });
    const { primeBootstrap, resetBootstrap, useAuditLogRetentionDays } = await load();
    resetBootstrap();
    await primeBootstrap();
    const { result } = renderHook(() => useAuditLogRetentionDays());
    expect(result.current.auditLogRetentionDays).toBe(0);
  });

  it("leaves the hook unprimed when an older backend sends neither field", async () => {
    mockApi.on("get", BOOTSTRAP, BODY);
    mockApi.on("get", AUDIT_LOG_RETENTION_PATH, { days: 99 });
    const { primeBootstrap, resetBootstrap, useAuditLogRetentionDays } = await load();
    resetBootstrap();
    await primeBootstrap();
    const { result } = renderHook(() => useAuditLogRetentionDays());
    // Not primed, so the hook falls back to its own endpoint.
    await waitFor(() => expect(result.current.auditLogRetentionDays).toBe(99));
    expect(mockApi.callsOf("get", AUDIT_LOG_RETENTION_PATH)).toHaveLength(1);
  });

  it("primes the batch window alone when only it is present", async () => {
    mockApi.on("get", BOOTSTRAP, { ...BODY, mutation_batch_retention_days: 3 });
    const { primeBootstrap, resetBootstrap, useAuditLogRetentionDays } = await load();
    resetBootstrap();
    await primeBootstrap();
    const { result } = renderHook(() => useAuditLogRetentionDays());
    expect(result.current.mutationBatchRetentionDays).toBe(3);
    expect(result.current.auditLogRetentionDays).toBe(365);
  });

  it("a failed bootstrap read is swallowed and leaves the cache empty", async () => {
    mockApi.fail("get", BOOTSTRAP);
    const { primeBootstrap, resetBootstrap } = await load();
    resetBootstrap();
    await expect(primeBootstrap()).resolves.toBeUndefined();

    // A later route for the same matcher wins (most recently added checked
    // first), so this overrides the failure above without needing a reset.
    mockApi.on("get", BOOTSTRAP, {
      ...BODY,
      audit_log_retention_days: 12,
      mutation_batch_retention_days: 4,
    });
    // Not marked primed, so a second call reads again.
    await primeBootstrap();
    expect(mockApi.callsOf("get", BOOTSTRAP)).toHaveLength(2);
  });
});

describe("primeBootstrap — card type categories", () => {
  it("primes the category registry so the hook does not fetch", async () => {
    const boot = await import("./bootstrap");
    vi.mocked(api.get).mockResolvedValueOnce({
      ...BODY,
      card_type_categories: [
        { id: "2", key: "B", label: "B", color: "#222222", sort_order: 1, built_in: false, translations: {} },
        { id: "1", key: "A", label: "A", color: "#111111", sort_order: 0, built_in: true, translations: {} },
      ],
    });
    await boot.primeBootstrap();
    const { renderHook } = await import("@testing-library/react");
    const { useCardTypeCategories } = await import("@/hooks/useCardTypeCategories");
    const { result } = renderHook(() => useCardTypeCategories());
    expect(result.current.loaded).toBe(true);
    expect(result.current.categories.map((c) => c.key)).toEqual(["A", "B"]);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("leaves the hook to fetch when an older backend sends no registry", async () => {
    const boot = await import("./bootstrap");
    vi.mocked(api.get).mockResolvedValueOnce({ ...BODY });
    await boot.primeBootstrap();
    vi.mocked(api.get).mockResolvedValueOnce([]);
    const { renderHook, waitFor } = await import("@testing-library/react");
    const { useCardTypeCategories } = await import("@/hooks/useCardTypeCategories");
    const { result } = renderHook(() => useCardTypeCategories());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(api.get).toHaveBeenLastCalledWith("/metamodel/categories");
  });
});

describe("primeBootstrap — gamified data quality", () => {
  it("primes the toggle on so the hook never fetches its own endpoint", async () => {
    const boot = await import("./bootstrap");
    vi.mocked(api.get).mockResolvedValueOnce({ ...BODY, gamification_enabled: true });
    await boot.primeBootstrap();

    const { renderHook } = await import("@testing-library/react");
    const { useGamificationEnabled } = await import("@/hooks/useGamificationEnabled");
    const { result } = renderHook(() => useGamificationEnabled());
    expect(result.current).toBe(true);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("primes the toggle off when the backend says false", async () => {
    const boot = await import("./bootstrap");
    vi.mocked(api.get).mockResolvedValueOnce({ ...BODY, gamification_enabled: false });
    await boot.primeBootstrap();

    const { renderHook } = await import("@testing-library/react");
    const { useGamificationEnabled } = await import("@/hooks/useGamificationEnabled");
    const { result } = renderHook(() => useGamificationEnabled());
    expect(result.current).toBe(false);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("treats a backend without the key as off, still without a second fetch", async () => {
    const boot = await import("./bootstrap");
    const legacy: Record<string, unknown> = { ...BODY };
    delete legacy.gamification_enabled;
    vi.mocked(api.get).mockResolvedValueOnce(legacy);
    await boot.primeBootstrap();

    const { renderHook } = await import("@testing-library/react");
    const { useGamificationEnabled } = await import("@/hooks/useGamificationEnabled");
    const { result } = renderHook(() => useGamificationEnabled());
    expect(result.current).toBe(false);
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});

const PHASE_HELP_PATH = "/settings/lifecycle-phase-help";

describe("primeBootstrap — lifecycle phase help", () => {
  it("primes the phase help so the hook does not fetch", async () => {
    mockApi.on("get", BOOTSTRAP, {
      ...BODY,
      lifecycle_phase_help: { phaseOut: { en: "Being replaced." } },
    });
    const { primeBootstrap, resetBootstrap } = await load();
    resetBootstrap();
    await primeBootstrap();
    const { useLifecyclePhaseHelp } = await import("@/hooks/useLifecyclePhaseHelp");
    const { result } = renderHook(() => useLifecyclePhaseHelp());
    expect(result.current.help).toEqual({ phaseOut: { en: "Being replaced." } });
    expect(mockApi.callsOf("get", PHASE_HELP_PATH)).toHaveLength(0);
  });

  it("leaves the hook to fetch when an older backend sends no phase help", async () => {
    mockApi.on("get", BOOTSTRAP, BODY);
    mockApi.on("get", PHASE_HELP_PATH, { phases: { plan: { en: "An idea." } } });
    const { primeBootstrap, resetBootstrap } = await load();
    resetBootstrap();
    await primeBootstrap();
    const { useLifecyclePhaseHelp } = await import("@/hooks/useLifecyclePhaseHelp");
    const { result } = renderHook(() => useLifecyclePhaseHelp());
    await waitFor(() => expect(result.current.help).toEqual({ plan: { en: "An idea." } }));
    expect(mockApi.callsOf("get", PHASE_HELP_PATH)).toHaveLength(1);
  });

  it("does not prime from a malformed value", async () => {
    mockApi.on("get", BOOTSTRAP, { ...BODY, lifecycle_phase_help: ["plan"] });
    mockApi.on("get", PHASE_HELP_PATH, { phases: {} });
    const { primeBootstrap, resetBootstrap } = await load();
    resetBootstrap();
    await primeBootstrap();
    const { useLifecyclePhaseHelp } = await import("@/hooks/useLifecyclePhaseHelp");
    renderHook(() => useLifecyclePhaseHelp());
    await waitFor(() => expect(mockApi.callsOf("get", PHASE_HELP_PATH)).toHaveLength(1));
  });
});

describe("primeBootstrap — lifecycle phase help guard", () => {
  // The hook normalises whatever it is handed, so these tests mock it and
  // assert the guard itself: only a plain object reaches the invalidator.
  async function primeWith(extra: Record<string, unknown>) {
    vi.resetModules();
    const invalidate = vi.fn();
    vi.doMock("@/hooks/useLifecyclePhaseHelp", () => ({
      invalidateLifecyclePhaseHelp: invalidate,
    }));
    mockApi.on("get", BOOTSTRAP, { ...BODY, ...extra });
    const boot = await import("./bootstrap");
    boot.resetBootstrap();
    await boot.primeBootstrap();
    vi.doUnmock("@/hooks/useLifecyclePhaseHelp");
    return invalidate;
  }

  it.each([
    ["null", { lifecycle_phase_help: null }],
    ["an array", { lifecycle_phase_help: ["plan"] }],
    ["absent", {}],
    ["a string", { lifecycle_phase_help: "plan" }],
  ])("does not call the invalidator when the value is %s", async (_label, extra) => {
    const invalidate = await primeWith(extra);
    expect(mockApi.callsOf("get", BOOTSTRAP)).toHaveLength(1);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("calls the invalidator with a plain object", async () => {
    const help = { plan: { en: "An idea." } };
    const invalidate = await primeWith({ lifecycle_phase_help: help });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith(help);
  });
});
