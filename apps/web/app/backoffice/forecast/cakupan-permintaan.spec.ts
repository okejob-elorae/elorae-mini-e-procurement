import { describe, expect, it } from "vitest";
import { hitungBulanBerpermintaan, jendelaLookback } from "./cakupan-permintaan";

describe("jendelaLookback", () => {
  it("12 bulan sebelum 2027 = 1 Jan 2026 00.00 WIB s.d. 31 Des 2026 23.59.59,999 WIB", () => {
    const { start, end } = jendelaLookback(2027, 12);
    expect(start.toISOString()).toBe("2025-12-31T17:00:00.000Z");
    expect(end.toISOString()).toBe("2026-12-31T16:59:59.999Z");
  });

  it("jendela yang tidak kelipatan 12 mundur lintas tahun", () => {
    expect(jendelaLookback(2027, 18).start.toISOString()).toBe("2025-06-30T17:00:00.000Z");
    expect(jendelaLookback(2027, 6).start.toISOString()).toBe("2026-06-30T17:00:00.000Z");
  });
});

describe("hitungBulanBerpermintaan", () => {
  it("bulan dari sumber berbeda dihitung sekali", () => {
    expect(
      hitungBulanBerpermintaan([
        { year: 2026, month: 1, netQuantity: 3 },
        { year: 2026, month: 1, netQuantity: 2 },
        { year: 2026, month: 2, netQuantity: 1 },
      ])
    ).toBe(2);
  });

  it("tanpa impor: pesanan marketplace dan laporan konsinyasi saja tetap terhitung", () => {
    expect(
      hitungBulanBerpermintaan([
        { year: 2026, month: 3, netQuantity: 10 },
        { year: 2026, month: 4, netQuantity: 4 },
        { year: 2026, month: 5, netQuantity: 7 },
      ])
    ).toBe(3);
  });

  it("bulan yang bersihnya nol atau negatif (hanya retur) tidak dihitung", () => {
    expect(
      hitungBulanBerpermintaan([
        { year: 2026, month: 6, netQuantity: 5 },
        { year: 2026, month: 6, netQuantity: -5 },
        { year: 2026, month: 7, netQuantity: -2 },
        { year: 2026, month: 8, netQuantity: 1 },
      ])
    ).toBe(1);
  });

  it("bulan yang sama di tahun berbeda adalah dua bulan", () => {
    expect(
      hitungBulanBerpermintaan([
        { year: 2025, month: 12, netQuantity: 1 },
        { year: 2026, month: 12, netQuantity: 1 },
      ])
    ).toBe(2);
  });

  it("tanpa baris → 0", () => {
    expect(hitungBulanBerpermintaan([])).toBe(0);
  });
});
