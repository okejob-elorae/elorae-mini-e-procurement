import { describe, expect, it } from "vitest";
import {
  bacaMasaPajak,
  balikBaris,
  barisPenyelesaianPpn,
  geserMasaPajak,
  hariTerakhirMasa,
  hitungRekapPpn,
  kompensasiBerikut,
  masaDariTanggal,
  rentangMasa,
  tanggalJurnalMasa,
} from "./masa";

const jumlah = (b: { debit: number; credit: number }[]) => Math.round(b.reduce((s, x) => s + x.debit - x.credit, 0) * 100);

describe("masa pajak", () => {
  it("membaca, menggeser, dan membatasi masa dalam WIB", () => {
    expect(bacaMasaPajak("2026-10")).toBe("2026-10");
    expect(bacaMasaPajak(" 2026-01 ")).toBe("2026-01");
    expect(bacaMasaPajak("2026-13")).toBeNull();
    expect(bacaMasaPajak("26-10")).toBeNull();
    expect(geserMasaPajak("2026-12", 1)).toBe("2027-01");
    expect(geserMasaPajak("2026-01", -1)).toBe("2025-12");
    expect(hariTerakhirMasa("2028-02")).toBe("2028-02-29");
    const r = rentangMasa("2026-10");
    expect(r.mulai.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(r.sampai.toISOString()).toBe("2026-10-31T17:00:00.000Z");
    // 31 Okt 23.30 WIB masih Oktober; 1 Nov 00.10 WIB sudah November.
    expect(masaDariTanggal(new Date("2026-10-31T16:30:00Z"))).toBe("2026-10");
    expect(masaDariTanggal(new Date("2026-10-31T17:10:00Z"))).toBe("2026-11");
    expect(tanggalJurnalMasa("2026-10").toISOString()).toBe("2026-10-30T17:00:00.000Z");
  });
});

describe("rekap & penyelesaian masa PPN", () => {
  it("kurang bayar: keluaran dinolkan, masukan + kompensasi dikredit, sisanya hutang PPN", () => {
    const r = hitungRekapPpn({ keluaran: 500_000, keluaranDpp: 4_545_455, masukan: 300_000, masukanDpp: 2_727_273, kompensasi: 100_000 });
    expect(r.saldo).toBe(100_000);
    const b = barisPenyelesaianPpn(r);
    expect(b.map((x) => [x.role, x.debit, x.credit])).toEqual([
      ["PPN_KELUARAN", 500_000, 0],
      ["PPN_MASUKAN", 0, 400_000],
      ["PPN_PAYABLE", 0, 100_000],
    ]);
    expect(jumlah(b)).toBe(0);
    expect(kompensasiBerikut(r.saldo)).toBe(0);
  });

  it("lebih bayar: hanya sebesar keluaran yang dipindah; sisa masukan jadi kompensasi masa berikut", () => {
    const r = hitungRekapPpn({ keluaran: 200_000, keluaranDpp: 0, masukan: 300_000, masukanDpp: 0, kompensasi: 0 });
    expect(r.saldo).toBe(-100_000);
    expect(barisPenyelesaianPpn(r).map((x) => [x.role, x.debit, x.credit])).toEqual([
      ["PPN_KELUARAN", 200_000, 0],
      ["PPN_MASUKAN", 0, 200_000],
    ]);
    expect(kompensasiBerikut(r.saldo)).toBe(100_000);
  });

  it("masa tanpa PPN: tidak ada baris; keluaran negatif (retur > penjualan) tetap seimbang", () => {
    expect(barisPenyelesaianPpn(hitungRekapPpn({ keluaran: 0, keluaranDpp: 0, masukan: 0, masukanDpp: 0, kompensasi: 0 }))).toEqual([]);
    const r = hitungRekapPpn({ keluaran: -11_000, keluaranDpp: -100_000, masukan: 0, masukanDpp: 0, kompensasi: 0 });
    const b = barisPenyelesaianPpn(r);
    expect(b.map((x) => [x.role, x.debit, x.credit])).toEqual([
      ["PPN_KELUARAN", 0, 11_000],
      ["PPN_MASUKAN", 11_000, 0],
    ]);
    expect(jumlah(b)).toBe(0);
    expect(kompensasiBerikut(r.saldo)).toBe(11_000);
  });

  it("pembalik menukar sisi", () => {
    expect(balikBaris([{ role: "PPN_PAYABLE", debit: 0, credit: 5 }])).toEqual([{ role: "PPN_PAYABLE", debit: 5, credit: 0 }]);
  });
});
