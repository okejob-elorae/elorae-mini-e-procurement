import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import {
  cancelDeliveryShipment,
  completeDeliveryShipment,
  createDeliveryShipment,
  hariNotaWib,
  reassignShipmentCarrier,
  shipDeliveryShipment,
  updateShipmentTracking,
} from "./shipment-writer";
import { DeliveryShipmentError } from "./errors";
import { terimaKiriman } from "@/lib/spg/stok-writer";
import {
  berangkatkanUji,
  bersihkanPesananUji,
  buatPesananUji,
  JATUH_TEMPO_UJI,
  kemasUji,
  podEkspedisiUji,
  type PesananUji,
} from "./uji-pengiriman";

/* Writes live stock, notas and receivables — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/**
 * Delivery shipments under the 2026-11-02 rule: stock and the nota move when the shipment is
 * CREATED (owner putus answer; Q1), the courier's confirmation is the store's receipt only at a
 * store without an SPG (R6), and "tidak jadi dikirim" voids a putus nota only when no payment report
 * of any kind exists (P16, P33a, R14). Konsi stock is covered by `konsi-shipment-stock.test.ts`.
 *
 * Fixtures come from `uji-pengiriman.ts`; each test builds its own order (`p`, and `p2` when a test
 * needs a second one) and the afterEach tears both down by explicit id.
 */

const podPermission = {
  connectOrCreate: {
    where: { code: "deliveries:pod" },
    create: { code: "deliveries:pod", module: "deliveries", action: "pod" },
  },
};
const pwaPermission = {
  connectOrCreate: {
    where: { code: "pwa:access" },
    create: { code: "pwa:access", module: "pwa", action: "access" },
  },
};

let p: PesananUji | null = null;
let p2: PesananUji | null = null;
let roleIds: string[] = [];
let userIds: string[] = [];

afterEach(async () => {
  await bersihkanPesananUji(p);
  await bersihkanPesananUji(p2);
  p = null;
  p2 = null;
  await prisma.user.deleteMany({ where: { id: { in: userIds.map(seededId) } } });
  await prisma.roleDefinition.deleteMany({ where: { id: { in: roleIds.map(seededId) } } });
  roleIds = [];
  userIds = [];
});

async function penggunaUji(permissions: Array<typeof podPermission>): Promise<string> {
  const token = Math.random().toString(36).slice(2, 10);
  const role = await prisma.roleDefinition.create({
    data: { name: `TEST-DSW-ROLE-${token}`, isSystem: false, permissions: { create: permissions.map((permission) => ({ permission })) } },
  });
  roleIds.push(role.id);
  const user = await prisma.user.create({ data: { name: "Pengguna uji", email: `dsw-${token}@test.local`, roleId: role.id } });
  userIds.push(user.id);
  return user.id;
}

async function notaDari(shipmentId: string) {
  const s = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: seededId(shipmentId) }, select: { deliveryId: true } });
  return prisma.fieldSalesDelivery.findUniqueOrThrow({
    where: { id: seededId(s.deliveryId ?? "") },
    include: { lines: true, receivable: true, taxInvoice: true },
  });
}

async function stok() {
  const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: seededId(p!.invId) } });
  return { onHand: Number(inv.qtyOnHand), reserved: Number(inv.reservedQty) };
}

async function kirimEkspedisi(qty: number) {
  const s = await kemasUji(p!, { lines: [{ orderLineId: p!.lineIds[0], qty }] });
  await berangkatkanUji(p!, s.shipmentId);
  const lines = await prisma.deliveryShipmentLine.findMany({ where: { shipmentId: seededId(s.shipmentId) } });
  return { shipmentId: s.shipmentId, shipmentLineId: lines[0].id };
}

// ── Creation ────────────────────────────────────────────────────────────────

