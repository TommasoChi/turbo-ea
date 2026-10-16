/**
 * Cross-stack contract: the editor's writer and the server's validator agree.
 *
 * `backend/tests/fixtures/archimate/frontend_model.xml` is `writeExchange(MODEL)`. This test pins the
 * file to the writer, byte for byte; `backend/tests/api/test_archimate_contract.py` then runs that same
 * file through `validate_exchange` and `POST /diagrams`. A change to the writer (or to the shared MODEL)
 * therefore fails here until the fixture is regenerated, and a writer output the server rejects fails
 * there.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MODEL } from "@/test/archimateModel";
import { writeExchange } from "./writeExchange";

const FIXTURE = resolve(__dirname, "../../../../../backend/tests/fixtures/archimate/frontend_model.xml");
const REGENERATE = "UPDATE_ARCHIMATE_FIXTURE=1 npx vitest run src/features/archimate/exchange/contract.test.ts";
const update = process.env.UPDATE_ARCHIMATE_FIXTURE === "1";

describe("editor/server contract", () => {
  // Skipped (not failed) where the backend tree is not checked out next to the frontend.
  it.skipIf(!update && !existsSync(FIXTURE))("writeExchange(MODEL) is exactly the backend fixture", () => {
    const written = writeExchange(MODEL);
    if (update) writeFileSync(FIXTURE, written, "utf8");
    // A Windows checkout with core.autocrlf stores the file with CRLF; the writer only ever emits LF.
    const stored = readFileSync(FIXTURE, "utf8").replaceAll("\r\n", "\n");
    expect(
      written,
      "backend/tests/fixtures/archimate/frontend_model.xml is out of date with writeExchange(MODEL). " +
        `Regenerate it from frontend/ with\n  ${REGENERATE}\n` +
        "(PowerShell: $env:UPDATE_ARCHIMATE_FIXTURE=1; npx vitest run src/features/archimate/exchange/contract.test.ts)\n" +
        "then review the diff and commit the fixture.",
    ).toBe(stored);
  });
});
