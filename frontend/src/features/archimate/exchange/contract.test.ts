/**
 * Cross-stack contract: the editor's writer and the server's validator agree.
 *
 * `backend/tests/fixtures/archimate/frontend_model.xml` is `writeExchange(MODEL)`. This test pins the
 * file to the writer, byte for byte; `backend/tests/api/test_archimate_contract.py` then runs that same
 * file through `validate_exchange` and `POST /diagrams`. A change to the writer (or to the shared MODEL)
 * therefore fails here until the fixture is regenerated, and a writer output the server rejects fails
 * there. (`.gitattributes` pins the fixture to LF, so the comparison is byte-exact on every checkout.)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MODEL } from "@/test/archimateModel";
import { writeExchange } from "./writeExchange";

const FIXTURE = resolve(__dirname, "../../../../../backend/tests/fixtures/archimate/frontend_model.xml");
const REGENERATE = "UPDATE_ARCHIMATE_FIXTURE=1 npx vitest run src/features/archimate/exchange/contract.test.ts";
const update = process.env.UPDATE_ARCHIMATE_FIXTURE === "1";
/** CI always has the whole monorepo: there a missing fixture or an update run is a failure, never a skip. */
const ci = Boolean(process.env.CI);
const COMMAND =
  `Regenerate it from frontend/ with\n  ${REGENERATE}\n` +
  "(PowerShell: $env:UPDATE_ARCHIMATE_FIXTURE=1; npx vitest run src/features/archimate/exchange/contract.test.ts)\n" +
  "then review the diff and commit the fixture.";

describe("editor/server contract", () => {
  // Skipped only for a local shallow checkout without the backend tree; never in CI.
  it.skipIf(!ci && !update && !existsSync(FIXTURE))("writeExchange(MODEL) is exactly the backend fixture", () => {
    // An update run rewrites the file and then compares it with itself: it must not count as a pass in CI.
    expect(ci && update, "UPDATE_ARCHIMATE_FIXTURE must not be set in CI").toBe(false);
    const written = writeExchange(MODEL);
    if (update) writeFileSync(FIXTURE, written, "utf8");
    expect(existsSync(FIXTURE), `${FIXTURE} is missing. ${COMMAND}`).toBe(true);
    expect(
      written,
      `backend/tests/fixtures/archimate/frontend_model.xml is out of date with writeExchange(MODEL). ${COMMAND}`,
    ).toBe(readFileSync(FIXTURE, "utf8"));
  });
});
