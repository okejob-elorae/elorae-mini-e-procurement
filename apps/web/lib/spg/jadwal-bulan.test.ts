import { describe, expect, it } from "vitest";
import {
  bulanBerikut,
  bulanBolehDiisiSpg,
  hariBelumTerisi,
  hariBerubahSejak,
  MAKS_ALASAN_JADWAL,
  potretSel,
  rapikanAlasanJadwal,
  rencanakanIsiJadwalBulanSpg,
  statusJadwalBulanDari,
} from "./jadwal-bulan";
import { SHIFT_BAWAAN } from "./pengaturan";

/**
 * Jadwal kerja bulanan SPG — bagian murni (P7c): SPG mengisi bulan berjalan dan berikutnya dari
 * HP, hari lewat tidak bisa diubah, hari di luar masa kerjanya tidak ditawarkan, dan "Ajukan ke
 * kantor" baru bisa sesudah setiap hari yang masih bisa diisi berisi.
 */

const dasar = {
  bulan: "2026-11",
  hariIni: "2026-11-10",
  userId: "dewi",
  mulai: null,
  akhir: null,
  sebelum: [],
  aturan: SHIFT_BAWAAN,
};

describe("bulan yang boleh diisi SPG", () => {
  it("bulan berjalan dan berikutnya (WIB), juga lintas tahun", () => {
    expect(bulanBolehDiisiSpg("2026-11-10")).toEqual(["2026-11", "2026-12"]);
    expect(bulanBolehDiisiSpg("2026-12-31")).toEqual(["2026-12", "2027-01"]);
    expect(bulanBerikut("2026-12")).toBe("2027-01");
  });
});

describe("rencanakanIsiJadwalBulanSpg", () => {
  it("bulan lalu dan dua bulan ke depan ditolak", () => {
    expect(rencanakanIsiJadwalBulanSpg({ ...dasar, bulan: "2026-10", isian: [{ userId: "dewi", day: "2026-10-31", isi: { jenis: "LIBUR" } }] })).toEqual({
      ok: false,
      kode: "BULAN_TIDAK_BOLEH",
    });
    expect(rencanakanIsiJadwalBulanSpg({ ...dasar, bulan: "2027-01", isian: [{ userId: "dewi", day: "2027-01-02", isi: { jenis: "LIBUR" } }] })).toMatchObject({
      ok: false,
      kode: "BULAN_TIDAK_BOLEH",
    });
  });

  it("hari di luar bulan itu → BUKAN_BULAN_INI; sebelum tanggal mulainya → DI_LUAR_MASA_KERJA", () => {
    expect(rencanakanIsiJadwalBulanSpg({ ...dasar, isian: [{ userId: "dewi", day: "2026-12-01", isi: { jenis: "LIBUR" } }] })).toEqual({
      ok: false,
      kode: "BUKAN_BULAN_INI",
      day: "2026-12-01",
    });
    expect(
      rencanakanIsiJadwalBulanSpg({ ...dasar, mulai: "2026-11-16", isian: [{ userId: "dewi", day: "2026-11-15", isi: { jenis: "KERJA", kode: "PAGI" } }] }),
    ).toEqual({ ok: false, kode: "DI_LUAR_MASA_KERJA", day: "2026-11-15" });
  });

  it("hari lewat tidak bisa diubah (aturan kisi yang sama); hari ini dan sesudahnya bisa; shift tak dikenal ditolak", () => {
    expect(rencanakanIsiJadwalBulanSpg({ ...dasar, isian: [{ userId: "dewi", day: "2026-11-09", isi: { jenis: "LIBUR" } }] })).toMatchObject({
      ok: false,
      kode: "HARI_LEWAT",
    });
    const r = rencanakanIsiJadwalBulanSpg({ ...dasar, isian: [{ userId: "dewi", day: "2026-11-10", isi: { jenis: "KERJA", kode: "PAGI" } }] });
    expect(r.ok).toBe(true);
    expect(rencanakanIsiJadwalBulanSpg({ ...dasar, isian: [{ userId: "dewi", day: "2026-11-11", isi: { jenis: "KERJA", kode: "MALAM" } }] })).toMatchObject({
      ok: false,
      kode: "SHIFT_TIDAK_DIKENAL",
    });
  });
});

