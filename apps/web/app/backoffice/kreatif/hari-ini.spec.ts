import { describe, expect, it } from "vitest";
import type { BarisTugas } from "@/lib/creative/tugas";
import {
  alamatHariIni,
  bacaParamHariIni,
  lebarBar,
  nadaRoas,
  pintasanTugas,
  tautanBuka,
  umurMerah,
  umurTugas,
} from "./hari-ini";

const HARI_INI = "2026-10-20";

function baris(isi: Partial<BarisTugas> = {}): BarisTugas {
  return {
    jenis: "KOLABORASI",
    id: "c1",
    judul: "Nadia",
    sub: "nadia",
    kolId: "k1",
    docNo: "BRIEF/2026/0001",
    waNormal: "6281",
    platform: "TIKTOK",
    tahap: "DEAL",
    sejak: "2026-10-10",
    umurHari: 10,
    saranGhosting: false,
    info: {},
    ...isi,
  };
}

describe("parameter alamat Hari ini", () => {
  it("bawaan bulan ini; pilihan cepat dihitung dari hari WIB", () => {
    expect(bacaParamHariIni({}, HARI_INI)).toEqual({ periode: "bulanIni", dari: "2026-10-01", sampai: HARI_INI, campaign: null });
    expect(bacaParamHariIni({ periode: "tujuhHari" }, HARI_INI)).toMatchObject({ dari: "2026-10-14", sampai: HARI_INI });
    expect(bacaParamHariIni({ periode: "bulanLalu" }, HARI_INI)).toMatchObject({ dari: "2026-09-01", sampai: "2026-09-30" });
    expect(bacaParamHariIni({ periode: "ngawur" }, HARI_INI).periode).toBe("bulanIni");
  });

  it("rentang diurutkan; rentang rusak atau > 366 hari kembali ke bawaan", () => {
    expect(bacaParamHariIni({ periode: "rentang", dari: "2026-10-10", sampai: "2026-10-01" }, HARI_INI)).toMatchObject({
      periode: "rentang",
      dari: "2026-10-01",
      sampai: "2026-10-10",
    });
    expect(bacaParamHariIni({ periode: "rentang", dari: "2026-10-10" }, HARI_INI).periode).toBe("bulanIni");
    expect(bacaParamHariIni({ periode: "rentang", dari: "2024-01-01", sampai: "2026-10-01" }, HARI_INI).periode).toBe("bulanIni");
  });

  it("alamat ditulis pendek dan dibaca ulang sama", () => {
    const p = bacaParamHariIni({ periode: "rentang", dari: "2026-09-01", sampai: "2026-09-15", campaign: "cp1" }, HARI_INI);
    const url = alamatHariIni(p);
    expect(url).toBe("/backoffice/kreatif?periode=rentang&dari=2026-09-01&sampai=2026-09-15&campaign=cp1");
    const sp = Object.fromEntries(new URL(url, "http://x").searchParams);
    expect(bacaParamHariIni(sp, HARI_INI)).toEqual(p);
    expect(alamatHariIni(bacaParamHariIni({}, HARI_INI))).toBe("/backoffice/kreatif");
  });
});

