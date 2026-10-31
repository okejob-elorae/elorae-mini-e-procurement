import { describe, expect, it } from "vitest";
import { bacaInfoProduk, periksaInfoProduk } from "./info-produk";
import { normalizeItemPayload } from "./mutations";

describe("bacaInfoProduk", () => {
  it("absent stays undefined so other callers never wipe the columns", () => {
    expect(bacaInfoProduk({})).toEqual({ material: undefined, careInstructions: undefined, sizeChartId: undefined });
  });
  it("blank means cleared; text is trimmed, single-line fields collapse spaces, care keeps its lines", () => {
    expect(bacaInfoProduk({ material: "  ", careInstructions: "", sizeChartId: "" })).toEqual({
      material: null,
      careInstructions: null,
      sizeChartId: null,
    });
    expect(bacaInfoProduk({ material: " Katun   combed 30s ", careInstructions: " Cuci dingin\r\nJangan diputih ", sizeChartId: " sc1 " })).toEqual({
      material: "Katun combed 30s",
      careInstructions: "Cuci dingin\nJangan diputih",
      sizeChartId: "sc1",
    });
    expect(bacaInfoProduk({ material: null })).toMatchObject({ material: null });
  });
});

describe("periksaInfoProduk", () => {
  it("limits the lengths", () => {
    expect(periksaInfoProduk({ material: "x".repeat(200) })).toBeNull();
    expect(periksaInfoProduk({ material: "x".repeat(201) })).toMatch(/^material:/);
    expect(periksaInfoProduk({ careInstructions: "x".repeat(2001) })).toMatch(/^careInstructions:/);
  });
});

describe("normalizeItemPayload carries the three fields", () => {
  const dasar = { nameId: "Kaos", nameEn: "Tee", type: "FINISHED_GOOD", uomId: "u1" };
  it("passes them through when sent", () => {
    const p = normalizeItemPayload({ ...dasar, material: "Katun", careInstructions: "Cuci dingin", sizeChartId: "" });
    expect(p.material).toBe("Katun");
    expect(p.careInstructions).toBe("Cuci dingin");
    expect(p.sizeChartId).toBeNull();
  });
  it("leaves them undefined when the payload does not mention them", () => {
    const p = normalizeItemPayload(dasar);
    expect(p.material).toBeUndefined();
    expect(p.careInstructions).toBeUndefined();
    expect(p.sizeChartId).toBeUndefined();
  });
});
