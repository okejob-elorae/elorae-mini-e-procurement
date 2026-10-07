import { describe, expect, it } from "vitest";
import { PESAN_PEMILIK_GRN, kodeTolakPemilikGrn } from "./kode-pemilik";

/*
 * Setuju/tolak terima-lebih oleh pemilik dulu menampilkan `err.message` —
 * di build produksi Next menyamarkannya jadi galat umum. Aksi pembungkus
 * `putuskanGRNPemilik` mengembalikan kode; pesan tetap yang dilempar
 * `approveGRNByOwner`/`declineGRNByOwner` diterjemahkan di sini.
 */
describe("kodeTolakPemilikGrn", () => {
  it("setiap pesan tetap punya kodenya", () => {
    expect(kodeTolakPemilikGrn(new Error(PESAN_PEMILIK_GRN.TIDAK_DITEMUKAN))).toBe("TIDAK_DITEMUKAN");
    expect(kodeTolakPemilikGrn(new Error(PESAN_PEMILIK_GRN.SUDAH_DITOLAK))).toBe("SUDAH_DIPUTUSKAN");
    expect(kodeTolakPemilikGrn(new Error(PESAN_PEMILIK_GRN.SUDAH_DISETUJUI))).toBe("SUDAH_DIPUTUSKAN");
    expect(kodeTolakPemilikGrn(new Error(PESAN_PEMILIK_GRN.TIDAK_MENUNGGU))).toBe("TIDAK_MENUNGGU");
    expect(kodeTolakPemilikGrn(new Error(PESAN_PEMILIK_GRN.ROL_SUDAH_DIPAKAI))).toBe("ROL_SUDAH_DIPAKAI");
    expect(kodeTolakPemilikGrn(new Error(PESAN_PEMILIK_GRN.STOK_KURANG))).toBe("STOK_KURANG");
    expect(kodeTolakPemilikGrn(new Error(PESAN_PEMILIK_GRN.QTY_PO_NEGATIF))).toBe("DATA_TIDAK_KONSISTEN");
    expect(kodeTolakPemilikGrn(new Error(PESAN_PEMILIK_GRN.TANPA_BARIS))).toBe("DATA_TIDAK_KONSISTEN");
  });

  it("harga satuan rusak (pesannya membawa id barang) → data tidak konsisten", () => {
    expect(kodeTolakPemilikGrn(new Error(`${PESAN_PEMILIK_GRN.HARGA_TIDAK_SAH} item-123`))).toBe("DATA_TIDAK_KONSISTEN");
  });

  it("galat lain (sambungan, basis data) → GAGAL", () => {
    expect(kodeTolakPemilikGrn(new Error("Connection reset"))).toBe("GAGAL");
    expect(kodeTolakPemilikGrn("bukan error")).toBe("GAGAL");
  });
});
