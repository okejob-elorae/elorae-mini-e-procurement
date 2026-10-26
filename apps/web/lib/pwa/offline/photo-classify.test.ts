import { describe, it, expect } from "vitest";
import { classifyPhotoUpload } from "./photo-classify";

describe("classifyPhotoUpload", () => {
  it("evicts on 2xx", () => { expect(classifyPhotoUpload(200)).toBe("evict"); });
  it("terminal on 400/403/404 and the 409 cap refusal", () => {
    for (const s of [400, 403, 404, 409]) expect(classifyPhotoUpload(s)).toBe("terminal");
  });
  it("retries a 401 (expired session) instead of failing the photo", () => {
    expect(classifyPhotoUpload(401)).toBe("retry");
  });
  it("retries status 0, the opaque response a manual redirect yields", () => {
    expect(classifyPhotoUpload(0)).toBe("retry");
  });
  it("retries on 5xx / 503 / 429 / thrown", () => {
    for (const s of [500, 502, 503, 429]) expect(classifyPhotoUpload(s)).toBe("retry");
    expect(classifyPhotoUpload("thrown")).toBe("retry");
  });
});
