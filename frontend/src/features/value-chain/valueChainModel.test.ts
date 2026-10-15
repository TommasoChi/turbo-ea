import { afterEach, describe, expect, it, vi } from "vitest";
import { categoricalColor } from "@/lib/color";
import { STATUS_COLORS } from "@/theme/tokens";
import type { CardType, FieldDef, FieldOption, ValueChainBand, ValueChainBandKey } from "@/types";
import {
  buildColorScale,
  DEFAULT_CHAIN_ROW_ORDER,
  fieldOf,
  fieldOptionsOf,
  moveKey,
  orderBands,
  PROCESS_COLOR_ATTRS,
  readStreamBandOrder,
  STREAM_BAND_KEYS,
  STREAM_BAND_ORDER_STORAGE_KEY,
  writeStreamBandOrder,
} from "./valueChainModel";

const band = (key: ValueChainBandKey): ValueChainBand => ({ key, boxes: [] });
const keys = (bands: ValueChainBand[]) => bands.map((b) => b.key);
const DEFAULT_ORDER = ["gate", "vs", "process", "cap"];

describe("constants", () => {
  it("exposes the default row and stream band orders", () => {
    expect(DEFAULT_CHAIN_ROW_ORDER).toEqual(["management", "core", "support"]);
    expect([...STREAM_BAND_KEYS]).toEqual(DEFAULT_ORDER);
    expect([...PROCESS_COLOR_ATTRS]).toEqual(["processType", "maturity", "automationLevel", "riskLevel"]);
    expect(STREAM_BAND_ORDER_STORAGE_KEY).toBe("turboea.valuechain.streamBandOrder");
  });
});

describe("orderBands", () => {
  const bands = [band("management"), band("core"), band("support"), band("not_set")];

  it("follows rowOrder, with not_set last", () => {
    expect(keys(orderBands(bands, ["core", "management", "support"]))).toEqual([
      "core",
      "management",
      "support",
      "not_set",
    ]);
  });

  it("keeps not_set last even when rowOrder lists it first", () => {
    expect(keys(orderBands(bands, ["not_set", "support", "core", "management"]))).toEqual([
      "support",
      "core",
      "management",
      "not_set",
    ]);
  });

  it("appends a band missing from rowOrder before not_set", () => {
    expect(keys(orderBands(bands, ["support", "core"]))).toEqual(["support", "core", "management", "not_set"]);
  });

  it("ignores duplicate and unknown keys in rowOrder", () => {
    const out = orderBands(bands, ["core", "core", "bogus", "management", "core"]);
    expect(keys(out)).toEqual(["core", "management", "support", "not_set"]);
    expect(out).toHaveLength(4);
  });

  it("does not invent bands the response lacks", () => {
    expect(keys(orderBands([band("core")], DEFAULT_CHAIN_ROW_ORDER))).toEqual(["core"]);
  });

  it("returns the original band objects", () => {
    expect(orderBands(bands, [])[0]).toBe(bands[0]);
  });

  it("returns an empty list for no bands", () => {
    expect(orderBands([], ["core"])).toEqual([]);
  });
});

describe("moveKey", () => {
  it("moves a key up", () => {
    expect(moveKey(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
  });

  it("moves a key down", () => {
    expect(moveKey(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"]);
  });

  it("leaves the first key in place when moving up, still returning a new array", () => {
    const input = ["a", "b", "c"] as const;
    const out = moveKey(input, "a", "up");
    expect(out).toEqual(["a", "b", "c"]);
    expect(out).not.toBe(input);
  });

  it("leaves the last key in place when moving down", () => {
    expect(moveKey(["a", "b", "c"], "c", "down")).toEqual(["a", "b", "c"]);
  });

  it("moves the last key up and the first key down (boundary neighbours)", () => {
    expect(moveKey(["a", "b", "c"], "c", "up")).toEqual(["a", "c", "b"]);
    expect(moveKey(["a", "b", "c"], "a", "down")).toEqual(["b", "a", "c"]);
  });

  it("ignores an unknown key", () => {
    expect(moveKey(["a", "b", "c"], "z", "up")).toEqual(["a", "b", "c"]);
    expect(moveKey(["a", "b", "c"], "z", "down")).toEqual(["a", "b", "c"]);
  });

  it("does not mutate its input", () => {
    const input = ["a", "b", "c"];
    moveKey(input, "b", "up");
    expect(input).toEqual(["a", "b", "c"]);
  });

  it("handles a single-element and an empty list", () => {
    expect(moveKey(["a"], "a", "up")).toEqual(["a"]);
    expect(moveKey(["a"], "a", "down")).toEqual(["a"]);
    expect(moveKey([] as string[], "a", "up")).toEqual([]);
  });
});

describe("readStreamBandOrder", () => {
  const store = (raw: string | null) => ({ getItem: vi.fn(() => raw) });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      window.localStorage.clear();
    } catch {
      /* not available in this environment */
    }
  });

  it("falls back to the default without storage", () => {
    expect(readStreamBandOrder(null)).toEqual(DEFAULT_ORDER);
  });

  it("falls back to the default when nothing is saved", () => {
    const s = store(null);
    expect(readStreamBandOrder(s)).toEqual(DEFAULT_ORDER);
    expect(s.getItem).toHaveBeenCalledWith(STREAM_BAND_ORDER_STORAGE_KEY);
  });

  it("returns a saved valid permutation", () => {
    expect(readStreamBandOrder(store('["cap","process","vs","gate"]'))).toEqual(["cap", "process", "vs", "gate"]);
  });

  it.each([
    ["malformed JSON", "{nope"],
    ["wrong length (short)", '["gate","vs","process"]'],
    ["wrong length (long)", '["gate","vs","process","cap","gate"]'],
    ["duplicate key", '["gate","gate","process","cap"]'],
    ["unknown key", '["gate","vs","process","bogus"]'],
    ["a non-array", '{"gate":1}'],
    ["a string", '"gate"'],
    ["null literal", "null"],
  ])("falls back to the default on %s", (_name, raw) => {
    expect(readStreamBandOrder(store(raw))).toEqual(DEFAULT_ORDER);
  });

  it("falls back to the default when getItem throws", () => {
    const s = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStreamBandOrder(s)).toEqual(DEFAULT_ORDER);
  });

  it("returns a fresh array each time", () => {
    const a = readStreamBandOrder(null);
    a.reverse();
    expect(readStreamBandOrder(null)).toEqual(DEFAULT_ORDER);
  });

  it("reads from window.localStorage by default", () => {
    window.localStorage.setItem(STREAM_BAND_ORDER_STORAGE_KEY, '["vs","gate","cap","process"]');
    expect(readStreamBandOrder()).toEqual(["vs", "gate", "cap", "process"]);
  });

  it("falls back to the default when window.localStorage itself throws", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readStreamBandOrder()).toEqual(DEFAULT_ORDER);
  });
});

