import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * GRN tanpa PO yang masih menunggu konfirmasi admin (P51a) untuk layar hitung dan persetujuan
 * opname: barangnya sudah di rak tapi belum masuk stok. Dijaga izin yang sama dengan halaman
 * opname (`inventory_opname:view`), hanya yang MENUNGGU, paling lama dulu, paling banyak 50, dan
 * baris barangnya dibaca dengan pembaca baris GRN yang sama dengan penulisnya. Tanpa basis data.
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  grnFindMany: vi.fn(),
  itemFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@elorae/db", () => ({
  prisma: { gRN: { findMany: h.grnFindMany }, item: { findMany: h.itemFindMany } },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/docNumber", () => ({ generateDocNumber: vi.fn() }));
vi.mock("@/lib/inventory/opname-approve", () => ({
  applyFabricAdjustments: vi.fn(),
  applyFgAccessoriesAdjustments: vi.fn(),
  detectItemDrift: vi.fn(),
  detectRollDrift: vi.fn(),
  pushFgStockAfterOpname: vi.fn(),
}));
vi.mock("@/lib/inventory/opname-snapshot", () => ({ freezeFabricRollSnapshot: vi.fn(), freezeItemSnapshot: vi.fn() }));
vi.mock("@/lib/inventory/opname-journal", () => ({ postOpnameJournal: vi.fn(), probeOpnameNetDelta: vi.fn() }));
vi.mock("@/lib/serialize-for-client", () => ({ serializeForClient: (v: unknown) => v }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
/* Hanya dipakai fungsi pemrosesan GRN, bukan pembaca barisnya. */
vi.mock("@/lib/inventory/costing", () => ({ calculateMovingAverage: vi.fn() }));
vi.mock("@/lib/finance/pajak/grn-ppn", () => ({ kunciBarisPpn: vi.fn() }));

const { getGrnTanpaPoMenungguUntukOpname } = await import("./stock-opname");

beforeEach(() => {
  h.auth.mockReset().mockResolvedValue({ user: { id: "u1", permissions: ["inventory_opname:view"] } });
  h.grnFindMany.mockReset().mockResolvedValue([
    {
      id: "g1",
      docNumber: "GRN/2026/0007",
      grnDate: new Date("2026-11-02T03:00:00.000Z"),
      supplier: { name: "Pemasok A" },
      items: [
        { itemId: "i1", variantSku: "KAOS-M", qty: 12, unitCost: 1000, totalCost: 12000 },
        { itemId: "i-hilang", variantSku: "", qty: 3, unitCost: 0, totalCost: 0 },
        { bukan: "baris" },
      ],
    },
  ]);
  h.itemFindMany.mockReset().mockResolvedValue([{ id: "i1", sku: "KAOS", nameId: "Kaos Polos" }]);
});

describe("getGrnTanpaPoMenungguUntukOpname", () => {
  it("menolak tanpa izin lihat opname, sebelum membaca apa pun", async () => {
    h.auth.mockResolvedValue({ user: { id: "u1", permissions: ["goods_receipts:confirm_no_po"] } });
    await expect(getGrnTanpaPoMenungguUntukOpname()).rejects.toThrow();
    expect(h.grnFindMany).not.toHaveBeenCalled();
  });

  it("hanya membaca GRN tanpa PO yang masih menunggu, paling lama dulu, paling banyak 50", async () => {
    await getGrnTanpaPoMenungguUntukOpname();
    expect(h.grnFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requiresNoPoConfirmation: true, noPoConfirmedAt: null },
        orderBy: { createdAt: "asc" },
        take: 50,
      }),
    );
  });

  it("memetakan pemasok dan barangnya; barang yang tidak dikenal tetap tampil dengan id-nya", async () => {
    expect(await getGrnTanpaPoMenungguUntukOpname()).toEqual([
      {
        id: "g1",
        docNumber: "GRN/2026/0007",
        pemasok: "Pemasok A",
        diterimaPada: "2026-11-02T03:00:00.000Z",
        barang: [
          { itemId: "i1", sku: "KAOS", nama: "Kaos Polos", variantSku: "KAOS-M", qty: 12 },
          { itemId: "i-hilang", sku: null, nama: "i-hilang", variantSku: null, qty: 3 },
        ],
      },
    ]);
    expect(h.itemFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["i1", "i-hilang"] } } }));
  });

  it("tanpa GRN menunggu: daftar kosong, tanpa membaca barang", async () => {
    h.grnFindMany.mockResolvedValue([]);
    expect(await getGrnTanpaPoMenungguUntukOpname()).toEqual([]);
    expect(h.itemFindMany).not.toHaveBeenCalled();
  });
});
