import { ELEMENT_TYPES, type ElementType } from "../taxonomy/elements";
import { GLYPHS } from "./icons";
import { NOTATION, bodyDetail, bodyPath, translatePath, type BodyShape } from "./notation";

const BODIES: BodyShape[] = [
  "rect", "roundRect", "pill", "event", "box3d", "ellipse", "parallelogram", "hexagon", "cylinder", "grouping", "circle", "plain",
];
const numbers = (d: string) => (d.match(/\d+(\.\d+)?/g) ?? []).map(Number);

describe("NOTATION", () => {
  it("has an entry for every element type, with a known glyph", () => {
    for (const type of ELEMENT_TYPES) {
      const { glyph } = NOTATION[type];
      if (glyph !== null) expect(GLYPHS).toHaveProperty(glyph);
    }
    expect(Object.keys(NOTATION).sort()).toEqual([...ELEMENT_TYPES].sort());
  });

  it("uses every glyph (no dead data)", () => {
    const used = new Set(Object.values(NOTATION).map((x) => x.glyph));
    expect(Object.keys(GLYPHS).filter((id) => !used.has(id))).toEqual([]);
  });

  it.each<[ElementType, BodyShape, boolean]>([
    ["BusinessActor", "rect", false],
    ["BusinessProcess", "roundRect", false],
    ["BusinessService", "pill", false],
    ["BusinessEvent", "event", false],
    ["DataObject", "rect", true],
    ["Node", "box3d", false],
    ["Stakeholder", "cylinder", false],
    ["Goal", "ellipse", false],
    ["Requirement", "parallelogram", false],
    ["Grouping", "grouping", false],
    ["AndJunction", "circle", false],
    ["Capability", "roundRect", false],
  ])("%s is a %s (header %s)", (type, body, header) => {
    expect(NOTATION[type]).toMatchObject({ body, header });
  });

  it("gives the header band only to the passive objects", () => {
    const withHeader = ELEMENT_TYPES.filter((t) => NOTATION[t].header);
    expect(withHeader.sort()).toEqual(
      ["Artifact", "BusinessObject", "Contract", "DataObject", "Deliverable", "Material", "Representation"],
    );
  });

  it("keeps the other pinned decisions", () => {
    expect(NOTATION.ValueStream.body).toBe("pill");
    expect(NOTATION.Principle.body).toBe("rect");
    expect(NOTATION.Meaning.body).toBe("ellipse");
    expect(NOTATION.Assessment.body).toBe("ellipse");
    expect(NOTATION.Location.body).toBe("rect");
    expect(NOTATION.OrJunction.body).toBe("circle");
    expect(NOTATION.Grouping.glyph).toBeNull();
    for (const t of ["Device", "Equipment", "Facility", "DistributionNetwork", "Path", "CommunicationNetwork", "SystemSoftware"] as const)
      expect(NOTATION[t].body).toBe("box3d");
  });
});

describe("bodyPath", () => {
  it("pins the rect literal", () => {
    expect(bodyPath("rect", 120, 55)).toBe("M0 0H120V55H0Z");
  });

  it.each(BODIES)("%s: a closed path starting with M, inside the box", (body) => {
    const d = bodyPath(body, 120, 55);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).not.toMatch(/NaN|undefined/);
    const [w, h] = [120, 55];
    // rect-like paths use H/V (one number); polygons use x y pairs
    if (d.includes("H")) return;
    const v = numbers(d);
    expect(v.length % 2).toBe(0);
    v.forEach((x, i) => {
      expect(x).toBeLessThanOrEqual(i % 2 ? h : w);
    });
  });

  it("keeps a junction circle inside its 15x15 box and fills it", () => {
    const v = numbers(bodyPath("circle", 15, 15));
    expect(v.length).toBeGreaterThan(40);
    for (const x of v) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(15);
    }
    expect(Math.max(...v)).toBe(15);
  });

  it("draws the shape each name promises", () => {
    expect(bodyPath("box3d", 120, 55)).toBe("M0 10L10 0L120 0L120 45L110 55L0 55Z");
    expect(bodyPath("parallelogram", 120, 55)).toBe("M15 0L120 0L105 55L0 55Z");
    expect(bodyPath("hexagon", 120, 55)).toBe("M12 0L108 0L120 27.5L108 55L12 55L0 27.5Z");
    expect(bodyPath("grouping", 200, 120)).toBe("M0 0L60 0L60 18L200 18L200 120L0 120Z");
    // a pill is round at both ends: its leftmost x is 0 only at mid-height
    const pill = numbers(bodyPath("pill", 120, 55));
    const left = new Set(pill.flatMap((x, i) => (i % 2 === 0 && x === 0 ? [pill[i + 1]] : [])));
    expect([...left]).toEqual([27.5]);
    // an event has a notch in its left side: the left corners, then the notch point at mid-height
    expect(bodyPath("event", 120, 55)).toMatch(/^M0 0L/);
    expect(bodyPath("event", 120, 55)).toMatch(/L0 55L18\.33 27\.5Z$/);
  });
});

describe("bodyDetail", () => {
  it("draws the box front and the cylinder cap, and nothing for the others", () => {
    expect(bodyDetail("box3d", 120, 55)).toBe("M0 10H110V55M110 10L120 0");
    expect(bodyDetail("cylinder", 120, 55)).toMatch(/^M108 0L.*L108 55$/);
    expect(bodyDetail("rect", 120, 55)).toBeNull();
    expect(bodyDetail("ellipse", 120, 55)).toBeNull();
  });
});

describe("translatePath", () => {
  it("moves M H V L Z", () => {
    expect(translatePath("M0 0H10V5H0Z", 3, 4)).toBe("M3 4H13V9H3Z");
    expect(translatePath("M1 2L3 4L5 6Z", 10, 20)).toBe("M11 22L13 24L15 26Z");
  });

  it("refuses a command it cannot move", () => {
    expect(() => translatePath("M0 0C1 1 2 2 3 3", 1, 1)).toThrow("unsupported command C");
    expect(() => translatePath("m0 0h5", 1, 1)).toThrow("unsupported command m");
  });
});