d("createDeliveryShipment (putus): the nota is issued when the shipment is created", () => {
  it("writes the shipment, one nota dated today WIB with its TaxInvoice and Receivable, and takes the stock out", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const sebelum = await stok();
    const r = await kemasUji(p, { lines: [{ orderLineId: p.lineIds[0], qty: 4 }] });
    expect(r.orderType).toBe("PUTUS");
    expect(r.ulang).toBe(false);
    expect(r.docNo).toMatch(/^DLV\//);
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: seededId(r.shipmentId) }, include: { lines: true } });
    expect(shipment.status).toBe("PACKED");
    expect(shipment.lines[0].plannedQty).toBe(4);
    expect(shipment.deliveryId).toBe(r.deliveryId);

    const nota = await notaDari(r.shipmentId);
    expect(nota.invoiceDate.getTime()).toBe(hariNotaWib(new Date()).getTime());
    expect(nota.dueDate.getTime()).toBe(JATUH_TEMPO_UJI.getTime());
    expect(nota.idempotencyKey).toBe(`shipment-${r.shipmentId}`);
    expect(nota.lines.map((l) => l.qty)).toEqual([4]);
    expect(nota.taxInvoice?.status).toBe("PENDING");
    expect(Number(nota.receivable?.amount)).toBe(40000);
    expect(await prisma.salesHistory.count({ where: { channel: "OFFLINE", orderId: nota.docNo } })).toBe(1);

    expect(await stok()).toEqual({ onHand: sebelum.onHand - 4, reserved: sebelum.reserved - 4 });
    const line = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: seededId(p.lineIds[0]) } });
    expect(line.deliveredQty).toBe(4);
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: seededId(p.orderId) } });
    expect(order.deliveryStatus).toBe("PARTIAL");
  });

  it("requires the due date, refuses one before today, and writes nothing on either refusal", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const tanpa = await createDeliveryShipment({
      orderId: p.orderId,
      method: "EXPEDITION",
      lines: [{ orderLineId: p.lineIds[0], qty: 1 }],
      packedById: p.salesmanId,
      idempotencyKey: `dsw-${p.token}-a`,
    }).catch((e) => e);
    expect(tanpa.code).toBe("MISSING_DATES");
    const mundur = await createDeliveryShipment({
      orderId: p.orderId,
      method: "EXPEDITION",
      lines: [{ orderLineId: p.lineIds[0], qty: 1 }],
      packedById: p.salesmanId,
      idempotencyKey: `dsw-${p.token}-b`,
      dueDate: new Date("2020-01-01T00:00:00.000+07:00"),
    }).catch((e) => e);
    expect(mundur.code).toBe("INVALID_DATES");
    expect(await prisma.deliveryShipment.count({ where: { orderId: seededId(p.orderId) } })).toBe(0);
    expect(await prisma.fieldSalesDelivery.count({ where: { orderId: seededId(p.orderId) } })).toBe(0);
  });

  it("counts what is already on a shipment: remaining = qty − deliveredQty − cancelledQty", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    await kemasUji(p, { lines: [{ orderLineId: p.lineIds[0], qty: 4 }] });
    const lebih = await kemasUji(p, { lines: [{ orderLineId: p.lineIds[0], qty: 7 }] }).catch((e) => e);
    expect(lebih.code).toBe("OVER_PLANNED");
    await expect(kemasUji(p, { lines: [{ orderLineId: p.lineIds[0], qty: 6 }] })).resolves.toMatchObject({ ulang: false });
  });

  it("refuses an order that is not APPROVED and an empty line list", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    await expect(kemasUji(p, { lines: [] })).rejects.toBeInstanceOf(DeliveryShipmentError);
    for (const status of ["PENDING_APPROVAL", "REJECTED"] as const) {
      await prisma.fieldSalesOrder.update({ where: { id: seededId(p.orderId) }, data: { status } });
      await expect(kemasUji(p, { lines: [{ orderLineId: p.lineIds[0], qty: 1 }] })).rejects.toMatchObject({ code: "INVALID_STATE" });
    }
    expect(await prisma.deliveryShipment.count({ where: { orderId: seededId(p.orderId) } })).toBe(0);
  });

  it("returns the same shipment for the same key and writes nothing twice; another order's key is refused", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const kunci = `dsw-${p.token}-kunci`;
    const pertama = await kemasUji(p, { lines: [{ orderLineId: p.lineIds[0], qty: 3 }], kunci });
    const ulang = await kemasUji(p, { lines: [{ orderLineId: p.lineIds[0], qty: 5 }], kunci });
    expect(ulang).toMatchObject({ shipmentId: pertama.shipmentId, deliveryId: pertama.deliveryId, ulang: true });
    expect(await prisma.deliveryShipment.count({ where: { orderId: seededId(p.orderId) } })).toBe(1);
    expect(await prisma.fieldSalesDelivery.count({ where: { orderId: seededId(p.orderId) } })).toBe(1);

    p2 = await buatPesananUji({ termsType: "PUTUS", qty: [2] });
    const lain = await kemasUji(p2, { lines: [{ orderLineId: p2.lineIds[0], qty: 1 }], kunci }).catch((e) => e);
    expect(lain.code).toBe("INVALID_STATE");
    expect(await prisma.deliveryShipment.count({ where: { orderId: seededId(p2.orderId) } })).toBe(0);
  });

  it("a double submit racing with one key makes one shipment and one nota", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const kunci = `dsw-${p.token}-dobel`;
    const hasil = await Promise.allSettled([
      kemasUji(p, { lines: [{ orderLineId: p.lineIds[0], qty: 3 }], kunci }),
      kemasUji(p, { lines: [{ orderLineId: p.lineIds[0], qty: 3 }], kunci }),
    ]);
    expect(hasil.every((h) => h.status === "fulfilled")).toBe(true);
    const ids = hasil.map((h) => (h as PromiseFulfilledResult<{ shipmentId: string }>).value.shipmentId);
    expect(new Set(ids).size).toBe(1);
    expect(await prisma.deliveryShipment.count({ where: { orderId: seededId(p.orderId) } })).toBe(1);
    expect(await prisma.fieldSalesDelivery.count({ where: { orderId: seededId(p.orderId) } })).toBe(1);
    expect(await prisma.receivable.count({ where: { storeId: seededId(p.storeId) } })).toBe(1);
    const line = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: seededId(p.lineIds[0]) } });
    expect(line.deliveredQty).toBe(3);
  });
});

// ── Tracking and ship ───────────────────────────────────────────────────────

