import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describeSourceScan } from "@/test/sourceScan";

// The engine never calls the API: every card operation goes through the EditorBridge, so no engine file
// can create or delete a card (dropping from the palette creates none, deleting a shape deletes none).
describeSourceScan("engine isolation from the API", () => {
  const files = readdirSync(__dirname).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

  it("scans the engine's source files (not an empty directory)", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)("%s does not import from @/api/", (file) => {
    expect(readFileSync(resolve(__dirname, file), "utf-8")).not.toMatch(/@\/api\//);
  });
});
