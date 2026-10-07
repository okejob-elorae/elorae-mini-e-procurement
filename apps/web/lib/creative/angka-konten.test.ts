import { describe, expect, it } from "vitest";
import {
  angkaTerbaru,
  biayaKolaborasi,
  cpe,
  cpm,
  angkaTitik,
  cpv,
  dariSen,
  engagementRate,
  jumlahkanAngka,
  jumlahUang,
  keadaanBudget,
  keSen,
  roas,
  rupiahTeks,
  totalInteraksi,
} from "./angka-konten";

const a = { views: 10_000, likes: 400, comments: 50, shares: 30, saves: 20 };

describe("uang aman-sen", () => {
  it("0,1 + 0,2 tidak menjadi 0,30000000000000004", () => {
    expect(jumlahUang([0.1, 0.2])).toBe(0.3);
    expect(keSen(1250.555)).toBe(125056);
    expect(dariSen(125056)).toBe(1250.56);
  });

  it("mengabaikan isian yang bukan angka", () => {
    expect(jumlahUang([100, Number.NaN, 50])).toBe(150);
  });
});

describe("engagement rate", () => {
  it("(likes+komentar+share+save) ÷ views, dalam persen", () => {
    expect(totalInteraksi(a)).toBe(500);
    expect(engagementRate(a)).toBe(5);
  });

  it("memakai pengikut bila views nol", () => {
    expect(engagementRate({ ...a, views: 0 }, 20_000)).toBe(2.5);
  });

  it("null bila tidak ada penyebut", () => {
    expect(engagementRate({ ...a, views: 0 }, 0)).toBeNull();
    expect(engagementRate({ ...a, views: 0 })).toBeNull();
  });
});

describe("angka per konten", () => {
  it("angka TERBARU per konten yang dipakai, bukan dijumlah antarpengisian", () => {
    const baris = [
      { recordedAt: "2026-10-02T03:00:00.000Z", views: 1000 },
      { recordedAt: "2026-10-05T03:00:00.000Z", views: 5000 },
      { recordedAt: "2026-10-03T03:00:00.000Z", views: 3000 },
    ];
    expect(angkaTerbaru(baris)?.views).toBe(5000);
    expect(angkaTerbaru([])).toBeNull();
  });

  it("menjumlahkan beberapa konten", () => {
    expect(jumlahkanAngka([a, a])).toEqual({ views: 20_000, likes: 800, comments: 100, shares: 60, saves: 40 });
    expect(jumlahkanAngka([])).toEqual({ views: 0, likes: 0, comments: 0, shares: 0, saves: 0 });
  });
});

describe("biaya kolaborasi", () => {
  it("= fee + boost + ongkir + Σ(HPP × qty) sampel + komisi", () => {
    expect(
      biayaKolaborasi({
        fee: 1_000_000,
        boostCost: 250_000,
        ongkir: [18_000, 22_000],
        sampel: [
          { unitCost: 85_500.5, qty: 2 },
          { unitCost: 40_000, qty: 1 },
        ],
        komisi: [12_345.67, 0.33],
      }),
    ).toEqual({ fee: 1_000_000, boost: 250_000, ongkir: 40_000, sampel: 211_001, komisi: 12_346, total: 1_513_347 });
  });

  it("isian kosong = nol", () => {
    expect(biayaKolaborasi({}).total).toBe(0);
  });
});

describe("rasio biaya", () => {
  it("CPM, CPV, CPE, ROAS", () => {
    expect(cpm(500_000, 100_000)).toBe(5000);
    expect(cpv(500_000, 100_000)).toBe(5);
    expect(cpe(500_000, 2_000)).toBe(250);
    expect(roas(1_250_000, 500_000)).toBe(2.5);
  });

  it("null bila penyebutnya nol — bukan Infinity, bukan 0", () => {
    expect(cpm(500_000, 0)).toBeNull();
    expect(cpv(500_000, 0)).toBeNull();
    expect(cpe(500_000, 0)).toBeNull();
    expect(roas(1_000, 0)).toBeNull();
  });
});

describe("keadaan budget campaign", () => {
  it("hijau di bawah 80%, kuning mulai 80%, merah bila lewat", () => {
    expect(keadaanBudget(790_000, 1_000_000)).toEqual({ keadaan: "AMAN", persen: 79, sisa: 210_000 });
    expect(keadaanBudget(800_000, 1_000_000).keadaan).toBe("HAMPIR");
    expect(keadaanBudget(1_000_000, 1_000_000).keadaan).toBe("HAMPIR");
    expect(keadaanBudget(1_100_000, 1_000_000)).toEqual({ keadaan: "LEWAT", persen: 110, sisa: -100_000 });
  });

  it("budget kosong atau nol = belum diatur", () => {
    expect(keadaanBudget(100, null)).toEqual({ keadaan: "TANPA_BUDGET", persen: null, sisa: null });
    expect(keadaanBudget(100, 0).keadaan).toBe("TANPA_BUDGET");
  });
});

describe("format teks untuk pesan dan rekap", () => {
  it("titik ribuan dan rupiah dibulatkan ke rupiah", () => {
    expect(angkaTitik(1_250_000)).toBe("1.250.000");
    expect(angkaTitik(999)).toBe("999");
    expect(rupiahTeks(1_250_000.4)).toBe("Rp 1.250.000");
    expect(rupiahTeks(-15_000)).toBe("-Rp 15.000");
    expect(rupiahTeks(0)).toBe("Rp 0");
  });
});
