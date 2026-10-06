import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Pembayaran pemasok: tanda "Jurnal gagal" (JOURNAL_PENDING) harus selesai
 * begitu keadaan yang dilaporkannya tidak berlaku lagi — jurnal pembayarannya
 * berhasil diposting, PO-nya dibatalkan bayarnya tanpa ada yang tertinggal di
 * buku, atau jurnal pembalikannya berhasil diposting. PO, pemasok, pengguna,
 * notifikasi dan jurnal asli di basis data uji; penulis jurnal ditiru supaya
 * pemetaan akun bersama tidak tersentuh. Penjaga standing-payment tetap asli.
 */

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: async () => "Penguji Keuangan",
  notifyPOCreated: async () => {},
  notifyPOStatusUpdated: async () => {},
  notifyPOPaymentToggled: async () => {},
}));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

type Klien = { journal: { count: typeof prisma.journal.count; create: typeof prisma.journal.create } };
const tiruan = vi.hoisted(() => ({
  bayar: "UNMAPPED_ROLE" as "ok" | "UNMAPPED_ROLE",
  balik: "NOTHING_TO_POST" as "ok" | "NOTHING_TO_POST" | "UNBALANCED",
  /* Meniru toggle lain yang gagal SELAMA batal bayar ini berjalan. */
  tandaSelaBalik: null as null | (() => Promise<void>),
}));
vi.mock("@/lib/purchasing/supplier-payment-journal", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@/lib/purchasing/supplier-payment-journal")>();
  const generasi = async (poId: string, client: Klien) =>
    (await client.journal.count({
      where: { sourceType: "SUPPLIER_PAYMENT_REVERSAL", sourceId: { startsWith: `${poId}#` } },
    })) + 1;
  return {
    ...asli,
    postSupplierPaymentJournal: vi.fn(async (poId: string, postedById: string, _paidAt: Date, client: Klien) => {
      if (tiruan.bayar !== "ok") return { ok: false, code: tiruan.bayar, role: "AP" };
      const j = await client.journal.create({
        data: {
          date: new Date(),
          description: "uji bayar",
          sourceType: "SUPPLIER_PAYMENT",
          sourceId: `${poId}#${await generasi(poId, client)}`,
          postedById,
        },
        select: { id: true },
      });
      return { ok: true, journalId: j.id, created: true };
    }),
    postSupplierPaymentReversalJournal: vi.fn(async (poId: string, postedById: string, client: Klien) => {
      if (tiruan.tandaSelaBalik) await tiruan.tandaSelaBalik();
      if (tiruan.balik !== "ok") return { ok: false, code: tiruan.balik };
      const j = await client.journal.create({
        data: {
          date: new Date(),
          description: "uji balik",
          sourceType: "SUPPLIER_PAYMENT_REVERSAL",
          sourceId: `${poId}#${await generasi(poId, client)}`,
          postedById,
        },
        select: { id: true },
      });
      return { ok: true, journalId: j.id, created: true };
    }),
  };
});

