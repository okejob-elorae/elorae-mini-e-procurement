import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Sapuan jurnal penjualan otomatis adalah satu-satunya jalan "posting ulang"
 * untuk pesanan marketplace: begitu jurnal pendapatan/HPP sebuah pesanan
 * berhasil, tanda JOURNAL_PENDING jenis itu harus selesai — kalau tidak,
 * baris "Jurnal gagal" di Beranda tidak pernah hilang. Basis data ditiru
 * seluruhnya: sapuan asli global dan butuh pengaturan cutover bersama.
 */

const db = vi.hoisted(() => ({
  pesanan: [] as Array<{ id: string; salesorderNo: string; shippedById: string | null }>,
}));
vi.mock("@elorae/db", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@elorae/db")>();
  const prisma = {
    systemSetting: { findUnique: vi.fn(async () => ({ value: "2026-01-01" })) },
    user: { findFirst: vi.fn(async () => ({ id: "admin-uji" })) },
    $queryRaw: vi.fn(async () => db.pesanan),
    journal: { findMany: vi.fn(async () => []) },
    adminNotification: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: "n-uji" })),
    },
  };
  return { ...asli, prisma };
});
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

const posting = vi.hoisted(() => ({ gagalPendapatan: new Set<string>() }));
vi.mock("./sales-journal", () => ({
  postSalesRevenueJournal: vi.fn(async (id: string) =>
    posting.gagalPendapatan.has(id)
      ? { ok: false, code: "UNMAPPED_ROLE", role: "AR" }
      : { ok: true, journalId: `j-rev-${id}`, created: true },
  ),
  postSalesCogsJournal: vi.fn(async (id: string) => ({ ok: true, journalId: `j-cogs-${id}`, created: true })),
}));

const { tandai } = vi.hoisted(() => ({ tandai: vi.fn(async () => 0) }));
vi.mock("@/lib/finance/jurnal-tertunda", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/finance/jurnal-tertunda")>()),
  tandaiJurnalTertundaSelesai: tandai,
}));

const { postPendingSalesJournals } = await import("./sweep");

describe("postPendingSalesJournals menandai JOURNAL_PENDING selesai", () => {
  beforeEach(() => {
    tandai.mockClear();
    posting.gagalPendapatan = new Set();
    db.pesanan = [
      { id: "so-1", salesorderNo: "SO-1", shippedById: "u-1" },
      { id: "so-2", salesorderNo: "SO-2", shippedById: "u-1" },
    ];
  });

  it("menandai setiap jenis jurnal yang berhasil, dan bukan yang gagal", async () => {
    posting.gagalPendapatan.add("so-2");

    const hasil = await postPendingSalesJournals({ orderIds: ["so-1", "so-2"] });

    expect(hasil.posted).toBe(3);
    expect(hasil.pending).toBe(1);
    expect(tandai).toHaveBeenCalledTimes(1);
    const sumber = (tandai.mock.calls[0] as unknown as [unknown[]])[0];
    expect(sumber).toEqual(
      expect.arrayContaining([
        { tipe: "dokumen", sourceType: "SALESORDER_REVENUE", sourceId: "so-1" },
        { tipe: "dokumen", sourceType: "SALESORDER_COGS", sourceId: "so-1" },
        { tipe: "dokumen", sourceType: "SALESORDER_COGS", sourceId: "so-2" },
      ]),
    );
    expect(sumber).toHaveLength(3);
  });

  it("tidak menulis apa pun bila tidak ada yang berhasil", async () => {
    db.pesanan = [];
    await postPendingSalesJournals({ orderIds: ["so-x"] });
    expect(tandai).not.toHaveBeenCalled();
  });
});
