import { describe, expect, it } from "vitest";
import { kartuBeranda } from "./kartu-beranda";

/*
 * Kartu beranda per izin. Peran-peran di bawah persis seed `seed.ts`: ketiganya
 * memegang `dashboard:view` dan `sales_orders:view` (untuk pemenuhan pesanan),
 * tetapi tidak satu pun memegang izin piutang atau penjualan lapangan.
 */

const PURCHASER = [
  "dashboard:view", "suppliers:view", "items:view", "sales_orders:view", "sales_orders:fulfill",
  "purchase_orders:view", "purchase_orders:create", "purchase_orders:edit",
  "supplier_payments:view", "vendor_returns:view", "lead_time:view",
];
const WAREHOUSE = [
  "dashboard:view", "items:view", "sales_orders:view", "sales_orders:fulfill", "suppliers:view",
  "inventory:view", "inventory:manage", "inventory_opname:view", "inventory_opname:count",
];
const PRODUCTION = [
  "dashboard:view", "items:view", "sales_orders:view", "sales_orders:fulfill",
  "work_orders:view", "work_orders:create", "work_orders:manage", "inventory_opname:view",
];

describe("kartuBeranda", () => {
  it("admin (*) melihat semuanya", () => {
    expect(kartuBeranda(["*"])).toEqual({
      tren: true,
      penjualanMarketplace: true,
      penjualanLapangan: true,
      piutang: true,
      stok: true,
      klaimMenunggu: true,
    });
  });

  it("PURCHASER: tanpa piutang, penjualan lapangan, tren semua saluran, dan nilai stok", () => {
    expect(kartuBeranda(PURCHASER)).toEqual({
      tren: false,
      penjualanMarketplace: true,
      penjualanLapangan: false,
      piutang: false,
      stok: false,
      klaimMenunggu: false,
    });
  });

  it("WAREHOUSE: stok ya, piutang dan penjualan lapangan tidak", () => {
    const k = kartuBeranda(WAREHOUSE);
    expect(k.stok).toBe(true);
    expect(k.piutang).toBe(false);
    expect(k.penjualanLapangan).toBe(false);
    expect(k.tren).toBe(false);
    // Gudang menghitung retur toko, tetapi itu bukan izin membaca buku piutang.
    expect(k.klaimMenunggu).toBe(false);
  });

  it("PRODUCTION: tidak melihat stok, piutang, maupun penjualan lapangan", () => {
    const k = kartuBeranda(PRODUCTION);
    expect([k.stok, k.piutang, k.penjualanLapangan, k.tren]).toEqual([false, false, false, false]);
  });

  it("piutang terbuka bagi receivables:view ATAU receivables:manage", () => {
    expect(kartuBeranda(["dashboard:view", "receivables:view"]).piutang).toBe(true);
    expect(kartuBeranda(["dashboard:view", "receivables:manage"]).piutang).toBe(true);
    // Keuangan memverifikasi BKM, tetapi tidak membaca buku piutang.
    expect(kartuBeranda(["dashboard:view", "journals:manage"]).piutang).toBe(false);
    expect(kartuBeranda(["dashboard:view", "journals:manage"]).klaimMenunggu).toBe(true);
  });

  it("tren butuh KEDUA izin penjualan: satu saja akan membocorkan saluran lain", () => {
    expect(kartuBeranda(["sales_orders:view"]).tren).toBe(false);
    expect(kartuBeranda(["field_sales_orders:view"]).tren).toBe(false);
    expect(kartuBeranda(["sales_orders:view", "field_sales_orders:view"]).tren).toBe(true);
  });

  it("dashboard:view saja tidak membuka kartu apa pun", () => {
    expect(Object.values(kartuBeranda(["dashboard:view"])).every((v) => v === false)).toBe(true);
    expect(Object.values(kartuBeranda(undefined)).every((v) => v === false)).toBe(true);
  });
});