const { setPOPaidAt, postSupplierPaymentReversalJournalAction } = await import("@/app/actions/purchase-orders");
const { hitungJurnalTertunda } = await import("@/lib/finance/jurnal-tertunda");

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("setPOPaidAt menyelesaikan tanda Jurnal gagal pembayaran pemasok (basis data uji)", () => {
  const token = Math.floor(Math.random() * 10_000_000).toString();
  let userId = "";
  let supplierTypeId = "";
  let supplierId = "";
  let poIds: string[] = [];
  let notifIds: string[] = [];

  async function buatPo(label: string): Promise<string> {
    const po = await prisma.purchaseOrder.create({
      data: { docNumber: `PO-W6-${token}-${label}`, supplierId, createdById: userId, paidAt: null },
      select: { id: true },
    });
    poIds.push(po.id);
    return po.id;
  }

  async function tandaLama(poId: string, kind: string, reason: string): Promise<string> {
    const n = await prisma.adminNotification.create({
      data: {
        category: "JOURNAL_PENDING",
        severity: "WARNING",
        title: "uji",
        message: "uji",
        metadata: { docId: poId, kind, reason, role: null },
        createdAt: new Date(Date.now() - 60_000),
      },
      select: { id: true },
    });
    notifIds.push(n.id);
    return n.id;
  }

  /* Dicocokkan di JS pada `metadata.docId`, seperti pembaca lain (JSON-path tidak andal). */
  async function tandaUntuk(poId: string): Promise<{ id: string; readAt: Date | null }[]> {
    const semua = await prisma.adminNotification.findMany({
      where: { category: "JOURNAL_PENDING" },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { id: true, readAt: true, metadata: true },
    });
    return semua
      .filter((n) => (n.metadata as { docId?: string } | null)?.docId === poId)
      .map((n) => ({ id: n.id, readAt: n.readAt }));
  }

  beforeAll(async () => {
    userId = "";
    supplierTypeId = "";
    supplierId = "";
    const user = await prisma.user.create({ data: { email: `test-w6-${token}@test.local`, name: "Penguji Keuangan" } });
    userId = user.id;
    const tipe = await prisma.supplierType.create({ data: { code: `ST-W6-${token}`, name: "Uji" } });
    supplierTypeId = tipe.id;
    const pemasok = await prisma.supplier.create({ data: { code: `SUP-W6-${token}`, name: "Uji", typeId: supplierTypeId } });
    supplierId = pemasok.id;
  }, 60_000);

  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { id: userId, permissions: ["*"] } });
    tiruan.bayar = "UNMAPPED_ROLE";
    tiruan.balik = "NOTHING_TO_POST";
    tiruan.tandaSelaBalik = null;
    poIds = [];
    notifIds = [];
  });

  afterEach(async () => {
    for (const poId of poIds) {
      const id = seededId(poId);
      try {
        const tanda = await tandaUntuk(id);
        if (tanda.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(tanda.map((t) => t.id)) } } });
      } catch (e) {
        console.warn("[set-po-paid-at-jurnal-tertunda.test.ts] gagal menghapus notifikasi uji", id, e);
      }
      try {
        await prisma.journal.deleteMany({
          where: { sourceType: { in: ["SUPPLIER_PAYMENT", "SUPPLIER_PAYMENT_REVERSAL"] }, sourceId: { startsWith: `${id}#` } },
        });
        await prisma.pOStatusHistory.deleteMany({ where: { poId: seededId(poId) } });
        await prisma.purchaseOrder.delete({ where: { id } });
      } catch (e) {
        console.warn("[set-po-paid-at-jurnal-tertunda.test.ts] gagal menghapus PO uji", id, e);
      }
    }
    try {
      if (notifIds.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(notifIds) } } });
    } catch (e) {
      console.warn("[set-po-paid-at-jurnal-tertunda.test.ts] gagal menghapus notifikasi uji", notifIds, e);
    }
  });

  afterAll(async () => {
    try {
      if (supplierId) await prisma.supplier.delete({ where: { id: seededId(supplierId) } });
      if (supplierTypeId) await prisma.supplierType.delete({ where: { id: seededId(supplierTypeId) } });
      if (userId) await prisma.user.delete({ where: { id: seededId(userId) } });
    } catch (e) {
      console.warn("[set-po-paid-at-jurnal-tertunda.test.ts] gagal menghapus pemasok/pengguna uji", e);
    }
  });

  it("tandai bayar gagal → 1 baris; batal bayar tanpa jurnal tertinggal → 0", async () => {
    const poId = await buatPo("A");

    const tandai = await setPOPaidAt(poId, new Date());
    expect(tandai.journalFailure?.code).toBe("UNMAPPED_ROLE");
    const tanda = await tandaUntuk(poId);
    expect(tanda).toHaveLength(1);
    expect(await hitungJurnalTertunda({ notifikasiIds: tanda.map((t) => t.id) })).toBe(1);

    const batal = await setPOPaidAt(poId, null);
    expect(batal.changed).toBe(true);
    expect(batal.journalFailure).toBeNull();
    const sesudah = await tandaUntuk(poId);
    expect(sesudah.every((t) => t.readAt != null)).toBe(true);
    expect(await hitungJurnalTertunda({ notifikasiIds: sesudah.map((t) => t.id) })).toBe(0);
  });

  it("dua alasan kegagalan untuk PO yang sama → tandai bayar yang berhasil menyelesaikan keduanya", async () => {
    const poId = await buatPo("B");
    const lain = await buatPo("B2");
    const a = await tandaLama(poId, "supplier_payment", "UNMAPPED_ROLE");
    const b = await tandaLama(poId, "supplier_payment", "GRN_JOURNALS_INCOMPLETE");
    const c = await tandaLama(lain, "supplier_payment", "UNMAPPED_ROLE");
    expect(await hitungJurnalTertunda({ notifikasiIds: [a, b, c] })).toBe(3);

    tiruan.bayar = "ok";
    const tandai = await setPOPaidAt(poId, new Date());

    expect(tandai.journalFailure).toBeNull();
    const sesudah = await tandaUntuk(poId);
    expect(sesudah.map((t) => t.readAt != null)).toEqual([true, true]);
    expect((await tandaUntuk(lain))[0].readAt).toBeNull();
    expect(await hitungJurnalTertunda({ notifikasiIds: [a, b, c] })).toBe(1);
  });

  it("tanda kegagalan yang ditulis SESUDAH batal bayar dimulai tidak ikut diselesaikan", async () => {
    const poId = await buatPo("D");
    await prisma.purchaseOrder.update({ where: { id: poId }, data: { paidAt: new Date() } });
    const lama = await tandaLama(poId, "supplier_payment", "UNMAPPED_ROLE");
    let baru = "";
    tiruan.tandaSelaBalik = async () => {
      const n = await prisma.adminNotification.create({
        data: {
          category: "JOURNAL_PENDING",
          severity: "WARNING",
          title: "uji",
          message: "uji",
          metadata: { docId: poId, kind: "supplier_payment", reason: "GRN_JOURNALS_INCOMPLETE", role: null },
          createdAt: new Date(Date.now() + 1_000),
        },
        select: { id: true },
      });
      baru = n.id;
      notifIds.push(n.id);
    };

    const batal = await setPOPaidAt(poId, null);

    expect(batal.changed).toBe(true);
    const tanda = await tandaUntuk(poId);
    expect(tanda.find((t) => t.id === lama)?.readAt).not.toBeNull();
    expect(tanda.find((t) => t.id === baru)?.readAt).toBeNull();
  });

  it("pembalikan gagal tetap tampil; 'Post reversal journal' yang berhasil menyelesaikannya", async () => {
    const poId = await buatPo("C");
    // Keadaan sesudah batal bayar yang pembalikannya gagal: PO belum dibayar,
    // jurnal pembayaran generasi 1 masih berdiri.
    await prisma.journal.create({
      data: {
        date: new Date(),
        description: "uji berdiri",
        sourceType: "SUPPLIER_PAYMENT",
        sourceId: `${poId}#1`,
        postedById: userId,
        createdAt: new Date(Date.now() - 120_000),
      },
    });
    const n = await tandaLama(poId, "supplier_payment_reversal", "UNBALANCED");

    tiruan.balik = "UNBALANCED";
    const gagal = await postSupplierPaymentReversalJournalAction(poId);
    expect(gagal.ok).toBe(false);
    expect(await hitungJurnalTertunda({ notifikasiIds: [n] })).toBe(1);

    tiruan.balik = "ok";
    const berhasil = await postSupplierPaymentReversalJournalAction(poId);
    expect(berhasil.ok).toBe(true);
    expect((await tandaUntuk(poId)).find((t) => t.id === n)?.readAt).not.toBeNull();
    expect(await hitungJurnalTertunda({ notifikasiIds: [n] })).toBe(0);
  });
});
