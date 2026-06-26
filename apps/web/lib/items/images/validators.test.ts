import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  validateMime,
  validateSize,
  validateGalleryCount,
  validateVariantSku,
  validateUrlHost,
  validateNewUploadUrl,
} from "./validators";

describe("validateMime", () => {
  it("accepts jpeg / png / webp", () => {
    expect(validateMime("image/jpeg")).toEqual({ ok: true });
    expect(validateMime("image/png")).toEqual({ ok: true });
    expect(validateMime("image/webp")).toEqual({ ok: true });
  });
  it("rejects pdf and unknown types", () => {
    expect(validateMime("application/pdf")).toMatchObject({ ok: false, code: "image_mime_invalid" });
    expect(validateMime("image/gif")).toMatchObject({ ok: false, code: "image_mime_invalid" });
  });
});

describe("validateSize", () => {
  it("accepts ≤ 5 MB", () => {
    expect(validateSize(5 * 1024 * 1024)).toEqual({ ok: true });
    expect(validateSize(1)).toEqual({ ok: true });
  });
  it("rejects > 5 MB", () => {
    expect(validateSize(5 * 1024 * 1024 + 1)).toMatchObject({ ok: false, code: "image_too_large" });
  });
});

describe("validateGalleryCount", () => {
  it("accepts ≤ 20", () => {
    expect(validateGalleryCount(0)).toEqual({ ok: true });
    expect(validateGalleryCount(20)).toEqual({ ok: true });
  });
  it("rejects > 20", () => {
    expect(validateGalleryCount(21)).toMatchObject({ ok: false, code: "image_count_exceeded" });
  });
});

describe("validateVariantSku", () => {
  const variants = [{ sku: "RED" }, { sku: "BLUE" }];
  it("accepts null (product-level)", () => {
    expect(validateVariantSku(null, variants)).toEqual({ ok: true });
  });
  it("accepts a matching variant sku", () => {
    expect(validateVariantSku("RED", variants)).toEqual({ ok: true });
  });
  it("rejects unknown variant sku", () => {
    expect(validateVariantSku("GREEN", variants)).toMatchObject({ ok: false, code: "image_variant_unknown" });
  });
});

describe("validateUrlHost", () => {
  it("accepts trusted Jubelio host", () => {
    expect(validateUrlHost("https://static.jubelio.com/x.jpg")).toEqual({ ok: true });
  });
  it("rejects untrusted external host", () => {
    expect(validateUrlHost("https://evil.example/x.jpg")).toMatchObject({ ok: false, code: "image_url_untrusted" });
  });
  it("rejects malformed url", () => {
    expect(validateUrlHost("not-a-url")).toMatchObject({ ok: false, code: "image_url_untrusted" });
  });
});

describe("validateNewUploadUrl", () => {
  const origHost = process.env.NEXT_PUBLIC_R2_PUBLIC_HOST;

  beforeAll(() => {
    process.env.NEXT_PUBLIC_R2_PUBLIC_HOST = "pub.r2.example.com";
  });

  afterAll(() => {
    if (origHost === undefined) {
      delete process.env.NEXT_PUBLIC_R2_PUBLIC_HOST;
    } else {
      process.env.NEXT_PUBLIC_R2_PUBLIC_HOST = origHost;
    }
  });

  it("accepts URL on the R2 host", () => {
    expect(validateNewUploadUrl("https://pub.r2.example.com/items/id1/x.jpg")).toEqual({ ok: true });
  });

  it("rejects Jubelio URL (not R2)", () => {
    expect(validateNewUploadUrl("https://static.jubelio.com/x.jpg")).toMatchObject({
      ok: false,
      code: "image_url_untrusted",
    });
  });

  it("rejects untrusted external host", () => {
    expect(validateNewUploadUrl("https://evil.example/x.jpg")).toMatchObject({
      ok: false,
      code: "image_url_untrusted",
    });
  });

  it("rejects malformed url", () => {
    expect(validateNewUploadUrl("not-a-url")).toMatchObject({ ok: false, code: "image_url_untrusted" });
  });

  it("returns error when R2 host env var is not set", () => {
    delete process.env.NEXT_PUBLIC_R2_PUBLIC_HOST;
    expect(validateNewUploadUrl("https://pub.r2.example.com/x.jpg")).toMatchObject({
      ok: false,
      code: "image_url_untrusted",
    });
    process.env.NEXT_PUBLIC_R2_PUBLIC_HOST = "pub.r2.example.com";
  });
});
