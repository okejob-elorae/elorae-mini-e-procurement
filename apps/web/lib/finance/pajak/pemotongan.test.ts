import { describe, expect, it } from "vitest";
import { INFO_POTONG_PEMASOK, SEMUA_JENIS_POTONG_PEMASOK, bacaJenisPotongPemasok, hitungPotongPemasok } from "./pemotongan";

describe("Supplier.taxWithholding — jenis potongan pemasok", () => {
  it("tiga jenis, masing-masing berperan hutang pajaknya sendiri", () => {
    expect(SEMUA_JENIS_POTONG_PEMASOK).toEqual(["PPH23", "PPH21", "PPH4_2"]);
    expect(INFO_POTONG_PEMASOK.PPH23.peranHutang).toBe("PPH23_PAYABLE");
    expect(INFO_POTONG_PEMASOK.PPH21.peranHutang).toBe("PPH21_PAYABLE");
    expect(INFO_POTONG_PEMASOK.PPH4_2.peranHutang).toBe("PPH4_2_PAYABLE");
    expect(bacaJenisPotongPemasok("PPH23")).toBe("PPH23");
    expect(bacaJenisPotongPemasok(null)).toBeNull();
    expect(bacaJenisPotongPemasok("pph23")).toBeNull();
  });
});

describe("hitungPotongPemasok", () => {
  it("PPh 23 jasa maklon badan: 2%, 4% tanpa NPWP", () => {
    expect(hitungPotongPemasok(10_000_000, "PPH23", { adaNpwp: true })).toMatchObject({ pph: 200_000, neto: 9_800_000 });
    expect(hitungPotongPemasok(10_000_000, "PPH23", { adaNpwp: false })).toMatchObject({ pph: 400_000, neto: 9_600_000 });
  });

  it("PPh 21 penjahit orang pribadi: 50% × bruto × 5% pada lapisan pertama", () => {
    // DPP 5 jt × 5% = 250.000.
    expect(hitungPotongPemasok(10_000_000, "PPH21", { adaNpwp: true })).toMatchObject({ pph: 250_000, neto: 9_750_000 });
    expect(hitungPotongPemasok(10_000_000, "PPH21", { adaNpwp: false })).toMatchObject({ pph: 300_000 });
  });

  it("PPh 4(2) sewa 10%, dibulatkan ke bawah ke rupiah penuh", () => {
    expect(hitungPotongPemasok(25_000_000, "PPH4_2", { adaNpwp: true })).toMatchObject({ pph: 2_500_000, neto: 22_500_000, tarifEfektifPersen: 10 });
    expect(hitungPotongPemasok(1_234_567, "PPH4_2", { adaNpwp: true })).toMatchObject({ pph: 123_456, neto: 1_111_111 });
  });

  it("tidak dipotong / nol / tidak sah → PPh 0", () => {
    expect(hitungPotongPemasok(5_000_000, null, { adaNpwp: true })).toEqual({ jenis: null, bruto: 5_000_000, pph: 0, neto: 5_000_000, tarifEfektifPersen: 0 });
    expect(hitungPotongPemasok(0, "PPH23", { adaNpwp: true }).pph).toBe(0);
    expect(hitungPotongPemasok(Number.NaN, "PPH23", { adaNpwp: true })).toMatchObject({ bruto: 0, pph: 0, neto: 0 });
  });
});
