import { describe, expect, it } from "vitest";
import { formatRupiah, formatRupiahRingkas } from "./rupiah";

// Spasi tak-putus: "Rp" dan angkanya tidak boleh terpisah baris.
const S = " ";

describe("formatRupiah", () => {
  it("writes whole rupiah with dot grouping and a non-breaking space", () => {
    expect(formatRupiah(22_850_000)).toBe(`Rp${S}22.850.000`);
    expect(formatRupiah(0)).toBe(`Rp${S}0`);
    expect(formatRupiah(999)).toBe(`Rp${S}999`);
    expect(formatRupiah(1_000)).toBe(`Rp${S}1.000`);
  });

  it("matches what the server's Intl produced, so nothing changes on screen", () => {
    const intl = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
    for (const n of [0, 7, 1_234, 173_775_000, -15_000, 1_234_567_890]) {
      expect(formatRupiah(n)).toBe(intl.format(n).replace(/\s/, S));
    }
  });

  it("rounds half away from zero, like Intl, and never prints minus zero", () => {
    expect(formatRupiah(2.5)).toBe(`Rp${S}3`);
    expect(formatRupiah(-2.5)).toBe(`-Rp${S}3`);
    expect(formatRupiah(-0.4)).toBe(`Rp${S}0`);
  });

  it("accepts the shapes the database hands back and never prints NaN", () => {
    expect(formatRupiah("14200000")).toBe(`Rp${S}14.200.000`);
    expect(formatRupiah(null)).toBe(`Rp${S}0`);
    expect(formatRupiah(undefined)).toBe(`Rp${S}0`);
    expect(formatRupiah("bukan angka")).toBe(`Rp${S}0`);
  });
});

describe("formatRupiahRingkas", () => {
  it("shortens to rb, jt and M with a decimal comma, dropping ,0", () => {
    expect(formatRupiahRingkas(14_200_000)).toBe(`Rp${S}14,2${S}jt`);
    expect(formatRupiahRingkas(12_480_000)).toBe(`Rp${S}12,5${S}jt`);
    expect(formatRupiahRingkas(14_000_000)).toBe(`Rp${S}14${S}jt`);
    expect(formatRupiahRingkas(1_250_000_000)).toBe(`Rp${S}1,3${S}M`);
    expect(formatRupiahRingkas(950_000)).toBe(`Rp${S}950${S}rb`);
    expect(formatRupiahRingkas(800)).toBe(`Rp${S}800`);
  });
});
