import { describe, it, expect } from "vitest";
import { exceedsDeclaredLength, MULTIPART_OVERHEAD_BYTES } from "./content-length";

const MB = 1024 * 1024;

function req(length?: string): Request {
  const headers: Record<string, string> = {};
  if (length !== undefined) headers["content-length"] = length;
  return new Request("http://localhost/x", { method: "POST", headers, body: "x" });
}

describe("exceedsDeclaredLength", () => {
  it("allows exactly the cap plus multipart overhead", () => {
    expect(exceedsDeclaredLength(req(String(10 * MB + MULTIPART_OVERHEAD_BYTES)), 10 * MB)).toBe(false);
  });

  it("refuses one byte past the allowance", () => {
    expect(exceedsDeclaredLength(req(String(10 * MB + MULTIPART_OVERHEAD_BYTES + 1)), 10 * MB)).toBe(true);
  });

  it("scales the allowance by the file count", () => {
    expect(exceedsDeclaredLength(req(String(30 * MB)), 10 * MB, 4)).toBe(false);
    expect(exceedsDeclaredLength(req(String(41 * MB)), 10 * MB, 4)).toBe(true);
  });

  it("passes a missing or malformed header", () => {
    expect(exceedsDeclaredLength(req(), 10 * MB)).toBe(false);
    expect(exceedsDeclaredLength(req("abc"), 10 * MB)).toBe(false);
  });
});
