import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { buatPesananUji, bersihkanPesananUji, kemasUji, type PesananUji } from "@/lib/delivery/uji-pengiriman";
import { DeliveryShipmentError } from "@/lib/delivery/errors";
import {
  KonsiTransferNotInTransitError,
  kembalikanKonsiTransferInTx,
  kunciPindahKonsi,
  receiveKonsiTransferInTx,
} from "./writer";

/* Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/**
 * Konsi stock moves when the shipment is CREATED (Q1): the transfer is written IN_TRANSIT, main
 * stock and the reservation drop together, nothing reaches the store's StoreStock until the store
 * receipt lands what arrived; refused pieces and a cancel come back at the line's issue cost.
 */
d("konsi transfer: issue at creation, receive, return, cancel (test bed only)", () => {
  let p: PesananUji | null = null;

  beforeEach(async () => {
    p = null;
    p = await buatPesananUji({ termsType: "KONSI", qty: [6], onHand: 50, avgCost: 10000, unitPrice: 40000 });
  });

  afterEach(async () => {
    await bersihkanPesananUji(p);
  });

  async function transferOf(shipmentId: string) {
    return prisma.konsiTransfer.findUniqueOrThrow({ where: { shipmentId: seededId(shipmentId) }, include: { lines: true } });
  }

  it("creation writes one IN_TRANSIT transfer, cuts main stock and the reservation together, and leaves StoreStock untouched", async () => {
    const s = await kemasUji(p!, { lines: [{ orderLineId: p!.lineIds[0], qty: 6 }] });
    const t = await transferOf(s.shipmentId);
    expect(t.status).toBe("IN_TRANSIT");
    expect(t.lines).toHaveLength(1);
    expect(Number(t.lines[0].qty)).toBe(6);
    expect(Number(t.lines[0].unitCost)).toBe(10000);
    /* P37: the surat jalan carries the konsi price snapshotted on the order line. */
    expect(Number(t.lines[0].unitPrice)).toBe(40000);
    expect(t.lines[0].receivedQty).toBeNull();
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: seededId(p!.invId) } });
    expect(Number(inv.qtyOnHand)).toBe(44);
    expect(Number(inv.reservedQty)).toBe(0);
    const adj = await prisma.stockAdjustment.findFirst({ where: { idempotencyKey: kunciPindahKonsi(t.id, p!.lineIds[0]) } });
    expect(adj?.source).toBe("KONSI_TRANSFER");
    expect(adj?.type).toBe("NEGATIVE");
    expect(await prisma.storeStock.count({ where: { storeId: seededId(p!.storeId) } })).toBe(0);
    const line = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: seededId(p!.lineIds[0]) } });
    expect(line.deliveredQty).toBe(6);
  });

  it("draws down a variantless main row seeded with variantSku null (the Jubelio shape)", async () => {
    await prisma.inventoryValue.update({ where: { id: seededId(p!.invId) }, data: { variantSku: null } });
    const s = await kemasUji(p!, { lines: [{ orderLineId: p!.lineIds[0], qty: 4 }] });
    const t = await transferOf(s.shipmentId);
    expect(t.lines[0].variantSku).toBe("");
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: seededId(p!.invId) } });
    expect(Number(inv.qtyOnHand)).toBe(46);
    expect(Number(inv.reservedQty)).toBe(2);
  });

  it("the store receipt marks it RECEIVED and raises StoreStock by what arrived, at the issue cost", async () => {
    const s = await kemasUji(p!, { lines: [{ orderLineId: p!.lineIds[0], qty: 6 }] });
    const t = await transferOf(s.shipmentId);
    const ketika = new Date();
    await runSerializable((tx) =>
      receiveKonsiTransferInTx(tx, {
        transferId: t.id,
        storeId: p!.storeId,
        receivedById: p!.salesmanId,
        receivedAt: ketika,
        baris: [{ transferLineId: t.lines[0].id, qtyReceived: 5 }],
      }),
    );
    const sesudah = await transferOf(s.shipmentId);
    expect(sesudah.status).toBe("RECEIVED");
    expect(sesudah.receivedAt?.getTime()).toBe(ketika.getTime());
    expect(sesudah.lines[0].receivedQty).toBe(5);
    const ss = await prisma.storeStock.findFirstOrThrow({ where: { storeId: seededId(p!.storeId), itemId: seededId(p!.itemId) } });
    expect(Number(ss.qty)).toBe(5);
    expect(Number(ss.avgCost)).toBe(10000);
    /* The missing piece is NOT put back in the main warehouse — it is barang hilang. */
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: seededId(p!.invId) } });
    expect(Number(inv.qtyOnHand)).toBe(44);
  });

  it("refused pieces return to main at the issue cost, reopen the reservation and the order line, and keep the transfer IN_TRANSIT", async () => {
    const s = await kemasUji(p!, { lines: [{ orderLineId: p!.lineIds[0], qty: 6 }] });
    const t = await transferOf(s.shipmentId);
    const hasil = await runSerializable((tx) =>
      kembalikanKonsiTransferInTx(tx, {
        transferId: t.id,
        baris: [{ orderLineId: p!.lineIds[0], qty: 2 }],
        olehUserId: p!.salesmanId,
        sekarang: new Date(),
        alasan: "Ditolak toko",
        batal: false,
        kunci: "uji-tolak",
      }),
    );
    expect(hasil.barangKembali).toEqual([p!.itemId]);
    const sesudah = await transferOf(s.shipmentId);
    expect(sesudah.status).toBe("IN_TRANSIT");
    expect(sesudah.lines[0].returnedQty).toBe(2);
    expect(sesudah.adjustedAt).not.toBeNull();
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: seededId(p!.invId) } });
    expect(Number(inv.qtyOnHand)).toBe(46);
    expect(Number(inv.reservedQty)).toBe(2);
    const res = await prisma.stockReservation.findUniqueOrThrow({ where: { fieldSalesLineId: seededId(p!.lineIds[0]) } });
    expect(res.state).toBe("RESERVED");
    expect(res.consumedQty).toBe(4);
    const adj = await prisma.stockAdjustment.findMany({ where: { itemId: seededId(p!.itemId), source: "KONSI_TRANSFER_RETURN" } });
    expect(adj).toHaveLength(1);
    expect(Number(adj[0].qtyChange)).toBe(2);
    const line = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: seededId(p!.lineIds[0]) } });
    expect(line.deliveredQty).toBe(4);
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(p!.orderId) } });
    expect(order.deliveryStatus).toBe("PARTIAL");
  });

  it("a cancel returns every open piece and moves the transfer to CANCELLED with its reason and audit row", async () => {
    const s = await kemasUji(p!, { lines: [{ orderLineId: p!.lineIds[0], qty: 6 }] });
    const t = await transferOf(s.shipmentId);
    await runSerializable((tx) =>
      kembalikanKonsiTransferInTx(tx, {
        transferId: t.id,
        baris: [{ orderLineId: p!.lineIds[0], qty: 6 }],
        olehUserId: p!.salesmanId,
        sekarang: new Date(),
        alasan: "Tidak jadi dikirim",
        batal: true,
        kunci: "batal",
      }),
    );
    const sesudah = await transferOf(s.shipmentId);
    expect(sesudah.status).toBe("CANCELLED");
    expect(sesudah.cancelReason).toBe("Tidak jadi dikirim");
    expect(sesudah.cancelledById).toBe(p!.salesmanId);
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: seededId(p!.invId) } });
    expect(Number(inv.qtyOnHand)).toBe(50);
    expect(Number(inv.reservedQty)).toBe(6);
    expect(await prisma.auditLog.count({ where: { entityId: seededId(t.id), action: "KONSI_TRANSFER_CANCELLED" } })).toBe(1);
  });

  it("refuses a receipt or a return once the transfer is RECEIVED or CANCELLED, moving nothing", async () => {
    const s = await kemasUji(p!, { lines: [{ orderLineId: p!.lineIds[0], qty: 6 }] });
    const t = await transferOf(s.shipmentId);
    await prisma.konsiTransfer.update({ where: { id: seededId(t.id) }, data: { status: "RECEIVED" } });
    const r1 = await runSerializable((tx) =>
      kembalikanKonsiTransferInTx(tx, {
        transferId: t.id,
        baris: [{ orderLineId: p!.lineIds[0], qty: 1 }],
        olehUserId: p!.salesmanId,
        sekarang: new Date(),
        alasan: "x",
        batal: true,
        kunci: "batal",
      }),
    ).catch((e) => e);
    expect(r1).toBeInstanceOf(KonsiTransferNotInTransitError);
    expect(r1.status).toBe("RECEIVED");

    await prisma.konsiTransfer.update({ where: { id: seededId(t.id) }, data: { status: "CANCELLED" } });
    const r2 = await runSerializable((tx) =>
      receiveKonsiTransferInTx(tx, {
        transferId: t.id,
        storeId: p!.storeId,
        receivedById: p!.salesmanId,
        receivedAt: new Date(),
        baris: [{ transferLineId: t.lines[0].id, qtyReceived: 6 }],
      }),
    ).catch((e) => e);
    expect(r2).toBeInstanceOf(KonsiTransferNotInTransitError);
    expect(r2.status).toBe("CANCELLED");
    expect(await prisma.storeStock.count({ where: { storeId: seededId(p!.storeId) } })).toBe(0);
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: seededId(p!.invId) } });
    expect(Number(inv.qtyOnHand)).toBe(44);
  });

  it("a receipt racing a cancel: exactly one wins, and the stock lands in exactly one place", async () => {
    const s = await kemasUji(p!, { lines: [{ orderLineId: p!.lineIds[0], qty: 6 }] });
    const t = await transferOf(s.shipmentId);
    const terima = runSerializable((tx) =>
      receiveKonsiTransferInTx(tx, {
        transferId: t.id,
        storeId: p!.storeId,
        receivedById: p!.salesmanId,
        receivedAt: new Date(),
        baris: [{ transferLineId: t.lines[0].id, qtyReceived: 6 }],
      }),
    );
    /* Staggered: without it the shorter writer always reaches its write first and the race is not exercised. */
    const batal = new Promise((r) => setTimeout(r, 5)).then(() =>
      runSerializable((tx) =>
        kembalikanKonsiTransferInTx(tx, {
          transferId: t.id,
          baris: [{ orderLineId: p!.lineIds[0], qty: 6 }],
          olehUserId: p!.salesmanId,
          sekarang: new Date(),
          alasan: "Tidak jadi dikirim",
          batal: true,
          kunci: "batal",
        }),
      ),
    );
    const hasil = await Promise.allSettled([terima, batal]);
    expect(hasil.filter((h) => h.status === "fulfilled")).toHaveLength(1);
    const ditolak = hasil.find((h) => h.status === "rejected") as PromiseRejectedResult;
    expect(ditolak.reason).toBeInstanceOf(KonsiTransferNotInTransitError);

    const sesudah = await transferOf(s.shipmentId);
    const ss = await prisma.storeStock.findFirst({ where: { storeId: seededId(p!.storeId), itemId: seededId(p!.itemId) } });
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: seededId(p!.invId) } });
    if (sesudah.status === "RECEIVED") {
      expect(Number(ss?.qty ?? 0)).toBe(6);
      expect(Number(inv.qtyOnHand)).toBe(44);
    } else {
      expect(sesudah.status).toBe("CANCELLED");
      expect(ss).toBeNull();
      expect(Number(inv.qtyOnHand)).toBe(50);
    }
  });

  it("refuses KONSI_NOT_RESERVED at creation against a consumed reservation, writing nothing", async () => {
    await prisma.stockReservation.update({
      where: { fieldSalesLineId: seededId(p!.lineIds[0]) },
      data: { state: "CONSUMED", consumedQty: 6 },
    });
    const err = await kemasUji(p!, { lines: [{ orderLineId: p!.lineIds[0], qty: 6 }] }).catch((e) => e);
    expect(err).toBeInstanceOf(DeliveryShipmentError);
    expect(err.code).toBe("KONSI_NOT_RESERVED");
    expect(await prisma.deliveryShipment.count({ where: { orderId: seededId(p!.orderId) } })).toBe(0);
    expect(await prisma.konsiTransfer.count({ where: { orderId: seededId(p!.orderId) } })).toBe(0);
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: seededId(p!.invId) } });
    expect(Number(inv.qtyOnHand)).toBe(50);
  });
});
