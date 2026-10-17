import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describeSourceScan } from "@/test/sourceScan";

// The engine never calls the API: every card operation goes through the EditorBridge, so no engine file
// can create or delete a card (dropping from the palette creates none, deleting a shape deletes none).
describeSourceScan("engine isolation from the API", () => {
  // Recursive: a file in a sub-folder of engine/ must not slip past the scan.
  const files = (readdirSync(__dirname, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .sort();

  // The api client by any spelling: the alias, or a relative path with an `api` segment
  // (`../../api/client`, `../api`), as a static import, a re-export or a dynamic import.
  const API_IMPORT =
    /(?:from\s*|import\s*\(\s*|import\s+|require\s*\(\s*)["'](?:@\/api(?:\/[^"']*)?|(?:\.{1,2}\/)+(?:[^"']*\/)?api(?:\/[^"']*)?)["']/;

  it("scans the engine's source files (not an empty directory)", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files).toEqual(expect.arrayContaining(["ArchimateEngine.ts", "EditorBridge.ts"]));
  });

  it.each(files)("%s does not import the api client", (file) => {
    expect(readFileSync(resolve(__dirname, file), "utf-8")).not.toMatch(API_IMPORT);
  });

  it("the pattern catches every spelling of an api import (and not look-alikes)", () => {
    for (const bad of [
      'import { api } from "@/api/client";',
      "import { api } from '@/api';",
      'import { api } from "../../api/client";',
      'import { api } from "../api";',
      'export { api } from "../../../api/client";',
      'const m = await import("../../api/client");',
      'import "@/api/client";',
    ]) {
      expect(bad).toMatch(API_IMPORT);
    }
    for (const ok of [
      'import { a } from "../taxonomy/elements";',
      'import { a } from "./apiary";',
      'import { a } from "../therapist/x";',
      'import type { Api } from "../exchange/exchangeModel";',
    ]) {
      expect(ok).not.toMatch(API_IMPORT);
    }
  });
});