import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { billableSuppliersForWo } from "./billable";

describe("billableSuppliersForWo", () => {
  const tag = `bfs-${Date.now().toString(36)}`;
  let userId = "";
  let typeId = "";
  let supplierA = "";
  let supplierB = "";
  let uomId = "";
  let fgId = "";
  let woId = "";
  let stepA = "";
  let stepB = "";

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { email: `${tag}@test.local`, name: "BFS", passwordHash: "x" },
        select: { id: true },
      })
    ).id;
    typeId = (
      await prisma.supplierType.create({
        data: { code: `BFS-${tag}`, name: "BFS" },
        select: { id: true },
      })
    ).id;
    supplierA = (
      await prisma.supplier.create({
        data: { code: `A-${tag}`, name: "A", typeId, status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    supplierB = (
      await prisma.supplier.create({
        data: { code: `B-${tag}`, name: "B", typeId, status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    uomId = (
      await prisma.uOM.create({
        data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" },
        select: { id: true },
      })
    ).id;
    fgId = (
      await prisma.item.create({
        data: {
          sku: `FG-${tag}`,
          nameId: "FG",
          nameEn: "FG",
          type: "FINISHED_GOOD",
          uomId,
        },
        select: { id: true },
      })
    ).id;
    const wo = await prisma.workOrder.create({
      data: {
        docNumber: `WO-${tag}`,
        vendorId: supplierA,
        finishedGoodId: fgId,
        plannedQty: 10,
        consumptionPlan: [],
        createdById: userId,
        status: "IN_PRODUCTION",
        steps: {
          create: [
            {
              sequence: 1,
              supplierId: supplierA,
              serviceTypeId: "svc-jahit",
              stepName: "Jahit/CMT",
              servicePrice: 1000,
              qty: 10,
            },
            {
              sequence: 2,
              supplierId: supplierB,
              serviceTypeId: "svc-sablon",
              stepName: "Sablon",
              servicePrice: 500,
              qty: 5,
            },
          ],
        },
      },
      select: { id: true, steps: { select: { id: true, sequence: true } } },
    });
    woId = wo.id;
    stepA = wo.steps.find((s) => s.sequence === 1)!.id;
    stepB = wo.steps.find((s) => s.sequence === 2)!.id;
  });

  afterAll(async () => {
    await prisma.vendorBillLine.deleteMany({
      where: { woStepId: { in: [seededId(stepA), seededId(stepB)].filter(Boolean) } },
    });
    await prisma.workOrderStep.deleteMany({ where: { woId: seededId(woId) } });
    await prisma.workOrder.deleteMany({ where: { id: seededId(woId) } });
    await prisma.item.deleteMany({ where: { id: seededId(fgId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({
      where: { id: { in: [seededId(supplierA), seededId(supplierB)].filter(Boolean) } },
    });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("lists each supplier with remaining step ids and qty/value", async () => {
    const rows = await billableSuppliersForWo(woId);
    const byId = new Map(rows.map((r) => [r.supplierId, r]));
    expect([...byId.keys()].sort()).toEqual([supplierA, supplierB].sort());
    expect(byId.get(supplierA)).toMatchObject({
      stepIds: [stepA],
      remainingQty: 10,
      remainingValue: 10_000,
    });
    expect(byId.get(supplierB)).toMatchObject({
      stepIds: [stepB],
      remainingQty: 5,
      remainingValue: 2_500,
    });
  });
});
