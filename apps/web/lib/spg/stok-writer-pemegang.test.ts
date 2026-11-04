import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { completeDeliveryShipment } from "@/lib/delivery/shipment-writer";
import {
  berangkatkanUji,
  bersihkanPesananUji,
  buatPesananUji,
  kemasUji,
  podEkspedisiUji,
  type PesananUji,
} from "@/lib/delivery/uji-pengiriman";
import { folderFotoTerimaToko, terimaKirimanPemegang } from "./stok-writer-pemegang";

/* Writes stock, notas and receipts — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/**
 * P45/P45a: the store's SPG LEFT after the goods were handed over; the store's PIC receives and the
 * holder salesman records it during a visit, with the PIC's name and a photo bound to the document.
 * R12: holder + open visit + no SPG + shipment confirmed by the courier + no receipt yet.
 */
d("terimaKirimanPemegang (test bed only)", () => {
  let p: PesananUji | null = null;

  afterEach(async () => {
    await bersihkanPesananUji(p);
    p = null;
  });

  /** A putus shipment handed over while the SPG was still assigned, then the SPG leaves. */
  async function diserahkanLaluSpgBerhenti() {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10], spg: true, pemegang: true });
    const s = await kemasUji(p, { lines: [{ orderLineId: p.lineIds[0], qty: 10 }] });
    await berangkatkanUji(p, s.shipmentId);
    const sl = await prisma.deliveryShipmentLine.findFirstOrThrow({ where: { shipmentId: seededId(s.shipmentId) } });
    await completeDeliveryShipment(podEkspedisiUji(s.shipmentId, p.salesmanId, [{ shipmentLineId: sl.id, deliveredQty: 10 }]));
    await prisma.user.update({ where: { id: seededId(p.spgId) }, data: { assignedStoreId: null } });
    await prisma.storeVisit.create({ data: { storeId: p.storeId, userId: p.salesmanId, checkinLat: 0, checkinLng: 0 } });
    const nota = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: seededId(s.deliveryId ?? "") }, include: { lines: true } });
    return { shipmentId: s.shipmentId, nota };
  }

  function isian(nota: { id: string; lines: Array<{ id: string }> }, tiba: number, over: Record<string, unknown> = {}) {
    const folder = folderFotoTerimaToko(p!.storeId, "PUTUS_DELIVERY", nota.id);
    return {
      storeId: p!.storeId,
      userId: p!.salesmanId,
      sourceType: "PUTUS_DELIVERY" as const,
      sourceId: nota.id,
      diterima: [{ lineId: nota.lines[0].id, qtyReceived: tiba }],
      picName: "Ibu Sari",
      photoUrl: `https://r2.test/${folder}/1.jpg`,
      photoR2Key: `${folder}/1.jpg`,
      idempotencyKey: `pmg-${p!.token}`,
      ...over,
    };
  }

  it("records the receipt as SALESMAN with the PIC's name and photo; a shortfall opens the lost-goods record", async () => {
    const { nota } = await diserahkanLaluSpgBerhenti();
    const r = await terimaKirimanPemegang(isian(nota, 9));
    expect(r.ok).toBe(true);
    const receipt = await prisma.storeReceipt.findUniqueOrThrow({
      where: { sourceType_sourceId: { sourceType: "PUTUS_DELIVERY", sourceId: nota.id } },
      include: { lines: true },
    });
    expect(receipt).toMatchObject({ receivedVia: "SALESMAN", picName: "Ibu Sari", receivedById: p!.salesmanId });
    expect(receipt.photoR2Key).toContain(folderFotoTerimaToko(p!.storeId, "PUTUS_DELIVERY", nota.id));
    expect(receipt.lines[0]).toMatchObject({ qtySent: 10, qtyReceived: 9, qtyRefused: 0 });
    const loss = await prisma.stockLoss.findFirstOrThrow({ where: { storeId: seededId(p!.storeId) }, include: { lines: true } });
    expect(loss.lines[0].qty).toBe(1);
    const sesudah = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: seededId(nota.id) }, include: { lines: true } });
    expect(sesudah.lines[0]).toMatchObject({ qty: 9, lostQty: 1 });
  });

  it("refuses a user who is not the store's holder, and one without an open visit", async () => {
    const { nota } = await diserahkanLaluSpgBerhenti();
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });
    expect(await terimaKirimanPemegang(isian(nota, 10, { userId: admin.id }))).toEqual({ ok: false, alasan: "BUKAN_PEMEGANG" });
    await prisma.storeVisit.updateMany({ where: { storeId: seededId(p!.storeId) }, data: { checkoutAt: new Date() } });
    expect(await terimaKirimanPemegang(isian(nota, 10))).toEqual({ ok: false, alasan: "TANPA_KUNJUNGAN" });
  });

  it("refuses while the store still has an SPG (absent or not, P26)", async () => {
    const { nota } = await diserahkanLaluSpgBerhenti();
    await prisma.user.update({ where: { id: seededId(p!.spgId) }, data: { assignedStoreId: p!.storeId } });
    expect(await terimaKirimanPemegang(isian(nota, 10))).toEqual({ ok: false, alasan: "TOKO_PUNYA_SPG" });
  });

  it("refuses a shipment the courier has not confirmed yet — its receipt is the courier's (R6/R12)", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10], pemegang: true });
    const s = await kemasUji(p, { lines: [{ orderLineId: p.lineIds[0], qty: 10 }] });
    await berangkatkanUji(p, s.shipmentId);
    await prisma.storeVisit.create({ data: { storeId: p.storeId, userId: p.salesmanId, checkinLat: 0, checkinLng: 0 } });
    const nota = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: seededId(s.deliveryId ?? "") }, include: { lines: true } });
    expect(await terimaKirimanPemegang(isian(nota, 10))).toEqual({ ok: false, alasan: "BELUM_DISERAHKAN" });
  });

  it("requires the PIC's name and a photo bound to THIS document, never reused", async () => {
    const { nota } = await diserahkanLaluSpgBerhenti();
    expect(await terimaKirimanPemegang(isian(nota, 10, { picName: " x " }))).toEqual({ ok: false, alasan: "NAMA_PJ_WAJIB" });
    const lain = folderFotoTerimaToko(p!.storeId, "PUTUS_DELIVERY", "dokumen-lain");
    expect(await terimaKirimanPemegang(isian(nota, 10, { photoR2Key: `${lain}/1.jpg` }))).toEqual({ ok: false, alasan: "FOTO_WAJIB" });
    expect(await terimaKirimanPemegang(isian(nota, 10, { photoR2Key: `store-receipt-photos/${p!.storeId}/1.jpg` }))).toEqual({
      ok: false,
      alasan: "FOTO_WAJIB",
    });
    const folder = folderFotoTerimaToko(p!.storeId, "PUTUS_DELIVERY", nota.id);
    await prisma.storeReceipt.create({
      data: {
        storeId: p!.storeId,
        sourceType: "MUTASI",
        sourceId: `uji-${p!.token}`,
        sourceDocNo: "UJI",
        receivedById: p!.salesmanId,
        photoR2Key: `${folder}/1.jpg`,
      },
    });
    expect(await terimaKirimanPemegang(isian(nota, 10))).toEqual({ ok: false, alasan: "FOTO_WAJIB" });
  });
});
