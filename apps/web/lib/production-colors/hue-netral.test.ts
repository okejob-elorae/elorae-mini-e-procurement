import { describe, expect, it } from "vitest";
import { hueEfektif, hueNetralDariLab, whereHueNetral } from "./hue-netral";

describe("hitam & putih dari L*a*b*", () => {
  it("Jet Black (L* 18,2), Black Cat (20,6) → Black; Phantom (23,4) bukan", () => {
    expect(hueNetralDariLab({ labL: 18.2, labA: 1.2, labB: -1.8 })).toBe("Black");
    expect(hueNetralDariLab({ labL: 20.6, labA: 2.1, labB: -6.5 })).toBe("Black");
    expect(hueNetralDariLab({ labL: 23.4, labA: 1.8, labB: -2.2 })).toBeNull();
  });

  it("Bright White (96,3) → White; navy gelap ber-kroma tinggi bukan hitam; tanpa Lab → null", () => {
    expect(hueNetralDariLab({ labL: 96.3, labA: -1.2, labB: 2.3 })).toBe("White");
    expect(hueNetralDariLab({ labL: 18, labA: 5, labB: -25 })).toBeNull();
    expect(hueNetralDariLab({ labL: null, labA: null, labB: null })).toBeNull();
  });

  it("tag efektif menggabungkan, tidak menggandakan", () => {
    expect(hueEfektif(["Gray"], { labL: 18.2, labA: 1.2, labB: -1.8 })).toEqual(["Gray", "Black"]);
    expect(hueEfektif(["White"], { labL: 96, labA: 0, labB: 0 })).toEqual(["White"]);
    expect(hueEfektif(undefined, { labL: 50, labA: 0, labB: 0 })).toEqual([]);
  });

  it("where Prisma memakai batas yang sama", () => {
    expect(whereHueNetral("Black")).toEqual({ labL: { lt: 22 }, labA: { gte: -12, lte: 12 }, labB: { gte: -12, lte: 12 } });
    expect(whereHueNetral("Red")).toBeNull();
  });
});
