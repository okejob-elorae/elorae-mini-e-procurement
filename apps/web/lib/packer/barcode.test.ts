import { describe, expect, it } from "vitest";
import {
  barcodesMatch,
  extractTrackingCandidate,
  isAcceptableScanCode,
  normalizeBarcode,
  normalizeScanCode,
  pickBestTrackingMatch,
  trackingCodesMatch,
} from "./barcode";

describe("packer barcode", () => {
  it("trims whitespace", () => {
    expect(normalizeBarcode("  ABC-1  ")).toBe("ABC-1");
  });

  it("normalizes scan codes to uppercase", () => {
    expect(normalizeScanCode("jy1064321101")).toBe("JY1064321101");
  });

  it("accepts shopee digit resi and courier awb", () => {
    expect(isAcceptableScanCode("11004268889737")).toBe(true);
    expect(isAcceptableScanCode("JY1064321101")).toBe(true);
    expect(isAcceptableScanCode("SPXID1234567890")).toBe(true);
  });

  it("rejects barcode/OCR garbage", () => {
    expect(isAcceptableScanCode("V- - _ L")).toBe(false);
    expect(extractTrackingCandidate("V- - _ L")).toBe("");
    expect(isAcceptableScanCode("ab")).toBe(false);
    expect(isAcceptableScanCode("SO-1")).toBe(false);
  });

  it("extracts digit run from noisy text", () => {
    expect(extractTrackingCandidate("No. Resi: 11004268889737")).toBe("11004268889737");
  });

  it("matches start and end when equal (case insensitive)", () => {
    expect(barcodesMatch("JY1064321101", "jy1064321101")).toBe(true);
  });

  it("matches barcode digits to prefixed tracking (LIKE)", () => {
    expect(trackingCodesMatch("11004268889737", "SPX11004268889737")).toBe(true);
    expect(barcodesMatch("SPX11004268889737", "11004268889737")).toBe(true);
  });

  it("rejects different barcodes", () => {
    expect(barcodesMatch("RESIAAAAAA01", "RESIBBBBBB02")).toBe(false);
  });

  it("picks best tracking among candidates", () => {
    const items = [
      { id: "a", trackingNumber: "SPX999999999999" },
      { id: "b", trackingNumber: "SPX11004268889737" },
      { id: "c", trackingNumber: "11004268889737" },
    ];
    const hit = pickBestTrackingMatch(items, "11004268889737", (i) => i.trackingNumber);
    expect(hit?.id).toBe("c");
  });
});
