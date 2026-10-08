import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Jurnal penerimaan barang jadi (keputusan sementara pemilik 34 — ongkos jahit
 * masuk HPP): DR persediaan barang jadi + DR PPN Masukan / CR persediaan bahan
 * + CR hutang usaha (jasa) + CR biaya yang masih harus dibayar (tambahan).
 *
 * Basis data uji nyata. Pemetaan akun TIDAK disentuh: `resolveAccount` ditiru
 * dan menunjuk akun-akun milik tes ini, jadi agen/tes lain yang memakai
 * pemetaan bersama pada saat yang sama tidak terganggu.
 */

const peta = vi.hoisted(() => ({ akun: {} as Record<string, string>, kosong: new Set<string>() }));
vi.mock("@/lib/finance/journals/mapping", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@/lib/finance/journals/mapping")>();
  return {
    ...asli,
    resolveAccount: vi.fn(async (role: string) => {
      const id = peta.akun[role];
      if (!id || peta.kosong.has(role)) throw new asli.UnmappedRoleError(role);
      return id;
    }),
  };
});
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

const { postFgReceiptJournal, barisJurnalPenerimaanFG } = await import("./fg-receipt-journal");
const { postFgReceiptJournalAman } = await import("./fg-receipt-journal-aman");
const { cariPenerimaanFgTanpaJurnal } = await import("./sapuan");
const { sumberSapuanTerdaftar } = await import("@/lib/finance/sapuan/semua");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const PERAN = ["INVENTORY_FG", "INVENTORY", "AP", "PPN_MASUKAN", "ACCRUED_EXPENSE"] as const;
const TIPE: Record<(typeof PERAN)[number], "ASET" | "LIABILITAS"> = {
  INVENTORY_FG: "ASET",
  INVENTORY: "ASET",
  AP: "LIABILITAS",
  PPN_MASUKAN: "ASET",
  ACCRUED_EXPENSE: "LIABILITAS",
};
// Tahun jauh di luar data nyata dan di luar 2001–2003 (dipakai tes tutup periode).
const TANGGAL = new Date("2004-02-10T03:00:00.000Z");

describe("barisJurnalPenerimaanFG (murni)", () => {
  it("penerimaan lengkap PKP: lima baris, seimbang", () => {
    const baris = barisJurnalPenerimaanFG(
      { persediaan: 1_080_000, ppnMasukan: 66_000, bahan: 400_000, jasa: 666_000, tambahan: 80_000 },
      { jasa: "Jasa produksi WO X" },
    );
    expect(baris).toEqual([
      { role: "INVENTORY_FG", debit: 1_080_000, credit: 0 },
      { role: "PPN_MASUKAN", debit: 66_000, credit: 0, memo: "DPP 600000.00" },
      { role: "INVENTORY", debit: 0, credit: 400_000 },
      { role: "AP", debit: 0, credit: 666_000, memo: "Jasa produksi WO X" },
      { role: "ACCRUED_EXPENSE", debit: 0, credit: 80_000 },
    ]);
    const dr = baris.reduce((s, b) => s + b.debit, 0);
    const cr = baris.reduce((s, b) => s + b.credit, 0);
    expect(dr).toBe(cr);
  });

  it("komponen nol dibuang: penerimaan lama = DR barang jadi / CR bahan", () => {
    expect(barisJurnalPenerimaanFG({ persediaan: 500, ppnMasukan: 0, bahan: 500, jasa: 0, tambahan: 0 })).toEqual([
      { role: "INVENTORY_FG", debit: 500, credit: 0 },
      { role: "INVENTORY", debit: 0, credit: 500 },
    ]);
  });
});