d("updateShipmentTracking + shipDeliveryShipment", () => {
  it("validates the weight and binds the handover photo to this shipment", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const s = await kemasUji(p);
    const s2 = await kemasUji(p);
    for (const weightKg of [0, -1, 1.234, Number.NaN, 100000]) {
      await expect(updateShipmentTracking({ shipmentId: s.shipmentId, weightKg })).rejects.toMatchObject({ code: "INVALID_WEIGHT" });
    }
    await updateShipmentTracking({ shipmentId: s.shipmentId, weightKg: 12.5 });
    expect(Number((await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: seededId(s.shipmentId) } })).weightKg)).toBe(12.5);
    await updateShipmentTracking({ shipmentId: s.shipmentId, weightKg: null });
    expect((await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: seededId(s.shipmentId) } })).weightKg).toBeNull();

    for (const key of [`delivery-handover/${s2.shipmentId}/1.jpg`, `delivery-proofs/${s.shipmentId}/1.jpg`, `delivery-handover/${s.shipmentId}/x/1.jpg`]) {
      await expect(
        updateShipmentTracking({ shipmentId: s.shipmentId, handoverPhotoUrl: `https://r2.test/${key}`, handoverPhotoR2Key: key }),
      ).rejects.toMatchObject({ code: "MISSING_HANDOVER_PHOTO" });
    }
  });

  it("an expedition shipment needs the resi, the weight and the handover photo before it leaves (P35, P43)", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const s = await kemasUji(p);
    const kirim = () => shipDeliveryShipment({ shipmentId: s.shipmentId, shippedById: p!.salesmanId });
    await expect(kirim()).rejects.toMatchObject({ code: "MISSING_RESI" });
    await updateShipmentTracking({ shipmentId: s.shipmentId, carrierName: "JNE", resiNumber: "RESI-1" });
    await expect(kirim()).rejects.toMatchObject({ code: "MISSING_WEIGHT" });
    await updateShipmentTracking({ shipmentId: s.shipmentId, weightKg: 3 });
    await expect(kirim()).rejects.toMatchObject({ code: "MISSING_HANDOVER_PHOTO" });
    await updateShipmentTracking({
      shipmentId: s.shipmentId,
      handoverPhotoUrl: `https://r2.test/delivery-handover/${s.shipmentId}/1.jpg`,
      handoverPhotoR2Key: `delivery-handover/${s.shipmentId}/1.jpg`,
    });
    await kirim();
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: seededId(s.shipmentId) } });
    expect(shipment.status).toBe("IN_TRANSIT");
    expect(shipment.shippedAt).not.toBeNull();
    /* Shipping moves no stock — it left at creation. */
    expect(await stok()).toEqual({ onHand: 19, reserved: 9 });
    await expect(updateShipmentTracking({ shipmentId: s.shipmentId, carrierName: "TIKI" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(kirim()).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("a salesman-carry shipment needs its carrier, and nothing else, to leave", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const s = await kemasUji(p, { method: "SALESMAN_CARRY" });
    await expect(shipDeliveryShipment({ shipmentId: s.shipmentId, shippedById: p.salesmanId })).rejects.toMatchObject({ code: "MISSING_CARRIER" });
    await prisma.deliveryShipment.update({ where: { id: seededId(s.shipmentId) }, data: { carriedById: p.salesmanId } });
    await shipDeliveryShipment({ shipmentId: s.shipmentId, shippedById: p.salesmanId });
    expect((await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: seededId(s.shipmentId) } })).status).toBe("IN_TRANSIT");
  });

  it("refuses a carrier who is not a user or whose role lacks deliveries:pod, and NOT_FOUND for a missing shipment", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const s = await kemasUji(p, { method: "SALESMAN_CARRY" });
    await expect(updateShipmentTracking({ shipmentId: s.shipmentId, carriedById: "does-not-exist" })).rejects.toMatchObject({ code: "INVALID_CARRIER" });
    const lemah = await penggunaUji([pwaPermission]);
    await expect(updateShipmentTracking({ shipmentId: s.shipmentId, carriedById: lemah })).rejects.toMatchObject({ code: "INVALID_CARRIER" });
    const pembawa = await penggunaUji([podPermission]);
    await updateShipmentTracking({ shipmentId: s.shipmentId, carriedById: pembawa });
    expect((await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: seededId(s.shipmentId) } })).carriedById).toBe(pembawa);
    await expect(updateShipmentTracking({ shipmentId: "does-not-exist", carrierName: "JNE" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(shipDeliveryShipment({ shipmentId: "does-not-exist", shippedById: p.salesmanId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("ship racing a cancel never leaves a cancelled shipment in transit", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const s = await kemasUji(p);
    await berangkatkanUji(p, s.shipmentId, { kirim: false });
    const kirim = shipDeliveryShipment({ shipmentId: s.shipmentId, shippedById: p.salesmanId });
    const batal = new Promise((r) => setTimeout(r, 5)).then(() =>
      cancelDeliveryShipment({ shipmentId: s.shipmentId, cancelledById: p!.salesmanId, reason: "Toko tutup" }),
    );
    const [k, b] = await Promise.allSettled([kirim, batal]);
    /* Cancel wins from PACKED and from IN_TRANSIT alike; a ship that lost refuses INVALID_STATE. */
    expect(b.status).toBe("fulfilled");
    if (k.status === "rejected") expect((k.reason as DeliveryShipmentError).code).toBe("INVALID_STATE");
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: seededId(s.shipmentId) } });
    expect(shipment.status).toBe("CANCELLED");
    expect(await stok()).toEqual({ onHand: 20, reserved: 10 });
  });

  it("tracking racing a cancel: a tracking edit never lands on a cancelled shipment's open fields after the cancel", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const s = await kemasUji(p);
    const lacak = new Promise((r) => setTimeout(r, 5)).then(() => updateShipmentTracking({ shipmentId: s.shipmentId, resiNumber: "RESI-BALAP" }));
    const batal = cancelDeliveryShipment({ shipmentId: s.shipmentId, cancelledById: p.salesmanId, reason: "Salah input" });
    const [l, b] = await Promise.allSettled([lacak, batal]);
    expect(b.status).toBe("fulfilled");
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: seededId(s.shipmentId) } });
    expect(shipment.status).toBe("CANCELLED");
    if (l.status === "rejected") {
      expect((l.reason as DeliveryShipmentError).code).toBe("INVALID_STATE");
      expect(shipment.resiNumber).toBeNull();
    }
  });
});

