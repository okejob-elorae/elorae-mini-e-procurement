import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import {
  listSellThroughSalesmanCandidates,
  isSellThroughSalesmanCandidate,
  defaultSellThroughSalesmanId,
} from "./salesman-candidates";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* Not torn down: a Permission row is shared reference data (see carrier-queries.test.ts). */
const permission = (code: string) => ({
  connectOrCreate: { where: { code }, create: { code, module: code.split(":")[0], action: code.split(":")[1] } },
});

d("sell-through salesman candidates (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let roleId = "";
  let otherRoleId = "";
  let salesmanId = "";
  let outsiderId = "";
  let storeId = "";
  let orderId = "";

  beforeEach(async () => {
    roleId = otherRoleId = salesmanId = outsiderId = storeId = orderId = "";
    const role = await prisma.roleDefinition.create({
      data: {
        name: `kst-salesman-${token}-${Date.now()}`,
        isSystem: false,
        permissions: { create: [{ permission: permission("settlements:submit") }, { permission: permission("pwa:access") }] },
      },
    });
    roleId = role.id;
    const other = await prisma.roleDefinition.create({
      data: {
        name: `kst-outsider-${token}-${Date.now()}`,
        isSystem: false,
        permissions: { create: [{ permission: permission("pwa:access") }] },
      },
    });
    otherRoleId = other.id;
    salesmanId = (await prisma.user.create({ data: { email: `kst-sm-${token}@test.local`, name: "KST Salesman", roleId } })).id;
    outsiderId = (await prisma.user.create({ data: { email: `kst-out-${token}@test.local`, name: "KST Outsider", roleId: otherRoleId } })).id;
    storeId = (
      await prisma.store.create({
        data: { code: `TEST-KSTSC-${token}`, name: "KST candidate store", address: "x", termsType: "KONSI", marginPercent: 20, isActive: true },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(salesmanId), seededId(outsiderId)] } } });
    await prisma.roleDefinition.deleteMany({ where: { id: { in: [seededId(roleId), seededId(otherRoleId)] } } });
  });

  it("lists a user whose role holds settlements:submit and pwa:access, and not one holding only pwa:access", async () => {
    const ids = (await listSellThroughSalesmanCandidates()).map((c) => c.id);
    expect(ids).toContain(salesmanId);
    expect(ids).not.toContain(outsiderId);
    expect(await isSellThroughSalesmanCandidate(prisma, salesmanId)).toBe(true);
    expect(await isSellThroughSalesmanCandidate(prisma, outsiderId)).toBe(false);
    expect(await isSellThroughSalesmanCandidate(prisma, "no-such-user")).toBe(false);
  });

  it("defaults to the salesman of the store's latest konsi order only while that user is still a candidate", async () => {
    expect(await defaultSellThroughSalesmanId(storeId)).toBeNull();
    orderId = (
      await prisma.fieldSalesOrder.create({
        data: { orderNo: `TEST-KSTSC-ORD-${token}`, storeId, salesmanId, orderType: "KONSI", subtotal: 0, total: 0 },
      })
    ).id;
    expect(await defaultSellThroughSalesmanId(storeId)).toBe(salesmanId);
    await prisma.fieldSalesOrder.update({ where: { id: orderId }, data: { salesmanId: outsiderId } });
    expect(await defaultSellThroughSalesmanId(storeId)).toBeNull();
  });
});