d("jurnal penerimaan barang jadi (basis data uji)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let vendorId = "";
  let uomId = "";
  let itemId = "";
  let woId = "";
  let urut = 0;
  const akunIds: string[] = [];
  const receiptIds: string[] = [];

  beforeAll(async () => {
    userId = "";
    typeId = "";
    vendorId = "";
    uomId = "";
    itemId = "";
    woId = "";
    userId = (await prisma.user.create({ data: { email: `fgj-${token}@uji.local`, name: "Uji jurnal FG" }, select: { id: true } })).id;
    typeId = (await prisma.supplierType.create({ data: { code: `TFJ-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    vendorId = (await prisma.supplier.create({ data: { code: `CMT-FJ-${token}`, name: "CMT uji", typeId }, select: { id: true } })).id;
    uomId = (await prisma.uOM.create({ data: { code: `J${token}`.slice(0, 10), nameId: "Pcs", nameEn: "Pcs" }, select: { id: true } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `FG-FJ-${token}`, nameId: "Kaos uji", nameEn: "Test tee", type: "FINISHED_GOOD", uomId },
        select: { id: true },
      })
    ).id;
    woId = (
      await prisma.workOrder.create({
        data: {
          docNumber: `WO-FJ-${token}`,
          vendorId,
          finishedGoodId: itemId,
          plannedQty: 100,
          consumptionPlan: {},
          createdById: userId,
          outputMode: "GENERIC",
          status: "IN_PRODUCTION",
        },
        select: { id: true },
      })
    ).id;
    for (const [i, role] of PERAN.entries()) {
      const a = await prisma.chartAccount.create({
        data: { code: `9B1${token}${i}`, name: `Uji ${role}`, type: TIPE[role], depth: 1, isActive: true },
        select: { id: true },
      });
      akunIds.push(a.id);
      peta.akun[role] = a.id;
    }
  });

  beforeEach(() => {
    peta.kosong = new Set();
  });

  afterAll(async () => {
    const ids = seededIds(receiptIds);
    try {
      await prisma.adminNotification.deleteMany({
        where: {
          id: {
            in: (await prisma.adminNotification.findMany({ where: { category: "JOURNAL_PENDING" }, select: { id: true, metadata: true } }))
              .filter((n) => ids.includes(String((n.metadata as { receiptId?: unknown } | null)?.receiptId ?? "")))
              .map((n) => n.id),
          },
        },
      });
    } catch (e) {
      console.warn("[fg-receipt-journal.test] gagal menghapus notifikasi uji", e);
    }
    const jurnal = await prisma.journal.findMany({ where: { sourceType: "FG_RECEIPT", sourceId: { in: ids } }, select: { id: true } });
    await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(jurnal.map((j) => j.id)) } } });
    await prisma.journal.deleteMany({ where: { id: { in: seededIds(jurnal.map((j) => j.id)) } } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: seededIds(akunIds) } } });
    await prisma.fGReceipt.deleteMany({ where: { id: { in: seededIds(receiptIds) } } });
    await prisma.workOrder.deleteMany({ where: { id: seededId(woId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(vendorId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  async function penerimaan(isi: {
    qtyAccepted: number;
    totalCostValue: number | null;
    materialCost?: number | null;
    serviceCost?: number | null;
    additionalCost?: number | null;
    receivedAt?: Date;
  }): Promise<string> {
    urut += 1;
    const r = await prisma.fGReceipt.create({
      data: {
        docNumber: `RCPT-FJ-${token}-${urut}`,
        woId,
        receiptType: "GENERIC",
        qtyReceived: isi.qtyAccepted,
        qtyRejected: 0,
        qtyAccepted: isi.qtyAccepted,
        totalCostValue: isi.totalCostValue,
        materialCost: isi.materialCost ?? null,
        serviceCost: isi.serviceCost ?? null,
        additionalCost: isi.additionalCost ?? null,
        avgCostPerUnit: isi.qtyAccepted > 0 && isi.totalCostValue ? isi.totalCostValue / isi.qtyAccepted : 0,
        receivedById: userId,
        receivedAt: isi.receivedAt ?? TANGGAL,
      },
      select: { id: true },
    });
    receiptIds.push(r.id);
    return r.id;
  }

  async function jurnalDari(receiptId: string) {
    const j = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "FG_RECEIPT", sourceId: receiptId } },
      include: { lines: true },
    });
    if (!j) return null;
    const perPeran = Object.fromEntries(
      PERAN.map((role) => {
        const l = j.lines.find((x) => x.chartAccountId === peta.akun[role]);
        return [role, l ? { debit: Number(l.debit), credit: Number(l.credit) } : null];
      }),
    );
    return { j, perPeran };
  }

  it("penerimaan dengan ongkos jahit (PKP): DR barang jadi + PPN Masukan / CR bahan + hutang jasa + biaya tambahan", async () => {
    const id = await penerimaan({
      qtyAccepted: 40,
      materialCost: 400_000,
      serviceCost: 666_000,
      additionalCost: 80_000,
      totalCostValue: 1_080_000,
    });
    expect(await postFgReceiptJournal(id, userId)).toMatchObject({ ok: true, created: true });
    const hasil = await jurnalDari(id);
    expect(hasil?.perPeran).toEqual({
      INVENTORY_FG: { debit: 1_080_000, credit: 0 },
      PPN_MASUKAN: { debit: 66_000, credit: 0 },
      INVENTORY: { debit: 0, credit: 400_000 },
      AP: { debit: 0, credit: 666_000 },
      ACCRUED_EXPENSE: { debit: 0, credit: 80_000 },
    });
    expect(hasil?.j.date.toISOString()).toBe(TANGGAL.toISOString());
    expect(hasil?.j.description).toBe(`Penerimaan barang jadi RCPT-FJ-${token}-${urut} (WO WO-FJ-${token})`);
  });

  it("non-PKP (PPN jasa ikut biaya): tanpa baris PPN Masukan", async () => {
    const id = await penerimaan({ qtyAccepted: 10, materialCost: 100_000, serviceCost: 166_500, additionalCost: 0, totalCostValue: 266_500 });
    expect(await postFgReceiptJournal(id, userId)).toMatchObject({ ok: true });
    expect((await jurnalDari(id))?.perPeran).toEqual({
      INVENTORY_FG: { debit: 266_500, credit: 0 },
      PPN_MASUKAN: null,
      INVENTORY: { debit: 0, credit: 100_000 },
      AP: { debit: 0, credit: 166_500 },
      ACCRUED_EXPENSE: null,
    });
  });

  it("penerimaan lama (tanpa rincian jasa) tetap DR barang jadi / CR bahan sebesar totalCostValue", async () => {
    const id = await penerimaan({ qtyAccepted: 10, materialCost: 500, totalCostValue: 500 });
    expect(await postFgReceiptJournal(id, userId)).toMatchObject({ ok: true });
    expect((await jurnalDari(id))?.perPeran).toEqual({
      INVENTORY_FG: { debit: 500, credit: 0 },
      PPN_MASUKAN: null,
      INVENTORY: { debit: 0, credit: 500 },
      AP: null,
      ACCRUED_EXPENSE: null,
    });
  });

  it("qty lolos 0 atau nilai 0 → NOTHING_TO_POST; rincian tak masuk akal → UNBALANCED", async () => {
    expect(await postFgReceiptJournal(await penerimaan({ qtyAccepted: 0, totalCostValue: 0 }), userId)).toEqual({
      ok: false,
      code: "NOTHING_TO_POST",
    });
    expect(await postFgReceiptJournal(await penerimaan({ qtyAccepted: 5, totalCostValue: 0 }), userId)).toEqual({
      ok: false,
      code: "NOTHING_TO_POST",
    });
    const rusak = await penerimaan({ qtyAccepted: 5, materialCost: 100, serviceCost: 100, additionalCost: 0, totalCostValue: 300 });
    expect(await postFgReceiptJournal(rusak, userId)).toEqual({ ok: false, code: "UNBALANCED" });
  });

  it("idempoten: posting ulang tidak membuat jurnal kedua", async () => {
    const id = await penerimaan({ qtyAccepted: 4, materialCost: 4_000, serviceCost: 0, additionalCost: 0, totalCostValue: 4_000 });
    expect(await postFgReceiptJournal(id, userId)).toMatchObject({ ok: true, created: true });
    expect(await postFgReceiptJournal(id, userId)).toMatchObject({ ok: true, created: false });
  });

  it("aman: peran belum dipetakan → satu JOURNAL_PENDING (tanpa dobel); berhasil kemudian → tandanya selesai", async () => {
    const id = await penerimaan({ qtyAccepted: 4, materialCost: 4_000, serviceCost: 6_000, additionalCost: 0, totalCostValue: 10_000 });
    peta.kosong = new Set(["AP"]);
    expect(await postFgReceiptJournalAman(id, userId)).toEqual({ ok: false, code: "UNMAPPED_ROLE", role: "AP" });
    expect(await postFgReceiptJournalAman(id, userId)).toEqual({ ok: false, code: "UNMAPPED_ROLE", role: "AP" });

    const tanda = async () =>
      (await prisma.adminNotification.findMany({ where: { category: "JOURNAL_PENDING" }, select: { id: true, readAt: true, metadata: true, title: true } }))
        .filter((n) => (n.metadata as { receiptId?: unknown } | null)?.receiptId === id);
    const sebelum = await tanda();
    expect(sebelum).toHaveLength(1);
    expect(sebelum[0].readAt).toBeNull();
    expect(sebelum[0].metadata).toMatchObject({ receiptId: id, woId, kind: "fg_receipt", reason: "UNMAPPED_ROLE", role: "AP" });
    expect(sebelum[0].title).toBe(`Jurnal penerimaan barang jadi RCPT-FJ-${token}-${urut} belum diposting`);

    peta.kosong = new Set();
    expect(await postFgReceiptJournalAman(id, userId)).toMatchObject({ ok: true, created: true });
    const sesudah = await tanda();
    expect(sesudah).toHaveLength(1);
    expect(sesudah[0].readAt).not.toBeNull();
  });

  it("sapuan: menemukan penerimaan bernilai tanpa jurnal di rentangnya, bukan yang sudah berjurnal / nol / di luar rentang", async () => {
    const hari = (s: string) => new Date(`${s}T03:00:00.000Z`);
    const tanpa = await penerimaan({ qtyAccepted: 3, materialCost: 3_000, serviceCost: 0, additionalCost: 0, totalCostValue: 3_000, receivedAt: hari("2004-03-05") });
    const sudah = await penerimaan({ qtyAccepted: 3, materialCost: 3_000, serviceCost: 0, additionalCost: 0, totalCostValue: 3_000, receivedAt: hari("2004-03-06") });
    await postFgReceiptJournal(sudah, userId);
    await penerimaan({ qtyAccepted: 3, totalCostValue: 0, receivedAt: hari("2004-03-07") });
    await penerimaan({ qtyAccepted: 0, totalCostValue: 3_000, receivedAt: hari("2004-03-08") });
    await penerimaan({ qtyAccepted: 3, materialCost: 3_000, totalCostValue: 3_000, receivedAt: hari("2004-04-02") });

    const ketemu = await cariPenerimaanFgTanpaJurnal({ sejak: hari("2004-03-01"), sampai: hari("2004-03-31"), batas: 50 });
    expect(ketemu.map((x) => x.id)).toEqual([tanpa]);
    expect(ketemu[0].label).toBe(`RCPT-FJ-${token}-${urut - 4}`);

    // Terdaftar di registri sapuan dan memposting lewat jalur aman.
    const sumber = sumberSapuanTerdaftar().find((s) => s.sourceType === "FG_RECEIPT");
    expect(sumber?.label).toBe("Penerimaan barang jadi");
    expect(await sumber!.posting(tanpa, userId)).toMatchObject({ ok: true, created: true });
    expect(await cariPenerimaanFgTanpaJurnal({ sejak: hari("2004-03-01"), sampai: hari("2004-03-31"), batas: 50 })).toEqual([]);
  });
});
