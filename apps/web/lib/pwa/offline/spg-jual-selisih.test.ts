import { describe, expect, it } from "vitest";
import { bacaSelisihTotal, catatSelisihTotal, totalBerbeda, type PenyimpananTeks } from "./spg-jual-selisih";

function penyimpanan(awal: Record<string, string> = {}): PenyimpananTeks & { isi: Record<string, string> } {
  const isi = { ...awal };
  return {
    isi,
    getItem: (k) => (k in isi ? isi[k] : null),
    setItem: (k, v) => {
      isi[k] = v;
    },
  };
}

describe("totalBerbeda", () => {
  it("ignores rounding residue under half a rupiah", () => {
    expect(totalBerbeda(100_000, 100_000.4)).toBe(false);
    expect(totalBerbeda(100_000, 99_000)).toBe(true);
  });
});

describe("catatSelisihTotal / bacaSelisihTotal", () => {
  it("remembers a differing total for that receipt only", () => {
    const s = penyimpanan();
    catatSelisihTotal(s, "nota-1", 200_000, 180_000, 1);
    expect(bacaSelisihTotal(s, "nota-1")).toEqual({ pratinjau: 200_000, tercatat: 180_000 });
    expect(bacaSelisihTotal(s, "nota-2")).toBeNull();
  });

  it("records nothing when the server agreed with the screen", () => {
    const s = penyimpanan();
    catatSelisihTotal(s, "nota-1", 200_000, 200_000, 1);
    expect(s.isi).toEqual({});
  });

  it("keeps only the latest 50 receipts", () => {
    const s = penyimpanan();
    for (let i = 0; i < 60; i += 1) catatSelisihTotal(s, `nota-${i}`, 2, 1, i);
    expect(Object.keys(JSON.parse(Object.values(s.isi)[0]))).toHaveLength(50);
    expect(bacaSelisihTotal(s, "nota-59")).not.toBeNull();
    expect(bacaSelisihTotal(s, "nota-0")).toBeNull();
  });

  it("survives corrupt or blocked storage without throwing", () => {
    const rusak = penyimpanan({ "elorae.spg.selisihTotal": "{bukan json" });
    expect(bacaSelisihTotal(rusak, "nota-1")).toBeNull();
    catatSelisihTotal(rusak, "nota-1", 2, 1, 1);
    expect(bacaSelisihTotal(rusak, "nota-1")).toEqual({ pratinjau: 2, tercatat: 1 });
    const dilarang: PenyimpananTeks = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => catatSelisihTotal(dilarang, "nota-1", 2, 1, 1)).not.toThrow();
    expect(bacaSelisihTotal(dilarang, "nota-1")).toBeNull();
  });
});
