import { describe, expect, it } from "vitest";
import { bacaCari, bacaHalaman, cocokCari, denganParam, potongHalaman, UKURAN_HALAMAN } from "./halaman";

/*
 * Daftar modul piutang dan konsinyasi (faktur, BKM, kontrabon, retur, siklus)
 * memuat semua baris sekaligus. Saringan dan halamannya dikerjakan di server;
 * berkas ini aturan murninya.
 */

describe("bacaHalaman", () => {
  it("menerima bilangan bulat positif, sisanya halaman 1", () => {
    expect(bacaHalaman("3")).toBe(3);
    expect(bacaHalaman(undefined)).toBe(1);
    expect(bacaHalaman("0")).toBe(1);
    expect(bacaHalaman("-2")).toBe(1);
    expect(bacaHalaman("2.5")).toBe(1);
    expect(bacaHalaman("abc")).toBe(1);
  });
});

describe("bacaCari", () => {
  it("memangkas spasi dan membatasi panjangnya", () => {
    expect(bacaCari("  INV/2026  ")).toBe("INV/2026");
    expect(bacaCari(undefined)).toBe("");
    expect(bacaCari("x".repeat(300))).toHaveLength(100);
  });
});

describe("cocokCari", () => {
  it("abai huruf besar-kecil dan tanda aksen, di salah satu teks", () => {
    expect(cocokCari("sinar", "INV/2026/0101", "Toko Sinar Jaya")).toBe(true);
    expect(cocokCari("ELORAÉ", "Butik Eloraé")).toBe(true);
    expect(cocokCari("inv/2026/01", "INV/2026/0101")).toBe(true);
    expect(cocokCari("makmur", "INV/2026/0101", "Toko Sinar Jaya", null)).toBe(false);
  });

  it("kata kunci kosong cocok dengan semua", () => {
    expect(cocokCari("", "apa saja")).toBe(true);
  });
});

describe("potongHalaman", () => {
  const baris = Array.from({ length: 57 }, (_, i) => i + 1);

  it("memotong 25 baris per halaman dan melaporkan totalnya", () => {
    expect(UKURAN_HALAMAN).toBe(25);
    const h = potongHalaman(baris, 2);
    expect(h.baris[0]).toBe(26);
    expect(h.baris).toHaveLength(25);
    expect(h).toMatchObject({ halaman: 2, totalHalaman: 3, total: 57 });
    expect(potongHalaman(baris, 3).baris).toEqual([51, 52, 53, 54, 55, 56, 57]);
  });

  it("halaman di luar jangkauan jatuh ke halaman terakhir, bukan daftar kosong", () => {
    // Saringan baru yang menyusutkan hasil tidak boleh mendarat di halaman kosong.
    const h = potongHalaman(baris, 9);
    expect(h.halaman).toBe(3);
    expect(h.baris[0]).toBe(51);
  });

  it("daftar kosong tetap satu halaman", () => {
    expect(potongHalaman([], 4)).toEqual({ baris: [], halaman: 1, totalHalaman: 1, total: 0, ukuran: 25 });
  });
});

describe("denganParam", () => {
  it("mengganti, menambah, dan menghapus parameter tanpa menyentuh yang lain", () => {
    const sp = new URLSearchParams("keadaan=lewat&halaman=3");
    expect(denganParam("/backoffice/piutang", sp, { cari: "INV 1", halaman: null })).toBe(
      "/backoffice/piutang?keadaan=lewat&cari=INV+1",
    );
    expect(denganParam("/backoffice/piutang", { keadaan: "lewat", cari: "" }, { keadaan: null })).toBe("/backoffice/piutang");
  });
});
