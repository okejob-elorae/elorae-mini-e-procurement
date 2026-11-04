import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { bersihkanPesananUji, buatPesananUji, kemasUji, type PesananUji } from "@/lib/delivery/uji-pengiriman";
import {
  batalkanNotaPengirimanInTx,
  koreksiNotaDiterimaInTx,
  kodeTolakDariPenghalangPiutang,
  penghalangBatalNota,
  type LaporanPembayaranNota,
} from "./koreksi-nota";

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

const kosong: LaporanPembayaranNota = { dibayar: false, bkm: [], setoran: [], pelunasan: [], kontrabon: [] };

describe("penghalangBatalNota (R14, P16, P33a)", () => {
  it("nothing attached → no refusal", () => {
    expect(penghalangBatalNota(kosong)).toBeNull();
  });

  it("any BKM except one its reporter withdrew blocks, checked or not", () => {
    for (const status of ["DIKIRIM", "TERVERIFIKASI", "DITOLAK"]) {
      expect(penghalangBatalNota({ ...kosong, bkm: [{ docNo: "BKM-1", status, nilai: 1 }] })).toEqual({ kode: "RECEIVABLE_PAID", detail: "BKM-1" });
    }
    expect(penghalangBatalNota({ ...kosong, bkm: [{ docNo: "BKM-1", status: "DIBATALKAN", nilai: 1 }] })).toBeNull();
  });

  it("every collector submission and store settlement blocks, whatever its status", () => {
    for (const status of ["PENDING", "VERIFIED", "REJECTED"]) {
      expect(penghalangBatalNota({ ...kosong, setoran: [{ docNo: "setoran abc", status, nilai: 1 }] })?.kode).toBe("RECEIVABLE_PAID");
    }
    for (const status of ["PENDING", "APPROVED", "REJECTED"]) {
      expect(penghalangBatalNota({ ...kosong, pelunasan: [{ docNo: "PLN-1", status, nilai: 1 }] })?.kode).toBe("RECEIVABLE_PAID");
    }
  });

  it("a recorded payment blocks without a report number; a running kontrabon is IN_USE", () => {
    expect(penghalangBatalNota({ ...kosong, dibayar: true })).toEqual({ kode: "RECEIVABLE_PAID" });
    expect(penghalangBatalNota({ ...kosong, kontrabon: [{ docNo: "KB-1", nilai: 5 }] })).toEqual({ kode: "RECEIVABLE_IN_USE", detail: "kontrabon KB-1" });
    /* A payment report outranks the kontrabon: its sentence names the money. */
    expect(penghalangBatalNota({ ...kosong, kontrabon: [{ docNo: "KB-1", nilai: 5 }], bkm: [{ docNo: "BKM-2", status: "DIKIRIM", nilai: 1 }] })?.kode).toBe(
      "RECEIVABLE_PAID",
    );
  });
});

describe("kodeTolakDariPenghalangPiutang (the shared receivable-void blocker, also the cycle unlock's)", () => {
  it("payment blockers read PAID, collection blockers read IN_USE", () => {
    expect(kodeTolakDariPenghalangPiutang("ADA_BKM")).toBe("RECEIVABLE_PAID");
    expect(kodeTolakDariPenghalangPiutang("ADA_PEMBAYARAN_TOKO")).toBe("RECEIVABLE_PAID");
    expect(kodeTolakDariPenghalangPiutang("ADA_KONTRABON")).toBe("RECEIVABLE_IN_USE");
    expect(kodeTolakDariPenghalangPiutang("ADA_TUGAS_TAGIH")).toBe("RECEIVABLE_IN_USE");
  });
});

