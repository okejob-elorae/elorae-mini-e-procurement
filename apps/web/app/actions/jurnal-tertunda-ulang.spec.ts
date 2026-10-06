import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededIds } from "@elorae/db";

/*
 * Tombol "Post journal" (posting ulang) harus menandai notifikasi
 * JOURNAL_PENDING dokumennya selesai begitu jurnalnya berhasil — kalau tidak,
 * baris "Jurnal gagal" di Beranda tidak pernah hilang. Basis data uji asli
 * untuk notifikasi dan jurnal; penulis jurnal ditiru (tidak menyentuh pemetaan
 * akun bersama) dan dokumen sumbernya ditiru di lapisan prisma.
 */

const sesi = vi.hoisted(() => ({ id: "penguji-w6", permissions: ["journals:manage"] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: sesi.id, email: null, permissions: sesi.permissions } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/redis/lock", () => ({
  SalesReturnLockBusyError: class extends Error {},
  withSalesReturnLock: async (_id: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, status: 200 })) }));

/*
 * Penulis jurnal tiruan. `hasil.berhasil[sourceType]` memilih hasilnya; saat
 * berhasil, baris Journal sungguhan dibuat untuk (sourceType, id) supaya
 * hitungan Beranda melihat keadaan yang sama dengan produksi.
 */
const hasil = vi.hoisted(() => ({ berhasil: {} as Record<string, boolean>, jurnalIds: [] as string[] }));
const posting = vi.hoisted(() => (sourceType: string) => async (id: string) => {
  if (!hasil.berhasil[sourceType]) return { ok: false as const, code: "UNMAPPED_ROLE" as const, role: "AP" };
  const { prisma: db } = await import("@elorae/db");
  // Idempoten seperti generateAutoJournal: jurnal yang sudah ada dikembalikan.
  const ada = await db.journal.findFirst({ where: { sourceType, sourceId: id }, select: { id: true } });
  if (ada) return { ok: true as const, journalId: ada.id, created: false };
  const j = await db.journal.create({
    data: { date: new Date(), description: "uji posting ulang", sourceType, sourceId: id, postedById: "penguji-w6" },
    select: { id: true },
  });
  hasil.jurnalIds.push(j.id);
  return { ok: true as const, journalId: j.id, created: true };
});
vi.mock("@/lib/inventory/grn-journal", () => ({
  postGrnJournal: vi.fn(posting("GRN")),
  postGrnReversalJournal: vi.fn(posting("GRN_REVERSAL")),
}));
vi.mock("@/lib/production/fg-receipt-journal", () => ({ postFgReceiptJournal: vi.fn(posting("FG_RECEIPT")) }));
vi.mock("@/lib/inventory/opname-journal", () => ({
  postOpnameJournal: vi.fn(posting("OPNAME")),
  opnameNetDelta: vi.fn(async () => 0),
}));
vi.mock("@/lib/canvassing/van-journal", () => ({
  postVanLoadJournal: vi.fn(posting("VAN_LOAD")),
  postVanSaleJournal: vi.fn(posting("VAN_SALE")),
  postVanReconcileJournal: vi.fn(posting("VAN_RECONCILE")),
}));
vi.mock("@/lib/finance/sales/sales-return-journal", () => ({
  postSalesReturnRevenueJournal: vi.fn(posting("SALESRETURN_REVENUE")),
  postSalesReturnCogsJournal: vi.fn(posting("SALESRETURN_COGS")),
}));

