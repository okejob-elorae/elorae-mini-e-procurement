import { describe, expect, it } from "vitest";
import { efisiensiBahan, persenBertanda, qtyBahan, statusTampilRekon } from "./rekonsiliasi-tampil";

describe("efisiensiBahan", () => {
  it("kain lebih pakai 154% dari teori (terpakai Rp 5.000.000, selisih +Rp 3.031.250), tidak ada bahan kembali → 39,4%, bukan 100%", () => {
    const e = efisiensiBahan([{ issuedQty: 100, theoreticalUsage: 39.375, usedValue: 5_000_000, varianceValue: 3_031_250, status: "OVER" }]);
    expect(e).toBeCloseTo((1_968_750 / 5_000_000) * 100, 6);
    expect(Number(e!.toFixed(1))).toBe(39.4);
  });

  it("pas dengan teori → 100; hemat → di atas 100; belum ada pemakaian → null", () => {
    expect(efisiensiBahan([{ issuedQty: 10, theoreticalUsage: 10, usedValue: 1_000, varianceValue: 0, status: "OK" }])).toBe(100);
    expect(efisiensiBahan([{ issuedQty: 8, theoreticalUsage: 10, usedValue: 800, varianceValue: -200, status: "UNDER" }])).toBe(125);
    expect(efisiensiBahan([])).toBeNull();
  });
});

describe("statusTampilRekon", () => {
  it("kancing 0 dikirim, teori 240 → BELUM_DIKIRIM, bukan 'Kurang' hijau", () => {
    expect(statusTampilRekon({ issuedQty: 0, theoreticalUsage: 240, status: "UNDER" })).toBe("BELUM_DIKIRIM");
    expect(statusTampilRekon({ issuedQty: 100, theoreticalUsage: 240, status: "UNDER" })).toBe("UNDER");
    expect(statusTampilRekon({ issuedQty: 0, theoreticalUsage: 0, status: "OK" })).toBe("OK");
  });
});

it("format Indonesia: persen bertanda satu desimal, qty dua desimal", () => {
  expect(persenBertanda(154)).toBe("+154,0%");
  expect(persenBertanda(-12.54)).toBe("-12,5%");
  expect(persenBertanda(0)).toBe("0,0%");
  expect(qtyBahan(78.75)).toBe("78,75");
  expect(qtyBahan(1234.5)).toBe("1.234,5");
});
