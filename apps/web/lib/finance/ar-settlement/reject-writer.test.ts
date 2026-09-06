import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { rejectSettlement } from "./reject-writer";
import { SettlementError } from "./errors";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("rejectSettlement (test bed only)", () => {
  let token = "";
  let storeId = "";
  let salesmanId = "";
  let adminId = "";
  let settlementId = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    storeId = "";
    salesmanId = "";
    adminId = "";
    settlementId = "";

    const store = await prisma.store.create({
      data: { code: `TEST-RJW-${token}`, name: "test", address: "test", termsType: "PUTUS" },
    });
    storeId = store.id;
    const salesman = await prisma.user.create({
      data: { email: `rjw-sales-${token}@test.local`, name: "salesman", role: "ADMIN" },
    });
    salesmanId = salesman.id;
    const admin = await prisma.user.create({
      data: { email: `rjw-admin-${token}@test.local`, name: "admin", role: "ADMIN" },
    });
    adminId = admin.id;

    const settlement = await prisma.storeSettlement.create({
      data: {
        docNo: `TEST-RJW-STL-${token}`,
        storeId,
        salesmanId,
        expectedAmount: 1000,
        actualAmount: 1000,
        varianceAmount: 0,
      },
    });
    settlementId = settlement.id;
  });

  afterEach(async () => {
    await prisma.storeSettlement.deleteMany({ where: { id: seededId(settlementId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(salesmanId), seededId(adminId)] } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  it("rejects a PENDING settlement with a reason", async () => {
    const result = await rejectSettlement({ settlementId, rejectedById: adminId, reason: "wrong amount" });
    expect(result.ok).toBe(true);
    const row = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(row!.status).toBe("REJECTED");
    expect(row!.rejectReason).toBe("wrong amount");
    expect(row!.reviewedById).toBe(adminId);
    expect(row!.reviewedAt).not.toBeNull();
  });

  it("refuses a blank reason", async () => {
    await expect(
      rejectSettlement({ settlementId, rejectedById: adminId, reason: "   " }),
    ).rejects.toBeInstanceOf(SettlementError);
    const row = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(row!.status).toBe("PENDING");
  });

  it("refuses a reason made only of zero-width characters", async () => {
    await expect(
      rejectSettlement({ settlementId, rejectedById: adminId, reason: "\u200B\u200B" }),
    ).rejects.toBeInstanceOf(SettlementError);
  });

  it("refuses a reason longer than 191 characters", async () => {
    await expect(
      rejectSettlement({ settlementId, rejectedById: adminId, reason: "x".repeat(192) }),
    ).rejects.toBeInstanceOf(SettlementError);
    const row = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(row!.status).toBe("PENDING");
  });

  it("throws SETTLEMENT_NOT_FOUND for a missing settlement", async () => {
    await expect(
      rejectSettlement({ settlementId: "does-not-exist", rejectedById: adminId, reason: "reason" }),
    ).rejects.toMatchObject({ code: "SETTLEMENT_NOT_FOUND" });
  });

  it("CAS refuses a settlement that is no longer PENDING", async () => {
    await rejectSettlement({ settlementId, rejectedById: adminId, reason: "first rejection" });
    await expect(
      rejectSettlement({ settlementId, rejectedById: adminId, reason: "second attempt" }),
    ).rejects.toMatchObject({ code: "NOT_PENDING" });
  });
});