// ── Completion ──────────────────────────────────────────────────────────────

d("completeDeliveryShipment (putus)", () => {
  it("at a store without an SPG the POD is the receipt: received 15 / refused 3 / lost 2 of 20 corrects the nota, returns 3 to main and opens the loss", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [20] });
    const k = await kirimEkspedisi(20);
    const bad = await completeDeliveryShipment(podEkspedisiUji(k.shipmentId, p.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 15 }])).catch((e) => e);
    expect(bad.code).toBe("LINE_UNACCOUNTED");
    expect((await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: seededId(k.shipmentId) } })).status).toBe("IN_TRANSIT");

    const r = await completeDeliveryShipment(
      podEkspedisiUji(k.shipmentId, p.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 15, returnedQty: 3, lostQty: 2 }]),
    );
    expect(r.mode).toBe("RECEIPT_AT_POD");
    expect(r.barangKembali).toEqual([p.itemId]);
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: seededId(k.shipmentId) }, include: { lines: true } });
    expect(shipment.status).toBe("PARTIALLY_DELIVERED");
    expect(shipment.lines[0]).toMatchObject({ deliveredQty: 15, returnedQty: 3, lostQty: 2 });

    const nota = await notaDari(k.shipmentId);
    expect(nota.voidedAt).toBeNull();
    expect(nota.correctedAt).not.toBeNull();
    expect(nota.lines[0]).toMatchObject({ qty: 15, returnedQty: 3, lostQty: 2 });
    expect(Number(nota.total)).toBe(150000);
    expect(Number(nota.receivable?.amount)).toBe(150000);
    expect(nota.taxInvoice?.status).toBe("PENDING");

    expect(await stok()).toEqual({ onHand: 13, reserved: 3 });
    const line = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: seededId(p.lineIds[0]) } });
    expect(line.deliveredQty).toBe(17);

    const receipt = await prisma.storeReceipt.findUniqueOrThrow({
      where: { sourceType_sourceId: { sourceType: "PUTUS_DELIVERY", sourceId: nota.id } },
      include: { lines: true },
    });
    expect(receipt.receivedVia).toBe("POD");
    expect(receipt.lines[0]).toMatchObject({ qtySent: 17, qtyRefused: 3, qtyReceived: 15 });

    const loss = await prisma.stockLoss.findFirstOrThrow({ where: { storeId: seededId(p.storeId) }, include: { lines: true } });
    expect(loss.shipmentId).toBe(k.shipmentId);
    /* Expedition claim value = nilai jual di nota before the correction: 2 × 10.000. */
    expect(Number(loss.claimValue)).toBe(20000);
    expect(loss.lines[0].qty).toBe(2);
  });

  it("every piece refused at the door voids the nota, its receivable and its faktur, and returns all the stock", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const k = await kirimEkspedisi(10);
    await completeDeliveryShipment(podEkspedisiUji(k.shipmentId, p.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 0, returnedQty: 10 }]));
    const nota = await notaDari(k.shipmentId);
    expect(nota.voidedAt).not.toBeNull();
    expect(nota.lines[0]).toMatchObject({ qty: 0, returnedQty: 10 });
    expect(nota.receivable?.status).toBe("VOIDED");
    expect(nota.taxInvoice?.status).toBe("CANCELLED");
    expect(await prisma.salesHistory.count({ where: { channel: "OFFLINE", orderId: nota.docNo } })).toBe(0);
    expect(await stok()).toEqual({ onHand: 20, reserved: 10 });
    expect(await prisma.stockLoss.count({ where: { storeId: seededId(p.storeId) } })).toBe(0);
  });

  it("everything lost in transit CORRECTS the nota to zero instead of voiding it, and opens the loss", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const k = await kirimEkspedisi(10);
    await completeDeliveryShipment(podEkspedisiUji(k.shipmentId, p.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 0, lostQty: 10 }]));
    const nota = await notaDari(k.shipmentId);
    expect(nota.voidedAt).toBeNull();
    expect(nota.correctedAt).not.toBeNull();
    expect(nota.lines[0]).toMatchObject({ qty: 0, lostQty: 10 });
    expect(nota.receivable?.status).toBe("VOIDED");
    /* Lost goods do not come back to stock (P38). */
    expect(await stok()).toEqual({ onHand: 10, reserved: 0 });
    expect(await prisma.stockLoss.count({ where: { storeId: seededId(p.storeId), shipmentId: seededId(k.shipmentId) } })).toBe(1);
  });

  it("at a store with an SPG the POD records only the handover; the SPG's receipt then corrects the nota", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [20], spg: true });
    const k = await kirimEkspedisi(20);
    const tolak = await completeDeliveryShipment(
      podEkspedisiUji(k.shipmentId, p.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 19, returnedQty: 1 }]),
    ).catch((e) => e);
    expect(tolak.code).toBe("DICATAT_SPG");
    const kosong = await completeDeliveryShipment(podEkspedisiUji(k.shipmentId, p.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 0 }])).catch((e) => e);
    expect(kosong.code).toBe("POD_KOSONG");
    const r = await completeDeliveryShipment(podEkspedisiUji(k.shipmentId, p.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 20 }]));
    expect(r.mode).toBe("INFO_ONLY");
    let nota = await notaDari(k.shipmentId);
    expect(nota.lines[0].qty).toBe(20);
    expect(nota.correctedAt).toBeNull();

    const terima = await terimaKiriman({
      storeId: p.storeId,
      userId: p.spgId,
      sourceType: "PUTUS_DELIVERY",
      sourceId: nota.id,
      diterima: [{ lineId: nota.lines[0].id, qtyReceived: 18, qtyRefused: 1 }],
    });
    expect(terima.ok).toBe(true);
    nota = await notaDari(k.shipmentId);
    expect(nota.lines[0]).toMatchObject({ qty: 18, returnedQty: 1, lostQty: 1 });
    expect(Number(nota.receivable?.amount)).toBe(180000);
  });

  it("an SPG who refuses every piece before the courier confirms voids the nota, and the courier can still close the shipment", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10], spg: true });
    const k = await kirimEkspedisi(10);
    let nota = await notaDari(k.shipmentId);
    /* R10: the SPG may receive while the shipment is still IN_TRANSIT; P40: every piece refused at the door. */
    const terima = await terimaKiriman({
      storeId: p.storeId,
      userId: p.spgId,
      sourceType: "PUTUS_DELIVERY",
      sourceId: nota.id,
      diterima: [{ lineId: nota.lines[0].id, qtyReceived: 0, qtyRefused: 10 }],
    });
    expect(terima.ok).toBe(true);
    nota = await notaDari(k.shipmentId);
    expect(nota.voidedAt).not.toBeNull();
    /* "Tidak jadi dikirim" is no exit (the nota is already voided)… */
    await expect(cancelDeliveryShipment({ shipmentId: k.shipmentId, cancelledById: p.salesmanId, reason: "Uji" })).rejects.toBeInstanceOf(
      DeliveryShipmentError,
    );
    /* …so the courier's confirmation must be: nothing handed over is valid because the store already received. */
    const r = await completeDeliveryShipment(podEkspedisiUji(k.shipmentId, p.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 0 }]));
    expect(r.mode).toBe("INFO_ONLY");
    const s = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: seededId(k.shipmentId) } });
    expect(s.status).toBe("PARTIALLY_DELIVERED");
    /* The stock already came back at the receipt; the confirmation moves nothing more. */
    expect(await stok()).toEqual({ onHand: 20, reserved: 10 });
  });

  it("a voided nota WITHOUT a store receipt (lost the race to a cancel) still refuses the confirmation", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10], spg: true });
    const k = await kirimEkspedisi(10);
    const nota = await notaDari(k.shipmentId);
    /* Simulates the read losing a race with "tidak jadi dikirim": the nota is voided, no receipt, the shipment still in transit. */
    await prisma.fieldSalesDelivery.update({ where: { id: seededId(nota.id) }, data: { voidedAt: new Date() } });
    const err = await completeDeliveryShipment(podEkspedisiUji(k.shipmentId, p.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 10 }])).catch((e) => e);
    expect(err.code).toBe("INVALID_STATE");
  });

  it("refuses a shipment without its document (packed by the old rule) instead of moving anything", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const lama = await prisma.deliveryShipment.create({
      data: {
        docNo: `DLV/TEST-${p.token}`,
        orderId: p.orderId,
        method: "EXPEDITION",
        status: "IN_TRANSIT",
        packedById: p.salesmanId,
        resiNumber: "RESI-LAMA",
        shippedAt: new Date(),
        lines: { create: [{ orderLineId: p.lineIds[0], itemId: p.itemId, variantSku: "", plannedQty: 2 }] },
      },
      include: { lines: true },
    });
    const err = await completeDeliveryShipment(podEkspedisiUji(lama.id, p.salesmanId, [{ shipmentLineId: lama.lines[0].id, deliveredQty: 2 }])).catch((e) => e);
    expect(err.code).toBe("INVALID_STATE");
    expect(await prisma.fieldSalesDelivery.count({ where: { orderId: seededId(p.orderId) } })).toBe(0);
    /* … and "tidak jadi dikirim" cancels it plainly, reversing nothing. */
    const batal = await cancelDeliveryShipment({ shipmentId: lama.id, cancelledById: p.salesmanId, reason: "Aturan lama" });
    expect(batal).toMatchObject({ deliveryId: null, transferId: null, barangKembali: [] });
    expect(await stok()).toEqual({ onHand: 20, reserved: 10 });
  });

  it("a same-actor replay returns ulang and writes nothing; another actor is refused", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const k = await kirimEkspedisi(10);
    const isi = podEkspedisiUji(k.shipmentId, p.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 10 }]);
    await completeDeliveryShipment(isi);
    const ulang = await completeDeliveryShipment({ ...isi, lines: [] });
    expect(ulang.ulang).toBe(true);
    expect(await prisma.storeReceipt.count({ where: { storeId: seededId(p.storeId) } })).toBe(1);
    const lain = await penggunaUji([podPermission]);
    await expect(completeDeliveryShipment({ ...isi, deliveredById: lain })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("binds the goods photo to this shipment's own folder", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const k = await kirimEkspedisi(5);
    const k2 = await kirimEkspedisi(5);
    for (const key of [`delivery-pod-proofs/${k.shipmentId}/goods.jpg`, `delivery-proofs/${k2.shipmentId}/1.jpg`, `delivery-proofs/${k.shipmentId}/x/1.jpg`]) {
      await expect(
        completeDeliveryShipment({
          ...podEkspedisiUji(k.shipmentId, p.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 5 }]),
          proofPhotoR2Key: key,
        }),
      ).rejects.toMatchObject({ code: "MISSING_PROOF" });
    }
  });

  it("salesman-carry: only the carrier, inside the radius, with a nota photo of its own and a receiver's name", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [4], lokasi: { lat: -6.2, lng: 106.8, radius: 100 } });
    const s = await kemasUji(p, { method: "SALESMAN_CARRY", lines: [{ orderLineId: p.lineIds[0], qty: 4 }] });
    await prisma.deliveryShipment.update({ where: { id: seededId(s.shipmentId) }, data: { carriedById: p.salesmanId } });
    await shipDeliveryShipment({ shipmentId: s.shipmentId, shippedById: p.salesmanId });
    const lineId = (await prisma.deliveryShipmentLine.findFirstOrThrow({ where: { shipmentId: seededId(s.shipmentId) } })).id;
    const isi = {
      shipmentId: s.shipmentId,
      deliveredById: p.salesmanId,
      proofPhotoUrl: "https://r2.test/goods.jpg",
      proofPhotoR2Key: `delivery-pod-proofs/${s.shipmentId}/goods.jpg`,
      signatureUrl: "https://r2.test/nota.jpg",
      signatureR2Key: `delivery-pod-proofs/${s.shipmentId}/nota.jpg`,
      signedByName: "Budi",
      gps: { lat: -6.2, lng: 106.8 },
      lines: [{ shipmentLineId: lineId, deliveredQty: 4 }],
    };
    const lain = await penggunaUji([podPermission]);
    await expect(completeDeliveryShipment({ ...isi, deliveredById: lain })).rejects.toMatchObject({ code: "NOT_CARRIER" });
    await expect(completeDeliveryShipment({ ...isi, gps: undefined })).rejects.toMatchObject({ code: "MISSING_GPS" });
    await expect(completeDeliveryShipment({ ...isi, gps: { lat: Number.NaN, lng: 106.8 } })).rejects.toMatchObject({ code: "MISSING_GPS" });
    await expect(completeDeliveryShipment({ ...isi, gps: { lat: -6.21, lng: 106.8 } })).rejects.toMatchObject({ code: "GPS_OUT_OF_RADIUS" });
    await expect(completeDeliveryShipment({ ...isi, signatureR2Key: isi.proofPhotoR2Key })).rejects.toMatchObject({ code: "MISSING_NOTA_PHOTO" });
    await expect(completeDeliveryShipment({ ...isi, signatureR2Key: `delivery-proofs/${s.shipmentId}/nota.jpg` })).rejects.toMatchObject({ code: "MISSING_NOTA_PHOTO" });
    await expect(completeDeliveryShipment({ ...isi, signedByName: "   " })).rejects.toMatchObject({ code: "MISSING_SIGNED_BY" });
    await completeDeliveryShipment(isi);
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: seededId(s.shipmentId) } });
    expect(shipment.status).toBe("DELIVERED");
    expect(shipment.gpsDistanceMeters).toBe(0);
    expect(shipment.signedByName).toBe("Budi");
  });

  it("clamps a deliveredAt in the future or more than three days old to now", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const k = await kirimEkspedisi(10);
    const sebelum = Date.now();
    await completeDeliveryShipment({
      ...podEkspedisiUji(k.shipmentId, p.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 10 }]),
      deliveredAt: new Date(Date.now() - 5 * 24 * 3600 * 1000),
      completedOffline: true,
    });
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: seededId(k.shipmentId) } });
    expect(shipment.deliveredAt!.getTime()).toBeGreaterThanOrEqual(sebelum - 1000);
    expect(shipment.completedOfflineAt).not.toBeNull();
  });
});

