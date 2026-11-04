import { describe, expect, it } from "vitest";
import {
  ALASAN_TANPA_TRANSAKSI,
  CATATAN_HASIL_MAKS,
  adaTransaksiDiAntrean,
  adalahAlasan,
  adalahKodeHasil,
  putuskanHasilCheckout,
  ringkasHasil,
} from "./hasil-kunjungan";

const dasar = { spg: false, adaTransaksi: false, transaksiTertunda: false, alasanWajib: true };

describe("daftar alasan", () => {
  it("sembilan alasan, LAINNYA terakhir", () => {
    expect(ALASAN_TANPA_TRANSAKSI).toEqual([
      "TOKO_TUTUP",
      "PEMILIK_TIDAK_ADA",
      "STOK_MASIH_BANYAK",
      "HARGA",
      "PESAING",
      "MASALAH_BAYAR",
      "PESAN_LEWAT_WA",
      "KUNJUNGAN_RUTIN",
      "LAINNYA",
    ]);
  });

  it("TRANSAKSI adalah kode hasil tapi bukan alasan yang boleh dipilih salesman", () => {
    expect(adalahKodeHasil("TRANSAKSI")).toBe(true);
    expect(adalahKodeHasil("TRANSAKSI_TERTUNDA")).toBe(true);
    expect(adalahAlasan("TRANSAKSI")).toBe(false);
    expect(adalahAlasan("TOKO_TUTUP")).toBe(true);
    expect(adalahAlasan("toko_tutup")).toBe(false);
    expect(adalahKodeHasil(null)).toBe(false);
  });
});

describe("putuskanHasilCheckout", () => {
  it("SPG: check-in adalah absensi — tidak ada hasil kunjungan, tidak pernah ditolak", () => {
    expect(putuskanHasilCheckout({ ...dasar, spg: true })).toEqual({ ok: true, outcome: null, outcomeNote: null });
    expect(putuskanHasilCheckout({ ...dasar, spg: true, alasan: "HARGA" })).toEqual({
      ok: true,
      outcome: null,
      outcomeNote: null,
    });
  });

  it("ada transaksi → TRANSAKSI otomatis, alasan dari HP diabaikan", () => {
    expect(putuskanHasilCheckout({ ...dasar, adaTransaksi: true })).toEqual({
      ok: true,
      outcome: "TRANSAKSI",
      outcomeNote: null,
    });
    expect(putuskanHasilCheckout({ ...dasar, adaTransaksi: true, alasan: "HARGA", catatan: "x" })).toEqual({
      ok: true,
      outcome: "TRANSAKSI",
      outcomeNote: null,
    });
  });

  it("transaksi masih di antrean HP → TRANSAKSI_TERTUNDA, dibedakan dari yang sudah terbukti di server", () => {
    expect(putuskanHasilCheckout({ ...dasar, transaksiTertunda: true })).toEqual({
      ok: true,
      outcome: "TRANSAKSI_TERTUNDA",
      outcomeNote: null,
    });
  });

  it("tanpa transaksi dan alasan wajib → HASIL_WAJIB bila alasan tidak dikirim", () => {
    expect(putuskanHasilCheckout(dasar)).toEqual({ ok: false, code: "HASIL_WAJIB" });
    expect(putuskanHasilCheckout({ ...dasar, alasan: "" })).toEqual({ ok: false, code: "HASIL_WAJIB" });
    expect(putuskanHasilCheckout({ ...dasar, alasan: null })).toEqual({ ok: false, code: "HASIL_WAJIB" });
  });

  it("tanpa transaksi dan alasan tidak wajib → boleh pulang tanpa hasil", () => {
    expect(putuskanHasilCheckout({ ...dasar, alasanWajib: false })).toEqual({
      ok: true,
      outcome: null,
      outcomeNote: null,
    });
  });

  it("alasan yang dikirim tetap disimpan meski tidak wajib", () => {
    expect(putuskanHasilCheckout({ ...dasar, alasanWajib: false, alasan: "PESAING" })).toEqual({
      ok: true,
      outcome: "PESAING",
      outcomeNote: null,
    });
  });

  it("alasan sah disimpan beserta catatan yang dirapikan", () => {
    expect(putuskanHasilCheckout({ ...dasar, alasan: "TOKO_TUTUP", catatan: "  tutup renovasi  " })).toEqual({
      ok: true,
      outcome: "TOKO_TUTUP",
      outcomeNote: "tutup renovasi",
    });
    expect(putuskanHasilCheckout({ ...dasar, alasan: "HARGA", catatan: "   " })).toEqual({
      ok: true,
      outcome: "HARGA",
      outcomeNote: null,
    });
  });

  it("alasan tak dikenal atau kode otomatis dari HP → HASIL_TIDAK_SAH", () => {
    expect(putuskanHasilCheckout({ ...dasar, alasan: "BOSAN" })).toEqual({ ok: false, code: "HASIL_TIDAK_SAH" });
    expect(putuskanHasilCheckout({ ...dasar, alasan: "TRANSAKSI" })).toEqual({ ok: false, code: "HASIL_TIDAK_SAH" });
    expect(putuskanHasilCheckout({ ...dasar, alasan: 7 })).toEqual({ ok: false, code: "HASIL_TIDAK_SAH" });
  });

  it("LAINNYA wajib disertai catatan", () => {
    expect(putuskanHasilCheckout({ ...dasar, alasan: "LAINNYA" })).toEqual({ ok: false, code: "CATATAN_WAJIB" });
    expect(putuskanHasilCheckout({ ...dasar, alasan: "LAINNYA", catatan: "  " })).toEqual({
      ok: false,
      code: "CATATAN_WAJIB",
    });
    expect(putuskanHasilCheckout({ ...dasar, alasan: "LAINNYA", catatan: "pemilik sakit" })).toEqual({
      ok: true,
      outcome: "LAINNYA",
      outcomeNote: "pemilik sakit",
    });
  });

  it("catatan dipotong di batas maksimal, catatan bukan teks diabaikan", () => {
    const panjang = "a".repeat(CATATAN_HASIL_MAKS + 50);
    const h = putuskanHasilCheckout({ ...dasar, alasan: "HARGA", catatan: panjang });
    expect(h.ok && h.outcomeNote?.length).toBe(CATATAN_HASIL_MAKS);
    expect(putuskanHasilCheckout({ ...dasar, alasan: "HARGA", catatan: 42 })).toEqual({
      ok: true,
      outcome: "HARGA",
      outcomeNote: null,
    });
  });
});

