import { ApiError } from "@/api/client";
import { describeApiError } from "./saveError";

const issues = (n: number) => Array.from({ length: n }, (_, i) => ({ code: `c${i + 1}`, ref: `r${i + 1}` }));

describe("describeApiError", () => {
  it("returns a string detail as is", () => {
    expect(describeApiError(new ApiError("x", 400, "Not allowed"), "fb")).toBe("Not allowed");
  });

  it("lists the issues of a 422 detail", () => {
    const e = new ApiError("x", 422, { message: "Invalid ArchiMate model", issues: issues(3) });
    expect(describeApiError(e, "fb")).toBe("Invalid ArchiMate model: c1 (r1), c2 (r2), c3 (r3)");
  });

  it("shows at most 3 issues and counts the rest", () => {
    const e = new ApiError("x", 422, { message: "Invalid", issues: issues(5) });
    expect(describeApiError(e, "fb")).toBe("Invalid: c1 (r1), c2 (r2), c3 (r3), +2 more");
  });

  it("leaves out an empty ref and works without a message", () => {
    expect(describeApiError(new ApiError("x", 422, { issues: [{ code: "a", ref: "" }] }), "fb")).toBe("a");
  });

  it("uses an Error's message", () => {
    expect(describeApiError(new Error("offline"), "fb")).toBe("offline");
  });

  it("falls back for anything else and never returns an empty string", () => {
    expect(describeApiError("weird", "fb")).toBe("fb");
    expect(describeApiError(null, "fb")).toBe("fb");
    expect(describeApiError(new Error(""), "fb")).toBe("fb");
    expect(describeApiError(new ApiError("", 500, { issues: [] }), "fb")).toBe("fb");
    expect(describeApiError(new ApiError("  ", 500, "  "), "fb")).toBe("fb");
  });

  it("falls back to the ApiError message when the detail has nothing to say", () => {
    expect(describeApiError(new ApiError("Server error", 500, null), "fb")).toBe("Server error");
  });
});