// ── "Tidak jadi dikirim" ────────────────────────────────────────────────────

d("cancelDeliveryShipment (putus): the nota is voided unless the store has paid, reported a payment or received it", () => {
  async function dikemas() {
    const s = await kemasUji(p!, { lines: [{ orderLineId: p!.lineIds[0], qty: 10 }] });
    return { shipmentId: s.shipmentId, nota: await notaDari(s.shipmentId) };
  }

  async function bkm(receivableId: string, status: "DIKIRIM" | "TERVERIFIKASI" | "DITOLAK" | "DIBATALKAN") {
    const claim = await prisma.paymentClaim.create({
      data: {
        docNo: `BKM-TEST-${p!.token}-${status}`,
        storeId: p!.storeId,
        salesmanId: p!.salesmanId,
        claimedTransferAt: new Date(),
        createdById: p!.salesmanId,
        status,
      },
    });
    await prisma.paymentClaimReceivable.create({ data: { paymentClaimId: claim.id, receivableId, settledAmount: 1000 } });
  }

  async function utuh(shipmentId: string) {
    const nota = await notaDari(shipmentId);
    expect(nota.voidedAt).toBeNull();
    expect(nota.receivable?.status).not.toBe("VOIDED");
    expect((await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: seededId(shipmentId) } })).status).toBe("PACKED");
    expect(await stok()).toEqual({ onHand: 10, reserved: 0 });
  }

  it("requires a reason", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const { shipmentId } = await dikemas();
    for (const reason of ["", "   ", "x".repeat(1001)]) {
      await expect(cancelDeliveryShipment({ shipmentId, cancelledById: p.salesmanId, reason })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    }
  });

  it("voids the nota, its receivable and faktur, removes SalesHistory, returns the stock and tells Keuangan", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const { shipmentId, nota: awal } = await dikemas();
    const r = await cancelDeliveryShipment({ shipmentId, cancelledById: p.salesmanId, reason: "Toko tutup" });
    expect(r.orderType).toBe("PUTUS");
    expect(r.notifikasi.map((n) => n.category)).toContain("DELIVERY_NOTA_VOIDED");
    const nota = await notaDari(shipmentId);
    expect(nota.voidedAt).not.toBeNull();
    expect(nota.voidReason).toBe("Toko tutup");
    expect(nota.lines[0]).toMatchObject({ qty: 0, returnedQty: 10 });
    expect(Number(nota.total)).toBe(0);
    expect(nota.receivable?.status).toBe("VOIDED");
    expect(Number(nota.receivable?.outstanding)).toBe(0);
    expect(nota.taxInvoice?.status).toBe("CANCELLED");
    expect(await prisma.salesHistory.count({ where: { channel: "OFFLINE", orderId: awal.docNo } })).toBe(0);
    expect(await stok()).toEqual({ onHand: 20, reserved: 10 });
    const line = await prisma.fieldSalesOrderLine.findUniqueOrThrow({ where: { id: seededId(p.lineIds[0]) } });
    expect(line.deliveredQty).toBe(0);
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: seededId(shipmentId) } });
    expect(shipment).toMatchObject({ status: "CANCELLED", cancelReason: "Toko tutup" });
  });

  it("refuses while the nota carries a BKM — reported, verified or rejected (P33a) — and leaves everything untouched", async () => {
    for (const status of ["DIKIRIM", "TERVERIFIKASI", "DITOLAK"] as const) {
      p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
      const { shipmentId, nota } = await dikemas();
      await bkm(nota.receivable!.id, status);
      const err = await cancelDeliveryShipment({ shipmentId, cancelledById: p.salesmanId, reason: "x" }).catch((e) => e);
      expect(err.code).toBe("RECEIVABLE_PAID");
      expect(err.detail).toContain(`BKM-TEST-${p.token}-${status}`);
      await utuh(shipmentId);
      await bersihkanPesananUji(p);
      p = null;
    }
  });

  it("does not count a BKM its reporter withdrew (DIBATALKAN)", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const { shipmentId, nota } = await dikemas();
    await bkm(nota.receivable!.id, "DIBATALKAN");
    await expect(cancelDeliveryShipment({ shipmentId, cancelledById: p.salesmanId, reason: "x" })).resolves.toMatchObject({ ok: true });
  });

  it("refuses once a payment was recorded, while a running kontrabon holds the nota, or once the store received or signed for it", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const { shipmentId, nota } = await dikemas();
    const batal = () => cancelDeliveryShipment({ shipmentId, cancelledById: p!.salesmanId, reason: "x" }).catch((e) => e);

    await prisma.receivable.update({ where: { id: seededId(nota.receivable!.id) }, data: { paidAmount: 1000 } });
    expect((await batal()).code).toBe("RECEIVABLE_PAID");
    await prisma.receivable.update({ where: { id: seededId(nota.receivable!.id) }, data: { paidAmount: 0 } });

    const kontrabon = await prisma.collectionNote.create({
      data: {
        docNo: `KB-TEST-${p.token}`,
        storeId: p.storeId,
        salesmanId: p.salesmanId,
        handoverDate: new Date(),
        promisedDate: new Date(),
        status: "BERJALAN",
      },
    });
    await prisma.collectionNoteReceivable.create({ data: { collectionNoteId: kontrabon.id, receivableId: nota.receivable!.id, amount: 100000 } });
    const kb = await batal();
    expect(kb.code).toBe("RECEIVABLE_IN_USE");
    expect(kb.detail).toContain(`KB-TEST-${p.token}`);
    await prisma.collectionNoteReceivable.deleteMany({ where: { collectionNoteId: seededId(kontrabon.id) } });

    await prisma.fieldSalesDelivery.update({ where: { id: seededId(nota.id) }, data: { receivedAt: new Date(), receivedByName: "Pemilik toko" } });
    const bt = await batal();
    expect(bt.code).toBe("ALREADY_RECEIVED");
    await prisma.fieldSalesDelivery.update({ where: { id: seededId(nota.id) }, data: { receivedAt: null, receivedByName: null } });

    await prisma.storeReceipt.create({
      data: { storeId: p.storeId, sourceType: "PUTUS_DELIVERY", sourceId: nota.id, sourceDocNo: nota.docNo, receivedById: p.salesmanId },
    });
    expect((await batal()).code).toBe("ALREADY_RECEIVED");
    await utuh(shipmentId);
  });

  it("a cancel racing the courier's confirmation: exactly one of them wins", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const k = await kirimEkspedisi(10);
    const batal = cancelDeliveryShipment({ shipmentId: k.shipmentId, cancelledById: p.salesmanId, reason: "Balapan" });
    const pod = new Promise((r) => setTimeout(r, 5)).then(() =>
      completeDeliveryShipment(podEkspedisiUji(k.shipmentId, p!.salesmanId, [{ shipmentLineId: k.shipmentLineId, deliveredQty: 10 }])),
    );
    const hasil = await Promise.allSettled([batal, pod]);
    expect(hasil.filter((h) => h.status === "fulfilled")).toHaveLength(1);
    const kalah = hasil.find((h) => h.status === "rejected") as PromiseRejectedResult;
    expect(["INVALID_STATE", "ALREADY_RECEIVED", "TERIMA_GAGAL"]).toContain((kalah.reason as DeliveryShipmentError).code);
    const nota = await notaDari(k.shipmentId);
    const shipment = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: seededId(k.shipmentId) } });
    if (shipment.status === "CANCELLED") {
      expect(nota.voidedAt).not.toBeNull();
      expect(await prisma.storeReceipt.count({ where: { storeId: seededId(p.storeId) } })).toBe(0);
    } else {
      expect(shipment.status).toBe("DELIVERED");
      expect(nota.voidedAt).toBeNull();
    }
  });
});

