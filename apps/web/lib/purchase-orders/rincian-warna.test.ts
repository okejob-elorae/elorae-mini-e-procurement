import { describe, expect, it } from "vitest";
import { MAKS_BARIS_WARNA, bacaAngkaIsian, bagiRata, bulat2, hitungWarna, jumlahRoll, keSen, satuanKg } from "./rincian-warna";

const jumlahSen = (baris: number[]) => baris.reduce((t, n) => t + keSen(n), 0);

describe("bagiRata", () => {
  it("jumlah bagian selalu persis total; baris terakhir menyerap sisa", () => {
    expect(bagiRata(100, 3)).toEqual([33.33, 33.33, 33.34]);
    expect(bagiRata(1000.5, 4)).toEqual([250.13, 250.13, 250.13, 250.11]);
    for (const [total, n] of [
      [0.03, 4],
      [0.02, 4],
      [7.77, 7],
      [123456.78, 9],
      [10, 1],
    ] as const) {
      const hasil = bagiRata(total, n);
      expect(hasil).toHaveLength(n);
      expect(jumlahSen(hasil)).toBe(keSen(total));
      expect(hasil.every((x) => x >= 0)).toBe(true);
    }
  });

  it("isian tidak sah → kosong", () => {
    expect(bagiRata(10, 0)).toEqual([]);
    expect(bagiRata(10, 1.5)).toEqual([]);
    expect(bagiRata(-1, 2)).toEqual([]);
    expect(bagiRata(Number.NaN, 2)).toEqual([]);
  });
});

describe("hitungWarna", () => {
  it("total ÷ min per warna → round, rata dua desimal, jumlah = total", () => {
    const h = hitungWarna(1000, 300);
    expect(h).toEqual({ ok: true, jumlah: 3, per: 333.33, baris: [333.33, 333.33, 333.34] });
  });

  it("paling sedikit satu warna", () => {
    expect(hitungWarna(100, 500)).toEqual({ ok: true, jumlah: 1, per: 100, baris: [100] });
  });

  it("pembulatan jumlah warna setengah ke atas, dan jumlahnya tetap persis", () => {
    const h = hitungWarna(250, 100);
    expect(h.ok && h.jumlah).toBe(3);
    if (h.ok) expect(jumlahSen(h.baris)).toBe(25000);
    const g = hitungWarna(1234.57, 25);
    expect(g.ok && g.jumlah).toBe(49);
    if (g.ok) expect(jumlahSen(g.baris)).toBe(123457);
  });

  it("menolak isian kosong/nol dan baris terlalu banyak", () => {
    expect(hitungWarna(0, 10)).toEqual({ ok: false, sebab: "ISIAN_TIDAK_SAH" });
    expect(hitungWarna(10, 0)).toEqual({ ok: false, sebab: "ISIAN_TIDAK_SAH" });
    expect(hitungWarna(10_000, 1)).toEqual({ ok: false, sebab: "TERLALU_BANYAK" });
    expect(hitungWarna(MAKS_BARIS_WARNA, 1).ok).toBe(true);
  });
});

describe("jumlahRoll", () => {
  it("ceil(qty ÷ kg per roll) hanya untuk satuan kg", () => {
    expect(jumlahRoll(50, 25, "KG")).toBe(2);
    expect(jumlahRoll(50.01, 25, "kg")).toBe(3);
    expect(jumlahRoll(0.3, 0.1, "Kg")).toBe(3);
    expect(jumlahRoll(0, 25, "KG")).toBe(0);
  });

  it("bukan kg, atau kg per roll kosong/nol → null", () => {
    expect(jumlahRoll(50, 25, "MTR")).toBeNull();
    expect(jumlahRoll(50, null, "KG")).toBeNull();
    expect(jumlahRoll(50, 0, "KG")).toBeNull();
    expect(satuanKg(" kG ")).toBe(true);
    expect(satuanKg(undefined)).toBe(false);
  });
});

describe("bacaAngkaIsian", () => {
  it("menerima koma desimal dan titik ribuan", () => {
    expect(bacaAngkaIsian("0,27")).toBe(0.27);
    expect(bacaAngkaIsian("0.27")).toBe(0.27);
    expect(bacaAngkaIsian("1.250,5")).toBe(1250.5);
    expect(bacaAngkaIsian(" 1250 ")).toBe(1250);
    expect(bacaAngkaIsian("12,")).toBe(12);
  });

  it("kosong, negatif, atau bukan angka → null", () => {
    expect(bacaAngkaIsian("")).toBeNull();
    expect(bacaAngkaIsian("-3")).toBeNull();
    expect(bacaAngkaIsian("abc")).toBeNull();
    expect(bacaAngkaIsian(".")).toBeNull();
    expect(bacaAngkaIsian("1,2,3")).toBeNull();
  });

  it("bulat2 tidak tertipu galat titik mengambang", () => {
    expect(bulat2(0.27 * 100 * 1.05)).toBe(28.35);
    expect(bulat2(1.005)).toBe(1.01);
  });
});
