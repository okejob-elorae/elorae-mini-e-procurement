import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { listDeliveryShipments, getDeliveryShipment, getDeliveryShipmentDetail, listMyDeliveries, listShipmentsForOrder } from "./shipment-queries";
import { shipDeliveryShipment } from "./shipment-writer";
import { berangkatkanUji, bersihkanPesananUji, buatPesananUji, kemasUji, type PesananUji } from "./uji-pengiriman";

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/**
 * The order comes from `uji-pengiriman.ts` (APPROVED, reserved, in stock), because a putus shipment
 * now issues its nota — and takes the stock out — the moment it is created. Three lines: the
 * fixture's shipment carries line 1 (4 pcs); the tests that need more shipments use lines 2 (3) and
 * 3 (2). `bersihkanPesananUji` removes the shipments, notas, receivables, faktur rows and stock by
 * explicit id.
 */
describe("shipment-queries", () => {
  let p: PesananUji | null = null;
  let storeId = "";
  let userId = "";
  let orderId = "";
  let shipmentId = "";

  beforeEach(async () => {
    storeId = userId = orderId = shipmentId = "";
    p = await buatPesananUji({ termsType: "PUTUS", qty: [4, 3, 2] });
    storeId = p.storeId;
    userId = p.salesmanId;
    orderId = p.orderId;
    const created = await kemasUji(p, { lines: [{ orderLineId: p.lineIds[0], qty: 4 }] });
    shipmentId = created.shipmentId;
  });

  afterEach(async () => {
    await bersihkanPesananUji(p);
    p = null;
  });

  it("lists shipments filtered by status", async () => {
    const result = await listDeliveryShipments({ status: "PACKED", page: 1, pageSize: 20 });
    expect(result.items.some((i) => i.id === shipmentId)).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(1);

    const empty = await listDeliveryShipments({ status: "DELIVERED", storeId, page: 1, pageSize: 20 });
    expect(empty.items.some((i) => i.id === shipmentId)).toBe(false);
  });

  it("gets a shipment with its lines", async () => {
    const detail = await getDeliveryShipment(shipmentId);
    expect(detail?.docNo).toMatch(/^DLV\//);
    expect(detail?.lines).toHaveLength(1);
    expect(detail?.lines[0].plannedQty).toBe(4);
  });

  it("returns null for a missing shipment", async () => {
    const detail = await getDeliveryShipment("does-not-exist");
    expect(detail).toBeNull();
  });

  it("does not list an EXPEDITION shipment for its carriedById, even when IN_TRANSIT", async () => {
    await prisma.deliveryShipment.update({ where: { id: seededId(shipmentId) }, data: { carriedById: userId } });
    /* shipmentId from this describe's beforeEach is still PACKED — give it its resi, weight and
       handover photo (P35, P43) and ship it so it qualifies for the IN_TRANSIT filter. */
    await berangkatkanUji(p!, shipmentId);

    const mine = await listMyDeliveries(userId);
    expect(mine.some((m) => m.id === shipmentId)).toBe(false);
  });

  it("lists only IN_TRANSIT SALESMAN_CARRY shipments, each to its own carrier", async () => {
    /* An existing seeded user, so there is nothing extra to tear down. */
    const otherUser = await prisma.user.findFirst({ where: { id: { not: userId } } });
    expect(otherUser).not.toBeNull();
    const otherUserId = otherUser!.id;

    const carryFor = async (carrierId: string, orderLineId: string, qty: number) => {
      const created = await kemasUji(p!, { method: "SALESMAN_CARRY", lines: [{ orderLineId, qty }] });
      /* Direct write: the seeded users may not be eligible carriers on every database (CI's seed.ts grants no `deliveries:pod`), so the spec assigns the column directly. */
      await prisma.deliveryShipment.update({ where: { id: seededId(created.shipmentId) }, data: { carriedById: carrierId } });
      /* A salesman-carry shipment needs only its carrier to leave (no resi, weight or handover photo). */
      await shipDeliveryShipment({ shipmentId: created.shipmentId, shippedById: userId });
      return created.shipmentId;
    };
    const mineId = await carryFor(userId, p!.lineIds[1], 3);
    const theirsId = await carryFor(otherUserId, p!.lineIds[2], 2);

    const mine = await listMyDeliveries(userId);
    expect(mine.some((m) => m.id === mineId)).toBe(true);
    expect(mine.some((m) => m.id === theirsId)).toBe(false);

    const theirs = await listMyDeliveries(otherUserId);
    expect(theirs.some((m) => m.id === theirsId)).toBe(true);
    expect(theirs.some((m) => m.id === mineId)).toBe(false);
  });

  it("returns orderType on getDeliveryShipment", async () => {
    const detail = await getDeliveryShipment(shipmentId);
    expect(detail?.orderType).toBe("PUTUS");
  });

  it("returns the store's payment tempo on getDeliveryShipment", async () => {
    await prisma.store.update({ where: { id: seededId(storeId) }, data: { paymentTempo: 45 } });
    const detail = await getDeliveryShipment(shipmentId);
    expect(detail?.storePaymentTempo).toBe(45);
  });

  it("lists shipments for an order, newest first, with lines and productName", async () => {
    const second = await kemasUji(p!, { lines: [{ orderLineId: p!.lineIds[1], qty: 3 }] });
    /* Backdate the first shipment so ordering is deterministic rather than racing on `now()`. */
    await prisma.deliveryShipment.update({
      where: { id: seededId(shipmentId) },
      data: { packedAt: new Date(Date.now() - 60_000) },
    });

    const shipments = await listShipmentsForOrder(orderId);
    expect(shipments).toHaveLength(2);
    expect(shipments[0].id).toBe(second.shipmentId);
    expect(shipments[1].id).toBe(shipmentId);
    expect(shipments[0].lines).toHaveLength(1);
    expect(shipments[0].lines[0].productName).toBe("Barang uji 2");
    expect(shipments[1].lines).toHaveLength(1);
    expect(shipments[1].lines[0].productName).toBe("Barang uji 1");
  });

  describe("getDeliveryShipmentDetail", () => {
    it("returns null for an unknown id", async () => {
      expect(await getDeliveryShipmentDetail("does-not-exist")).toBeNull();
    });

    it("derives photo URLs from the R2 keys, never from the stored URL columns", async () => {
      await prisma.deliveryShipment.update({
        where: { id: seededId(shipmentId) },
        data: {
          status: "DELIVERED",
          proofPhotoR2Key: `delivery-proofs/${shipmentId}/1700000000.jpg`,
          proofPhotoUrl: "https://evil.example/goods.jpg",
          signatureR2Key: `delivery-pod-proofs/${shipmentId}/nota.jpg`,
          signatureUrl: "https://evil.example/nota.jpg",
          signedByName: "Bu Receiver",
          gpsLat: "-6.2000000",
          gpsLng: "106.8000000",
          gpsDistanceMeters: 42,
        },
      });
      const detail = await getDeliveryShipmentDetail(shipmentId);
      expect(detail?.goodsPhoto.url).toMatch(new RegExp(`delivery-proofs/${shipmentId}/1700000000\\.jpg$`));
      expect(detail?.goodsPhoto.unavailable).toBe(false);
      expect(detail?.notaPhoto.url).toMatch(new RegExp(`delivery-pod-proofs/${shipmentId}/nota\\.jpg$`));
      expect(JSON.stringify(detail)).not.toContain("evil.example");
      expect(detail?.signedByName).toBe("Bu Receiver");
      expect(detail?.gpsLat).toBeCloseTo(-6.2);
      expect(detail?.gpsLng).toBeCloseTo(106.8);
      expect(detail?.gpsDistanceMeters).toBe(42);
    });

    it("binds a SALESMAN_CARRY goods photo to the pod folder", async () => {
      await prisma.deliveryShipment.update({
        where: { id: seededId(shipmentId) },
        data: {
          method: "SALESMAN_CARRY",
          proofPhotoR2Key: `delivery-proofs/${shipmentId}/1700000000.jpg`,
        },
      });
      const detail = await getDeliveryShipmentDetail(shipmentId);
      expect(detail?.goodsPhoto).toEqual({ url: null, unavailable: true });

      await prisma.deliveryShipment.update({
        where: { id: seededId(shipmentId) },
        data: { proofPhotoR2Key: `delivery-pod-proofs/${shipmentId}/goods.jpg` },
      });
      const bound = await getDeliveryShipmentDetail(shipmentId);
      expect(bound?.goodsPhoto.url).toMatch(new RegExp(`delivery-pod-proofs/${shipmentId}/goods\\.jpg$`));
      expect(bound?.goodsPhoto.unavailable).toBe(false);
    });

    it("yields no URL and flags unavailable for a malformed or foreign key", async () => {
      await prisma.deliveryShipment.update({
        where: { id: seededId(shipmentId) },
        data: {
          proofPhotoR2Key: `delivery-proofs/${shipmentId}/../other/x.jpg`,
          signatureR2Key: "delivery-pod-proofs/another-shipment/nota.jpg",
          signatureUrl: "https://evil.example/nota.jpg",
        },
      });
      const detail = await getDeliveryShipmentDetail(shipmentId);
      expect(detail?.goodsPhoto).toEqual({ url: null, unavailable: true });
      expect(detail?.notaPhoto).toEqual({ url: null, unavailable: true });
    });

    it("flags a legacy stored URL with no key, and reports no photo when neither exists", async () => {
      const bare = await getDeliveryShipmentDetail(shipmentId);
      expect(bare?.goodsPhoto).toEqual({ url: null, unavailable: false });
      await prisma.deliveryShipment.update({
        where: { id: seededId(shipmentId) },
        data: { proofPhotoUrl: "https://legacy.example/goods.jpg" },
      });
      const legacy = await getDeliveryShipmentDetail(shipmentId);
      expect(legacy?.goodsPhoto).toEqual({ url: null, unavailable: true });
    });

    it("resolves actor names and renders a missing user as null", async () => {
      const salesman = await prisma.user.findUnique({ where: { id: userId } });
      await prisma.deliveryShipment.update({
        where: { id: seededId(shipmentId) },
        data: { shippedById: "dangling-user-id", carriedById: userId },
      });
      const detail = await getDeliveryShipmentDetail(shipmentId);
      expect(detail?.packedByName).toBe(salesman!.name || salesman!.email);
      expect(detail?.carriedByName).toBe(salesman!.name || salesman!.email);
      expect(detail?.shippedByName).toBeNull();
      expect(detail?.deliveredByName).toBeNull();
    });

    it("returns store, order and line facts, with the nota issued at creation", async () => {
      const detail = await getDeliveryShipmentDetail(shipmentId);
      expect(detail?.storeName).toBe(`Toko uji ${p!.token}`);
      expect(detail?.orderId).toBe(orderId);
      /* A putus shipment carries its nota from creation (owner putus answer 2026-11-02). */
      const s = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: seededId(shipmentId) }, select: { deliveryId: true } });
      const nota = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: seededId(s.deliveryId ?? "") }, select: { docNo: true } });
      expect(detail?.accountingDocNo).toBe(nota.docNo);
      expect(detail?.konsiTransferDocNo).toBeNull();
      expect(detail?.lines).toHaveLength(1);
      expect(detail?.lines[0]).toMatchObject({ productName: "Barang uji 1", plannedQty: 4, deliveredQty: null });
    });
  });
});
