import { describe, expect, it } from "vitest";
import { alamatDaftarBarang, bacaSaringBarang, isActiveDariStatus } from "./saring-barang";

describe("bacaSaringBarang", () => {
  it("membaca kategori dan status yang sah", () => {
    expect(bacaSaringBarang({ kategori: "kat-1", status: "nonaktif" })).toEqual({ kategori: "kat-1", status: "nonaktif" });
    expect(bacaSaringBarang({ status: "aktif" })).toEqual({ kategori: "", status: "aktif" });
  });

  it("status asing atau kosong dibaca sebagai semua", () => {
    expect(bacaSaringBarang({ status: "ACTIVE" }).status).toBe("");
    expect(bacaSaringBarang({}).status).toBe("");
  });

  it("parameter berulang memakai nilai pertama; kategori dipangkas", () => {
    expect(bacaSaringBarang({ kategori: [" kat-2 ", "kat-3"], status: ["aktif", "nonaktif"] })).toEqual({
      kategori: "kat-2",
      status: "aktif",
    });
  });
});

describe("isActiveDariStatus", () => {
  it("aktif → true, nonaktif → false, semua → undefined", () => {
    expect(isActiveDariStatus("aktif")).toBe(true);
    expect(isActiveDariStatus("nonaktif")).toBe(false);
    expect(isActiveDariStatus("")).toBeUndefined();
  });
});

describe("alamatDaftarBarang", () => {
  it("hanya menulis parameter yang terisi, halaman 1 tidak ditulis", () => {
    expect(alamatDaftarBarang("/backoffice/items", { type: "", search: "", kategori: "", status: "", page: 1 })).toBe(
      "/backoffice/items",
    );
    expect(
      alamatDaftarBarang("/backoffice/items", { type: "FINISHED_GOOD", search: " polo ", kategori: "kat-1", status: "nonaktif", page: 3 }),
    ).toBe("/backoffice/items?type=FINISHED_GOOD&search=polo&kategori=kat-1&status=nonaktif&page=3");
  });
});
