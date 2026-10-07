import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn(async () => {}) }));

import { reportStuckDeliveryCompletionAction } from "./actions";

const token = `STUCK-${Date.now().toString(36)}`;
const carrierId = `carrier-${token}`;
const otherId = `other-${token}`;

async function stuckRows(shipmentId: string) {
  const rows = await prisma.adminNotification.findMany({
    where: { category: "DELIVERY_COMPLETION_STUCK" },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return rows.filter((r) => (r.metadata as { shipmentId?: string } | null)?.shipmentId === shipmentId);
}

describe("reportStuckDeliveryCompletionAction", () => {
  let carryId = "";
  let expeditionId = "";

  beforeEach(async () => {
    carryId = "";
    expeditionId = "";
    const base = { orderId: `order-${token}`, packedById: carrierId, status: "IN_TRANSIT" as const, carriedById: carrierId };
    carryId = (await prisma.deliveryShipment.create({ data: { ...base, docNo: `${token}-SC`, method: "SALESMAN_CARRY" } })).id;
    expeditionId = (await prisma.deliveryShipment.create({ data: { ...base, docNo: `${token}-EX`, method: "EXPEDITION" } })).id;
  });

  afterEach(async () => {
    const created = [...(await stuckRows(carryId)), ...(await stuckRows(expeditionId))].map((r) => r.id);
    await prisma.adminNotification.deleteMany({ where: { id: { in: created.map(seededId) } } });
    await prisma.deliveryShipment.delete({ where: { id: seededId(carryId) } });
    await prisma.deliveryShipment.delete({ where: { id: seededId(expeditionId) } });
  });

  it("raises one alert for the shipment's own carrier, even without deliveries:pod", async () => {
    mockAuth.mockResolvedValue({ user: { id: carrierId, permissions: [] } });
    await reportStuckDeliveryCompletionAction(carryId, "GPS_OUT_OF_RADIUS");
    await reportStuckDeliveryCompletionAction(carryId, "GPS_OUT_OF_RADIUS");
    const rows = await stuckRows(carryId);
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toContain(`${token}-SC`);
    expect((rows[0].metadata as { reason?: string }).reason).toBe("GPS_OUT_OF_RADIUS");
  });

  it("raises nothing for a user who does not carry the shipment", async () => {
    mockAuth.mockResolvedValue({ user: { id: otherId, permissions: ["deliveries:pod"] } });
    await reportStuckDeliveryCompletionAction(carryId, "NOT_CARRIER");
    expect(await stuckRows(carryId)).toHaveLength(0);
  });

  it("raises nothing for a missing or non-salesman-carry shipment", async () => {
    mockAuth.mockResolvedValue({ user: { id: carrierId, permissions: ["deliveries:pod"] } });
    await reportStuckDeliveryCompletionAction(`missing-${token}`, "UNEXPECTED");
    await reportStuckDeliveryCompletionAction(expeditionId, "UNEXPECTED");
    expect(await stuckRows(`missing-${token}`)).toHaveLength(0);
    expect(await stuckRows(expeditionId)).toHaveLength(0);
  });

  it("records a reason that is not an error code as UNKNOWN", async () => {
    mockAuth.mockResolvedValue({ user: { id: carrierId, permissions: ["deliveries:pod"] } });
    await reportStuckDeliveryCompletionAction(carryId, "Z".repeat(5000));
    const rows = await stuckRows(carryId);
    expect(rows).toHaveLength(1);
    expect((rows[0].metadata as { reason?: string }).reason).toBe("UNKNOWN");
    expect(rows[0].message.length).toBeLessThan(400);
  });
});
