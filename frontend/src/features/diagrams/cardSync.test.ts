import { describe, it, expect } from "vitest";
import { cardCreatePayload, syncAllMessageKey } from "./cardSync";

const pending = { type: "Application", name: "Draft App" };

describe("cardCreatePayload", () => {
  it("sends the type and the name for a card created without a description", () => {
    expect(cardCreatePayload(pending)).toEqual({ type: "Application", name: "Draft App" });
    expect(cardCreatePayload(pending)).not.toHaveProperty("description");
  });

  it("carries the description typed in the Create-card dialog (#1210)", () => {
    expect(cardCreatePayload({ ...pending, description: "Hosts the ERP" })).toEqual({
      type: "Application",
      name: "Draft App",
      description: "Hosts the ERP",
    });
  });

  it("trims the description and omits a blank one", () => {
    // `CardCreate.description` is `str | None`: a blank is "none", not "".
    expect(cardCreatePayload({ ...pending, description: "  notes  " })).toMatchObject({
      description: "notes",
    });
    expect(cardCreatePayload({ ...pending, description: "" })).not.toHaveProperty("description");
    expect(cardCreatePayload({ ...pending, description: "   " })).not.toHaveProperty(
      "description",
    );
  });

  it("forwards nothing else from a scanned pending card", () => {
    // The temp id and the cell id are canvas bookkeeping; the inventory must
    // never see them.
    const scanned = { cellId: "pfs-1", tempId: "pending-x", ...pending, description: "d" };
    expect(Object.keys(cardCreatePayload(scanned)).sort()).toEqual([
      "description",
      "name",
      "type",
    ]);
  });
});

it("includes the pending subtype in the shared single and sync-all payload", () => {
  expect(cardCreatePayload({ type: "DataObject", name: "Invoice", subtype: "document" })).toEqual({
    type: "DataObject", name: "Invoice", subtype: "document",
  });
});

it("reports subtype-blocked work after syncing eligible cards", () => {
  expect(syncAllMessageKey([{ type: "DataObject", subtype: undefined }], [{ key: "data" }])).toBe("editor.subtypeRequired");
  expect(syncAllMessageKey([{ type: "DataObject", subtype: "data" }], [{ key: "data" }])).toBe("editor.syncComplete");
  expect(syncAllMessageKey([{ type: "Application" }], [])).toBe("editor.syncComplete");
});
