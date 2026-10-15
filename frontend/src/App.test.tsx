import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * End-to-end pin for where an unauthenticated deep link lands.
 *
 * The whole deep-link feature rests on a contract that was previously
 * untested: `App`'s unauthenticated catch-all renders `LoginPage` *in place*,
 * without navigating, so the URL the user asked for survives an email/password
 * sign-in. These tests fail if anyone turns that catch-all into a redirect.
 */

vi.mock("@/api/client", () => ({
  api: { get: vi.fn().mockResolvedValue([]), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  auth: {
    login: vi.fn(),
    register: vi.fn(),
    me: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    ssoConfig: vi.fn().mockResolvedValue({ enabled: false }),
    ssoCallback: vi.fn(),
    setPassword: vi.fn(),
    proxySession: vi.fn().mockRejectedValue(new Error("no proxy")),
  },
  setToken: vi.fn(),
  clearToken: vi.fn(),
  hasToken: vi.fn(),
  setAuthenticated: vi.fn(),
  isAuthenticated: vi.fn().mockReturnValue(false),
  getRaw: vi.fn(),
  upload: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

vi.mock("@/api/bootstrap", () => ({
  primeBootstrap: vi.fn().mockResolvedValue(undefined),
  resetBootstrap: vi.fn(),
}));

// Module flags are irrelevant to most tests here — permission gating is what is
// under test, and the real ModuleGate would otherwise sit on its loading
// spinner forever. The value-chain tests flip `gate.real` to exercise it.
const gate = vi.hoisted(() => ({ real: false }));
vi.mock("@/components/ModuleGate", async () => {
  const actual = await vi.importActual<typeof import("@/components/ModuleGate")>(
    "@/components/ModuleGate",
  );
  const Real = actual.default;
  return {
    default: (props: React.ComponentProps<typeof Real>) =>
      gate.real ? <Real {...props} /> : <>{props.children}</>,
  };
});
vi.mock("@/hooks/useValueChainEnabled", () =>
  import("@/test/hooks").then((m) => m.useValueChainEnabledModule()),
);

// Stub the lazy pages these tests reach, so AG Grid / Recharts stay out of
// the suite. The value-chain stubs record mounting: a gated page must never
// mount (it would fire its API calls on mount).
const mounted = vi.hoisted(() => ({ valueChain: vi.fn(), valueStream: vi.fn() }));
vi.mock("@/features/dashboard/Dashboard", () => ({
  default: () => <div>dashboard page</div>,
}));
vi.mock("@/features/ppm/PpmHome", () => ({
  default: () => <div>ppm page</div>,
}));
vi.mock("@/features/value-chain/ValueChainPage", () => ({
  default: () => {
    mounted.valueChain();
    return <div>value chain page</div>;
  },
}));
vi.mock("@/features/value-chain/ValueStreamPage", () => ({
  default: () => {
    mounted.valueStream();
    return <div>value stream page</div>;
  },
}));

import { api, auth } from "@/api/client";
import { hookState } from "@/test/hooks";

import App from "./App";

const MEMBER = {
  id: "u1",
  email: "member@example.com",
  display_name: "Member",
  role: "member",
  is_active: true,
  permissions: { "ppm.view": true, "inventory.view": true },
};

const NO_PPM = { ...MEMBER, permissions: { "inventory.view": true } };

beforeEach(() => {
  vi.clearAllMocks();
  gate.real = false;
  hookState.reset();
  sessionStorage.clear();
  window.history.pushState({}, "", "/ppm");
});

describe("deep link through sign-in", () => {
  it("shows the login form at the requested URL, without redirecting", async () => {
    vi.mocked(auth.me).mockRejectedValue(new Error("Unauthorized"));

    render(<App />);

    expect(await screen.findByLabelText(/email/i)).toBeInTheDocument();
    expect(window.location.pathname).toBe("/ppm");
  });

  it("lands on the requested page after an email/password sign-in", async () => {
    vi.mocked(auth.me).mockRejectedValueOnce(new Error("Unauthorized"));
    const user = userEvent.setup();

    render(<App />);

    await screen.findByLabelText(/email/i);

    vi.mocked(auth.login).mockResolvedValue({ access_token: "tok" });
    vi.mocked(auth.me).mockResolvedValue(MEMBER);

    await user.type(screen.getByLabelText(/email/i), "member@example.com");
    await user.type(screen.getByLabelText(/password/i), "hunter2");
    await user.click(screen.getByRole("button", { name: /^login$/i }));

    expect(await screen.findByText("ppm page")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/ppm");
  });

  it("shows Access denied at that URL when the role cannot open the page", async () => {
    vi.mocked(auth.me).mockRejectedValueOnce(new Error("Unauthorized"));
    const user = userEvent.setup();

    render(<App />);

    await screen.findByLabelText(/email/i);

    vi.mocked(auth.login).mockResolvedValue({ access_token: "tok" });
    vi.mocked(auth.me).mockResolvedValue(NO_PPM);

    await user.type(screen.getByLabelText(/email/i), "member@example.com");
    await user.type(screen.getByLabelText(/password/i), "hunter2");
    await user.click(screen.getByRole("button", { name: /^login$/i }));

    expect(await screen.findByText("Access denied")).toBeInTheDocument();
    expect(screen.queryByText("ppm page")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/ppm");
  });

  describe("value chain routes", () => {
    const VC_USER = { ...MEMBER, permissions: { "bpm.value_chain": true } };
    const apiPaths = () => vi.mocked(api.get).mock.calls.map((c) => String(c[0]));

    beforeEach(() => {
      gate.real = true;
    });

    it.each([
      ["/value-chain", "value chain page"],
      ["/value-chain/value-stream", "value stream page"],
    ])("renders %s for bpm.value_chain with the module on", async (path, text) => {
      window.history.pushState({}, "", path);
      vi.mocked(auth.me).mockResolvedValue(VC_USER);

      render(<App />);

      expect(await screen.findByText(text)).toBeInTheDocument();
    });

    it("shows the disabled card with the BPM settings link and never mounts the page when the module is off", async () => {
      hookState.valueChain = {
        valueChainEnabled: false,
        valueChainRawEnabled: false,
        valueChainLoaded: true,
      };
      window.history.pushState({}, "", "/value-chain");
      vi.mocked(auth.me).mockResolvedValue(VC_USER);
      const user = userEvent.setup();

      render(<App />);

      const open = await screen.findByRole("button", { name: /Open settings/ });
      expect(mounted.valueChain).not.toHaveBeenCalled();
      expect(apiPaths().filter((p) => p.includes("value-chain"))).toEqual([]);

      await user.click(open);
      await waitFor(() => {
        expect(window.location.pathname + window.location.search).toBe("/admin/settings?tab=bpm");
      });
      expect(mounted.valueChain).not.toHaveBeenCalled();
    });

    it("shows Access denied to a user with bpm.view but not bpm.value_chain, and the page never mounts", async () => {
      window.history.pushState({}, "", "/value-chain/value-stream");
      vi.mocked(auth.me).mockResolvedValue({ ...MEMBER, permissions: { "bpm.view": true } });

      render(<App />);

      expect(await screen.findByText("Access denied")).toBeInTheDocument();
      expect(mounted.valueStream).not.toHaveBeenCalled();
    });

    it("lets permission outrank the module flag: Access denied, not the disabled card, when both fail", async () => {
      hookState.valueChain = {
        valueChainEnabled: false,
        valueChainRawEnabled: false,
        valueChainLoaded: true,
      };
      window.history.pushState({}, "", "/value-chain");
      vi.mocked(auth.me).mockResolvedValue({ ...MEMBER, permissions: { "bpm.view": true } });

      render(<App />);

      expect(await screen.findByText("Access denied")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Open settings/ })).not.toBeInTheDocument();
      expect(mounted.valueChain).not.toHaveBeenCalled();
    });
  });

  it("still renders an ungated page for a role with nothing granted", async () => {
    window.history.pushState({}, "", "/");
    vi.mocked(auth.me).mockResolvedValue({ ...MEMBER, permissions: {} });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("dashboard page")).toBeInTheDocument();
    });
  });
});