describe("hariBelumTerisi", () => {
  const sel = (hari: string[]) => new Set(hari);

  it("hari kosong dari hari ini sampai akhir masa kerjanya; hari lewat yang kosong tidak termasuk", () => {
    const masa = { hariAwal: "2026-11-01", hariAkhir: "2026-11-30" };
    const terisi = Array.from({ length: 20 }, (_, i) => `2026-11-${String(i + 11).padStart(2, "0")}`).filter((d) => d !== "2026-11-25");
    // 1–9 November kosong (sudah lewat) tidak ikut; 10 dan 25 November kosong.
    expect(hariBelumTerisi({ bulan: "2026-11", hariIni: "2026-11-10", masa, sel: sel(terisi) })).toEqual(["2026-11-10", "2026-11-25"]);
  });

  it("mulai di tengah bulan: dihitung dari hari mulainya; berhenti: sampai hari terakhirnya; tanpa masa: kosong", () => {
    expect(hariBelumTerisi({ bulan: "2026-12", hariIni: "2026-11-10", masa: { hariAwal: "2026-12-29", hariAkhir: "2026-12-31" }, sel: sel(["2026-12-30"]) })).toEqual([
      "2026-12-29",
      "2026-12-31",
    ]);
    expect(hariBelumTerisi({ bulan: "2026-11", hariIni: "2026-11-10", masa: { hariAwal: "2026-11-01", hariAkhir: "2026-11-12" }, sel: sel([]) })).toEqual([
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
    ]);
    expect(hariBelumTerisi({ bulan: "2026-11", hariIni: "2026-11-10", masa: null, sel: sel([]) })).toEqual([]);
  });
});

describe("potret dan perubahan sejak disetujui", () => {
  it("potret sel urut hari; hari yang dibuat, diubah, atau dikosongkan sejak potret terakhir", () => {
    const lama = potretSel([
      { day: "2026-11-12", kind: "LIBUR", shiftCode: null },
      { day: "2026-11-11", kind: "KERJA", shiftCode: "PAGI" },
    ]);
    expect(Object.keys(lama)).toEqual(["2026-11-11", "2026-11-12"]);
    expect(lama["2026-11-11"]).toBe("KERJA:PAGI");
    const baru = potretSel([
      { day: "2026-11-11", kind: "KERJA", shiftCode: "SIANG" },
      { day: "2026-11-13", kind: "LIBUR", shiftCode: null },
    ]);
    expect(hariBerubahSejak(lama, baru)).toEqual(["2026-11-11", "2026-11-12", "2026-11-13"]);
    expect(hariBerubahSejak(null, baru)).toEqual([]);
  });
});

describe("alasan tolak / buka lagi", () => {
  it("wajib, dirapikan, paling panjang 300 huruf", () => {
    expect(rapikanAlasanJadwal("  ")).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(rapikanAlasanJadwal(undefined)).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(rapikanAlasanJadwal("x".repeat(MAKS_ALASAN_JADWAL + 1))).toEqual({ ok: false, kode: "ALASAN_TERLALU_PANJANG" });
    expect(rapikanAlasanJadwal("  hari Minggu belum diisi ")).toEqual({ ok: true, teks: "hari Minggu belum diisi" });
  });

  it("status dari teks basis data", () => {
    expect(statusJadwalBulanDari("DISETUJUI")).toBe("DISETUJUI");
    expect(statusJadwalBulanDari("LAIN")).toBeNull();
    expect(statusJadwalBulanDari(null)).toBeNull();
  });
});
