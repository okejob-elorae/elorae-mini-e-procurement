import { describe, it, expect } from "vitest";
import { bagiNilaiPerLokasi, lacakLapisan, sisaLapisan } from "./sisa-lapisan";

const keluar = (qty: number, balanceQty: number, refType = "SpgSale") => ({ qty: -qty, balanceQty, refType, refId: "x" });
const masuk = (qty: number, balanceQty: number) => ({ qty, balanceQty, refType: "GRN", refId: "lain" });

describe("sisaLapisan", () => {
  it("is whole when nothing left after the receipt", () => {
    expect(sisaLapisan([])).toBe(1);
    expect(sisaLapisan([masuk(50, 250)])).toBe(1);
  });

  it("follows the moving average: 200 on hand, 50 sold → 0.75 of the layer remains", () => {
    expect(sisaLapisan([keluar(50, 150)])).toBeCloseTo(0.75, 10);
  });

  it("drops to zero once the balance reaches zero and stays there", () => {
    expect(sisaLapisan([keluar(200, 0), masuk(100, 100)])).toBe(0);
  });

  it("ignores inflows and zero-quantity revaluations between outflows", () => {
    expect(sisaLapisan([keluar(50, 150), { qty: 0, balanceQty: 150 }, masuk(150, 300), keluar(150, 150)])).toBeCloseTo(0.375, 10);
  });
});

describe("lacakLapisan", () => {
  it("carries the part sent to a consignment store instead of losing it", () => {
    // 200 on hand (100 from this GRN): 40 to a konsi store, then 80 sold.
    const r = lacakLapisan([keluar(40, 160, "KonsiTransfer"), keluar(80, 80)], (e) => e.refType === "KonsiTransfer");
    expect(r.dibawa).toEqual([{ refType: "KonsiTransfer", refId: "x", porsi: 0.2 }]);
    expect(r.sisa).toBeCloseTo(0.4, 10);
  });

  it("carries nothing once the layer is gone", () => {
    const r = lacakLapisan([keluar(200, 0), keluar(10, -10, "VanLoad")], (e) => e.refType === "VanLoad");
    expect(r).toEqual({ sisa: 0, dibawa: [] });
  });
});

describe("bagiNilaiPerLokasi", () => {
  it("rounds each location and leaves the rest to goods already out, keeping the sign", () => {
    expect(bagiNilaiPerLokasi(5_000_000, [0.75])).toEqual({ lokasi: [3_750_000], keluar: 1_250_000 });
    expect(bagiNilaiPerLokasi(-5_000_000, [0.75, 0.1])).toEqual({ lokasi: [-3_750_000, -500_000], keluar: -750_000 });
  });

  it("never gives the locations more than the whole", () => {
    const r = bagiNilaiPerLokasi(101, [0.5, 0.5]);
    expect(r.lokasi.reduce((s, n) => s + n, 0) + r.keluar).toBe(101);
    expect(r.keluar).toBeGreaterThanOrEqual(0);
  });
});
