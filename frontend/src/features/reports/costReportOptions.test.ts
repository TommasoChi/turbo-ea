import { describe, it, expect } from "vitest";
import {
  COMBINED_KEY,
  typeKeysOf,
  typeParam,
  commonCostFields,
  commonGroupableFields,
  relationGroupOptions,
} from "./costReportOptions";
import type { FieldDef, RelationType } from "@/types";

const f = (key: string, type = "text", extra: Partial<FieldDef> = {}) =>
  ({ key, label: key, type, ...extra }) as FieldDef;
const sel = (key: string) =>
  f(key, "single_select", { options: [{ key: "a", label: "A" }] });
const schema = (...fields: FieldDef[]) => [{ fields }];

const rt = (
  key: string,
  source: string,
  target: string,
  cardinality: RelationType["cardinality"],
  extra: Partial<RelationType> = {},
) =>
  ({
    key,
    label: key,
    source_type_key: source,
    target_type_key: target,
    cardinality,
    is_hidden: false,
    ...extra,
  }) as RelationType;

describe("type selection", () => {
  it("splits and joins the combined key", () => {
    expect(COMBINED_KEY).toBe("Application+ITComponent");
    expect(typeKeysOf(COMBINED_KEY)).toEqual(["Application", "ITComponent"]);
    expect(typeKeysOf("Initiative")).toEqual(["Initiative"]);
    expect(typeParam(COMBINED_KEY)).toBe("Application,ITComponent");
  });
});

describe("commonCostFields", () => {
  it("keeps only cost fields present in every schema", () => {
    const a = schema(f("c1", "cost"), f("c2", "cost"), f("x"));
    const b = schema(f("c2", "cost"), f("c3", "cost"));
    expect(commonCostFields([a, b]).map((x) => x.key)).toEqual(["c2"]);
    expect(commonCostFields([a]).map((x) => x.key)).toEqual(["c1", "c2"]);
    expect(commonCostFields([])).toEqual([]);
  });
});

describe("commonGroupableFields", () => {
  it("keeps single-valued fields with the same key in every schema", () => {
    const a = schema(sel("s1"), sel("s2"), f("m", "multiple_select", { options: [{ key: "a", label: "A" }] }));
    const b = schema(sel("s2"), f("m", "multiple_select", { options: [{ key: "a", label: "A" }] }));
    expect(commonGroupableFields([a, b]).map((x) => x.key)).toEqual(["s2"]);
  });
});

describe("relationGroupOptions", () => {
  const label = (r: RelationType) => `L:${r.key}`;
  it("offers 1:1 on either end and 1:n on the source end only", () => {
    const rts = [
      rt("one", "Application", "Provider", "1:1"),
      rt("oneRev", "Provider", "Application", "1:1"),
      rt("src", "Application", "Provider", "1:n"),
      rt("tgt", "Provider", "Application", "1:n"),
      rt("nm", "Application", "Provider", "n:m"),
      rt("self", "Application", "Application", "1:1"),
      rt("hidden", "Application", "Provider", "1:1", { is_hidden: true }),
    ];
    expect(relationGroupOptions(rts, ["Application"], label)).toEqual([
      { value: "rel:one", label: "L:one" },
      { value: "rel:oneRev", label: "L:oneRev" },
      { value: "rel:src", label: "L:src" },
    ]);
  });
  it("offers nothing for the combined option", () => {
    const rts = [rt("one", "Application", "Provider", "1:1")];
    expect(relationGroupOptions(rts, ["Application", "ITComponent"], label)).toEqual([]);
  });
});