/* Dokumen sumber ditiru: hanya `findUnique` pemeriksa keadaan di aksi ulang. */
vi.mock("@elorae/db", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@elorae/db")>();
  const dokumen: Record<string, unknown> = {
    gRN: { id: "grn-uji", ownerDeclinedAt: new Date("2026-01-01") },
    fGReceipt: { woId: "wo-uji" },
    stockOpname: { id: "op-uji", status: "APPROVED" },
    salesReturn: { decidedAt: new Date("2026-01-01") },
    vanLoad: { canvasserId: "kanvas-uji" },
    vanSale: { id: "vs-uji" },
    vanReconcile: { canvasserId: "kanvas-uji" },
  };
  const prisma = new Proxy(asli.prisma, {
    get(t, p) {
      if (typeof p === "string" && p in dokumen) return { findUnique: async () => dokumen[p] };
      const v = Reflect.get(t, p);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
  return { ...asli, prisma };
});

const { postGrnReceiptJournalAction, postGrnReversalJournalAction } = await import("./grn");
const { postFgReceiptJournalAction } = await import("./production");
const { postOpnameJournalAction } = await import("./stock-opname");
const { postVanLoadJournalAction } = await import("./canvassing");
const { postVanSaleJournalAction } = await import("./van-sale");
const { postVanReconcileJournalAction } = await import("./van-reconcile");
const { postSalesReturnJournalsAction } = await import("./sales-return-decision");
const { hitungJurnalTertunda } = await import("@/lib/finance/jurnal-tertunda");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

type Kasus = {
  nama: string;
  sourceType: string;
  metadata: (id: string) => Record<string, unknown>;
  aksi: (id: string) => Promise<{ ok: boolean }>;
};

const KASUS: Kasus[] = [
  { nama: "GRN (terima)", sourceType: "GRN", metadata: (id) => ({ grnId: id, kind: "receipt" }), aksi: postGrnReceiptJournalAction },
  { nama: "GRN (pembalikan)", sourceType: "GRN_REVERSAL", metadata: (id) => ({ grnId: id, kind: "reversal" }), aksi: postGrnReversalJournalAction },
  { nama: "terima barang jadi", sourceType: "FG_RECEIPT", metadata: (id) => ({ receiptId: id, woId: "wo-uji", kind: "fg_receipt" }), aksi: postFgReceiptJournalAction },
  { nama: "opname", sourceType: "OPNAME", metadata: (id) => ({ opnameId: id }), aksi: postOpnameJournalAction },
  { nama: "muat van", sourceType: "VAN_LOAD", metadata: (id) => ({ docId: id, kind: "van_load" }), aksi: postVanLoadJournalAction },
  { nama: "jual van", sourceType: "VAN_SALE", metadata: (id) => ({ docId: id, kind: "van_sale" }), aksi: postVanSaleJournalAction },
  { nama: "rekonsiliasi van", sourceType: "VAN_RECONCILE", metadata: (id) => ({ docId: id, kind: "van_reconcile" }), aksi: postVanReconcileJournalAction },
];

d("posting ulang jurnal menandai JOURNAL_PENDING selesai (basis data uji)", () => {
  let token = "";
  let notifIds: string[] = [];

  beforeEach(() => {
    token = `w6a-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000)}`;
    notifIds = [];
    hasil.berhasil = {};
    hasil.jurnalIds = [];
  });

  afterEach(async () => {
    try {
      if (notifIds.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(notifIds) } } });
    } catch (e) {
      console.warn("[jurnal-tertunda-ulang.spec.ts] gagal menghapus notifikasi uji", notifIds, e);
    }
    try {
      if (hasil.jurnalIds.length) await prisma.journal.deleteMany({ where: { id: { in: seededIds(hasil.jurnalIds) } } });
    } catch (e) {
      console.warn("[jurnal-tertunda-ulang.spec.ts] gagal menghapus jurnal uji", hasil.jurnalIds, e);
    }
  });

  async function gagal(metadata: Record<string, unknown>, reason: string): Promise<string> {
    const n = await prisma.adminNotification.create({
      data: {
        category: "JOURNAL_PENDING",
        severity: "WARNING",
        title: "uji",
        message: "uji",
        metadata: { ...metadata, reason, role: null } as never,
      },
      select: { id: true },
    });
    notifIds.push(n.id);
    return n.id;
  }

  async function dibaca(id: string): Promise<boolean> {
    const n = await prisma.adminNotification.findUnique({ where: { id }, select: { readAt: true } });
    return n?.readAt != null;
  }

  for (const k of KASUS) {
    it(`${k.nama}: gagal → tetap tampil; berhasil → kedua alasan selesai, dokumen lain tidak`, async () => {
      const docId = `${k.sourceType.toLowerCase()}-${token}`;
      const a = await gagal(k.metadata(docId), "UNMAPPED_ROLE");
      const b = await gagal(k.metadata(docId), "ERROR");
      const lain = await gagal(k.metadata(`${docId}-lain`), "UNMAPPED_ROLE");

      const gagalLagi = await k.aksi(docId);
      expect(gagalLagi.ok).toBe(false);
      expect(await hitungJurnalTertunda({ notifikasiIds: [a, b, lain] })).toBe(3);
      expect(await dibaca(a)).toBe(false);

      hasil.berhasil[k.sourceType] = true;
      const berhasil = await k.aksi(docId);

      expect(berhasil.ok).toBe(true);
      expect(await dibaca(a)).toBe(true);
      expect(await dibaca(b)).toBe(true);
      expect(await dibaca(lain)).toBe(false);
      expect(await hitungJurnalTertunda({ notifikasiIds: [a, b, lain] })).toBe(1);
    });
  }

  it("retur penjualan: hanya jenis jurnal yang berhasil yang ditandai selesai", async () => {
    const returnId = `sr-${token}`;
    const pendapatan = await gagal({ salesReturnId: returnId, kind: "revenue" }, "UNMAPPED_ROLE");
    const hpp = await gagal({ salesReturnId: returnId, kind: "cogs" }, "UNMAPPED_ROLE");

    hasil.berhasil.SALESRETURN_REVENUE = true;
    const sebagian = await postSalesReturnJournalsAction(returnId);
    expect(sebagian.ok).toBe(false);
    expect(await dibaca(pendapatan)).toBe(true);
    expect(await dibaca(hpp)).toBe(false);
    expect(await hitungJurnalTertunda({ notifikasiIds: [pendapatan, hpp] })).toBe(1);

    hasil.berhasil.SALESRETURN_COGS = true;
    const penuh = await postSalesReturnJournalsAction(returnId);
    expect(penuh.ok).toBe(true);
    expect(await dibaca(hpp)).toBe(true);
    expect(await hitungJurnalTertunda({ notifikasiIds: [pendapatan, hpp] })).toBe(0);
  });
});
