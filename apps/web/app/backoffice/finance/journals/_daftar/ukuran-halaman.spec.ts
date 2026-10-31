import { describe, expect, it } from "vitest";
import { bacaUkuranHalaman, halamanBaris, UKURAN_HALAMAN_BAWAAN } from "./ukuran-halaman";

describe("bacaUkuranHalaman", () => {
  it("hanya pilihan yang disediakan; selainnya bawaan 25", () => {
    expect(bacaUkuranHalaman("50")).toBe(50);
    expect(bacaUkuranHalaman("100")).toBe(100);
    expect(bacaUkuranHalaman("10")).toBe(UKURAN_HALAMAN_BAWAAN);
    expect(bacaUkuranHalaman(undefined)).toBe(25);
    expect(bacaUkuranHalaman("9999")).toBe(25);
  });
});

describe("halamanBaris", () => {
  const rows = Array.from({ length: 230 }, (_, i) => i);

  it("memotong per halaman dan menjepit halaman di luar rentang", () => {
    expect(halamanBaris(rows, 1, 100).baris).toHaveLength(100);
    expect(halamanBaris(rows, 3, 100)).toMatchObject({ halaman: 3, jumlahHalaman: 3 });
    expect(halamanBaris(rows, 3, 100).baris).toHaveLength(30);
    expect(halamanBaris(rows, 9, 100).halaman).toBe(3);
    expect(halamanBaris(rows, 0, 100).halaman).toBe(1);
    expect(halamanBaris([], 1, 25)).toEqual({ baris: [], halaman: 1, jumlahHalaman: 1 });
  });
});
