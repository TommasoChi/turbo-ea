import { getConfig } from "@testing-library/dom";
import { describe, expect, it } from "vitest";

describe("the mutation sandbox's wait budget", () => {
  it("is longer than the suite's default and only set by the sandbox setup file", async () => {
    // This file runs in the normal suite, where the base setup file's own
    // budget still holds (src/test/setup.ts raises the library default of
    // 1000ms to 10000ms for every test, not just the sandbox's)...
    expect(getConfig().asyncUtilTimeout).toBe(10_000);
    // ...and the sandbox setup file, run by vitest.stryker.config.ts, raises
    // it further still, since the instrumented single-thread run is slower yet.
    const sandbox = await import("./mutationSandbox");
    expect(sandbox.SANDBOX_ASYNC_UTIL_TIMEOUT_MS).toBe(20_000);
    expect(getConfig().asyncUtilTimeout).toBe(sandbox.SANDBOX_ASYNC_UTIL_TIMEOUT_MS);
  });
});
