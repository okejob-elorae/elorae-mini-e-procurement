import { describe, expect, it } from "vitest";
import { bacaKomisiPerPcs, periksaKomisiPerPcs } from "./komisi-spg";

/*
 * Komisi SPG per pcs (`Item.commissionPerPcs`) dari formulir barang (uji
 * akuntansi 2, bug 8 — kolomnya dipakai komisi SPG tetapi tidak bisa diisi dari
 * layar mana pun, jadi komisi per potong selalu 0).
 */

describe("bacaKomisiPerPcs", () => {
  it("tidak dikirim = tidak disentuh; kosong = 0; angka dibulatkan ke sen; koma desimal diterima", () => {
    expect(bacaKomisiPerPcs(undefined)).toBeUndefined();
    expect(bacaKomisiPerPcs(null)).toBe(0);
    expect(bacaKomisiPerPcs("  ")).toBe(0);
    expect(bacaKomisiPerPcs(10_000)).toBe(10_000);
    expect(bacaKomisiPerPcs("10000")).toBe(10_000);
    expect(bacaKomisiPerPcs("2500,5")).toBe(2_500.5);
    expect(bacaKomisiPerPcs(1_234.567)).toBe(1_234.57);
    expect(bacaKomisiPerPcs("sepuluh ribu")).toBeNaN();
  });
});

describe("periksaKomisiPerPcs", () => {
  it("barang jadi: 0 atau lebih; negatif dan bukan angka ditolak", () => {
    expect(periksaKomisiPerPcs(undefined, "FINISHED_GOOD")).toBeNull();
    expect(periksaKomisiPerPcs(0, "FINISHED_GOOD")).toBeNull();
    expect(periksaKomisiPerPcs(10_000, "FINISHED_GOOD")).toBeNull();
    expect(periksaKomisiPerPcs(-1, "FINISHED_GOOD")).toMatch(/^commissionPerPcs: /);
    expect(periksaKomisiPerPcs(Number.NaN, "FINISHED_GOOD")).toMatch(/^commissionPerPcs: /);
    expect(periksaKomisiPerPcs(1e15, "FINISHED_GOOD")).toMatch(/^commissionPerPcs: /);
  });

  it("bahan dan aksesori tidak dijual SPG: hanya 0 yang diterima", () => {
    expect(periksaKomisiPerPcs(0, "FABRIC")).toBeNull();
    expect(periksaKomisiPerPcs(5_000, "FABRIC")).toMatch(/^commissionPerPcs: .*barang jadi/);
    expect(periksaKomisiPerPcs(5_000, "ACCESSORIES")).toMatch(/^commissionPerPcs: /);
  });
});
