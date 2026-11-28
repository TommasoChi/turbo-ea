import { describe, expect, it } from "vitest";

import { isDisposableTarget } from "./disposable-target";

describe("isDisposableTarget", () => {
  it.each([
    "https://localhost:9443",
    "https://localhost:18443",
    "http://localhost:8000",
    "http://localhost:5173",
    "http://localhost:4173",
    "http://localhost:8001",
    "https://localhost:9444",
    "http://host.docker.internal:8920",
    "http://localhost:8930",
    "http://127.0.0.1:18920",
    "http://localhost:18931",
    "http://localhost",
    "https://localhost",
  ])("refuses %s with the flag", (url) => {
    const r = isDisposableTarget({ E2E_BASE_URL: url, E2E_PML_DISPOSABLE: "1" });
    expect(r.ok).toBe(false);
    expect(r.reason).not.toBe("");
  });

  it("accepts another port only when E2E_HOST_PORT names it", () => {
    const env = { E2E_BASE_URL: "http://localhost:18931", E2E_PML_DISPOSABLE: "1" };
    expect(isDisposableTarget({ ...env, E2E_HOST_PORT: "18931" }).ok).toBe(true);
    expect(isDisposableTarget({ ...env, E2E_HOST_PORT: "18930" }).ok).toBe(false);
  });

  it.each(["8920", "9443", "80", "70000", "abc", ""])("refuses a reserved or invalid E2E_HOST_PORT %s", (port) => {
    const url = `http://localhost:${port || "18930"}`;
    expect(isDisposableTarget({ E2E_BASE_URL: url, E2E_PML_DISPOSABLE: "1", E2E_HOST_PORT: port }).ok).toBe(false);
  });

  it.each(["http://user:pw@localhost:18930/", "http://localhost:18930/", "http://localhost:018930"])(
    "decides %s by the parsed port",
    (url) => {
      expect(isDisposableTarget({ E2E_BASE_URL: url, E2E_PML_DISPOSABLE: "1" }).ok).toBe(true);
    },
  );

  it("refuses userinfo that hides a protected port", () => {
    expect(isDisposableTarget({ E2E_BASE_URL: "http://localhost:18930@localhost:8920/", E2E_PML_DISPOSABLE: "1" }).ok).toBe(false);
  });

  it("refuses a URL without the flag", () => {
    expect(isDisposableTarget({ E2E_BASE_URL: "http://localhost:18930" }).ok).toBe(false);
  });

  it("refuses an unparsable URL", () => {
    expect(isDisposableTarget({ E2E_BASE_URL: "not a url", E2E_PML_DISPOSABLE: "1" }).ok).toBe(false);
  });

  it("refuses an unset URL without CI or the flag", () => {
    expect(isDisposableTarget({}).ok).toBe(false);
  });

  it.each(["false", "0", ""])("refuses an unset URL when CI is %j and no flag", (ci) => {
    expect(isDisposableTarget({ CI: ci }).ok).toBe(false);
  });

  it("allows an unset URL under CI or with the flag", () => {
    expect(isDisposableTarget({ CI: "1" }).ok).toBe(true);
    expect(isDisposableTarget({ CI: "true" }).ok).toBe(true);
    expect(isDisposableTarget({ E2E_PML_DISPOSABLE: "1" }).ok).toBe(true);
  });

  it.each(["https://staging.internal:18930", "http://192.168.1.10:18930", "http://localhost.evil.com:18930"])(
    "refuses the stack's port on a non-loopback host %s",
    (url) => {
      expect(isDisposableTarget({ E2E_BASE_URL: url, E2E_PML_DISPOSABLE: "1" }).ok).toBe(false);
    },
  );

  it.each(["http://127.0.0.1:18930", "http://host.docker.internal:18930", "http://localhost:18930", "http://LOCALHOST:18930"])(
    "accepts the loopback host %s on the stack's port",
    (url) => {
      expect(isDisposableTarget({ E2E_BASE_URL: url, E2E_PML_DISPOSABLE: "1" }).ok).toBe(true);
    },
  );

  it("allows the e2e stack's port with the flag", () => {
    expect(isDisposableTarget({ E2E_BASE_URL: "http://host.docker.internal:18930", E2E_PML_DISPOSABLE: "1" }).ok).toBe(true);
    expect(isDisposableTarget({ E2E_BASE_URL: "http://localhost:18930", E2E_PML_DISPOSABLE: "1" }).ok).toBe(true);
  });
});
