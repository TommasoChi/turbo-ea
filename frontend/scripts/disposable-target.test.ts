import { describe, expect, it } from "vitest";

import { isDisposableTarget } from "./disposable-target";

describe("isDisposableTarget", () => {
  it("refuses the owner's instance even with the flag", () => {
    const r = isDisposableTarget({ E2E_BASE_URL: "http://host.docker.internal:8920", E2E_PML_DISPOSABLE: "1" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("8920");
  });

  it.each(["http://localhost:8930", "http://127.0.0.1:18920"])("refuses %s with the flag", (url) => {
    expect(isDisposableTarget({ E2E_BASE_URL: url, E2E_PML_DISPOSABLE: "1" }).ok).toBe(false);
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

  it("allows an unset URL under CI or with the flag", () => {
    expect(isDisposableTarget({ CI: "1" }).ok).toBe(true);
    expect(isDisposableTarget({ E2E_PML_DISPOSABLE: "1" }).ok).toBe(true);
  });

  it("allows the e2e stack's port with the flag", () => {
    expect(isDisposableTarget({ E2E_BASE_URL: "http://host.docker.internal:18930", E2E_PML_DISPOSABLE: "1" }).ok).toBe(true);
    expect(isDisposableTarget({ E2E_BASE_URL: "http://localhost:18930", E2E_PML_DISPOSABLE: "1" }).ok).toBe(true);
  });
});
