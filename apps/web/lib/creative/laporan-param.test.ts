import { describe, expect, it } from "vitest";
import {
  alamatBayar,
  alamatCetakRekap,
  alamatLaporan,
  bacaParamBayar,
  bacaParamLaporan,
  namaBerkasRekap,
} from "./laporan-param";

const HARI_INI = "2026-10-07";

describe("alamat Pembayaran", () => {
  it("membaca bawaan dan menolak isian asing", () => {
    expect(bacaParamBayar({})).toEqual({ chip: "BELUM", cari: "", campaign: null, halaman: 1, per: 25 });
    expect(bacaParamBayar({ chip: "LUNAS", cari: " nadia ", campaign: "c1", halaman: "3", per: "50" })).toEqual({
      chip: "LUNAS",
      cari: "nadia",
      campaign: "c1",
      halaman: 3,
      per: 50,
    });
    expect(bacaParamBayar({ chip: "x", halaman: "-1", per: "33" })).toMatchObject({ chip: "BELUM", halaman: 1, per: 25 });
  });

  it("bolak-balik tanpa menulis bawaan", () => {
    expect(alamatBayar(bacaParamBayar({}))).toBe("/backoffice/kreatif/pembayaran");
    const p = bacaParamBayar({ chip: "SEMUA", cari: "@rina", campaign: "c1", halaman: "2", per: "100" });
    expect(bacaParamBayar(Object.fromEntries(new URL(alamatBayar(p), "http://x").searchParams))).toEqual(p);
  });
});

describe("alamat Laporan", () => {
  it("bawaan periode per tab", () => {
    expect(bacaParamLaporan({}, HARI_INI)).toMatchObject({ tab: "peringkat", periode: "bulanIni", rentang: { dari: "2026-10-01", sampai: HARI_INI } });
    expect(bacaParamLaporan({ tab: "rekap" }, HARI_INI)).toMatchObject({ tab: "rekap", periode: "hariIni", rentang: { dari: HARI_INI, sampai: HARI_INI } });
    expect(bacaParamLaporan({ periode: "semua" }, HARI_INI).rentang).toBeNull();
  });

  it("rentang tersimpan di alamat; saringan peringkat tidak ikut ke rekap", () => {
    const p = bacaParamLaporan({ periode: "rentang", dari: "2026-09-01", sampai: "2026-09-15", cari: "nadia", urut: "roas", halaman: "2" }, HARI_INI);
    expect(alamatLaporan(p)).toBe("/backoffice/kreatif/laporan?periode=rentang&dari=2026-09-01&sampai=2026-09-15&cari=nadia&urut=roas&halaman=2");
    expect(alamatLaporan({ ...p, tab: "rekap" })).toBe("/backoffice/kreatif/laporan?tab=rekap&periode=rentang&dari=2026-09-01&sampai=2026-09-15");
    expect(alamatLaporan(bacaParamLaporan({ tab: "rekap" }, HARI_INI))).toBe("/backoffice/kreatif/laporan?tab=rekap");
  });

  it("cetak dan nama berkas rekap", () => {
    expect(alamatCetakRekap({ dari: "2026-10-07", sampai: "2026-10-07" })).toBe("/backoffice/kreatif/laporan/cetak?dari=2026-10-07&sampai=2026-10-07");
    expect(namaBerkasRekap({ dari: "2026-10-07", sampai: "2026-10-07" })).toBe("rekap-kol-2026-10-07.txt");
    expect(namaBerkasRekap({ dari: "2026-10-01", sampai: "2026-10-07" })).toBe("rekap-kol-2026-10-01_sd_2026-10-07.txt");
  });
});
