import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { closeFieldSalesOrderRemainder } from "@/lib/field-sales/delivery/writer";
import { terimaKiriman } from "@/lib/spg/stok-writer";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { mapError } from "./action-errors";
import { cancelDeliveryShipment, completeDeliveryShipment } from "./shipment-writer";
import {
  berangkatkanUji,
  bersihkanPesananUji,
  buatPesananUji,
  kemasUji,
  podEkspedisiUji,
  type PesananUji,
} from "./uji-pengiriman";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/**
 * Konsi shipments under the 2026-11-02 rule (Q1): stock leaves main when the shipment is CREATED
 * (into "Gudang Toko, dalam perjalanan"), the store receipt is the only place that lands it on the
 * shelf. At a store without an SPG the courier's confirmation IS that receipt (decision 2026-10-29
 * tambahan #3); at a store with an SPG it only records the handover (P40).
 */
d("konsi shipment stock: creation, POD receipt, SPG receipt, cancel (test bed only)", () => {
  let p: PesananUji | null = null;

  afterEach(async () => {
    await bersihkanPesananUji(p);
    p = null;
  });

  async function kirim(qty: number) {
    const s = await kemasUji(p!, { lines: [{ orderLineId: p!.lineIds[0], qty }] });
    await berangkatkanUji(p!, s.shipmentId);
    const lines = await prisma.deliveryShipmentLine.findMany({ where: { shipmentId: seededId(s.shipmentId) } });
    const transfer = await prisma.konsiTransfer.findUniqueOrThrow({ where: { shipmentId: seededId(s.shipmentId) }, include: { lines: true } });
    return { shipmentId: s.shipmentId, shipmentLineId: lines[0].id, transfer };
  }

  it("at a store without an SPG the POD is the receipt: arrived to StoreStock, refused back to main, lost to a StockLoss valued at the surat jalan price", async () => {
    p = await buatPesananUji({ termsType: "KONSI", qty: [6], onHand: 50, avgCost: 10000, unitPrice: 40000 });
    const k = await kirim(6);
    const bad = await completeDeliveryShipment(podEkspedisiUji(k.shipmentId, p.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 4 }])).catch((e) => e);
    expect(bad.code).toBe("LINE_UNACCOUNTED");

    const r = await completeDeliveryShipment(
      podEkspedisiUji(k.shipmentId, p.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 4, returnedQty: 1, lostQty: 1 }]),
    );
    expect(r.mode).toBe("RECEIPT_AT_POD");
    const t = await prisma.konsiTransfer.findUniqueOrThrow({ where: { id: seededId(k.transfer.id) }, include: { lines: true } });
    expect(t.status).toBe("RECEIVED");
    expect(t.lines[0].receivedQty).toBe(4);
    expect(t.lines[0].returnedQty).toBe(1);
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(p.storeId), itemId: seededId(p.itemId) } });
    expect(Number(ss.qty)).toBe(4);
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: seededId(p.invId) } });
    expect(Number(inv.qtyOnHand)).toBe(45);
    const receipt = await prisma.storeReceipt.findUniqueOrThrow({
      where: { sourceType_sourceId: { sourceType: "KONSI_TRANSFER", sourceId: k.transfer.id } },
      include: { lines: true },
    });
    expect(receipt.receivedVia).toBe("POD");
    expect(receipt.lines[0]).toMatchObject({ qtySent: 5, qtyRefused: 1, qtyReceived: 4 });
    const loss = await prisma.stockLoss.findFirstOrThrow({ where: { storeId: seededId(p.storeId) }, include: { lines: true } });
    expect(loss.shipmentId).toBe(k.shipmentId);
    /* P37: the konsi claim value = the value on the surat jalan, 1 lost × 40.000. */
    expect(Number(loss.claimValue)).toBe(40000);
    expect(loss.lines[0].qty).toBe(1);
    const line = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: seededId(p.lineIds[0]) } });
    expect(line.deliveredQty).toBe(5);
  });

  it("every piece refused at the door cancels the transfer and returns all of it to main", async () => {
    p = await buatPesananUji({ termsType: "KONSI", qty: [6], onHand: 50, avgCost: 10000, unitPrice: 40000 });
    const k = await kirim(6);
    await completeDeliveryShipment(podEkspedisiUji(k.shipmentId, p.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 0, returnedQty: 6 }]));
    const t = await prisma.konsiTransfer.findUniqueOrThrow({ where: { id: seededId(k.transfer.id) } });
    expect(t.status).toBe("CANCELLED");
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: seededId(p.invId) } });
    expect(Number(inv.qtyOnHand)).toBe(50);
    expect(Number(inv.reservedQty)).toBe(6);
    expect(await prisma.stockLoss.count({ where: { storeId: seededId(p.storeId) } })).toBe(0);
  });

  it("at a store with an SPG the POD only records the handover; the SPG's receipt lands the stock and records the door refusal", async () => {
    p = await buatPesananUji({ termsType: "KONSI", qty: [6], onHand: 50, avgCost: 10000, unitPrice: 40000, spg: true });
    const k = await kirim(6);
    const tolak = await completeDeliveryShipment(
      podEkspedisiUji(k.shipmentId, p.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 5, returnedQty: 1 }]),
    ).catch((e) => e);
    expect(tolak.code).toBe("DICATAT_SPG");
    const kosong = await completeDeliveryShipment(podEkspedisiUji(k.shipmentId, p.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 0 }])).catch((e) => e);
    expect(kosong.code).toBe("POD_KOSONG");

    const r = await completeDeliveryShipment(podEkspedisiUji(k.shipmentId, p.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 6 }]));
    expect(r.mode).toBe("INFO_ONLY");
    expect((await prisma.konsiTransfer.findUniqueOrThrow({ where: { id: seededId(k.transfer.id) } })).status).toBe("IN_TRANSIT");
    expect(await prisma.storeStock.count({ where: { storeId: seededId(p.storeId) } })).toBe(0);

    /* R2: the shipment is DELIVERED but the store has not received it — closing the rest waits. */
    const tutup = await closeFieldSalesOrderRemainder({ orderId: p.orderId, closedById: p.salesmanId, reason: "Sisa batal" }).catch((e) => e);
    expect(tutup.code).toBe("SHIPMENT_IN_FLIGHT");

    const terima = await terimaKiriman({
      storeId: p.storeId,
      userId: p.spgId,
      sourceType: "KONSI_TRANSFER",
      sourceId: k.transfer.id,
      diterima: [{ lineId: k.transfer.lines[0].id, qtyReceived: 5, qtyRefused: 1 }],
    });
    expect(terima.ok).toBe(true);
    const t = await prisma.konsiTransfer.findUniqueOrThrow({ where: { id: seededId(k.transfer.id) }, include: { lines: true } });
    expect(t.status).toBe("RECEIVED");
    expect(t.lines[0].receivedQty).toBe(5);
    expect(t.lines[0].returnedQty).toBe(1);
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: seededId(p.invId) } });
    expect(Number(inv.qtyOnHand)).toBe(45);
  });

  it("a konsi store whose SPG stops while the goods are on the road: the courier still records a door refusal, which goes back to main instead of being written off", async () => {
    p = await buatPesananUji({ termsType: "KONSI", qty: [6], onHand: 50, avgCost: 10000, unitPrice: 40000, spg: true, pemegang: true });
    const k = await kirim(6);
    /* P45a: she stops while the shipment is in transit — store released, last day today. */
    await prisma.user.update({
      where: { id: seededId(p.spgId) },
      data: { assignedStoreId: null, spgEndedStoreId: p.storeId, spgEndedOn: formatDateOnlyJakarta(new Date()) },
    });
    const r = await completeDeliveryShipment(
      podEkspedisiUji(k.shipmentId, p.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 4, returnedQty: 2 }]),
    );
    expect(r.mode).toBe("RECEIPT_AT_POD");
    const t = await prisma.konsiTransfer.findUniqueOrThrow({ where: { id: seededId(k.transfer.id) }, include: { lines: true } });
    expect(t.status).toBe("RECEIVED");
    expect(t.lines[0]).toMatchObject({ receivedQty: 4, returnedQty: 2 });
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(p.storeId), itemId: seededId(p.itemId) } });
    expect(Number(ss.qty)).toBe(4);
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: seededId(p.invId) } });
    expect(Number(inv.qtyOnHand)).toBe(46);
    expect(await prisma.stockLoss.count({ where: { storeId: seededId(p.storeId) } })).toBe(0);
  });

  it("an SPG cannot receive a shipment still packed in the warehouse", async () => {
    p = await buatPesananUji({ termsType: "KONSI", qty: [6], spg: true });
    const s = await kemasUji(p, { lines: [{ orderLineId: p.lineIds[0], qty: 6 }] });
    const t = await prisma.konsiTransfer.findUniqueOrThrow({ where: { shipmentId: seededId(s.shipmentId) }, include: { lines: true } });
    const r = await terimaKiriman({
      storeId: p.storeId,
      userId: p.spgId,
      sourceType: "KONSI_TRANSFER",
      sourceId: t.id,
      diterima: [{ lineId: t.lines[0].id, qtyReceived: 6 }],
    });
    expect(r).toEqual({ ok: false, alasan: "BELUM_BERANGKAT" });
  });

  it("'tidak jadi dikirim' on a packed konsi shipment returns the stock, cancels the transfer, and refuses once the store received it", async () => {
    p = await buatPesananUji({ termsType: "KONSI", qty: [6], onHand: 50, avgCost: 10000 });
    const s = await kemasUji(p, { lines: [{ orderLineId: p.lineIds[0], qty: 6 }] });
    const blocked = await closeFieldSalesOrderRemainder({ orderId: p.orderId, closedById: p.salesmanId, reason: "Sisa" }).catch((e) => e);
    expect(blocked.code).toBe("SHIPMENT_IN_FLIGHT");
    const r = await cancelDeliveryShipment({ shipmentId: s.shipmentId, cancelledById: p.salesmanId, reason: "Toko tutup" });
    expect(r.orderType).toBe("KONSI");
    expect(r.berangkat).toBe(false);
    const t = await prisma.konsiTransfer.findUniqueOrThrow({ where: { shipmentId: seededId(s.shipmentId) } });
    expect(t.status).toBe("CANCELLED");
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: seededId(s.shipmentId) } });
    expect(shipment.status).toBe("CANCELLED");
    expect(shipment.cancelReason).toBe("Toko tutup");
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: seededId(p.invId) } });
    expect(Number(inv.qtyOnHand)).toBe(50);
    expect(Number(inv.reservedQty)).toBe(6);
    const line = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: seededId(p.lineIds[0]) } });
    expect(line.deliveredQty).toBe(0);

    const k = await kirim(6);
    await completeDeliveryShipment(podEkspedisiUji(k.shipmentId, p.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 6 }]));
    /* Delivered and received: no longer cancellable. */
    const telat = await cancelDeliveryShipment({ shipmentId: k.shipmentId, cancelledById: p.salesmanId, reason: "x" }).catch((e) => e);
    expect(telat.code).toBe("INVALID_STATE");
  });

  /**
   * An SPG receipt racing "tidak jadi dikirim" on an in-transit konsi shipment (R14): both guard on
   * the transfer still being IN_TRANSIT, inside `runSerializable`. Run once with the cancel
   * staggered and once with the receipt staggered, so neither writer always reaches its write first
   * (a race test can pass on buggy code when one side always wins). The loser is read through the
   * action layer's `mapError`, which is what the operator sees.
   */
  async function balapanTerimaBatal(ditunda: "BATAL" | "TERIMA") {
    const q = await buatPesananUji({ termsType: "KONSI", qty: [6], onHand: 50, avgCost: 10000, spg: true });
    p = q;
    const k = await kirim(6);
    const tunda = (siapa: "BATAL" | "TERIMA") => new Promise((r) => setTimeout(r, ditunda === siapa ? 5 : 0));
    const terima = tunda("TERIMA").then(() =>
      terimaKiriman({
        storeId: q.storeId,
        userId: q.spgId,
        sourceType: "KONSI_TRANSFER",
        sourceId: k.transfer.id,
        diterima: [{ lineId: k.transfer.lines[0].id, qtyReceived: 6 }],
      }),
    );
    const batal = tunda("BATAL").then(() => cancelDeliveryShipment({ shipmentId: k.shipmentId, cancelledById: q.salesmanId, reason: "Balapan" }));
    const [t, b] = await Promise.allSettled([terima, batal]);

    const terimaMenang = t.status === "fulfilled" && t.value.ok;
    const batalMenang = b.status === "fulfilled";
    expect(terimaMenang !== batalMenang).toBe(true);

    const transfer = await prisma.konsiTransfer.findUniqueOrThrow({ where: { id: seededId(k.transfer.id) } });
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: seededId(k.shipmentId) } });
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: seededId(q.invId) } });
    if (terimaMenang) {
      expect(transfer.status).toBe("RECEIVED");
      const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(q.storeId), itemId: seededId(q.itemId) } });
      expect(Number(ss.qty)).toBe(6);
      expect(Number(inv.qtyOnHand)).toBe(44);
      expect(shipment.status).not.toBe("CANCELLED");
      expect(b.status).toBe("rejected");
      const alasan = mapError((b as PromiseRejectedResult).reason, "uji-balapan").reason;
      expect(["ALREADY_RECEIVED", "INVALID_STATE"]).toContain(alasan);
    } else {
      expect(transfer.status).toBe("CANCELLED");
      expect(shipment.status).toBe("CANCELLED");
      expect(await prisma.storeStock.count({ where: { storeId: seededId(q.storeId) } })).toBe(0);
      expect(Number(inv.qtyOnHand)).toBe(50);
      expect(t.status === "fulfilled" ? t.value : t.reason).toEqual({ ok: false, alasan: "KIRIMAN_DIBATALKAN" });
    }
  }

  it("an SPG receipt racing 'tidak jadi dikirim' on an in-transit konsi shipment: exactly one wins and the stock lands in one place", async () => {
    await balapanTerimaBatal("BATAL");
  });

  it("the same race with the receipt staggered instead of the cancel: still exactly one wins", async () => {
    await balapanTerimaBatal("TERIMA");
  });
});
