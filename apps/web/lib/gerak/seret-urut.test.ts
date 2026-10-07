import { describe, expect, it } from "vitest";
import {
  AMBANG_SERET_PX,
  LAJU_GULIR_MAKS,
  celahDiam,
  celahSisip,
  indeksTujuan,
  lajuGulir,
  lewatAmbang,
  pindahkan,
  sisipkan,
} from "./seret-urut";

describe("lewatAmbang", () => {
  it("gerak kecil tetap klik; mulai seret tepat di ambang, ke arah mana pun", () => {
    expect(lewatAmbang(0, 0)).toBe(false);
    expect(lewatAmbang(3, 4)).toBe(false);
    expect(lewatAmbang(AMBANG_SERET_PX, 0)).toBe(true);
    expect(lewatAmbang(0, -AMBANG_SERET_PX)).toBe(true);
    expect(lewatAmbang(-5, -5)).toBe(true);
  });
});

describe("celahSisip", () => {
  // Tiga butir setinggi 40 px mulai y=100: tengah 120, 160, 200.
  const tengah = [120, 160, 200];

  it("di atas butir pertama = 0, di bawah terakhir = n, di antara = jumlah tengah di atasnya", () => {
    expect(celahSisip(tengah, 90)).toBe(0);
    expect(celahSisip(tengah, 119)).toBe(0);
    expect(celahSisip(tengah, 121)).toBe(1);
    expect(celahSisip(tengah, 170)).toBe(2);
    expect(celahSisip(tengah, 500)).toBe(3);
  });

  it("daftar kosong selalu 0", () => {
    expect(celahSisip([], 1000)).toBe(0);
  });
});

describe("indeksTujuan dan celahDiam", () => {
  it("celah di bawah butirnya sendiri dikurangi satu (butir diangkat dulu)", () => {
    expect(indeksTujuan(0, 3)).toBe(2);
    expect(indeksTujuan(2, 0)).toBe(0);
    expect(indeksTujuan(1, 1)).toBe(1);
    expect(indeksTujuan(1, 2)).toBe(1);
  });

  it("celah tepat di atas/bawah butir itu = urutan tidak berubah", () => {
    expect(celahDiam(1, 1)).toBe(true);
    expect(celahDiam(1, 2)).toBe(true);
    expect(celahDiam(1, 0)).toBe(false);
    expect(celahDiam(1, 3)).toBe(false);
  });

  it("indeksTujuan + pindahkan = hasil seret yang sama dengan menyisipkan di celah", () => {
    const awal = ["a", "b", "c", "d"];
    for (let dari = 0; dari < awal.length; dari++) {
      for (let celah = 0; celah <= awal.length; celah++) {
        const tanpa = awal.filter((_, i) => i !== dari);
        const celahTanpa = celah > dari ? celah - 1 : celah;
        const harapan = sisipkan(tanpa, awal[dari], celahTanpa);
        expect(pindahkan(awal, dari, indeksTujuan(dari, celah))).toEqual(harapan);
        if (celahDiam(dari, celah)) expect(harapan).toEqual(awal);
      }
    }
  });
});

describe("pindahkan dan sisipkan", () => {
  it("tidak mengubah larik asal; indeks di luar batas → salinan apa adanya", () => {
    const awal = [1, 2, 3];
    expect(pindahkan(awal, 0, 2)).toEqual([2, 3, 1]);
    expect(pindahkan(awal, 2, 0)).toEqual([3, 1, 2]);
    expect(pindahkan(awal, 5, 0)).toEqual([1, 2, 3]);
    expect(pindahkan(awal, 0, -1)).toEqual([1, 2, 3]);
    expect(pindahkan(awal, 0.5, 1)).toEqual([1, 2, 3]);
    expect(awal).toEqual([1, 2, 3]);
  });

  it("sisipkan menjepit celah ke 0..n", () => {
    expect(sisipkan(["a", "b"], "x", 1)).toEqual(["a", "x", "b"]);
    expect(sisipkan(["a", "b"], "x", 0)).toEqual(["x", "a", "b"]);
    expect(sisipkan(["a", "b"], "x", 2)).toEqual(["a", "b", "x"]);
    expect(sisipkan(["a", "b"], "x", 9)).toEqual(["a", "b", "x"]);
    expect(sisipkan(["a", "b"], "x", -3)).toEqual(["x", "a", "b"]);
    expect(sisipkan([], "x", 0)).toEqual(["x"]);
  });
});

describe("lajuGulir", () => {
  it("diam di tengah, makin cepat dekat tepi, paling cepat di/lewat tepi", () => {
    expect(lajuGulir(500, 0, 1000)).toBe(0);
    expect(lajuGulir(47, 0, 1000)).toBeLessThan(0);
    expect(lajuGulir(10, 0, 1000)).toBeLessThan(lajuGulir(40, 0, 1000));
    expect(lajuGulir(0, 0, 1000)).toBe(-LAJU_GULIR_MAKS);
    expect(lajuGulir(-200, 0, 1000)).toBe(-LAJU_GULIR_MAKS);
    expect(lajuGulir(960, 0, 1000)).toBeGreaterThan(0);
    expect(lajuGulir(1000, 0, 1000)).toBe(LAJU_GULIR_MAKS);
    expect(lajuGulir(1500, 0, 1000)).toBe(LAJU_GULIR_MAKS);
  });

  it("wadah pendek memakai seperempat tingginya; wadah tanpa tinggi tidak digulir", () => {
    expect(lajuGulir(50, 0, 100)).toBe(0);
    expect(lajuGulir(10, 0, 100)).toBeLessThan(0);
    expect(lajuGulir(5, 10, 10)).toBe(0);
    expect(lajuGulir(5, 10, 0)).toBe(0);
  });
});
