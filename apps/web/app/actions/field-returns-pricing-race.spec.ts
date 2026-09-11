import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

/*
 * Real DB, real prisma client — only auth() is mocked (a session lookup, not a DB call).
 * hasPermission is the genuine implementation: it is a pure function over the permissions array
 * carried on the mocked session, so it needs no mock of its own.
 *
 * This exists to prove setLinePriceAction's compare-and-swap genuinely defends against a
 * concurrent approveFieldReturn, which a plain findUnique-then-write pair cannot promise on its
 * own — the read and the write are two separate round trips with nothing holding between them.
 */
const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { setLinePriceAction } from "./field-returns";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("setLinePriceAction — concurrent approval race (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let userId = "";
  let returnId = "";
  let lineId = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    storeId = "";
    userId = "";
    returnId = "";
    lineId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-FRPR-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: {
        sku: `TEST-FRPR-${token}`,
        nameId: "Retur race item",
        nameEn: "Retur race item",
        type: "FINISHED_GOOD",
        uomId,
        isActive: true,
        sellingPrice: 40000,
      },
    });
    itemId = item.id;

    const store = await prisma.store.create({
      data: { code: `TEST-FRPR-STORE-${token}`, name: "Test Race Store", address: "Test address", termsType: "PUTUS", isActive: true },
    });
    storeId = store.id;

    const user = await prisma.user.create({ data: { email: `test-frpr-${token}@example.com`, name: "Test Race User" } });
    userId = user.id;

    const ret = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-FRPR-RET-${token}`,
        storeId,
        raisedById: userId,
        status: "PENDING_APPROVAL",
        transport: "SELF_CARRY",
        notaPhotoUrl: "https://cdn.example/nota.jpg",
        notaPhotoR2Key: "field-returns/x/nota.jpg",
      },
    });
    returnId = ret.id;

    const line = await prisma.fieldReturnLine.create({
      data: {
        returnId,
        itemId,
        variantSku: "M",
        qty: 2,
        reason: "UNSOLD",
        priceSource: "MANUAL",
        unitPrice: 5000,
        priceNote: "original manual price",
      },
    });
    lineId = line.id;

    mockAuth.mockReset();
    mockAuth.mockResolvedValue({ user: { id: userId, permissions: ["field_returns:manage"] } });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: seededId(returnId) } });
    await prisma.fieldReturn.deleteMany({ where: { id: seededId(returnId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("refuses ALREADY_APPROVED and leaves the line untouched when the retur is approved between the read and the write", async () => {
    /*
     * The action's own findUnique is spied so that, right after it captures the real (still
     * open) status, this simulates a concurrent approveFieldReturn committing — before the
     * action's own updateMany runs. The action's read-time fast-path has already passed by then,
     * so only the updateMany's own repeated status condition can still catch it.
     */
    const original = prisma.fieldReturnLine.findUnique.bind(prisma.fieldReturnLine);
    const spy = vi.spyOn(prisma.fieldReturnLine, "findUnique").mockImplementation(
      /* Cast needed: the real findUnique returns a Prisma__FieldReturnLineClient — a thenable
         that also carries relation-navigation methods (returnDoc, item, resolutions) — not a
         plain Promise. This mock deliberately doesn't provide those; the action under test
         never calls them. */
      (async (args: unknown) => {
        const result = await original(args as Parameters<typeof original>[0]);
        await prisma.fieldReturn.update({ where: { id: returnId }, data: { status: "APPROVED" } });
        return result;
      }) as unknown as typeof prisma.fieldReturnLine.findUnique,
    );

    const res = await setLinePriceAction({ lineId, manualUnitPrice: 7000, note: "new price after race" });
    expect(res).toEqual({ ok: false, code: "ALREADY_APPROVED" });

    spy.mockRestore();

    const row = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineId) } });
    expect(row.priceSource).toBe("MANUAL");
    expect(row.unitPrice?.toNumber()).toBe(5000);
    expect(row.priceNote).toBe("original manual price");
    expect(row.priceDeliveryLineId).toBeNull();
  });
});
