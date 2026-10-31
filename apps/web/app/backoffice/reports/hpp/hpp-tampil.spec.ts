import { describe, expect, it } from "vitest";
import {
  alamatSaringanHpp,
  bacaSaringanHpp,
  formatQty,
  hppSatuan,
  lolosStatus,
  SARINGAN_HPP_BAWAAN,
} from "./hpp-tampil";

/*
 * Halaman HPP: saringan tersimpan di alamat (bisa dibagikan, tetap sesudah
 * muat ulang), WO dibatalkan tersembunyi secara bawaan, qty bulat tanpa ",00",
 * dan SATU angka HPP/pcs untuk satu WO di tabel maupun dialog.
 */

describe("bacaSaringanHpp / alamatSaringanHpp", () => {
  it("tanpa parameter: semua barang & pemasok, tanpa tanggal, WO dibatalkan disembunyikan", () => {
    expect(bacaSaringanHpp({})).toEqual(SARINGAN_HPP_BAWAAN);
    expect(SARINGAN_HPP_BAWAAN.status).toBe("AKTIF");
    expect(alamatSaringanHpp(SARINGAN_HPP_BAWAAN)).toBe("");
  });

  it("membaca dan menulis setiap saringan; nilai bawaan tidak ditulis", () => {
    const s = bacaSaringanHpp({ barang: "fg1", vendor: "v1", dari: "2026-10-01", sampai: "2026-10-31", status: "CANCELLED" });
    expect(s).toEqual({ barang: "fg1", vendor: "v1", dari: "2026-10-01", sampai: "2026-10-31", status: "CANCELLED" });
    expect(alamatSaringanHpp(s)).toBe("?barang=fg1&vendor=v1&dari=2026-10-01&sampai=2026-10-31&status=CANCELLED");
    expect(alamatSaringanHpp({ ...SARINGAN_HPP_BAWAAN, status: "SEMUA" })).toBe("?status=SEMUA");
  });

  it("nilai asing diabaikan — tanggal rusak, status tak dikenal, parameter ganda", () => {
    expect(bacaSaringanHpp({ dari: "kemarin", status: "APA", barang: ["a", "b"] })).toEqual({
      ...SARINGAN_HPP_BAWAAN,
      barang: "a",
    });
  });
});

describe("lolosStatus", () => {
  it("bawaan menyembunyikan WO dibatalkan; SEMUA menampilkannya; satu status = status itu saja", () => {
    expect(lolosStatus("CANCELLED", "AKTIF")).toBe(false);
    expect(lolosStatus("DRAFT", "AKTIF")).toBe(true);
    expect(lolosStatus("CANCELLED", "SEMUA")).toBe(true);
    expect(lolosStatus("COMPLETED", "IN_PRODUCTION")).toBe(false);
    expect(lolosStatus("IN_PRODUCTION", "IN_PRODUCTION")).toBe(true);
  });
});

describe("formatQty", () => {
  it("bilangan bulat tanpa desimal, pecahan sampai tiga angka, gaya Indonesia", () => {
    expect(formatQty(50)).toBe("50");
    expect(formatQty(1250)).toBe("1.250");
    expect(formatQty(1.25)).toBe("1,25");
    expect(formatQty(0.3333333)).toBe("0,333");
    expect(formatQty(null)).toBe("—");
  });
});

describe("hppSatuan — satu definisi HPP/pcs", () => {
  // WO/2026/HPP01: kain 59.200 + aksesoris 10.050 (sudah ber-PPN) + jasa 26.750
  // (belum) = 96.000 tercatat; jasa dinaikkan PPN 11% → 98.942,50 bila semua ber-PPN.
  const wo = { subtotal: 96_000, nettSubtotal: 98_942.5 };

  it("angka utama = biaya tercatat (dasar harga jual); 'bila semua termasuk PPN' disebut terpisah", () => {
    expect(hppSatuan(wo)).toEqual({ tercatat: 96_000, termasukPpn: 98_942.5 });
  });

  it("tanpa nilai termasuk PPN: sama dengan biaya tercatat", () => {
    expect(hppSatuan({ subtotal: 50_000 })).toEqual({ tercatat: 50_000, termasukPpn: 50_000 });
  });
});
