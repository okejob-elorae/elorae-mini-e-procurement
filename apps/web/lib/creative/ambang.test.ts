import { describe, expect, it } from "vitest";
import { AMBANG_BAWAAN, BATAS_AMBANG, bacaAmbang, KUNCI_AMBANG, validasiAmbang, type AmbangKreatif } from "./ambang";

describe("ambang bawaan Ruang KOL", () => {
  it("memakai angka keputusan sementara pemilik", () => {
    expect(AMBANG_BAWAAN).toEqual<AmbangKreatif>({
      followUpHari: 3,
      dealKeKirimHari: 3,
      kirimKeTerimaHari: 7,
      terimaKeTayangHari: 5,
      tayangKeAngkaHari: 3,
      reviewDrafHari: 2,
      jatuhTempoBayarHari: 14,
      saranGhostingHari: 14,
      umurTahapMerahHari: 7,
    });
    expect(KUNCI_AMBANG).toBe("kreatif.ambang");
  });

  it("setiap bawaan berada di dalam batasnya", () => {
    for (const [k, v] of Object.entries(AMBANG_BAWAAN) as [keyof AmbangKreatif, number][]) {
      expect(v).toBeGreaterThanOrEqual(BATAS_AMBANG[k].min);
      expect(v).toBeLessThanOrEqual(BATAS_AMBANG[k].maks);
    }
  });
});

describe("bacaAmbang — pemaaf, selalu mengembalikan nilai yang bisa dipakai", () => {
  it("baris kosong atau rusak jatuh ke bawaan", () => {
    expect(bacaAmbang(null)).toEqual(AMBANG_BAWAAN);
    expect(bacaAmbang("")).toEqual(AMBANG_BAWAAN);
    expect(bacaAmbang("{bukan json")).toEqual(AMBANG_BAWAAN);
    expect(bacaAmbang("[1,2]")).toEqual(AMBANG_BAWAAN);
  });

  it("menerima teks JSON maupun objek, dan hanya mengganti kunci yang sah", () => {
    expect(bacaAmbang(JSON.stringify({ followUpHari: 5 })).followUpHari).toBe(5);
    const r = bacaAmbang({ followUpHari: 4, reviewDrafHari: "x", kirimKeTerimaHari: 999, asing: 1 });
    expect(r.followUpHari).toBe(4);
    expect(r.reviewDrafHari).toBe(AMBANG_BAWAAN.reviewDrafHari);
    expect(r.kirimKeTerimaHari).toBe(AMBANG_BAWAAN.kirimKeTerimaHari);
    expect(r).not.toHaveProperty("asing");
  });

  it("menolak pecahan dan angka negatif per kunci", () => {
    const r = bacaAmbang({ dealKeKirimHari: 2.5, terimaKeTayangHari: -1 });
    expect(r.dealKeKirimHari).toBe(AMBANG_BAWAAN.dealKeKirimHari);
    expect(r.terimaKeTayangHari).toBe(AMBANG_BAWAAN.terimaKeTayangHari);
  });
});

describe("validasiAmbang — untuk penyimpanan, menyebut setiap kunci yang salah", () => {
  it("lolos untuk isian lengkap yang sah", () => {
    expect(validasiAmbang({ ...AMBANG_BAWAAN, followUpHari: 2 })).toEqual({
      ok: true,
      ambang: { ...AMBANG_BAWAAN, followUpHari: 2 },
    });
  });

  it("isian sebagian dilengkapi dengan bawaan", () => {
    const r = validasiAmbang({ followUpHari: 6 });
    expect(r.ok && r.ambang.followUpHari).toBe(6);
    expect(r.ok && r.ambang.jatuhTempoBayarHari).toBe(14);
  });

  it("menolak dengan daftar galat per kunci", () => {
    const r = validasiAmbang({ followUpHari: "tiga", jatuhTempoBayarHari: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.galat).toEqual([
        { kunci: "followUpHari", sebab: "BUKAN_ANGKA" },
        { kunci: "jatuhTempoBayarHari", sebab: "DI_LUAR_BATAS" },
      ]);
    }
  });

  it("menolak yang bukan objek", () => {
    expect(validasiAmbang("x").ok).toBe(false);
    expect(validasiAmbang(null).ok).toBe(false);
  });
});