describe("umur baris tugas", () => {
  it("agenda: H-n, hari ini, telat n hari", () => {
    expect(umurTugas("AGENDA", baris({ jenis: "AGENDA", umurHari: -2 }), HARI_INI)).toEqual({ jenis: "H_MIN", hari: 2 });
    expect(umurTugas("AGENDA", baris({ jenis: "AGENDA", umurHari: 0 }), HARI_INI)).toEqual({ jenis: "HARI_INI" });
    expect(umurTugas("AGENDA", baris({ jenis: "AGENDA", umurHari: 3 }), HARI_INI)).toEqual({ jenis: "TELAT", hari: 3 });
  });

  it("kelompok bertenggat: telat dihitung dari TENGGATNYA, bukan dari awal hitung", () => {
    // Deal 10 Okt + 3 hari = tenggat 13 Okt → telat 7 hari pada 20 Okt.
    expect(umurTugas("DEAL_BELUM_KIRIM", baris({ info: { tanggal: "2026-10-13" } }), HARI_INI)).toEqual({ jenis: "TELAT", hari: 7 });
  });

  it("kirim dobel/data kurang/diblokir: umur biasa, merah hanya lewat ambang; budget tanpa umur", () => {
    const u = umurTugas("DATA_KIRIM_KURANG", baris({ umurHari: 9 }), HARI_INI);
    // Umurnya dihitung sejak deal dan ditulis begitu ("9 hari sejak deal").
    expect(u).toEqual({ jenis: "UMUR_DEAL", hari: 9 });
    expect(umurMerah(u, 7)).toBe(true);
    expect(umurTugas("KOL_DIBLOKIR", baris({ umurHari: 2 }), HARI_INI)).toEqual({ jenis: "UMUR_TAHAP", hari: 2 });
    expect(umurMerah({ jenis: "UMUR_TAHAP", hari: 8 }, 7)).toBe(true);
    expect(umurMerah({ jenis: "UMUR", hari: 7 }, 7)).toBe(false);
    expect(umurMerah({ jenis: "TELAT", hari: 1 }, 7)).toBe(true);
    expect(umurTugas("BUDGET_CAMPAIGN", baris({ jenis: "CAMPAIGN" }), HARI_INI)).toBeNull();
  });
});

describe("tautan baris", () => {
  it("pintasan ke layar kerjanya membawa id kolaborasi", () => {
    expect(pintasanTugas("DEAL_BELUM_KIRIM", baris())).toEqual({ aksi: "kirimSampel", href: "/backoffice/kreatif/sampel?tab=perlu-dikirim&kolaborasi=c1" });
    expect(pintasanTugas("RESI_NYANGKUT", baris())?.aksi).toBe("tandaiDiterima");
    expect(pintasanTugas("DRAF_MENUNGGU", baris())?.href).toBe("/backoffice/kreatif/konten-kol?tab=draf&kolaborasi=c1");
    expect(pintasanTugas("ANGKA_BELUM_ADA", baris())?.aksi).toBe("isiAngka");
    expect(pintasanTugas("BELUM_DIBAYAR", baris())?.href).toBe("/backoffice/kreatif/pembayaran?kolaborasi=c1");
    expect(pintasanTugas("DATA_KIRIM_KURANG", baris())?.href).toBe("/backoffice/kreatif/kol/k1?tab=ukuran");
    expect(pintasanTugas("BELUM_DIBALAS", baris())).toBeNull();
    expect(pintasanTugas("AGENDA", baris({ jenis: "AGENDA" }))).toBeNull();
  });

  it("Buka: agenda ke kalender dengan dialognya, campaign ke campaign — tidak pernah kolaborasi kosong", () => {
    expect(tautanBuka(baris({ jenis: "AGENDA", id: "a1", sejak: "2026-10-22" }))).toBe(
      "/backoffice/kreatif/kalender?bulan=2026-10&tanggal=2026-10-22&agenda=a1",
    );
    expect(tautanBuka(baris({ jenis: "CAMPAIGN", id: "cp1" }))).toBe("/backoffice/kreatif/campaign/cp1");
    expect(tautanBuka(baris())).toBe("/backoffice/kreatif/kolaborasi/c1");
    expect(tautanBuka(baris({ jenis: "AKUN", id: "akun1", kolId: "k9" }))).toBe("/backoffice/kreatif/kol/k9?tab=pengikut");
    expect(tautanBuka(baris({ jenis: "PERANGKAT", id: "p1", kolId: null }))).toBe("/backoffice/kreatif/pemantauan");
  });
});

describe("angka kecil di layar", () => {
  it("bar posisi relatif terhadap terbanyak; nol tetap nol", () => {
    expect(lebarBar(5, 10)).toBe(50);
    expect(lebarBar(0, 10)).toBe(0);
    expect(lebarBar(1, 1000)).toBe(2);
    expect(lebarBar(3, 0)).toBe(0);
  });

  it("ROAS: hijau ≥ 1, merah < 1, kosong bila belum ada data", () => {
    expect(nadaRoas(1)).toBe("baik");
    expect(nadaRoas(0.4)).toBe("buruk");
    expect(nadaRoas(null)).toBe("kosong");
  });
});
