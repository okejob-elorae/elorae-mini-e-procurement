import { describe, expect, it } from "vitest";
import { catatanRiwayatPo } from "./catatan-riwayat";

/*
 * Catatan riwayat status PO ditulis penulis lama dalam bahasa Inggris
 * ("GRN issued: GRN/2026/08/0002", "Supplier payment marked", data contoh
 * "Partial GRN received"). Teks tetap itu diperlakukan sebagai KODE tindakan
 * dan ditampilkan lewat i18n; alasan yang diketik orang tampil apa adanya.
 */
describe("catatanRiwayatPo", () => {
  it("GRN diterima membawa nomor GRN-nya", () => {
    expect(catatanRiwayatPo("GRN issued: GRN/2026/08/0002")).toEqual({
      kunci: "grnDiterima",
      nilai: { nomor: "GRN/2026/08/0002" },
    });
  });

  it("keputusan pemilik atas terima-lebih", () => {
    expect(catatanRiwayatPo("GRN owner-approved: GRN/2026/08/0003")).toEqual({
      kunci: "grnDisetujuiPemilik",
      nilai: { nomor: "GRN/2026/08/0003" },
    });
    expect(catatanRiwayatPo("GRN owner-declined: GRN/2026/08/0004")).toEqual({
      kunci: "grnDitolakPemilik",
      nilai: { nomor: "GRN/2026/08/0004" },
    });
  });

  it("teks tetap tanpa nilai", () => {
    expect(catatanRiwayatPo("PO Created")).toEqual({ kunci: "dibuat", nilai: {} });
    expect(catatanRiwayatPo("PO Edited (PIN verified)")).toEqual({ kunci: "diubahPin", nilai: {} });
    expect(catatanRiwayatPo("Supplier payment marked")).toEqual({ kunci: "bayarDitandai", nilai: {} });
    expect(catatanRiwayatPo("Supplier payment unmarked")).toEqual({ kunci: "bayarDibatalkan", nilai: {} });
    expect(catatanRiwayatPo("Partial GRN received")).toEqual({ kunci: "grnSebagian", nilai: {} });
    expect(catatanRiwayatPo("PO Cancelled")).toEqual({ kunci: "dibatalkan", nilai: {} });
  });

  it("perubahan status otomatis memakai label status, bukan kode mentah", () => {
    expect(catatanRiwayatPo("Status changed to SUBMITTED")).toEqual({
      kunci: "statusBerubah",
      nilai: { status: "SUBMITTED" },
    });
  });

  it("Tutup PO: alasan yang diketik dibawa sebagai nilai", () => {
    expect(catatanRiwayatPo("Ditutup sebelum lengkap: pemasok tidak sanggup")).toEqual({
      kunci: "ditutup",
      nilai: { alasan: "pemasok tidak sanggup" },
    });
  });

  it("retur pemasok yang diproses (ditulis processReturn ke riwayat PO dari WO-nya)", () => {
    expect(catatanRiwayatPo("Vendor return RET/2026/08/0002 processed (WO WO/2026/0005)")).toEqual({
      kunci: "returDiproses",
      nilai: { retur: "RET/2026/08/0002", wo: "WO/2026/0005" },
    });
  });

  it("alasan yang diketik orang tampil apa adanya", () => {
    expect(catatanRiwayatPo("Salah pemasok, diganti PO/2026/0009")).toEqual({ teks: "Salah pemasok, diganti PO/2026/0009" });
  });

  it("kosong → null", () => {
    expect(catatanRiwayatPo(null)).toBeNull();
    expect(catatanRiwayatPo("   ")).toBeNull();
  });
});
