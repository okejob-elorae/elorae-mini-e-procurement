import { describe, expect, it } from "vitest";
import { saldoTerbalik } from "./aturan";
import { buildBalanceSheet } from "@/lib/finance/reports/balance-sheet";
import type { BalanceRow } from "@/lib/finance/reports/balances";

describe("saldoTerbalik", () => {
  it("saldo bertanda negatif = terbalik; pembulatan sen bukan", () => {
    expect(saldoTerbalik(-100, [])).toBe(true);
    expect(saldoTerbalik(-0.004, [])).toBe(false);
    expect(saldoTerbalik(0, [])).toBe(false);
    expect(saldoTerbalik(250, [])).toBe(false);
  });

  it("akun berperan dua arah tidak diperiksa (kontra-akun, laba ditahan, selisih)", () => {
    expect(saldoTerbalik(-100, ["ACCUM_DEPRECIATION"])).toBe(false);
    expect(saldoTerbalik(-100, ["SALES_RETURN"])).toBe(false);
    expect(saldoTerbalik(-100, ["RETAINED_EARNINGS"])).toBe(false);
    expect(saldoTerbalik(-100, ["INVENTORY_VARIANCE"])).toBe(false);
    // Kas bersaldo kredit (cerukan / salah akun) tetap ditandai.
    expect(saldoTerbalik(-100, ["CASH"])).toBe(true);
  });
});

describe("Neraca — laba tahun berjalan vs tahun lalu yang belum ditutup", () => {
  const baris = (accountId: string, type: BalanceRow["type"], debit: number, credit: number, signed: number): BalanceRow => ({
    accountId,
    code: accountId,
    name: accountId,
    type,
    parentId: null,
    depth: 1,
    isActive: true,
    hasChildren: false,
    debit,
    credit,
    signed,
  });

  it("laba belum ditutup dipecah: tahun berjalan dari pemanggil, sisanya tahun lalu", () => {
    const rows = [
      baris("kas", "ASET", 10_000, 0, 10_000),
      baris("modal", "EKUITAS", 0, 4_000, 4_000),
      baris("pendapatan", "PENDAPATAN", 0, 6_000, 6_000),
    ];
    const bs = buildBalanceSheet(rows, { labaTahunBerjalan: 2_500 });
    expect(bs.unclosedEarnings).toBe(6_000);
    expect(bs.labaTahunBerjalan).toBe(2_500);
    expect(bs.labaTahunLaluBelumDitutup).toBe(3_500);
    expect(bs.isBalanced).toBe(true);
  });

  it("tahun lalu yang sudah ditutup: laba ada di laba ditahan, akun laba rugi nol, tidak ada sisa tahun lalu", () => {
    const rows = [
      baris("kas", "ASET", 10_000, 0, 10_000),
      baris("modal", "EKUITAS", 0, 4_000, 4_000),
      baris("labaDitahan", "EKUITAS", 0, 3_500, 3_500),
      baris("pendapatan", "PENDAPATAN", 3_500, 6_000, 2_500),
    ];
    const bs = buildBalanceSheet(rows, { labaTahunBerjalan: 2_500 });
    expect(bs.totalEkuitas).toBe(7_500);
    expect(bs.labaTahunLaluBelumDitutup).toBe(0);
    expect(bs.totalLiabilitasEkuitas).toBe(10_000);
    expect(bs.isBalanced).toBe(true);
  });

  it("tanpa angka tahun berjalan (pemanggil lama) seluruh laba belum ditutup dianggap tahun berjalan", () => {
    const bs = buildBalanceSheet([baris("p", "PENDAPATAN", 0, 100, 100), baris("k", "ASET", 100, 0, 100)]);
    expect(bs.labaTahunBerjalan).toBe(100);
    expect(bs.labaTahunLaluBelumDitutup).toBe(0);
  });
});