// ── Carrier reassign ────────────────────────────────────────────────────────

d("reassignShipmentCarrier", () => {
  it("moves an in-transit putus shipment — whose nota exists from creation — to a new carrier, and the old carrier can no longer complete it", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [4], lokasi: { lat: -6.2, lng: 106.8, radius: 100 } });
    const s = await kemasUji(p, { method: "SALESMAN_CARRY", lines: [{ orderLineId: p.lineIds[0], qty: 4 }] });
    await prisma.deliveryShipment.update({ where: { id: seededId(s.shipmentId) }, data: { carriedById: p.salesmanId } });
    await shipDeliveryShipment({ shipmentId: s.shipmentId, shippedById: p.salesmanId });
    const baru = await penggunaUji([podPermission]);
    await expect(reassignShipmentCarrier({ shipmentId: s.shipmentId, carriedById: baru, reassignedById: p.salesmanId })).resolves.toEqual({
      ok: true,
      orderId: p.orderId,
    });
    expect(await prisma.auditLog.count({ where: { entityId: seededId(s.shipmentId), action: "DELIVERY_SHIPMENT_CARRIER_REASSIGNED" } })).toBe(1);
    const lineId = (await prisma.deliveryShipmentLine.findFirstOrThrow({ where: { shipmentId: seededId(s.shipmentId) } })).id;
    await expect(
      completeDeliveryShipment({
        shipmentId: s.shipmentId,
        deliveredById: p.salesmanId,
        proofPhotoUrl: "https://r2.test/goods.jpg",
        proofPhotoR2Key: `delivery-pod-proofs/${s.shipmentId}/goods.jpg`,
        gps: { lat: -6.2, lng: 106.8 },
        lines: [{ shipmentLineId: lineId, deliveredQty: 4 }],
      }),
    ).rejects.toMatchObject({ code: "NOT_CARRIER" });
  });

  it("refuses a packed or an expedition shipment and an ineligible carrier", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10] });
    const packed = await kemasUji(p, { method: "SALESMAN_CARRY" });
    const baru = await penggunaUji([podPermission]);
    await expect(reassignShipmentCarrier({ shipmentId: packed.shipmentId, carriedById: baru, reassignedById: p.salesmanId })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    const k = await kirimEkspedisi(2);
    await expect(reassignShipmentCarrier({ shipmentId: k.shipmentId, carriedById: baru, reassignedById: p.salesmanId })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    await expect(reassignShipmentCarrier({ shipmentId: "does-not-exist", carriedById: baru, reassignedById: p.salesmanId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