/* Writes notas and receivables — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("koreksiNotaDiterimaInTx / batalkanNotaPengirimanInTx (test bed only)", () => {
  let p: PesananUji | null = null;

  afterEach(async () => {
    await bersihkanPesananUji(p);
    p = null;
  });

  async function notaBaru(qty: number) {
    const s = await kemasUji(p!, { lines: [{ orderLineId: p!.lineIds[0], qty }] });
    return prisma.fieldSalesDelivery.findUniqueOrThrow({
      where: { id: seededId(s.deliveryId ?? "") },
      include: { lines: true, receivable: true, taxInvoice: true },
    });
  }

  it("a correction sends a numbered faktur back to the replacement queue and tells the tax admin", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const nota = await notaBaru(10);
    await prisma.taxInvoice.update({ where: { id: seededId(nota.taxInvoice!.id) }, data: { status: "CREATED", invoiceNo: `010.000-26.${p.token}` } });
    const r = await runSerializable((tx) =>
      koreksiNotaDiterimaInTx(tx, {
        deliveryId: nota.id,
        baris: [{ deliveryLineId: nota.lines[0].id, kembali: 0, hilang: 2 }],
        sumber: "PENERIMAAN_TOKO",
        refKembali: "uji",
        olehUserId: p!.salesmanId,
        alasan: "Kurang tiba",
        sekarang: new Date(),
      }),
    );
    expect(r.batal).toBe(false);
    expect(r.nilaiBersihSebelum.get(nota.lines[0].id)).toBe(100000);
    const kategori = r.notifikasi.map((n) => n.category);
    expect(kategori).toEqual(["DELIVERY_NOTA_CORRECTED", "TAX_INVOICE_NOTA_CHANGED"]);
    expect((r.notifikasi[1].metadata as { jenis?: string }).jenis).toBe("KOREKSI");
    const faktur = await prisma.taxInvoice.findUniqueOrThrow({ where: { id: seededId(nota.taxInvoice!.id) } });
    expect(faktur.status).toBe("PENDING");
    const sesudah = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: seededId(nota.id) }, include: { lines: true, receivable: true } });
    expect(sesudah.lines[0]).toMatchObject({ qty: 8, lostQty: 2 });
    expect(Number(sesudah.receivable?.amount)).toBe(80000);
    const riwayat = await prisma.salesHistory.findMany({ where: { channel: "OFFLINE", orderId: nota.docNo } });
    expect(riwayat.reduce((n, h) => n + h.quantity, 0)).toBe(8);
    expect(await prisma.auditLog.count({ where: { entityId: seededId(nota.id), action: "DELIVERY_NOTA_CORRECTED" } })).toBe(1);
  });

  it("reports money still waiting to be checked that the corrected nota no longer covers (P34)", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const nota = await notaBaru(10);
    const claim = await prisma.paymentClaim.create({
      data: { docNo: `BKM-TEST-${p.token}`, storeId: p.storeId, salesmanId: p.salesmanId, claimedTransferAt: new Date(), createdById: p.salesmanId },
    });
    await prisma.paymentClaimReceivable.create({ data: { paymentClaimId: claim.id, receivableId: nota.receivable!.id, settledAmount: 100000 } });
    const r = await runSerializable((tx) =>
      koreksiNotaDiterimaInTx(tx, {
        deliveryId: nota.id,
        baris: [{ deliveryLineId: nota.lines[0].id, kembali: 4, hilang: 0 }],
        sumber: "PENERIMAAN_TOKO",
        refKembali: "uji",
        olehUserId: p!.salesmanId,
        alasan: "Ditolak di pintu",
        sekarang: new Date(),
      }),
    );
    const n = r.notifikasi.find((x) => x.category === "DELIVERY_NOTA_CORRECTED")!;
    expect(n.severity).toBe("WARNING");
    expect((n.metadata as { menungguCek?: string }).menungguCek).toContain(`BKM-TEST-${p.token}`);
    expect(n.message).toContain("menunggu cek");
  });

  it("a void cancels a numbered faktur (number kept) and tells the tax admin to cancel it in Coretax", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [5] });
    const nota = await notaBaru(5);
    await prisma.taxInvoice.update({ where: { id: seededId(nota.taxInvoice!.id) }, data: { status: "CREATED", invoiceNo: `010.000-26.${p.token}` } });
    const r = await runSerializable((tx) =>
      batalkanNotaPengirimanInTx(tx, { deliveryId: nota.id, olehUserId: p!.salesmanId, alasan: "Tidak jadi", sekarang: new Date(), refKembali: "batal", periksa: true }),
    );
    expect(r.batal).toBe(true);
    const tax = r.notifikasi.find((x) => x.category === "TAX_INVOICE_NOTA_CHANGED")!;
    expect((tax.metadata as { jenis?: string }).jenis).toBe("BATAL");
    const faktur = await prisma.taxInvoice.findUniqueOrThrow({ where: { id: seededId(nota.taxInvoice!.id) } });
    expect(faktur.status).toBe("CANCELLED");
    expect(faktur.invoiceNo).toBe(`010.000-26.${p.token}`);
  });

  it("refuses a void the moment a payment report exists, inside the same transaction, writing nothing", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [5] });
    const nota = await notaBaru(5);
    await prisma.collectionSubmission.create({
      data: {
        receivableId: nota.receivable!.id,
        collectorId: p.salesmanId,
        amount: 1000,
        method: "CASH",
        paidAt: new Date(),
        status: "REJECTED",
      },
    });
    try {
      const err = await runSerializable((tx) =>
        batalkanNotaPengirimanInTx(tx, { deliveryId: nota.id, olehUserId: p!.salesmanId, alasan: "x", sekarang: new Date(), refKembali: "batal", periksa: true }),
      ).catch((e) => e);
      expect(err.code).toBe("RECEIVABLE_PAID");
      const tetap = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: seededId(nota.id) } });
      expect(tetap.voidedAt).toBeNull();
    } finally {
      await prisma.collectionSubmission.deleteMany({ where: { receivableId: seededId(nota.receivable!.id) } });
    }
  });

  it("refuses a void while an OPEN collection task lists the nota (same blocker as the cycle unlock), naming the collector", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [5] });
    const nota = await notaBaru(5);
    const tugas = await prisma.collectionTask.create({
      data: { assigneeId: p.salesmanId, storeId: p.storeId, receivableIds: [nota.receivable!.id], status: "TERBUKA", createdById: p.salesmanId },
    });
    try {
      const batal = () =>
        runSerializable((tx) =>
          batalkanNotaPengirimanInTx(tx, { deliveryId: nota.id, olehUserId: p!.salesmanId, alasan: "x", sekarang: new Date(), refKembali: "batal", periksa: true }),
        );
      const err = await batal().catch((e) => e);
      expect(err.code).toBe("RECEIVABLE_IN_USE");
      expect(err.detail).toContain("tugas tagih");
      const tetap = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: seededId(nota.id) } });
      expect(tetap.voidedAt).toBeNull();

      /* A finished task no longer holds the nota. */
      await prisma.collectionTask.update({ where: { id: seededId(tugas.id) }, data: { status: "SELESAI", completedAt: new Date() } });
      await expect(batal()).resolves.toMatchObject({ batal: true });
    } finally {
      await prisma.collectionTask.deleteMany({ where: { id: seededId(tugas.id) } });
    }
  });
});
