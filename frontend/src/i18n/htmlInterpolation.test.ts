/**
 * i18next runs with `escapeValue: false` (React escapes what it renders), so a
 * translation rendered through `dangerouslySetInnerHTML` would put a card, role
 * or field name into the DOM as markup. Every `t()` inside such an expression
 * that interpolates text must therefore escape its own values:
 * `interpolation: { escapeValue: true }` (the translation's own <strong> stays;
 * the values do not become tags). A call that interpolates only numbers
 * (`count`, `cards`) cannot carry markup and is left alone.
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

  /** Each `t(…)` call in the expression, parentheses balanced. */
  function tCalls(expr: string): string[] {
    const calls: string[] = [];
    for (const m of expr.matchAll(/\bt\(/g)) {
      let depth = 0;
      let end = m.index! + 1;
      for (; end < expr.length; end += 1) {
        if (expr[end] === "(") depth += 1;
        if (expr[end] === ")" && --depth === 0) break;
      }
      calls.push(expr.slice(m.index!, end + 1));
    }
    return calls;
  }

  const NUMERIC_ONLY = new Set(["count", "cards"]);
  function carriesText(call: string): boolean {
    const withoutStrings = call.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    const names = [...withoutStrings.matchAll(/\b(\w+)\s*:/g)].map((m) => m[1]);
    return names.some((n) => !NUMERIC_ONLY.has(n));
  }

  it("every t() rendered as HTML with a text value escapes it", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      for (const expr of htmlExpressions(fs.readFileSync(file, "utf8"))) {
        for (const call of tCalls(expr)) {
          if (carriesText(call) && !/escapeValue:\s*true/.test(call)) {
            offenders.push(`${path.relative(SRC, file)}: ${call.slice(0, 80)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
