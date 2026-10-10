import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AngkaKolaborasi } from "./angka-queries";
import { biayaKolaborasi } from "./angka-konten";
import {
  bacaStatusCampaignKol,
  lebarBarBudget,
  metrikCampaign,
  ringkasCampaign,
  ringkasDaftarCampaign,
  SEMUA_STATUS_CAMPAIGN,
  terpakaiKolaborasi,
} from "./campaign-aturan";

function angka(biaya: Parameters<typeof biayaKolaborasi>[0], tambahan: Partial<AngkaKolaborasi> = {}): AngkaKolaborasi {
  return {
    angka: { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 },
    interaksi: 0,
    jumlahKonten: 0,
    orders: 0,
    gmv: 0,
    komisi: 0,
    biaya: biayaKolaborasi(biaya),
    roas: null,
    ...tambahan,
  };
}

describe("terpakaiKolaborasi", () => {
  it("kolaborasi berjalan memakai biaya penuh", () => {
    expect(terpakaiKolaborasi("DEAL", angka({ fee: 1_000_000, boostCost: 200_000, ongkir: [15_000] }))).toBe(1_215_000);
  });

  it("yang keluar jalur tanpa konten hanya memakai yang benar-benar keluar", () => {
    const a = angka({ fee: 1_000_000, boostCost: 200_000, ongkir: [15_000], sampel: [{ unitCost: 80_000, qty: 2 }] });
    expect(terpakaiKolaborasi("BATAL", a)).toBe(175_000);
    // Sudah ada konten tayang sebelum keluar: fee-nya terutang.
    expect(terpakaiKolaborasi("BATAL", { ...a, jumlahKonten: 1 })).toBe(1_375_000);
  });
});

describe("ringkasCampaign", () => {
  it("menjumlahkan per campaign dan menghitung ROAS dari terpakai", () => {
    const r = ringkasCampaign(
      [
        { kolId: "a", tahap: "TAYANG", angka: angka({ fee: 1_000_000 }, { gmv: 3_000_000, jumlahKonten: 2, angka: { views: 10_000, likes: 0, comments: 0, shares: 0, saves: 0 } }) },
        { kolId: "a", tahap: "DEAL", angka: angka({ fee: 500_000 }) },
        { kolId: "b", tahap: "GHOSTING", angka: angka({ fee: 400_000 }) },
      ],
      2_000_000,
    );
    expect(r).toMatchObject({ jumlahKol: 1, jumlahKolaborasi: 3, jumlahKonten: 2, views: 10_000, terpakai: 1_500_000, gmv: 3_000_000, roas: 2 });
    expect(r.interaksi).toBe(0);
    expect(r.budget).toEqual({ keadaan: "AMAN", persen: 75, sisa: 500_000 });
  });

  it("tanpa budget: keadaan TANPA_BUDGET, lebar bar 0; lebar dijepit 0–100", () => {
    expect(ringkasCampaign([], null).budget.keadaan).toBe("TANPA_BUDGET");
    expect(lebarBarBudget(null)).toBe(0);
    expect(lebarBarBudget(140)).toBe(100);
    expect(lebarBarBudget(42.5)).toBe(42.5);
  });
});

describe("ringkasCampaign — interaksi", () => {
  it("menjumlahkan interaksi kolaborasi (like + komentar + share + save) dari angkaKolaborasi", () => {
    const r = ringkasCampaign(
      [
        { kolId: "a", tahap: "TAYANG", angka: angka({}, { interaksi: 450, jumlahKonten: 1 }) },
        { kolId: "b", tahap: "TAYANG", angka: angka({}, { interaksi: 50, jumlahKonten: 1 }) },
      ],
      null,
    );
    expect(r.interaksi).toBe(500);
  });
});

