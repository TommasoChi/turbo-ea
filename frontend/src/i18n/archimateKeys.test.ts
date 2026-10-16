import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { EXCHANGE_ERROR_CODES } from "@/features/archimate/exchange/readExchange";

/**
 * The `archimate` namespace is nested JSON (the other namespaces are flat), so the generic parity
 * suite in `i18n.test.ts` only sees its top-level groups. This file checks the leaves: every locale
 * has every English key, placeholders agree, plural categories are complete, and the two error-code
 * tables match the code that produces them.
 */

const LOCALES = ["en", "de", "fr", "es", "it", "pt", "zh", "ru", "da", "ar"] as const;

type Tree = { [key: string]: string | Tree };

const load = (locale: string): Tree =>
  JSON.parse(readFileSync(resolve(__dirname, "locales", locale, "archimate.json"), "utf-8"));

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === "string") out[prefix + k] = v;
    else Object.assign(out, flatten(v, `${prefix}${k}.`));
  }
  return out;
}

const PLURAL = /_(zero|one|two|few|many|other)$/;
const placeholders = (v: string) => [...v.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

const en = load("en");
const enFlat = flatten(en);

/** The 14 codes of the server validator plus `missing_identifier` (backend/app/services/archimate/validate.py). */
const SERVER_CODES = [
  "too_large", "xml_invalid", "dtd_forbidden", "wrong_root", "missing_identifier",
  "unknown_element_type", "unknown_relationship_type", "unknown_access_type", "duplicate_identifier",
  "dangling_source", "dangling_target", "relationship_not_allowed",
  "dangling_element_ref", "dangling_relationship_ref", "connection_endpoint_mismatch",
];

describe("English archimate namespace", () => {
  it("has only non-empty string leaves", () => {
    expect(Object.keys(enFlat).length).toBeGreaterThan(100);
    for (const [k, v] of Object.entries(enFlat)) expect(v, k).not.toBe("");
  });

  it("has the issueCount plural pair", () => {
    expect(typeof (en.validation as Tree).issueCount_one).toBe("string");
    expect(typeof (en.validation as Tree).issueCount_other).toBe("string");
  });

  it("has the engine's tools and directed labels", () => {
    expect(Object.keys(en.tools as Tree).sort()).toEqual(["hand", "lasso"]);
    expect((en.context as Tree).directed).toBe("Directed association");
  });

  it("errors.exchange has exactly the client reader's codes", () => {
    expect(Object.keys((en.errors as Tree).exchange as Tree).sort()).toEqual([...EXCHANGE_ERROR_CODES].sort());
  });

  it("validation.codes has exactly the server validator's 15 codes", () => {
    expect(SERVER_CODES).toHaveLength(15);
    expect(Object.keys((en.validation as Tree).codes as Tree).sort()).toEqual([...SERVER_CODES].sort());
  });
});

describe.each(LOCALES.filter((l) => l !== "en"))("archimate/%s", (locale) => {
  const flat = flatten(load(locale));
  const base = (k: string) => k.replace(PLURAL, "");
  const enBases = new Set(Object.keys(enFlat).map(base));
  // The brief's rule: every locale has _one/_other; ru and ar carry their full categories.
  const EXTRA: Record<string, string[]> = { ru: ["few", "many"], ar: ["zero", "two", "few", "many"] };
  const required = ["one", "other", ...(EXTRA[locale] ?? [])];

  it("has every English key and nothing else (plural suffixes aside)", () => {
    const own = new Set(Object.keys(flat).map(base));
    expect([...enBases].filter((k) => !own.has(k))).toEqual([]);
    expect([...own].filter((k) => !enBases.has(k))).toEqual([]);
  });

  it("has no empty value", () => {
    for (const [k, v] of Object.entries(flat)) expect(v, k).not.toBe("");
  });

  it("carries every plural category of the language for each plural key", () => {
    for (const k of Object.keys(enFlat).filter((x) => x.endsWith("_one"))) {
      for (const cat of required) expect(flat[`${base(k)}_${cat}`], `${base(k)}_${cat}`).toBeTypeOf("string");
    }
  });

  it("keeps the {{placeholders}} of every non-plural key and of _other", () => {
    for (const [k, v] of Object.entries(enFlat)) {
      if (PLURAL.test(k) && !k.endsWith("_other")) continue;
      expect(placeholders(flat[k]), k).toEqual(placeholders(v));
    }
  });

  it("is translated, not a copy of English", () => {
    const same = Object.keys(enFlat).filter((k) => flat[k] === enFlat[k]);
    expect(same.length).toBeLessThan(Object.keys(enFlat).length / 4);
  });
});
