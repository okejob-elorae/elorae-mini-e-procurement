import { describe, it, expect } from "vitest";
import { classifyPhotoUpload } from "./photo-classify";

describe("classifyPhotoUpload", () => {
  it("evicts on 2xx", () => { expect(classifyPhotoUpload(200)).toBe("evict"); });
  it("terminal on 400/401/403/404", () => {
    for (const s of [400, 401, 403, 404]) expect(classifyPhotoUpload(s)).toBe("terminal");
  });
  it("retries on 5xx / 503 / 429 / thrown", () => {
    for (const s of [500, 502, 503, 429]) expect(classifyPhotoUpload(s)).toBe("retry");
    expect(classifyPhotoUpload("thrown")).toBe("retry");
  });
});
