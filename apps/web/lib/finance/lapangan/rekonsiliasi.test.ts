import { describe, expect, it } from "vitest";
import { hitungBarisRekonsiliasi, ringkasRekonsiliasi, toleransiPembulatan } from "./rekonsiliasi";

const dasar = { storeId: "t1", storeName: "Toko A", diLuarJurnal: 0 };

describe("rekonsiliasi piutang toko", () => {
  it("cocok bila buku besar = sisa modul − kredit retur yang belum dipotong", () => {
    const b = hitungBarisRekonsiliasi({ ...dasar, bukuBesar: 900_000, modul: 1_000_000, kreditRetur: 100_000, jumlahPiutang: 1 });
    expect(b.harapan).toBe(900_000);
    expect(b.selisih).toBe(0);
    expect(b.cocok).toBe(true);
  });

  it("selisih di atas pembulatan rupiah per faktur ditandai", () => {
    expect(hitungBarisRekonsiliasi({ ...dasar, bukuBesar: 1_000_000.4, modul: 1_000_000, kreditRetur: 0, jumlahPiutang: 1 }).cocok).toBe(true);
    const b = hitungBarisRekonsiliasi({ ...dasar, bukuBesar: 1_000_000.6, modul: 1_000_000, kreditRetur: 0, jumlahPiutang: 1 });
    expect(b.cocok).toBe(false);
    expect(b.selisih).toBe(0.6);
    expect(toleransiPembulatan(0)).toBe(0.5);
    expect(toleransiPembulatan(4)).toBe(2);
  });

  it("ringkasan: toko tidak cocok di atas, total dijumlah dalam sen", () => {
    const r = ringkasRekonsiliasi({
      akun: null,
      tanggalMulai: "2026-08-01",
      tanpaToko: 0,
      baris: [
        { ...dasar, storeId: "a", storeName: "A", bukuBesar: 100.1, modul: 100.1, kreditRetur: 0, jumlahPiutang: 1 },
        { ...dasar, storeId: "b", storeName: "B", bukuBesar: 50, modul: 80, kreditRetur: 10, jumlahPiutang: 1, diLuarJurnal: 20 },
      ],
    });
    expect(r.baris.map((b) => b.storeId)).toEqual(["b", "a"]);
    expect(r.total).toEqual({ bukuBesar: 150.1, modul: 180.1, kreditRetur: 10, diLuarJurnal: 20, selisih: -20, tokoTidakCocok: 1 });
  });
});
