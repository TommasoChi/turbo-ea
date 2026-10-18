// The mutation sandbox's wait budget for Testing Library's `findBy*` and
// `waitFor` (vitest.stryker.config.ts adds this file after the base setup).
//
// Stryker's initial test run executes the instrumented files on one thread
// with per-test coverage, several times slower than `vitest run`, and a
// correct `findByText` on a large page ran out of the default 1,000 ms there
// (`CardDetail.branches.test.tsx`, nightly run 18 of 2026-10-08) with no race
// anywhere: the element appeared, late. The normal suite keeps the base setup
// file's own budget (10,000 ms as of 2026-10-19, see src/test/setup.ts), so a
// render that slow there still fails a pull request; only the sandbox waits
// longer still, since the instrumented single-thread run is slower yet. A
// longer wait cannot hide a remount race — the element must still appear,
// and one that was found and then removed fails as before — so a test that
// still fails here has a race to fix (scripts/mutation/README.md, "A test
// that fails only in Stryker's initial run").
import { configure } from "@testing-library/dom";

export const SANDBOX_ASYNC_UTIL_TIMEOUT_MS = 20_000;

// The scripts/ tests run under `@vitest-environment node`; nothing waits on a
// DOM there, and the DOM library's configure must not run without one.
if (typeof window !== "undefined") {
  configure({ asyncUtilTimeout: SANDBOX_ASYNC_UTIL_TIMEOUT_MS });
}
