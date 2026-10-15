// Word export of one value stream map: the map as a picture, then the goals and processes as lists.
// The "595959" / "#ffffff" literals below are docx / print values (a Word page is white whatever the
// app theme is), not UI colours: this is the only file allowed to hold them.

export interface WordLabels {
  subtitle: string;
  goalsHeading: string;
  processesHeading: string;
  noGoals: string;
  noProcesses: string;
  imageDescription: string;
  /** Thrown when the capture is not a readable PNG. */
  snapshotFailed: string;
  /** Thrown for every other failure (the cause is only logged). */
  failed: string;
}

export interface WordExportInput {
  node: HTMLElement;
  rootName: string;
  goals: string[];
  processNames: string[];
  labels: WordLabels;
}

export type WordSection = { heading: string; items: string[] } | { heading: string; emptyText: string };

const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+=*)$/;
const PAGE_WIDTH_PX = 600;

export function pngDataUrlToBytes(dataUrl: string): Uint8Array | null {
  const match = PNG_DATA_URL.exec(dataUrl);
  if (!match) return null;
  try {
    return Uint8Array.from(window.atob(match[1]), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function wordFileName(rootName: string): string {
  return `${rootName.replace(/[\\/:*?"<>|]/g, "-")} - Value Stream.docx`;
}

/** Scales the picture down to the page width keeping its aspect ratio; never scales up. */
export function fitToPage(width: number, height: number, maxWidth = PAGE_WIDTH_PX) {
  if (!(width > 0) || !Number.isFinite(width)) return { width: maxWidth, height: Math.round(maxWidth / 2) };
  const scale = Math.min(1, maxWidth / width);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** An empty list says so, so "nothing linked" is not mistaken for "the export dropped them". */
export function buildSections(goals: string[], processNames: string[], labels: WordLabels): WordSection[] {
  const section = (heading: string, items: string[], emptyText: string): WordSection =>
    items.length ? { heading, items } : { heading, emptyText };
  return [
    section(labels.goalsHeading, goals, labels.noGoals),
    section(labels.processesHeading, processNames, labels.noProcesses),
  ];
}

/** Runs `fn`; any failure is logged and replaced by the translated `failed` message (shown to the user as is). */
async function guarded<T>(failed: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    console.error("Value stream Word export failed", cause);
    throw new Error(failed);
  }
}

export async function exportValueStreamToWord({ node, rootName, goals, processNames, labels }: WordExportInput) {
  const { png, size } = await guarded(labels.failed, async () => {
    const { toPng } = await import("html-to-image");
    const rect = node.getBoundingClientRect();
    const dataUrl = await toPng(node, {
      cacheBust: true,
      pixelRatio: 1.5,
      backgroundColor: "#ffffff",
      filter: (el) => !(el instanceof HTMLElement && el.dataset.exportIgnore),
    });
    return { png: pngDataUrlToBytes(dataUrl), size: fitToPage(rect.width, rect.height) };
  });
  if (!png) throw new Error(labels.snapshotFailed);

  await guarded(labels.failed, async () => {
    const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType } = await import("docx");
    const sectionParagraphs = buildSections(goals, processNames, labels).flatMap((s) => [
      new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 120 } }),
      ...("items" in s
        ? s.items.map((text) => new Paragraph({ text, bullet: { level: 0 } }))
        : [new Paragraph({ children: [new TextRun({ text: s.emptyText, italics: true })] })]),
    ]);
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: rootName, heading: HeadingLevel.TITLE }),
            new Paragraph({
              children: [new TextRun({ text: labels.subtitle, color: "595959" })],
              spacing: { after: 360 },
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new ImageRun({
                  type: "png",
                  data: png,
                  transformation: size,
                  altText: { name: rootName, description: labels.imageDescription, title: rootName },
                }),
              ],
            }),
            ...sectionParagraphs,
          ],
        },
      ],
    });
    const url = URL.createObjectURL(await Packer.toBlob(doc));
    const a = document.createElement("a");
    a.href = url;
    a.download = wordFileName(rootName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}
