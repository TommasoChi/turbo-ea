/**
 * i18next runs with `escapeValue: false` (React escapes what it renders), so a
 * translation rendered through `dangerouslySetInnerHTML` would put a card, role
 * or field name into the DOM as markup. Every `t()` inside such an expression
 * must therefore escape its own values: `interpolation: { escapeValue: true }`
 * (the translation's own <strong> stays; the values do not become tags).
 */
import fs from "node:fs";
import path from "node:path";
import { describeSourceScan } from "@/test/sourceScan";

describeSourceScan("dangerouslySetInnerHTML translations escape their values", () => {
  const SRC = path.resolve(__dirname, "..");

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full, out);
      } else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  /** The `{ … }` expression after each `dangerouslySetInnerHTML=`, braces balanced. */
  function htmlExpressions(source: string): string[] {
    const found: string[] = [];
    let from = source.indexOf("dangerouslySetInnerHTML=");
    while (from !== -1) {
      const open = source.indexOf("{", from);
      let depth = 0;
      let end = open;
      for (; end < source.length; end += 1) {
        if (source[end] === "{") depth += 1;
        if (source[end] === "}" && --depth === 0) break;
      }
      found.push(source.slice(open, end + 1));
      from = source.indexOf("dangerouslySetInnerHTML=", end);
    }
    return found;
  }

  it("every t() rendered as HTML escapes its values", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      for (const expr of htmlExpressions(fs.readFileSync(file, "utf8"))) {
        const calls = expr.match(/\bt\(/g)?.length ?? 0;
        const escaped = expr.match(/escapeValue:\s*true/g)?.length ?? 0;
        if (calls > escaped) offenders.push(`${path.relative(SRC, file)}: ${expr.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
