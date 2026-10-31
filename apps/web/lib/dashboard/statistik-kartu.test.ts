import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * `getDashboardStats` per kartu beranda.
 *
 * Dulu setiap pemegang beranda menjalankan agregat nilai seluruh persediaan,
 * nilai seluruh PO, dan pembacaan stok menipis — lalu `statistikBeranda`
 * membuang semuanya bagi yang tidak melihat kartu stok, dan dua nilai rupiah itu
 * tidak digambar kartu mana pun. Dengan daftar kartu yang tampil, kueri kartu
 * yang tersembunyi tidak dijalankan. Tanpa basis data: setiap kueri ditiru.
 */

const { dipanggil, db } = vi.hoisted(() => {
  const dipanggil: string[] = [];
  const catat = <T,>(nama: string, nilai: T) =>
    vi.fn(async () => {
      dipanggil.push(nama);
      return nilai;
    });
  // count PO dibedakan menurut saringannya supaya angkanya bisa dicek.
  const hitungPo = vi.fn(async (arg: { where: Record<string, unknown> }) => {
    dipanggil.push("po.count");
    const w = arg.where;
    if (w.status === "DRAFT") return 2;
    if (w.status === "SUBMITTED") return 5;
    if (w.status === "PARTIAL") return 1;
    if (w.createdAt) return 3;
    return 4;
  });
  const db = {
    prisma: {
      purchaseOrder: {
        count: hitungPo,
        aggregate: catat("po.aggregate", { _sum: { grandTotal: 245_000_000 } }),
      },
      item: { count: catat("item.count", 120) },
      inventoryValue: {
        // Definisi ringkasan Inventori (per barang, tersedia = di tangan − dipesan):
        // barang A dua baris dijumlahkan: 3 + 2 = 5 ≤ titik pesan 5 → menipis.
        // Barang B 9 > 4 → aman. Barang C tersedia 0 → HABIS, bukan menipis.
        findMany: catat("inventory.findMany", [
          { itemId: "A", qtyOnHand: 3, reservedQty: 0, item: { reorderPoint: 5 } },
          { itemId: "A", qtyOnHand: 2, reservedQty: 0, item: { reorderPoint: 5 } },
          { itemId: "B", qtyOnHand: 9, reservedQty: 0, item: { reorderPoint: 4 } },
          { itemId: "C", qtyOnHand: 0, reservedQty: 0, item: { reorderPoint: 1 } },
        ]),
        aggregate: catat("inventory.aggregate", { _sum: { totalValue: 60_500_000 } }),
      },
      workOrder: { count: catat("wo.count", 1) },
      supplier: { count: catat("supplier.count", 4) },
      gRN: { count: catat("grn.count", 6) },
      stockMovement: { count: catat("movement.count", 7) },
    },
    Prisma: {},
    sqlId: vi.fn(),
  };
  return { dipanggil, db };
});

vi.mock("@elorae/db", () => db);

const { getDashboardStats } = await import("./queries");

beforeEach(() => {
  dipanggil.length = 0;
});

describe("getDashboardStats — tanpa daftar kartu (pemanggil lama)", () => {
  it("tetap memuat semuanya, angka sama seperti dulu", async () => {
    const s = await getDashboardStats();
    expect(dipanggil).toContain("po.aggregate");
    expect(dipanggil).toContain("inventory.aggregate");
    expect(dipanggil).toContain("inventory.findMany");
    expect(s.po.totalValue).toBe(245_000_000);
    expect(s.inventory.totalValue).toBe(60_500_000);
    expect(s.items.lowStockCount).toBe(1);
    expect(s.items.habisCount).toBe(1);
  });
});

describe("getDashboardStats — dengan kartu beranda", () => {
  it("kartu stok tersembunyi: tidak ada satu pun kueri persediaan, tidak ada agregat nilai PO", async () => {
    const s = await getDashboardStats({ stok: false });
    expect(dipanggil).not.toContain("inventory.findMany");
    expect(dipanggil).not.toContain("inventory.aggregate");
    expect(dipanggil).not.toContain("po.aggregate");
    expect(s.po.totalValue).toBeNull();
    expect(s.inventory.totalValue).toBeNull();
    expect(s.items.lowStockCount).toBe(0);
  });

  it("kartu stok tampil: stok menipis dihitung, dua agregat rupiah yang tidak digambar tetap dilewati", async () => {
    const s = await getDashboardStats({ stok: true });
    expect(dipanggil).toContain("inventory.findMany");
    expect(dipanggil).not.toContain("inventory.aggregate");
    expect(dipanggil).not.toContain("po.aggregate");
    expect(s.items.lowStockCount).toBe(1);
    expect(s.items.habisCount).toBe(1);
    expect(s.po.totalValue).toBeNull();
    expect(s.inventory.totalValue).toBeNull();
  });

  it("angka yang digambar untuk semua pemegang beranda tetap dimuat", async () => {
    for (const stok of [false, true]) {
      const s = await getDashboardStats({ stok });
      expect(s.po.draft).toBe(2);
      // Tiruan wo.count = 1 untuk setiap status: sedang diproduksi 1 + selesai sebagian 1.
      expect(s.workOrders).toEqual({ inProduction: 2, sedangDiproduksi: 1, selesaiSebagian: 1, completedToday: 1 });
      expect(s.suppliers.activeCount).toBe(4);
      expect(s.grnsThisWeek).toBe(6);
    }
  });
});
