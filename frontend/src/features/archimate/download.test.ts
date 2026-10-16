import { downloadText } from "./download";

describe("downloadText", () => {
  it("clicks an anchor carrying the filename once, then revokes the object URL", () => {
    const create = vi.fn(() => "blob:x");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("m.xml");
      expect(this.getAttribute("href")).toBe("blob:x");
      expect(revoke).not.toHaveBeenCalled();
    });
    downloadText("m.xml", "<a/>", "application/xml");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:x");
    const blob = (create.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toBe("application/xml");
    click.mockRestore();
  });
});
