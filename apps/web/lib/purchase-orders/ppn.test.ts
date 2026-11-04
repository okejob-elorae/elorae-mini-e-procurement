import { describe, expect, it } from "vitest";
import { bulatkanTarifPpn, hitungTotalPo } from "./ppn";

/*
 * PPN di PO: pilihan per baris ("Include PPN" / "Exclude PPN") dulu disimpan
 * tetapi tidak pernah dihitung — `grandTotal` selalu sama dengan subtotal, jadi
 * PO berharga "belum termasuk PPN" tercatat lebih kecil dari yang harus dibayar.
 * Sekarang: baris "Exclude PPN" dikenai PPN dengan tarif Pengaturan → Pajak;
 * baris "Include PPN" sudah memuat PPN di harganya, jadi tidak ditambah lagi.
 */

describe("hitungTotalPo", () => {
  it("baris tanpa PPN dikenai 11%, baris termasuk PPN tidak ditambah lagi", () => {
    const hasil = hitungTotalPo(
      [
        { qty: 12, price: 85_000, ppnIncluded: false },
        { qty: 10, price: 50_000, ppnIncluded: true },
      ],
      11,
    );
    expect(hasil).toEqual({
      subtotal: 1_520_000,
      dasarPpn: 1_020_000,
      taxAmount: 112_200,
      diskon: 0,
      grandTotal: 1_632_200,
      ppnRatePercent: 11,
    });
  });

  it("PPN dihitung pada subtotal SETELAH diskon: 11% × (1.000.000 − 100.000) = 99.000", () => {
    const hasil = hitungTotalPo([{ qty: 10, price: 100_000, ppnIncluded: false }], 11, { diskon: 100_000 });
    expect(hasil).toEqual({
      subtotal: 1_000_000,
      dasarPpn: 900_000,
      taxAmount: 99_000,
      diskon: 100_000,
      grandTotal: 999_000,
      ppnRatePercent: 11,
    });
  });

  it("diskon dibagi pro-rata: bagian baris 'Include PPN' tidak mengurangi dasar PPN", () => {
    // Subtotal 2.000.000 (1.000.000 tanpa PPN + 1.000.000 termasuk PPN), diskon 200.000:
    // separuhnya (100.000) jatuh ke baris tanpa PPN → dasar 900.000 → PPN 99.000.
    const hasil = hitungTotalPo(
      [
        { qty: 10, price: 100_000, ppnIncluded: false },
        { qty: 10, price: 100_000, ppnIncluded: true },
      ],
      11,
      { diskon: 200_000 },
    );
    expect(hasil).toMatchObject({ subtotal: 2_000_000, dasarPpn: 900_000, taxAmount: 99_000, grandTotal: 1_899_000 });
  });

  it("diskon negatif atau melebihi subtotal ditolak", () => {
    const baris = [{ qty: 1, price: 100_000, ppnIncluded: false }];
    expect(() => hitungTotalPo(baris, 11, { diskon: -1 })).toThrow();
    expect(() => hitungTotalPo(baris, 11, { diskon: 100_001 })).toThrow();
  });

  it("PPN dibulatkan ke bawah ke rupiah penuh", () => {
    // 3 × 33.333 = 99.999; 11% = 10.999,89 → 10.999.
    const hasil = hitungTotalPo([{ qty: 3, price: 33_333, ppnIncluded: false }], 11);
    expect(hasil.taxAmount).toBe(10_999);
    expect(hasil.grandTotal).toBe(110_998);
  });

  it("qty pecahan (kain per meter) tetap tepat sampai sen", () => {
    // 2,5 m × 12.345,50 = 30.863,75; 11% = 3.395,0125 → 3.395.
    const hasil = hitungTotalPo([{ qty: "2.5", price: "12345.50", ppnIncluded: false }], 11);
    expect(hasil.subtotal).toBe(30_863.75);
    expect(hasil.taxAmount).toBe(3_395);
    expect(hasil.grandTotal).toBe(34_258.75);
  });

  it("semua baris termasuk PPN: tidak ada PPN tambahan", () => {
    const hasil = hitungTotalPo([{ qty: 4, price: 111_000, ppnIncluded: true }], 11);
    expect(hasil).toMatchObject({ subtotal: 444_000, dasarPpn: 0, taxAmount: 0, grandTotal: 444_000 });
  });

  it("tarif null (PO lama, dibuat sebelum PPN dihitung): total = subtotal", () => {
    const hasil = hitungTotalPo([{ qty: 12, price: 85_000, ppnIncluded: false }], null);
    expect(hasil).toEqual({
      subtotal: 1_020_000,
      dasarPpn: 1_020_000,
      taxAmount: 0,
      diskon: 0,
      grandTotal: 1_020_000,
      ppnRatePercent: null,
    });
  });

  it("tarif 0%: tidak ada PPN", () => {
    const hasil = hitungTotalPo([{ qty: 12, price: 85_000, ppnIncluded: false }], 0);
    expect(hasil.taxAmount).toBe(0);
    expect(hasil.grandTotal).toBe(1_020_000);
  });

  it("tarif 12% mengikuti Pengaturan, bukan angka 11 yang dipatok", () => {
    const hasil = hitungTotalPo([{ qty: 12, price: 85_000, ppnIncluded: false }], 12);
    expect(hasil.taxAmount).toBe(122_400);
    expect(hasil.grandTotal).toBe(1_142_400);
  });

  it("menerima Decimal Prisma (punya toString)", () => {
    const dec = (s: string) => ({ toString: () => s });
    const hasil = hitungTotalPo([{ qty: dec("12.00"), price: dec("85000.00"), ppnIncluded: false }], 11);
    expect(hasil.grandTotal).toBe(1_132_200);
  });

  it("tarif tidak sah ditolak", () => {
    expect(() => hitungTotalPo([{ qty: 1, price: 1, ppnIncluded: false }], -1)).toThrow();
    expect(() => hitungTotalPo([{ qty: 1, price: 1, ppnIncluded: false }], Number.NaN)).toThrow();
  });
});

describe("bulatkanTarifPpn", () => {
  it("tarif Pengaturan dibulatkan ke presisi kolom PO (2 desimal)", () => {
    expect(bulatkanTarifPpn(11)).toBe(11);
    expect(bulatkanTarifPpn(11.125)).toBe(11.13);
    expect(bulatkanTarifPpn(11.124)).toBe(11.12);
  });

  it("PPN dari tarif yang dibulatkan sama dengan PPN yang dihitung ulang dari kolom PO", () => {
    // 10 × 100.000 tanpa PPN; 11,125% → disimpan 11,13% → PPN 111.300 saat dibuat DAN saat disunting.
    const baris = [{ qty: 10, price: 100_000, ppnIncluded: false }];
    expect(hitungTotalPo(baris, bulatkanTarifPpn(11.125)).taxAmount).toBe(111_300);
    expect(hitungTotalPo(baris, Number("11.13")).taxAmount).toBe(111_300);
  });
});
