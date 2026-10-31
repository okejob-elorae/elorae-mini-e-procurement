import { describe, expect, it } from "vitest";
import {
  alamatUbahPesanan,
  alasanDiganti,
  bacaIdGanti,
  catatanUntukDiubah,
  dibatalkanSalesman,
  periksaAlasanBatal,
  tambahCadanganLama,
} from "./ganti-pesanan";

describe("periksaAlasanBatal", () => {
  it("requires a reason and trims it", () => {
    expect(periksaAlasanBatal("  toko batal pesan  ")).toEqual({ ok: true, alasan: "toko batal pesan" });
    expect(periksaAlasanBatal("")).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(periksaAlasanBatal("   \n ")).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(periksaAlasanBatal(undefined)).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(periksaAlasanBatal(42)).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
  });

  it("allows exactly 500 characters and refuses 501", () => {
    expect(periksaAlasanBatal("a".repeat(500))).toEqual({ ok: true, alasan: "a".repeat(500) });
    expect(periksaAlasanBatal("a".repeat(501))).toEqual({ ok: false, kode: "ALASAN_TERLALU_PANJANG" });
    // Spasi di tepi tidak ikut dihitung.
    expect(periksaAlasanBatal(`  ${"a".repeat(500)}  `)).toEqual({ ok: true, alasan: "a".repeat(500) });
  });
});

describe("alasanDiganti / alamatUbahPesanan", () => {
  it("names the new order", () => {
    expect(alasanDiganti("PUTUS/2026/0042")).toBe("Diganti dengan PUTUS/2026/0042");
  });

  it("builds the catalog address with the order id", () => {
    expect(alamatUbahPesanan("s1", "o1")).toBe("/pwa/stores/s1/catalog?ganti=o1");
  });
});

describe("bacaIdGanti", () => {
  it("accepts an id-shaped value and ignores anything else", () => {
    expect(bacaIdGanti("cmabc123_x-Y")).toBe("cmabc123_x-Y");
    expect(bacaIdGanti(["o1", "o2"])).toBe("o1");
    expect(bacaIdGanti(undefined)).toBeNull();
    expect(bacaIdGanti("")).toBeNull();
    expect(bacaIdGanti("../x")).toBeNull();
    expect(bacaIdGanti("a".repeat(65))).toBeNull();
  });
});

describe("dibatalkanSalesman", () => {
  it("is only a REJECTED order carrying a canceller", () => {
    expect(dibatalkanSalesman({ status: "REJECTED", cancelledById: "u1" })).toBe(true);
    expect(dibatalkanSalesman({ status: "REJECTED", cancelledById: null })).toBe(false);
    expect(dibatalkanSalesman({ status: "PENDING_APPROVAL", cancelledById: "u1" })).toBe(false);
    expect(dibatalkanSalesman({ status: "REJECTED", cancelledById: undefined })).toBe(false);
  });
});

describe("catatanUntukDiubah", () => {
  it("drops the system-written bonus shortage lines and keeps the salesman's own note", () => {
    const catatan = "Kirim sebelum Jumat\n[Bonus] Kurang 2 pcs Kaos (promo Beli 6) — stok tidak cukup.";
    expect(catatanUntukDiubah(catatan)).toBe("Kirim sebelum Jumat");
    expect(catatanUntukDiubah("[Bonus] Kurang 1 pcs X (promo Y) — stok tidak cukup.")).toBe("");
    expect(catatanUntukDiubah(null)).toBe("");
    expect(catatanUntukDiubah("Bonus kurang? tanya kantor")).toBe("Bonus kurang? tanya kantor");
  });
});

describe("tambahCadanganLama", () => {
  const katalog = [
    { itemId: "kaos", available: 3, variants: [{ variantSku: "K-M", available: 1, variantLabel: "M" }, { variantSku: "K-L", available: 2, variantLabel: "L" }] },
    { itemId: "kemeja", available: 0, variants: [] },
    { itemId: "topi", available: 5, variants: [] },
  ];

  it("adds the old order's held stock back to the variant and the item total", () => {
    const hasil = tambahCadanganLama(katalog, { "kaos::K-M": 4, "kemeja::": 2 });
    expect(hasil[0].available).toBe(7);
    expect(hasil[0].variants).toEqual([
      { variantSku: "K-M", available: 5, variantLabel: "M" },
      { variantSku: "K-L", available: 2, variantLabel: "L" },
    ]);
    expect(hasil[1].available).toBe(2);
    // Barang yang tidak dipegang pesanan lama tetap objek yang sama.
    expect(hasil[2]).toBe(katalog[2]);
  });

  it("ignores holds for items no longer in the catalog and never mutates the input", () => {
    const hasil = tambahCadanganLama(katalog, { "hilang::": 9 });
    expect(hasil).toEqual(katalog);
    expect(katalog[0].available).toBe(3);
  });

  it("an empty hold map returns the catalog unchanged", () => {
    expect(tambahCadanganLama(katalog, {})).toEqual(katalog);
  });
});
