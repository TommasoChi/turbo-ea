/**
 * Decides whether the browser suite may write data. Plain TypeScript with no Playwright import so
 * Vitest can test it; `e2e/ppm-support.ts` (`requireDisposableStack`) is its only caller.
 */

const DEFAULT_E2E_PORT = 18930;

/** Mirrors FORBIDDEN_PORTS in scripts/e2e/docker-e2e.sh: other instances and the dev servers. */
const RESERVED_PORTS = new Set([8920, 8930, 5433, 9443, 9444, 18920, 18443, 8000, 8001, 4173, 5173]);

/** The stack is reached as localhost from the host and as host.docker.internal from the Playwright container. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "host.docker.internal"]);

/** The one port the e2e stack may listen on, or null when E2E_HOST_PORT is not a usable one. */
function stackPort(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_E2E_PORT;
  const port = /^\d{1,5}$/.test(raw) ? Number(raw) : Number.NaN;
  return port >= 1024 && port <= 65535 && !RESERVED_PORTS.has(port) ? port : null;
}

export interface DisposableTarget {
  ok: boolean;
  reason: string;
}

export function isDisposableTarget(env: Record<string, string | undefined>): DisposableTarget {
  const flag = env.E2E_PML_DISPOSABLE === "1";
  const baseUrl = env.E2E_BASE_URL;
  if (!baseUrl) {
    return env.CI === "true" || env.CI === "1" || flag
      ? { ok: true, reason: "" }
      : {
          ok: false,
          reason:
            "E2E_BASE_URL is unset, so the suite would write into the dev backend on :8000; run it through scripts/e2e/docker-e2e.sh.",
        };
  }
  let port: string;
  let hostname: string;
  try {
    ({ port, hostname } = new URL(baseUrl));
  } catch {
    return { ok: false, reason: `E2E_BASE_URL "${baseUrl}" is not a URL.` };
  }
  if (!LOOPBACK_HOSTS.has(hostname)) {
    return { ok: false, reason: `Host "${hostname}" is not the local e2e stack: refusing to write there.` };
  }
  const allowed = stackPort(env.E2E_HOST_PORT);
  if (allowed === null) {
    return { ok: false, reason: `E2E_HOST_PORT "${env.E2E_HOST_PORT}" is not a usable e2e stack port.` };
  }
  if (!port || Number(port) !== allowed) {
    return {
      ok: false,
      reason: `Port ${port || "(default)"} is not the e2e stack's port ${allowed}: refusing to write there.`,
    };
  }
  return flag
    ? { ok: true, reason: "" }
    : { ok: false, reason: "Set E2E_PML_DISPOSABLE=1 only for an isolated demo stack." };
}
