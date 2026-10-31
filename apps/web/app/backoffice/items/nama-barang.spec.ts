import { describe, expect, it } from "vitest";
import { namaInggrisAtauIndonesia, rapikanNamaBarang } from "./nama-barang";

describe("namaInggrisAtauIndonesia", () => {
  it("memakai nama Inggris bila diisi", () => {
    expect(namaInggrisAtauIndonesia("Red cotton fabric", "Kain katun merah")).toBe("Red cotton fabric");
  });

  it("nama Inggris kosong atau spasi → nama Indonesia", () => {
    expect(namaInggrisAtauIndonesia("", "Kaos Polo Navy")).toBe("Kaos Polo Navy");
    expect(namaInggrisAtauIndonesia("   ", "Kaos Polo Navy")).toBe("Kaos Polo Navy");
    expect(namaInggrisAtauIndonesia(undefined, "  Kaos Polo Navy ")).toBe("Kaos Polo Navy");
    expect(namaInggrisAtauIndonesia(null, "Kaos Polo Navy")).toBe("Kaos Polo Navy");
  });

  it("memangkas spasi di tepi nama Inggris", () => {
    expect(namaInggrisAtauIndonesia("  Navy polo  ", "Kaos Polo Navy")).toBe("Navy polo");
  });
});

describe("rapikanNamaBarang", () => {
  it("mengisi nameEn dari nameId tanpa mengubah isian lain", () => {
    const isian = { nameId: " Kemeja Linen ", nameEn: "", uomId: "u1", reorderPoint: 12 };
    expect(rapikanNamaBarang(isian)).toEqual({ nameId: "Kemeja Linen", nameEn: "Kemeja Linen", uomId: "u1", reorderPoint: 12 });
  });

  it("nameEn yang diisi dipertahankan", () => {
    expect(rapikanNamaBarang({ nameId: "Kemeja Linen", nameEn: "Linen shirt" })).toEqual({
      nameId: "Kemeja Linen",
      nameEn: "Linen shirt",
    });
  });
});
