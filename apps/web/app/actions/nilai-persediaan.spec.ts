import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Aksi baca nilai persediaan untuk komponen klien.
 *
 * Dulu `lib/inventory/costing.ts` ber-"use server", jadi `getInventoryValue`,
 * `getInventorySnapshot` — dan juga penulis `calculateMovingAverage` dan
 * kawan-kawan — bisa dipanggil siapa pun yang masuk. Kini pustakanya biasa, dan
 * klien membaca lewat aksi ini yang memeriksa sesi dan izin inventori dulu.
 * Pustakanya ditiru: yang dibuktikan di sini hanya pagarnya.
 */

const sesi = vi.hoisted(() => ({ ada: true, permissions: ["inventory:view"] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (sesi.ada ? { user: { id: "penguji-nilai", email: null, permissions: sesi.permissions } } : null)),
}));

const pustaka = vi.hoisted(() => ({
  getInventoryValue: vi.fn(async () => ({ qtyOnHand: 12, avgCost: 85_000, totalValue: 1_020_000 })),
  getInventorySnapshot: vi.fn(async () => ({ items: [], totalCount: 0, totalValue: 0 })),
}));
vi.mock("@/lib/inventory/costing", () => pustaka);

const aksi = await import("./nilai-persediaan");

describe("aksi nilai persediaan", () => {
  beforeEach(() => {
    sesi.ada = true;
    sesi.permissions = ["inventory:view"];
    pustaka.getInventoryValue.mockClear();
    pustaka.getInventorySnapshot.mockClear();
  });

  const panggilan: Array<[string, () => Promise<unknown>]> = [
    ["getInventoryValue", () => aksi.getInventoryValue("barang-1", "VAR-M")],
    ["getInventorySnapshot", () => aksi.getInventorySnapshot({ page: 1, pageSize: 10 })],
  ];

  it.each(panggilan)("%s menolak tanpa sesi dan tidak membaca apa pun", async (_n, panggil) => {
    sesi.ada = false;
    await expect(panggil()).rejects.toThrow(/Unauthorized/);
    expect(pustaka.getInventoryValue).not.toHaveBeenCalled();
    expect(pustaka.getInventorySnapshot).not.toHaveBeenCalled();
  });

  it.each(panggilan)("%s menolak sales/SPG tanpa izin inventori", async (_n, panggil) => {
    sesi.permissions = ["pwa:access", "spg_sales:record"];
    await expect(panggil()).rejects.toThrow(/Forbidden/);
    expect(pustaka.getInventoryValue).not.toHaveBeenCalled();
    expect(pustaka.getInventorySnapshot).not.toHaveBeenCalled();
  });

  it("inventory:view membaca nilai satu barang dengan argumen yang sama", async () => {
    await expect(aksi.getInventoryValue("barang-1", "VAR-M")).resolves.toEqual({
      qtyOnHand: 12,
      avgCost: 85_000,
      totalValue: 1_020_000,
    });
    expect(pustaka.getInventoryValue).toHaveBeenCalledWith("barang-1", "VAR-M");
  });

  it("inventory:manage (penyesuai stok) tetap boleh membaca nilai", async () => {
    sesi.permissions = ["inventory:manage"];
    await expect(aksi.getInventoryValue("barang-1", null)).resolves.toBeTruthy();
    expect(pustaka.getInventoryValue).toHaveBeenCalledWith("barang-1", null);
  });

  it("admin wildcard boleh membaca ringkasan stok dengan opsi yang sama", async () => {
    sesi.permissions = ["*"];
    const opsi = { page: 2, pageSize: 25, search: "kaos", sort: "stock_desc" as const };
    await expect(aksi.getInventorySnapshot(opsi)).resolves.toMatchObject({ totalCount: 0 });
    expect(pustaka.getInventorySnapshot).toHaveBeenCalledWith(opsi);
  });

  it("id barang bukan teks ditolak sebelum menyentuh basis data", async () => {
    await expect(aksi.getInventoryValue(123 as unknown as string)).rejects.toThrow();
    expect(pustaka.getInventoryValue).not.toHaveBeenCalled();
  });
});
