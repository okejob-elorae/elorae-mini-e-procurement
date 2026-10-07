import { describe, expect, it } from "vitest";
import type { AngkaKolaborasi } from "./angka-queries";
import { biayaKolaborasi } from "./angka-konten";
import { lebarBarBudget, ringkasCampaign, terpakaiKolaborasi } from "./campaign-aturan";

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
    expect(r.budget).toEqual({ keadaan: "AMAN", persen: 75, sisa: 500_000 });
  });

  it("tanpa budget: keadaan TANPA_BUDGET, lebar bar 0; lebar dijepit 0–100", () => {
    expect(ringkasCampaign([], null).budget.keadaan).toBe("TANPA_BUDGET");
    expect(lebarBarBudget(null)).toBe(0);
    expect(lebarBarBudget(140)).toBe(100);
    expect(lebarBarBudget(42.5)).toBe(42.5);
  });
});
