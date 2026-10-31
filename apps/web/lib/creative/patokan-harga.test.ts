import { describe, expect, it } from "vitest";
import { HARI_MIN_VIEWS, MIN_SAMPEL_PATOKAN, kuantil, ringkasPatokan, sampelPatokan, type KolaborasiPatokan } from "./patokan-harga";

const HARI = 86_400_000;
const tayang = new Date("2026-08-01T05:00:00Z");
const pada = (hari: number) => new Date(tayang.getTime() + hari * HARI);

const kolab = (id: string, lain: Partial<KolaborasiPatokan> = {}): KolaborasiPatokan => ({
  id,
  tahap: "TAYANG",
  fee: 10_000_000,
  termin: [],
  konten: [{ platform: "TIKTOK", format: "VIDEO", liveAt: tayang, angkaTerakhir: { recordedAt: pada(8), views: 200_000 } }],
  ...lain,
});

describe("sampelPatokan", () => {
  it("harga per 1.000 views = fee ÷ views × 1.000", () => {
    expect(sampelPatokan([kolab("a")])).toEqual([{ kolaborasiId: "a", fee: 10_000_000, views: 200_000, cpm: 50_000 }]);
  });

  it("fee diambil dari termin hidup (basis yang disepakati), bukan KolBrief.fee, bila ada termin", () => {
    const s = sampelPatokan([
      kolab("a", {
        fee: 1,
        termin: [
          { status: "DIBAYAR", bruto: 6_000_000, neto: 5_850_000, grossUp: false },
          { status: "BELUM", bruto: 4_100_000, neto: 4_000_000, grossUp: true },
          { status: "BATAL", bruto: 9_000_000, neto: 9_000_000, grossUp: false },
        ],
      }),
    ]);
    expect(s[0].fee).toBe(10_000_000);
  });

  it("views semua video TikTok kolaborasi itu dijumlahkan", () => {
    const s = sampelPatokan([
      kolab("a", {
        konten: [
          { platform: "TIKTOK", format: "VIDEO", liveAt: tayang, angkaTerakhir: { recordedAt: pada(9), views: 150_000 } },
          { platform: "TIKTOK", format: "VIDEO", liveAt: tayang, angkaTerakhir: { recordedAt: pada(7), views: 50_000 } },
          { platform: "INSTAGRAM", format: "VIDEO", liveAt: tayang, angkaTerakhir: { recordedAt: pada(9), views: 999_999 } },
        ],
      }),
    ]);
    expect(s[0].views).toBe(200_000);
  });

  it("dilewati: belum tayang, tanpa fee, angka belum berumur 7 hari, video tanpa angka, views 0", () => {
    const s = sampelPatokan([
      kolab("belumTayang", { tahap: "DEAL" }),
      kolab("tanpaFee", { fee: 0 }),
      kolab("terlaluMuda", {
        konten: [{ platform: "TIKTOK", format: "VIDEO", liveAt: tayang, angkaTerakhir: { recordedAt: pada(HARI_MIN_VIEWS - 1), views: 9 } }],
      }),
      kolab("satuVideoTanpaAngka", {
        konten: [
          { platform: "TIKTOK", format: "VIDEO", liveAt: tayang, angkaTerakhir: { recordedAt: pada(9), views: 100 } },
          { platform: "TIKTOK", format: "VIDEO", liveAt: tayang, angkaTerakhir: null },
        ],
      }),
      kolab("tanpaTayang", { konten: [{ platform: "TIKTOK", format: "VIDEO", liveAt: null, angkaTerakhir: { recordedAt: pada(9), views: 100 } }] }),
      kolab("nol", { konten: [{ platform: "TIKTOK", format: "VIDEO", liveAt: tayang, angkaTerakhir: { recordedAt: pada(9), views: 0 } }] }),
      kolab("tanpaVideo", { konten: [] }),
      kolab("sah", { tahap: "SELESAI" }),
    ]);
    expect(s.map((x) => x.kolaborasiId)).toEqual(["sah"]);
  });
});

describe("kuantil", () => {
  it("interpolasi linier (sama dengan PERCENTILE.INC di Excel)", () => {
    expect(kuantil([10, 20, 30, 40], 0.5)).toBe(25);
    expect(kuantil([10, 20, 30, 40], 0.25)).toBe(17.5);
    expect(kuantil([10, 20, 30, 40], 0.75)).toBe(32.5);
    expect(kuantil([7], 0.25)).toBe(7);
  });
});

describe("ringkasPatokan", () => {
  it(`kurang dari ${MIN_SAMPEL_PATOKAN} kolaborasi → tidak ada patokan, hanya jumlahnya`, () => {
    const s = sampelPatokan(["a", "b", "c", "d"].map((id) => kolab(id)));
    expect(ringkasPatokan(s)).toEqual({ n: 4, cukup: false, minSampel: MIN_SAMPEL_PATOKAN, hariMinViews: HARI_MIN_VIEWS });
  });

  it("cukup data → kuartil bawah, median, kuartil atas harga per 1.000 views (dibulatkan ke rupiah)", () => {
    const fee = [4_000_000, 6_000_000, 8_000_000, 10_000_000, 12_000_000];
    const s = sampelPatokan(fee.map((f, i) => kolab(`k${i}`, { fee: f })));
    expect(ringkasPatokan(s)).toEqual({
      n: 5,
      cukup: true,
      minSampel: MIN_SAMPEL_PATOKAN,
      hariMinViews: HARI_MIN_VIEWS,
      p25: 30_000,
      median: 40_000,
      p75: 50_000,
    });
  });
});