describe("writeStreamBandOrder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    try {
      window.localStorage.clear();
    } catch {
      /* not available in this environment */
    }
  });

  it("stores the order as JSON under the storage key", () => {
    const setItem = vi.fn();
    writeStreamBandOrder(["cap", "gate", "vs", "process"], { setItem });
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledWith(STREAM_BAND_ORDER_STORAGE_KEY, '["cap","gate","vs","process"]');
  });

  it("swallows a throwing setItem", () => {
    const setItem = () => {
      throw new Error("quota");
    };
    expect(() => writeStreamBandOrder(["gate", "vs", "process", "cap"], { setItem })).not.toThrow();
  });

  it("does nothing without storage", () => {
    expect(() => writeStreamBandOrder(["gate", "vs", "process", "cap"], null)).not.toThrow();
  });

  it("writes to window.localStorage by default and round-trips", () => {
    writeStreamBandOrder(["process", "cap", "gate", "vs"]);
    expect(window.localStorage.getItem(STREAM_BAND_ORDER_STORAGE_KEY)).toBe('["process","cap","gate","vs"]');
    expect(readStreamBandOrder()).toEqual(["process", "cap", "gate", "vs"]);
  });

  it("swallows a throwing window.localStorage", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => writeStreamBandOrder(["gate", "vs", "process", "cap"])).not.toThrow();
  });
});

describe("fieldOf / fieldOptionsOf", () => {
  const rating: FieldOption[] = [
    { key: "low", label: "Low", color: "#00ff00" },
    { key: "high", label: "High" },
  ];
  const f = (key: string, options?: FieldOption[]): FieldDef => ({ key, label: key, type: "single_select", options });
  const type = {
    key: "BusinessProcess",
    fields_schema: [
      { section: "General", fields: [f("name"), f("owner")] },
      { section: "Details", fields: [f("maturity", rating), f("freeText")] },
    ],
  } as unknown as CardType;

  it("finds a field in a later section", () => {
    expect(fieldOf(type, "maturity")?.key).toBe("maturity");
    expect(fieldOf(type, "owner")?.key).toBe("owner");
  });

  it("returns undefined for an unknown field or undefined type", () => {
    expect(fieldOf(type, "nope")).toBeUndefined();
    expect(fieldOf(undefined, "maturity")).toBeUndefined();
    expect(fieldOf({ key: "X" } as unknown as CardType, "maturity")).toBeUndefined();
  });

  it("returns the options of a field in the 2nd section", () => {
    expect(fieldOptionsOf(type, "maturity")).toBe(rating);
  });

  it("returns [] for a field without options, an unknown field, or an undefined type", () => {
    expect(fieldOptionsOf(type, "freeText")).toEqual([]);
    expect(fieldOptionsOf(type, "nope")).toEqual([]);
    expect(fieldOptionsOf(undefined, "maturity")).toEqual([]);
  });
});

describe("buildColorScale", () => {
  const options: FieldOption[] = [
    { key: "a", label: "A", color: "#112233" },
    { key: "b", label: "B" },
    { key: "c", label: "C", color: "" },
  ];
  const scale = buildColorScale(options);

  it("uses the option's own colour", () => {
    expect(scale.colorOf("a")).toBe("#112233");
  });

  it("falls back to the categorical colour by position for uncoloured options", () => {
    expect(scale.colorOf("b")).toBe(categoricalColor(1));
    expect(scale.colorOf("c")).toBe(categoricalColor(2));
  });

  it("returns the neutral colour for null, undefined, empty and unknown values", () => {
    expect(scale.colorOf(null)).toBe(STATUS_COLORS.neutral);
    expect(scale.colorOf(undefined)).toBe(STATUS_COLORS.neutral);
    expect(scale.colorOf("")).toBe(STATUS_COLORS.neutral);
    expect(scale.colorOf("unknown")).toBe(STATUS_COLORS.neutral);
  });

  it("preserves entry order with option, key and colour", () => {
    expect(scale.entries.map((e) => e.key)).toEqual(["a", "b", "c"]);
    expect(scale.entries[0]).toEqual({ key: "a", option: options[0], color: "#112233" });
    expect(scale.entries[1].option).toBe(options[1]);
    expect(scale.entries[1].color).toBe(categoricalColor(1));
  });

  it("handles no options", () => {
    const empty = buildColorScale([]);
    expect(empty.entries).toEqual([]);
    expect(empty.colorOf("a")).toBe(STATUS_COLORS.neutral);
  });
});
