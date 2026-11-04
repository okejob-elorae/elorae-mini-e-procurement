import { describe, expect, it } from "vitest";
import { alamatDaftarBarang, bacaSaringBarang, isActiveDariStatus } from "./saring-barang";

describe("bacaSaringBarang", () => {
  it("membaca kategori dan status yang sah", () => {
    expect(bacaSaringBarang({ kategori: "kat-1", status: "nonaktif" })).toEqual({ kategori: "kat-1", status: "nonaktif", saluran: "" });
    expect(bacaSaringBarang({ status: "aktif" })).toEqual({ kategori: "", status: "aktif", saluran: "" });
  });

  it("status asing atau kosong dibaca sebagai semua", () => {
    expect(bacaSaringBarang({ status: "ACTIVE" }).status).toBe("");
    expect(bacaSaringBarang({}).status).toBe("");
  });

  it("parameter berulang memakai nilai pertama; kategori dipangkas", () => {
    expect(bacaSaringBarang({ kategori: [" kat-2 ", "kat-3"], status: ["aktif", "nonaktif"] })).toEqual({
      kategori: "kat-2",
      status: "aktif",
      saluran: "",
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

describe("saringan Dijual di (P3)", () => {
  it("membaca saluran yang sah; yang asing dibaca sebagai semua", () => {
    expect(bacaSaringBarang({ saluran: "OFFLINE" }).saluran).toBe("OFFLINE");
    expect(bacaSaringBarang({ saluran: ["MARKETPLACE", "BOTH"] }).saluran).toBe("MARKETPLACE");
    expect(bacaSaringBarang({ saluran: "offline" }).saluran).toBe("");
  });

  it("bolak-balik lewat alamat", () => {
    const alamat = alamatDaftarBarang("/backoffice/items", { type: "", search: "", kategori: "", status: "", saluran: "BOTH", page: 1 });
    expect(alamat).toBe("/backoffice/items?saluran=BOTH");
    const sp = Object.fromEntries(new URL(alamat, "http://x").searchParams);
    expect(bacaSaringBarang(sp).saluran).toBe("BOTH");
  });
});
