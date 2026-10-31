import { describe, expect, it } from "vitest";
import { ALAT, jalankanAlat, jsonAman, type SumberData } from "./alat";

// 28 Sep 2026, 10:00 WIB.
const HARI_INI = new Date("2026-09-28T03:00:00Z");

function sumber(sebagian: Partial<SumberData> = {}): SumberData {
  const tidakDipakai = async () => {
    throw new Error("tidak dipanggil di tes ini");
  };
  return {
    trenRentang: tidakDipakai,
    salesman: tidakDipakai,
    stok: tidakDipakai,
    produksi: tidakDipakai,
    marketplaceHariIni: tidakDipakai,
    ...sebagian,
  };
}

describe("ALAT", () => {
  it("every tool has a name, a description and an object input schema", () => {
    for (const a of ALAT) {
      expect(a.name).toMatch(/^[a-z_]+$/);
      expect(a.description.length).toBeGreaterThan(20);
      expect(a.inputSchema.type).toBe("object");
    }
  });

  it("offers no receivables tool until the owner asks for one", () => {
    expect(ALAT.map((a) => a.name).join(" ")).not.toMatch(/piutang|receivable|konsinyasi/);
  });
});

describe("jalankanAlat — ringkasan_penjualan", () => {
  const tren = [
    { tanggal: "2026-07-31", marketplace: 0, lapangan: 100 },
    { tanggal: "2026-08-01", marketplace: 50, lapangan: 0 },
    { tanggal: "2026-08-02", marketplace: 0, lapangan: 0 },
    { tanggal: "2026-08-03", marketplace: 25, lapangan: 75 },
  ];

  it("totals the requested range, compares it with the one before, and lists only days that sold", async () => {
    const h = (await jalankanAlat(
      "ringkasan_penjualan",
      { dari: "2026-08-02", sampai: "2026-08-03" },
      sumber({ trenRentang: async () => tren }),
      HARI_INI,
    )) as Record<string, unknown>;
    expect(h).toMatchObject({
      dari: "2026-08-02",
      sampai: "2026-08-03",
      jumlahHari: 2,
      total: 100,
      marketplace: 25,
      lapangan: 75,
      periodeSebelumnya: { dari: "2026-07-31", sampai: "2026-08-01", total: 150 },
      perubahanPersen: -33,
    });
    expect(h.hariAdaPenjualan).toEqual([{ tanggal: "2026-08-03", marketplace: 25, lapangan: 75, total: 100 }]);
  });

  it("splits the range by channel — and a point without detail counts as zero", async () => {
    const rinci = [
      { tanggal: "2026-08-01", marketplace: 0, lapangan: 0 },
      { tanggal: "2026-08-02", marketplace: 70, lapangan: 9, shopee: 50, tiktok: 20, spg: 9 },
      { tanggal: "2026-08-03", marketplace: 5, lapangan: 0, tokopedia: 5 },
    ];
    const h = (await jalankanAlat(
      "ringkasan_penjualan",
      { dari: "2026-08-02", sampai: "2026-08-03" },
      sumber({ trenRentang: async () => rinci }),
      HARI_INI,
    )) as Record<string, unknown>;
    expect(h.perSaluran).toEqual({ shopee: 50, tiktok: 20, tokopedia: 5, mpLain: 0, putus: 0, van: 0, spg: 9 });
    expect(h.hariAdaPenjualan).toEqual([
      { tanggal: "2026-08-02", marketplace: 70, lapangan: 9, total: 79 },
      { tanggal: "2026-08-03", marketplace: 5, lapangan: 0, total: 5 },
    ]);
  });

  it("defaults to the last 30 days ending today (WIB)", async () => {
    let diminta: [string, string] | null = null;
    await jalankanAlat(
      "ringkasan_penjualan",
      {},
      sumber({
        trenRentang: async (a, b) => {
          diminta = [a, b];
          return [];
        },
      }),
      HARI_INI,
    );
    expect(diminta).toEqual(["2026-08-30", "2026-09-28"]);
  });

  it("explains a bad range instead of querying", async () => {
    const h = await jalankanAlat("ringkasan_penjualan", { dari: "2026-09-10", sampai: "2026-09-01" }, sumber(), HARI_INI);
    expect(h).toMatchObject({ galat: expect.stringContaining("366") });
  });
});

describe("jalankanAlat — unknown tool", () => {
  it("answers with an error instead of throwing", async () => {
    expect(await jalankanAlat("hapus_semua", {}, sumber(), HARI_INI)).toMatchObject({ galat: expect.any(String) });
  });
});

describe("jsonAman", () => {
  it("turns Decimal-like values, dates and bigints into plain JSON", () => {
    const decimal = { toNumber: () => 12.5, toString: () => "12.5", d: [1] };
    expect(
      jsonAman({ a: decimal, b: new Date("2026-09-28T03:00:00Z"), c: BigInt(7), d: [decimal], e: null }),
    ).toEqual({ a: 12.5, b: "2026-09-28T03:00:00.000Z", c: 7, d: [12.5], e: null });
  });
});
