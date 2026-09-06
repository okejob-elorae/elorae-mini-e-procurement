import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { buildRejectionBody, rejectSettlement } from "./reject-writer";

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
    /*
     * `entityType` is a second discriminator on purpose, matching the approve spec's tighter
     * scoping: `entityId` alone is a bare cuid shared across every entity kind on the bed.
     */
    await prisma.auditLog.deleteMany({
      where: { entityType: "StoreSettlement", entityId: seededId(settlementId) },
    });
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

  it("writes a SETTLEMENT_REJECT audit row inside the same transaction as the CAS", async () => {
    await rejectSettlement({ settlementId, rejectedById: adminId, reason: "wrong amount" });
    const log = await prisma.auditLog.findFirst({
      where: { entityId: settlementId, action: "SETTLEMENT_REJECT" },
    });
    expect(log).not.toBeNull();
    expect(log!.userId).toBe(adminId);
    expect(log!.entityType).toBe("StoreSettlement");
    expect(log!.reason).toBe("wrong amount");
  });

  /*
   * The CODE, not just the class. Every refusal below throws a `SettlementError`, so asserting the
   * class alone passes even when a regression swaps one reason for another.
   */
  it("refuses a blank reason", async () => {
    await expect(
      rejectSettlement({ settlementId, rejectedById: adminId, reason: "   " }),
    ).rejects.toMatchObject({ code: "MISSING_REASON" });
    const row = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(row!.status).toBe("PENDING");
  });

  it("refuses a reason made only of zero-width characters", async () => {
    await expect(
      rejectSettlement({ settlementId, rejectedById: adminId, reason: "\u200B\u200B" }),
    ).rejects.toMatchObject({ code: "MISSING_REASON" });
  });

  it("refuses a reason longer than 191 characters", async () => {
    await expect(
      rejectSettlement({ settlementId, rejectedById: adminId, reason: "x".repeat(192) }),
    ).rejects.toMatchObject({ code: "INPUT_TOO_LARGE" });
    const row = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(row!.status).toBe("PENDING");
  });

  /*
   * The other side of the bound. Without this, relaxing the guard from `>` to `>=` — the classic
   * off-by-one on a length cap — passes the whole file.
   */
  it("accepts a reason of exactly 191 characters", async () => {
    const reason = "x".repeat(191);
    await rejectSettlement({ settlementId, rejectedById: adminId, reason });
    const row = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(row!.status).toBe("REJECTED");
    expect(row!.rejectReason).toBe(reason);
  });

  /*
   * The length guard runs on the TRIMMED reason and the trimmed reason is what persists — 191
   * characters of content wrapped in whitespace must not be refused, and the stored reason must
   * not carry the padding into the 191-character `AuditLog.reason` column.
   */
  it("trims the reason before measuring and storing it", async () => {
    await rejectSettlement({
      settlementId,
      rejectedById: adminId,
      reason: `   ${"x".repeat(191)}   `,
    });
    const row = await prisma.storeSettlement.findUnique({ where: { id: settlementId } });
    expect(row!.rejectReason).toBe("x".repeat(191));
    const log = await prisma.auditLog.findFirst({
      where: { entityType: "StoreSettlement", entityId: settlementId, action: "SETTLEMENT_REJECT" },
    });
    expect(log!.reason).toBe("x".repeat(191));
  });

  it("refuses a rejecter id with no User row", async () => {
    await expect(
      rejectSettlement({ settlementId, rejectedById: "does-not-exist", reason: "wrong amount" }),
    ).rejects.toMatchObject({ code: "REJECTER_NOT_FOUND" });
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

  /**
   * `NotificationQueue.body` is `VARCHAR(191)` and the body DERIVES from a reason already allowed
   * all 191 characters, so the overflow is in the derived value rather than in either input. The
   * writer's own best-effort catch swallows the resulting truncation error and the action still
   * reports success, so an unbounded body means the salesman is never told his settlement was
   * rejected — with nothing anywhere saying so.
   */
  describe("buildRejectionBody", () => {
    it("leaves a short reason whole", () => {
      expect(buildRejectionBody("BKM/2026/09/0001", "salah jumlah")).toBe(
        "Pelunasan BKM/2026/09/0001 ditolak: salah jumlah",
      );
    });

    it("keeps a maximum-length reason on a real docNo inside 191 characters", () => {
      const body = buildRejectionBody("BKM/2026/09/0001", "x".repeat(191));
      expect(body.length).toBe(191);
      expect(body.startsWith("Pelunasan BKM/2026/09/0001 ditolak: ")).toBe(true);
    });

    it("marks the cut instead of stopping mid-reason silently", () => {
      const body = buildRejectionBody("BKM/2026/09/0001", "x".repeat(191));
      expect(body.endsWith("\u2026")).toBe(true);
    });

    it("drops the reason entirely rather than overflow when the docNo alone fills the column", () => {
      const body = buildRejectionBody("B".repeat(400), "salah jumlah");
      expect(body.length).toBe(191);
      expect(body).not.toContain("salah jumlah");
    });
  });
});
