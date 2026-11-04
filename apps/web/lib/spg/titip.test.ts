import { describe, expect, it } from "vitest";
import {
  batasSimpanDari,
  bolehDikabari,
  kelompokTitip,
  labelVarian,
  lewatMasaSimpan,
  pesanTitipTersedia,
  stokUntukPermintaan,
  tambahHari,
  tanggalPanjang,
} from "./titip";

describe("masa simpan (hari WIB)", () => {
  it("counts from today's WIB date, not the UTC one", () => {
    // 2026-10-03 23:30 WIB = 16:30 UTC; the WIB day is the 3rd.
    expect(batasSimpanDari(new Date("2026-10-03T16:30:00Z"), 3)).toBe("2026-10-06");
    // 2026-10-04 00:30 WIB = 2026-10-03 17:30 UTC; the WIB day is already the 4th.
    expect(batasSimpanDari(new Date("2026-10-03T17:30:00Z"), 3)).toBe("2026-10-07");
  });

  it("adds calendar days across months and years", () => {
    expect(tambahHari("2026-10-30", 3)).toBe("2026-11-02");
    expect(tambahHari("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("is past the hold only AFTER the last held day", () => {
    expect(lewatMasaSimpan("2026-10-06", "2026-10-06")).toBe(false);
    expect(lewatMasaSimpan("2026-10-06", "2026-10-07")).toBe(true);
    expect(lewatMasaSimpan(null, "2026-10-07")).toBe(false);
  });
});

describe("stokUntukPermintaan", () => {
  const saldo = new Map([
    ["kemeja::KMJ-M", 0],
    ["kemeja::KMJ-L", 2],
    ["kemeja::KMJ-XL", -1],
    ["kaos::", 4],
  ]);

  it("reads one variant's balance, never below zero", () => {
    expect(stokUntukPermintaan("kemeja", "KMJ-L", saldo)).toBe(2);
    expect(stokUntukPermintaan("kemeja", "KMJ-M", saldo)).toBe(0);
    expect(stokUntukPermintaan("kemeja", "KMJ-XL", saldo)).toBe(0);
    expect(stokUntukPermintaan("kemeja", "KMJ-S", saldo)).toBe(0);
  });

  it("treats an empty variant as any variant: a negative size does not cancel a size on the shelf", () => {
    expect(stokUntukPermintaan("kemeja", "", saldo)).toBe(2);
    expect(stokUntukPermintaan("kemeja", null, saldo)).toBe(2);
    expect(stokUntukPermintaan("kaos", "", saldo)).toBe(4);
  });

  it("never matches a free-text request or another item with the same prefix", () => {
    expect(stokUntukPermintaan(null, "", saldo)).toBe(0);
    expect(stokUntukPermintaan("kem", "", saldo)).toBe(0);
  });
});

describe("kelompok & kabari", () => {
  it("shows a waiting request whose goods are on the shelf as arrived", () => {
    expect(kelompokTitip("MENUNGGU", 1)).toBe("datang");
    expect(kelompokTitip("MENUNGGU", 0)).toBe("menunggu");
    expect(kelompokTitip("TERSEDIA", 0)).toBe("datang");
    expect(kelompokTitip("DIKABARI", 0)).toBe("dikabari");
    expect(kelompokTitip("SELESAI", 5)).toBe("tutup");
    expect(kelompokTitip("BATAL", 5)).toBe("tutup");
  });

  it("lets the SPG notify only when the goods are there, or judge free-text requests herself", () => {
    expect(bolehDikabari("MENUNGGU", 0, true)).toBe(false);
    expect(bolehDikabari("MENUNGGU", 2, true)).toBe(true);
    expect(bolehDikabari("MENUNGGU", 0, false)).toBe(true);
    expect(bolehDikabari("TERSEDIA", 0, true)).toBe(true);
    expect(bolehDikabari("DIKABARI", 0, true)).toBe(true);
    expect(bolehDikabari("SELESAI", 3, true)).toBe(false);
    expect(bolehDikabari("BATAL", 3, false)).toBe(false);
  });
});

describe("pesanTitipTersedia", () => {
  const pesan = pesanTitipTersedia({
    namaPembeli: "Rina",
    namaToko: "Toko Sinar Jaya",
    barang: "Kemeja Flanel",
    varian: "Hitam, XL",
    qty: 2,
    sampai: "2026-10-06",
  });

  it("names the store, the goods with their size, and the last day held — in Indonesian", () => {
    expect(pesan).toContain("Halo Kak Rina");
    expect(pesan).toContain("Toko Sinar Jaya");
    expect(pesan).toContain("Kemeja Flanel (Hitam, XL) sebanyak 2 pcs");
    expect(pesan).toContain("simpankan sampai Selasa, 6 Oktober 2026");
  });

  it("never carries a price", () => {
    expect(pesan).not.toMatch(/Rp|\d{2,}\.\d{3}|harga/i);
  });

  it("drops the size and the count when there is nothing to say", () => {
    const p = pesanTitipTersedia({ namaPembeli: "", namaToko: "Toko A", barang: "Celana chino", varian: null, qty: 1, sampai: "2026-10-06" });
    expect(p).toContain("Halo Kak, kami dari Toko A.");
    expect(p).toContain("Celana chino yang Kakak minta dikabari");
    expect(p).not.toContain("()");
    expect(p).not.toContain("pcs");
  });

  it("formats the long date in WIB", () => {
    expect(tanggalPanjang("2026-12-31")).toBe("Kamis, 31 Desember 2026");
  });
});

describe("labelVarian", () => {
  it("joins colour and size, falling back to the SKU", () => {
    expect(labelVarian({ warna: "Hitam", ukuran: "XL" }, "SKU-1")).toBe("Hitam, XL");
    expect(labelVarian({ warna: null, ukuran: "XL" }, "SKU-1")).toBe("XL");
    expect(labelVarian({ warna: null, ukuran: null }, "SKU-1")).toBe("SKU-1");
    expect(labelVarian(null, null)).toBeNull();
  });
});
