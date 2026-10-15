import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildSections,
  fitToPage,
  exportValueStreamToWord,
  pngDataUrlToBytes,
  wordFileName,
  type WordLabels,
} from "./valueChainExport";

const toPng = vi.hoisted(() => vi.fn());
vi.mock("html-to-image", () => ({ toPng }));

/** A valid 1x1 PNG. */
const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const LABELS: WordLabels = {
  subtitle: "Value Stream Map – 15 October 2026",
  goalsHeading: "Business goals",
  processesHeading: "Business processes",
  noGoals: "No goal linked",
  noProcesses: "No process linked",
  imageDescription: "Hire-to-Retire value stream map",
  snapshotFailed: "Could not read the snapshot.",
  failed: "Failed to generate the Word document.",
};

describe("pngDataUrlToBytes", () => {
  it("decodes a PNG data URL to its bytes", () => {
    const bytes = pngDataUrlToBytes("data:image/png;base64,iVBORw0KGgo=");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes!)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it.each([
    ["a non-PNG data URL", "data:image/jpeg;base64,iVBORw0KGgo="],
    ["an empty string", ""],
    ["garbage", "not a data url"],
    ["a PNG data URL with a non-base64 payload", "data:image/png;base64,@@@"],
    ["a PNG data URL with an empty payload", "data:image/png;base64,"],
    ["a PNG data URL with a truncated base64 payload", "data:image/png;base64,iVBOR"],
  ])("returns null for %s", (_, input) => {
    expect(pngDataUrlToBytes(input)).toBeNull();
  });
});

describe("wordFileName", () => {
  it("replaces every character that is invalid in a file name", () => {
    const name = wordFileName('A/B:C*?"<>|');
    expect(name).toBe("A-B-C------ - Value Stream.docx");
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });

  it("keeps a plain name untouched", () => {
    expect(wordFileName("Hire-to-Retire")).toBe("Hire-to-Retire - Value Stream.docx");
  });

  it("replaces a backslash too", () => {
    expect(wordFileName("A\\B")).toBe("A-B - Value Stream.docx");
  });
});

describe("fitToPage", () => {
  it("scales a wide picture down to 600 px keeping the aspect ratio", () => {
    expect(fitToPage(1200, 600)).toEqual({ width: 600, height: 300 });
  });

  it("keeps a narrow picture as is", () => {
    expect(fitToPage(300, 100)).toEqual({ width: 300, height: 100 });
  });

  it("keeps a picture exactly 600 px wide as is", () => {
    expect(fitToPage(600, 400)).toEqual({ width: 600, height: 400 });
  });

  it("scales a picture 1 px wider than the page", () => {
    expect(fitToPage(601, 601)).toEqual({ width: 600, height: 600 });
  });

  it("keeps a picture 1 px narrower than the page", () => {
    expect(fitToPage(599, 200)).toEqual({ width: 599, height: 200 });
  });

  it("honours a custom maximum width", () => {
    expect(fitToPage(400, 200, 100)).toEqual({ width: 100, height: 50 });
  });

  it.each([
    ["zero", 0],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["negative", -5],
  ])("falls back to a 2:1 page-wide placeholder for a %s width", (_, width) => {
    expect(fitToPage(width, 100)).toEqual({ width: 600, height: 300 });
  });

  it("falls back relative to a custom maximum width", () => {
    expect(fitToPage(0, 0, 200)).toEqual({ width: 200, height: 100 });
  });
});

describe("buildSections", () => {
  it("lists the goals and the processes under their headings", () => {
    expect(buildSections(["G1", "G2"], ["P1"], LABELS)).toEqual([
      { heading: "Business goals", items: ["G1", "G2"] },
      { heading: "Business processes", items: ["P1"] },
    ]);
  });

  it("says so, per section, when a list is empty", () => {
    expect(buildSections([], ["P1"], LABELS)).toEqual([
      { heading: "Business goals", emptyText: "No goal linked" },
      { heading: "Business processes", items: ["P1"] },
    ]);
    expect(buildSections(["G1"], [], LABELS)).toEqual([
      { heading: "Business goals", items: ["G1"] },
      { heading: "Business processes", emptyText: "No process linked" },
    ]);
  });
});

describe("exportValueStreamToWord", () => {
  let clicked: HTMLAnchorElement[];
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  const makeNode = (width = 1200, height = 600) => {
    const node = document.createElement("div");
    node.getBoundingClientRect = () => ({ width, height }) as DOMRect;
    return node;
  };

  beforeEach(() => {
    toPng.mockReset();
    toPng.mockResolvedValue(PNG_1x1);
    clicked = [];
    createObjectURL = vi.fn(() => "blob:x");
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    vi.restoreAllMocks();
  });

  it("captures the node as a white PNG, skipping export-ignored elements, and downloads a .docx", async () => {
    const node = makeNode();
    await exportValueStreamToWord({
      node,
      rootName: "Hire/Retire",
      goals: ["G1"],
      processNames: ["P1", "P2"],
      labels: LABELS,
    });

    expect(toPng).toHaveBeenCalledTimes(1);
    const [target, options] = toPng.mock.calls[0];
    expect(target).toBe(node);
    expect(options).toMatchObject({ backgroundColor: "#ffffff", pixelRatio: 1.5, cacheBust: true });
    const ignored = document.createElement("div");
    ignored.dataset.exportIgnore = "true";
    expect(options.filter(ignored)).toBe(false);
    expect(options.filter(document.createElement("div"))).toBe(true);
    expect(options.filter(document.createTextNode("x"))).toBe(true);

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe(wordFileName("Hire/Retire"));
    expect(clicked[0].download).toBe("Hire-Retire - Value Stream.docx");
    expect(clicked[0].getAttribute("href")).toBe("blob:x");
    expect(document.body.contains(clicked[0])).toBe(false);

    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toContain("wordprocessingml");
    expect(blob.size).toBeGreaterThan(0);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });

  describe("document content", () => {
    const exportXml = async (goals: string[], processNames: string[]) => {
      await exportValueStreamToWord({ node: makeNode(), rootName: "Hire <&> Retire", goals, processNames, labels: LABELS });
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      // jsdom's Blob has no arrayBuffer()
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
      });
      const zip = await JSZip.loadAsync(buffer);
      return zip.file("word/document.xml")!.async("string");
    };
    /** The paragraphs of the document, in order. */
    const paragraphs = (xml: string) => xml.match(/<w:p>.*?<\/w:p>|<w:p [^>]*>.*?<\/w:p>/gs) ?? [];
    const paragraphWith = (xml: string, text: string) => {
      const found = paragraphs(xml).filter((p) => p.includes(`>${text}</w:t>`));
      expect(found).toHaveLength(1);
      return found[0];
    };

    it("writes the title, the coloured subtitle and the centred, described picture", async () => {
      const xml = await exportXml(["G1"], ["P1"]);
      const title = paragraphWith(xml, "Hire &lt;&amp;&gt; Retire");
      expect(title).toContain('<w:pStyle w:val="Title"/>');
      const subtitle = paragraphWith(xml, LABELS.subtitle);
      expect(subtitle).toContain('<w:color w:val="595959"/>');
      expect(subtitle).not.toContain("w:pStyle");
      const picture = paragraphs(xml).find((p) => p.includes("<w:drawing>"))!;
      expect(picture).toContain('<w:jc w:val="center"/>');
      expect(picture).toContain('descr="Hire-to-Retire value stream map"');
      expect(picture).toContain('name="Hire &lt;&amp;&gt; Retire"');
      expect(picture).toContain('title="Hire &lt;&amp;&gt; Retire"');
      expect(picture).toContain('<a:ext cx="5715000" cy="2857500"/>'); // 1200x600 px fitted to 600x300 px, 9525 EMU per px
      expect(title).not.toContain('<w:jc w:val="center"/>');
    });

    it("writes each section as a heading followed by a bullet per name", async () => {
      const xml = await exportXml(["G1", "G2"], ["P1"]);
      for (const heading of [LABELS.goalsHeading, LABELS.processesHeading]) {
        expect(paragraphWith(xml, heading)).toContain('<w:pStyle w:val="Heading1"/>');
      }
      for (const name of ["G1", "G2", "P1"]) {
        const bullet = paragraphWith(xml, name);
        expect(bullet).toContain("<w:numPr>");
        expect(bullet).toContain('<w:ilvl w:val="0"/>');
        expect(bullet).toContain('<w:pStyle w:val="ListParagraph"/>');
      }
      expect(xml).not.toContain(LABELS.noGoals);
      expect(xml).not.toContain(LABELS.noProcesses);
      // headings and items keep their order: goals, then processes
      const at = [LABELS.goalsHeading, ">G1<", ">G2<", LABELS.processesHeading, ">P1<"].map((s) => xml.indexOf(s));
      expect(at.every((i) => i > 0)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
    });

    it("writes an italic, non-bullet sentence under a heading whose list is empty", async () => {
      const xml = await exportXml([], []);
      for (const text of [LABELS.noGoals, LABELS.noProcesses]) {
        const empty = paragraphWith(xml, text);
        expect(empty).toContain("<w:i/>");
        expect(empty).not.toContain("<w:numPr>");
      }
      expect(paragraphWith(xml, LABELS.goalsHeading)).toContain('<w:pStyle w:val="Heading1"/>');
      expect(paragraphWith(xml, LABELS.processesHeading)).toContain('<w:pStyle w:val="Heading1"/>');
    });

    it("does not italicise a populated list", async () => {
      const xml = await exportXml(["G1"], ["P1"]);
      expect(paragraphWith(xml, "G1")).not.toContain("<w:i/>");
      expect(paragraphWith(xml, "P1")).not.toContain("<w:i/>");
    });
  });

  it("rejects with the translated snapshot error and downloads nothing when the capture is not a PNG", async () => {
    toPng.mockResolvedValue("data:text/plain;base64,AAAA");
    await expect(
      exportValueStreamToWord({ node: makeNode(), rootName: "R", goals: [], processNames: [], labels: LABELS }),
    ).rejects.toThrow(new Error(LABELS.snapshotFailed));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clicked).toHaveLength(0);
  });

  it("hides a library failure behind the translated generic message and logs the cause", async () => {
    const cause = new Error("Failed to execute 'toBlob' on HTMLCanvasElement: Tainted canvases");
    toPng.mockRejectedValue(cause);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const rejection = await exportValueStreamToWord({
      node: makeNode(),
      rootName: "R",
      goals: [],
      processNames: [],
      labels: LABELS,
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe(LABELS.failed);
    expect((rejection as Error).message).not.toContain("Tainted");
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0]).toContain(cause);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clicked).toHaveLength(0);
  });

  it("hides a failure while generating the file too", async () => {
    createObjectURL.mockImplementation(() => {
      throw new Error("object URL exploded");
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      exportValueStreamToWord({ node: makeNode(), rootName: "R", goals: [], processNames: [], labels: LABELS }),
    ).rejects.toThrow(new Error(LABELS.failed));
    expect(logged).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveLength(0);
  });
});
