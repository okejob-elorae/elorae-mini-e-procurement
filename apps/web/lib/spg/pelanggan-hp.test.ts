import { describe, expect, it } from "vitest";
import { barangFavorit, statusPelangganHp } from "./pelanggan-hp";

describe("statusPelangganHp", () => {
  const sekarang = new Date("2026-10-20T05:00:00Z");
  const hariLalu = (n: number) => new Date(sekarang.getTime() - n * 86_400_000);

  it("dormant from the configured number of days since the last purchase", () => {
    expect(statusPelangganHp({ jumlahNota: 3, terakhir: hariLalu(90), sekarang, hariTidur: 90 })).toEqual({ status: "TIDUR", hariSejak: 90 });
    expect(statusPelangganHp({ jumlahNota: 3, terakhir: hariLalu(89), sekarang, hariTidur: 90 })).toEqual({ status: "KEMBALI", hariSejak: 89 });
    expect(statusPelangganHp({ jumlahNota: 1, terakhir: hariLalu(2), sekarang, hariTidur: 90 })).toEqual({ status: "BARU", hariSejak: 2 });
    expect(statusPelangganHp({ jumlahNota: 0, terakhir: null, sekarang, hariTidur: 90 })).toEqual({ status: "BELUM_BELANJA", hariSejak: null });
  });
});

describe("barangFavorit", () => {
  it("ranks items by net pieces at the store and drops items fully returned", () => {
    const hasil = barangFavorit([
      { itemId: "a", nama: "Kaos", qty: 2, kembali: 0 },
      { itemId: "b", nama: "Celana", qty: 5, kembali: 5 },
      { itemId: "a", nama: "Kaos", qty: 3, kembali: 1 },
      { itemId: "c", nama: "Topi", qty: 1, kembali: 0 },
      { itemId: "d", nama: "Jaket", qty: 4, kembali: 0 },
      { itemId: "e", nama: "Rok", qty: 1, kembali: 0 },
    ]);
    expect(hasil).toEqual([
      { itemId: "d", nama: "Jaket", qty: 4 },
      { itemId: "a", nama: "Kaos", qty: 4 },
      { itemId: "e", nama: "Rok", qty: 1 },
    ]);
  });
});