describe("adaTransaksiDiAntrean", () => {
  const kosong = { pesanan: [], klaim: [], retur: [] };
  const acuan = { visitId: "v1", storeId: "s1", sejakMs: 1_000 };

  it("antrean kosong → tidak ada", () => {
    expect(adaTransaksiDiAntrean(kosong, acuan)).toBe(false);
  });

  it("pesanan yang terikat kunjungan ini dan belum gagal → ada", () => {
    expect(
      adaTransaksiDiAntrean({ ...kosong, pesanan: [{ visitId: "v1", storeId: "s1", syncState: "pending" }] }, acuan),
    ).toBe(true);
    expect(
      adaTransaksiDiAntrean({ ...kosong, pesanan: [{ visitId: "v1", storeId: "s1", syncState: "syncing" }] }, acuan),
    ).toBe(true);
  });

  it("pesanan kunjungan lain, atau yang sudah gagal, tidak dihitung", () => {
    expect(
      adaTransaksiDiAntrean({ ...kosong, pesanan: [{ visitId: "v2", storeId: "s1", syncState: "pending" }] }, acuan),
    ).toBe(false);
    expect(
      adaTransaksiDiAntrean({ ...kosong, pesanan: [{ visitId: "v1", storeId: "s1", syncState: "failed" }] }, acuan),
    ).toBe(false);
  });

  it("klaim/retur untuk toko ini sejak check-in → ada; yang lebih lama atau toko lain tidak", () => {
    expect(
      adaTransaksiDiAntrean({ ...kosong, klaim: [{ storeId: "s1", capturedAt: 1_500, syncState: "pending" }] }, acuan),
    ).toBe(true);
    expect(
      adaTransaksiDiAntrean({ ...kosong, retur: [{ storeId: "s1", capturedAt: 1_000, syncState: "pending" }] }, acuan),
    ).toBe(true);
    expect(
      adaTransaksiDiAntrean({ ...kosong, klaim: [{ storeId: "s1", capturedAt: 999, syncState: "pending" }] }, acuan),
    ).toBe(false);
    expect(
      adaTransaksiDiAntrean({ ...kosong, retur: [{ storeId: "s2", capturedAt: 1_500, syncState: "pending" }] }, acuan),
    ).toBe(false);
    expect(
      adaTransaksiDiAntrean({ ...kosong, retur: [{ storeId: "s1", capturedAt: 1_500, syncState: "failed" }] }, acuan),
    ).toBe(false);
  });
});

describe("ringkasHasil", () => {
  it("hanya kunjungan salesman yang sudah selesai yang dihitung", () => {
    const r = ringkasHasil([
      { outcome: "TRANSAKSI", selesai: true, spg: false },
      { outcome: null, selesai: false, spg: false },
      { outcome: null, selesai: true, spg: true },
    ]);
    expect(r).toEqual({ total: 1, transaksi: 1, perKode: [{ kode: "TRANSAKSI", jumlah: 1 }] });
  });

  it("transaksi = TRANSAKSI + TRANSAKSI_TERTUNDA; kosong dan kode tak dikenal jadi KOSONG", () => {
    const r = ringkasHasil([
      { outcome: "HARGA", selesai: true, spg: false },
      { outcome: "HARGA", selesai: true, spg: false },
      { outcome: "TRANSAKSI", selesai: true, spg: false },
      { outcome: "TRANSAKSI_TERTUNDA", selesai: true, spg: false },
      { outcome: null, selesai: true, spg: false },
      { outcome: "ANEH", selesai: true, spg: false },
      { outcome: "TOKO_TUTUP", selesai: true, spg: false },
    ]);
    expect(r.total).toBe(7);
    expect(r.transaksi).toBe(2);
    expect(r.perKode).toEqual([
      { kode: "HARGA", jumlah: 2 },
      { kode: "KOSONG", jumlah: 2 },
      { kode: "TRANSAKSI", jumlah: 1 },
      { kode: "TRANSAKSI_TERTUNDA", jumlah: 1 },
      { kode: "TOKO_TUTUP", jumlah: 1 },
    ]);
  });

  it("tanpa kunjungan → nol", () => {
    expect(ringkasHasil([])).toEqual({ total: 0, transaksi: 0, perKode: [] });
  });
});
