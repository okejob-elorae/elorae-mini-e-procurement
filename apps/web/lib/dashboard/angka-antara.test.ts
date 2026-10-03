import { describe, expect, it } from "vitest";
import { angkaAntara } from "./angka-antara";

describe("angkaAntara", () => {
  it("target bulat tidak pernah tampil berkoma di tengah gerak", () => {
    for (let k = 0; k <= 1; k += 0.05) {
      expect(Number.isInteger(angkaAntara(0, 3000, k))).toBe(true);
    }
  });

  it("target berkoma tetap halus, dan selalu berakhir tepat di target", () => {
    expect(Number.isInteger(angkaAntara(0, 1234.5, 0.5))).toBe(false);
    expect(angkaAntara(0, 1234.5, 1)).toBe(1234.5);
    expect(angkaAntara(10, 3, 1)).toBe(3);
  });
});
