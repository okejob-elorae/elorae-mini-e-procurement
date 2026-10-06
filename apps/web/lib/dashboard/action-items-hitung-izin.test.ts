import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Beranda memanggil `getActionItemCounts(izin)`: hitungan baris yang tidak
 * boleh dilihat penonton tidak dijalankan sama sekali — termasuk
 * `hitungJurnalTertunda`, bacaan terberat di antaranya. Lencana menu memanggil
 * tanpa izin dan tetap menghitung semuanya.
 */

const { kueri } = vi.hoisted(() => ({ kueri: [] as string[] }));
const catat = (nama: string, nilai: number) =>
  vi.fn(async () => {
    kueri.push(nama);
    return nilai;
  });

vi.mock("@/lib/finance/jurnal-tertunda", () => ({ hitungJurnalTertunda: catat("jurnal", 2) }));
vi.mock("@/lib/receivables/koreksi", () => ({ koreksiTertunda: vi.fn() }));
vi.mock("@elorae/db", () => ({
  prisma: {
    fieldSalesOrder: { count: catat("pesananLapangan", 3) },
    storeChangeRequest: { count: catat("perubahanToko", 4) },
    taxInvoice: { count: catat("fakturPajak", 5) },
    salesReturn: { count: catat("retur", 6) },
  },
}));

const { getActionItemCounts } = await import("./action-items");

beforeEach(() => {
  kueri.length = 0;
});

describe("getActionItemCounts — per izin penonton", () => {
  it("tanpa izin (lencana menu): semua dihitung", async () => {
    expect(await getActionItemCounts()).toEqual({
      fieldSalesPendingApproval: 3,
      storeChangesPending: 4,
      taxInvoicePending: 5,
      salesReturnPending: 6,
      journalPending: 2,
    });
    expect(kueri.sort()).toEqual(["fakturPajak", "jurnal", "perubahanToko", "pesananLapangan", "retur"]);
  });

  it("produksi: tidak satu hitungan pun berjalan", async () => {
    const hasil = await getActionItemCounts(["dashboard:view", "work_orders:view"]);
    expect(Object.values(hasil)).toEqual([0, 0, 0, 0, 0]);
    expect(kueri).toEqual([]);
  });

  it("keuangan dengan journals:view: hanya jurnal tertunda", async () => {
    const hasil = await getActionItemCounts(["dashboard:view", "journals:view"]);
    expect(hasil.journalPending).toBe(2);
    expect(hasil.fieldSalesPendingApproval).toBe(0);
    expect(kueri).toEqual(["jurnal"]);
  });

  it("admin: semua dihitung", async () => {
    await getActionItemCounts(["*"]);
    expect(kueri).toHaveLength(5);
  });
});