describe("metrikCampaign — CPV, CPE, ER, persen target", () => {
  it("CPV = terpakai ÷ views, CPE = terpakai ÷ interaksi (save ikut), ER = interaksi ÷ views × 100", () => {
    const m = metrikCampaign({ terpakai: 1_000_000, views: 400_000, interaksi: 20_000, jumlahKonten: 3 }, { targetViews: 1_000_000, targetContent: 4 });
    expect(m).toEqual({ cpv: 2.5, cpe: 50, er: 5, persenViews: 40, persenKonten: 75 });
  });

  it("pembagian dengan nol = null (layar menulis —), bukan 0 atau Infinity", () => {
    const m = metrikCampaign({ terpakai: 1_000_000, views: 0, interaksi: 0, jumlahKonten: 0 }, { targetViews: null, targetContent: 0 });
    expect(m).toEqual({ cpv: null, cpe: null, er: null, persenViews: null, persenKonten: null });
  });

  it("tanpa biaya CPV/CPE nol (sudah ada views); persen bisa lewat 100", () => {
    const m = metrikCampaign({ terpakai: 0, views: 1_500, interaksi: 30, jumlahKonten: 5 }, { targetViews: 1_000, targetContent: 4 });
    expect(m).toEqual({ cpv: 0, cpe: 0, er: 2, persenViews: 150, persenKonten: 125 });
  });

  it("dibulatkan dua desimal", () => {
    const m = metrikCampaign({ terpakai: 1_000_000, views: 300_000, interaksi: 7_000, jumlahKonten: 1 }, { targetViews: 900_000, targetContent: 3 });
    expect(m).toEqual({ cpv: 3.33, cpe: 142.86, er: 2.33, persenViews: 33.33, persenKonten: 33.33 });
  });
});

describe("status campaign", () => {
  it("empat status, dan pembaca alamat tidak peka huruf", () => {
    expect(SEMUA_STATUS_CAMPAIGN).toEqual(["DRAFT", "BERJALAN", "SELESAI", "BATAL"]);
    expect(bacaStatusCampaignKol("berjalan")).toBe("BERJALAN");
    expect(bacaStatusCampaignKol(["Selesai"])).toBe("SELESAI");
    expect(bacaStatusCampaignKol("aneh")).toBe("");
    expect(bacaStatusCampaignKol(undefined)).toBe("");
  });
});

describe("ringkasDaftarCampaign — strip ringkasan daftar campaign", () => {
  it("KOL aktif + pengikut dari akun TERBESAR per KOL; budget, terpakai, views hanya campaign yang tidak diarsip", () => {
    const r = ringkasDaftarCampaign(
      [
        { status: "BERJALAN", arsip: false, anggaran: 10_000_000, terpakai: 2_500_000.5, views: 100_000 },
        { status: "BERJALAN", arsip: false, anggaran: null, terpakai: 1_000_000, views: 50_000 },
        { status: "DRAFT", arsip: false, anggaran: 5_000_000, terpakai: 0, views: 0 },
        // Diarsip: tidak dihitung, walau statusnya masih BERJALAN.
        { status: "BERJALAN", arsip: true, anggaran: 99_000_000, terpakai: 9_000_000, views: 9_000_000 },
        { status: "SELESAI", arsip: false, anggaran: 1_000_000, terpakai: 900_000, views: 20_000 },
      ],
      [[50_000, 5_000], [200_000], []],
    );
    expect(r).toEqual({
      jumlahKol: 3,
      totalPengikut: 250_000,
      berjalan: 2,
      budget: 16_000_000,
      terpakai: 4_400_000.5,
      views: 170_000,
    });
  });

  it("kosong = nol semua", () => {
    expect(ringkasDaftarCampaign([], [])).toEqual({ jumlahKol: 0, totalPengikut: 0, berjalan: 0, budget: 0, terpakai: 0, views: 0 });
  });
});

describe("label status campaign", () => {
  const pesan = (b: string) => JSON.parse(readFileSync(path.resolve(__dirname, `../i18n/messages/${b}.json`), "utf8"));
  it("setiap status dan jejak perubahan status berlabel di kedua bahasa", () => {
    for (const b of ["id", "en"]) {
      const p = pesan(b);
      for (const s of SEMUA_STATUS_CAMPAIGN) expect(typeof p.kreatifRuang.campaign.keadaan[s], `${b}: ${s}`).toBe("string");
      expect(typeof p.auditActions.actions.KOL_CAMPAIGN_STATUS_CHANGED).toBe("string");
    }
  });
});
