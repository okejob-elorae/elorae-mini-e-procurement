import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { freezeItemSnapshot, getOpenFabricItemIds } from "./opname-snapshot";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("opname snapshot item filter (test bed only)", () => {
  let uomId = "";
  let itemId = "";
  let userId = "";
  let opnameId = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    userId = "";
    opnameId = "";
    const token = Math.floor(Math.random() * 1_000_000_000);
    const uom = await prisma.uOM.create({ data: { code: `TEST-OPSNAP-UOM-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-OPSNAP-ITEM-${token}`, nameId: "Snapshot item", nameEn: "Snapshot item", type: "FINISHED_GOOD", uomId, isActive: true },
    });
    itemId = item.id;
    const user = await prisma.user.create({ data: { email: `test-opsnap-${token}@test.local`, name: "Opname", role: "ADMIN" } });
    userId = user.id;
    const opname = await prisma.stockOpname.create({
      data: { docNumber: `TEST-OPSNAP-${token}`, scope: "FINISHED_GOOD", status: "CREATED", snapshotAt: new Date(), createdById: userId },
    });
    opnameId = opname.id;
  });

  afterEach(async () => {
    const failures: string[] = [];
    const step = async (what: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        failures.push(`${what}: ${String(e)}`);
      }
    };
    await step("opname lines", () => prisma.stockOpnameItem.deleteMany({ where: { opnameId: seededId(opnameId) } }));
    await step("opname", () => prisma.stockOpname.deleteMany({ where: { id: seededId(opnameId) } }));
    await step("item", () => prisma.item.deleteMany({ where: { id: seededId(itemId) } }));
    await step("uom", () => prisma.uOM.deleteMany({ where: { id: seededId(uomId) } }));
    await step("user", () => prisma.user.deleteMany({ where: { id: seededId(userId) } }));
    if (failures.length) throw new Error(`opname snapshot spec teardown failed — ${failures.join(" | ")}`);
  });

  it("freezes nothing when itemIds is an empty selection", async () => {
    const count = await prisma.$transaction((tx) => freezeItemSnapshot(tx, opnameId, "FINISHED_GOOD", []));
    expect(count).toBe(0);
    expect(await prisma.stockOpnameItem.count({ where: { opnameId: seededId(opnameId) } })).toBe(0);
  });

  it("still freezes the scope when itemIds is absent", async () => {
    const count = await prisma.$transaction((tx) => freezeItemSnapshot(tx, opnameId, "FINISHED_GOOD"));
    expect(count).toBeGreaterThanOrEqual(1);
    expect(await prisma.stockOpnameItem.count({ where: { opnameId: seededId(opnameId), itemId: seededId(itemId) } })).toBeGreaterThanOrEqual(1);
  });

  it("getOpenFabricItemIds reads an empty selection as match-nothing", async () => {
    expect(await getOpenFabricItemIds([])).toEqual([]);
  });
});
