/**
 * Decides whether the browser suite may write data. Plain TypeScript with no Playwright import so
 * Vitest can test it; `e2e/ppm-support.ts` (`requireDisposableStack`) is its only caller.
 */

/** Never a throwaway stack: the owner's instance, the VAPT stack, the docs stack. */
const PROTECTED_PORTS = new Set(["8920", "8930", "18920"]);

export interface DisposableTarget {
  ok: boolean;
  reason: string;
}

export function isDisposableTarget(env: Record<string, string | undefined>): DisposableTarget {
  const flag = env.E2E_PML_DISPOSABLE === "1";
  const baseUrl = env.E2E_BASE_URL;
  if (!baseUrl) {
    return env.CI || flag
      ? { ok: true, reason: "" }
      : {
          ok: false,
          reason:
            "E2E_BASE_URL is unset, so the suite would write into the dev backend on :8000; run it through scripts/e2e/docker-e2e.sh.",
        };
  }
  let port: string;
  try {
    const url = new URL(baseUrl);
    port = url.port || (url.protocol === "https:" ? "443" : "80");
  } catch {
    return { ok: false, reason: `E2E_BASE_URL "${baseUrl}" is not a URL.` };
  }
  if (PROTECTED_PORTS.has(port)) {
    return { ok: false, reason: `Port ${port} is not a throwaway stack: refusing to write there.` };
  }
  return flag
    ? { ok: true, reason: "" }
    : { ok: false, reason: "Set E2E_PML_DISPOSABLE=1 only for an isolated demo stack." };
}
