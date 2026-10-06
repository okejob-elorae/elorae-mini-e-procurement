import { describe, expect, it, vi } from "vitest";

/*
 * Baris "Jurnal gagal" di Beranda (dan lencana sidebar) dulu menghitung SEMUA
 * notifikasi JOURNAL_PENDING yang belum dibaca. Sekarang angkanya dari
 * `hitungJurnalTertunda`: belum ditandai selesai DAN dokumennya memang belum
 * berjurnal.
 */

const { hitung, hitungMentah } = vi.hoisted(() => ({
  hitung: vi.fn(async () => 2),
  hitungMentah: vi.fn(async () => 7),
}));
vi.mock("@/lib/finance/jurnal-tertunda", () => ({ hitungJurnalTertunda: hitung }));
vi.mock("@elorae/db", () => ({
  prisma: {
    fieldSalesOrder: { count: vi.fn(async () => 0) },
    storeChangeRequest: { count: vi.fn(async () => 0) },
    taxInvoice: { count: vi.fn(async () => 0) },
    salesReturn: { count: vi.fn(async () => 0) },
    adminNotification: { count: hitungMentah },
  },
}));

const { getActionItemCounts } = await import("./action-items");

describe("getActionItemCounts — Jurnal gagal", () => {
  it("memakai hitungan yang tertunda sungguhan, bukan semua notifikasi belum dibaca", async () => {
    const hasil = await getActionItemCounts();
    expect(hasil.journalPending).toBe(2);
    expect(hitung).toHaveBeenCalledWith();
    expect(hitungMentah).not.toHaveBeenCalled();
  });
});
