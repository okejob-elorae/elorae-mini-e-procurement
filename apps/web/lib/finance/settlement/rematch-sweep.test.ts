import { describe, it, expect, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { runSettlementRematchSweep } from "./rematch-sweep";

// Test-bed only — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/* Seeds N `JubelioSalesOrderResync` rows under `batchId`, one per given status. */
async function seedResyncRows(batchId: string, statuses: string[]): Promise<void> {
  await prisma.jubelioSalesOrderResync.createMany({
    data: statuses.map((status, i) => ({ batchId, salesorderNo: `SO-${batchId}-${i}`, status })),
  });
}

d("runSettlementRematchSweep (test bed only)", () => {
  it("rematches a settlement whose batch is all-terminal (DONE + NOT_FOUND)", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });
    const suffix = Math.random().toString(36).slice(2, 10);
    const batchId = `rematch-terminal-${suffix}`;

    let settlementId = "";
    try {
      const settlement = await prisma.settlement.create({
        data: {
          marketplace: "SHOPEE",
          seller: "elorae.official",
          periodFrom: new Date("2026-06-01T00:00:00+07:00"),
          periodTo: new Date("2026-06-30T00:00:00+07:00"),
          fileName: "t.xlsx",
          uploadedById: admin.id,
          status: "PARSED",
          totalPendapatan: 0,
          totalPengeluaran: 0,
          totalDilepas: 0,
          parsedNetTotal: 0,
          checksumOk: true,
          checksumVariance: 0,
          summaryRaw: {},
          sellerFeesRaw: [],
          adjustmentsRaw: [],
          resyncBatchId: batchId,
          resyncSeededAt: new Date(),
        },
        select: { id: true },
      });
      settlementId = settlement.id;

      await seedResyncRows(batchId, ["DONE", "NOT_FOUND"]);

      const result = await runSettlementRematchSweep({ settlementIds: [settlementId] });
      expect(result).toEqual({ scanned: 1, rematched: 1, skippedReconciled: 0, stillRunning: 0 });

      const after = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
      expect(after.resyncRematchedAt).not.toBeNull();
      expect(after.status).toBe("MATCHED");
    } finally {
      await prisma.jubelioSalesOrderResync.deleteMany({ where: { batchId: seededId(batchId) } });
      await prisma.settlementLine.deleteMany({ where: { settlementId: seededId(settlementId) } });
      await prisma.settlement.deleteMany({ where: { id: seededId(settlementId) } });
    }
  });

  it("leaves an in-flight batch alone (one DONE, one FETCHING)", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });
    const suffix = Math.random().toString(36).slice(2, 10);
    const batchId = `rematch-inflight-${suffix}`;

    let settlementId = "";
    try {
      const settlement = await prisma.settlement.create({
        data: {
          marketplace: "SHOPEE",
          seller: "elorae.official",
          periodFrom: new Date("2026-06-01T00:00:00+07:00"),
          periodTo: new Date("2026-06-30T00:00:00+07:00"),
          fileName: "t.xlsx",
          uploadedById: admin.id,
          status: "PARSED",
          totalPendapatan: 0,
          totalPengeluaran: 0,
          totalDilepas: 0,
          parsedNetTotal: 0,
          checksumOk: true,
          checksumVariance: 0,
          summaryRaw: {},
          sellerFeesRaw: [],
          adjustmentsRaw: [],
          resyncBatchId: batchId,
          resyncSeededAt: new Date(),
        },
        select: { id: true },
      });
      settlementId = settlement.id;

      await seedResyncRows(batchId, ["DONE", "FETCHING"]);

      const result = await runSettlementRematchSweep({ settlementIds: [settlementId] });
      expect(result).toEqual({ scanned: 1, rematched: 0, skippedReconciled: 0, stillRunning: 1 });

      const after = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
      expect(after.resyncRematchedAt).toBeNull();
      expect(after.status).toBe("PARSED");
    } finally {
      await prisma.jubelioSalesOrderResync.deleteMany({ where: { batchId: seededId(batchId) } });
      await prisma.settlementLine.deleteMany({ where: { settlementId: seededId(settlementId) } });
      await prisma.settlement.deleteMany({ where: { id: seededId(settlementId) } });
    }
  });

  it("stamps a RECONCILED settlement but never rematches it, leaving line figures untouched", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });
    const suffix = Math.random().toString(36).slice(2, 10);
    const batchId = `rematch-reconciled-${suffix}`;
    const orderNo = `REC-${suffix}`;

    let settlementId = "";
    try {
      const settlement = await prisma.settlement.create({
        data: {
          marketplace: "SHOPEE",
          seller: "elorae.official",
          periodFrom: new Date("2026-06-01T00:00:00+07:00"),
          periodTo: new Date("2026-06-30T00:00:00+07:00"),
          fileName: "t.xlsx",
          uploadedById: admin.id,
          status: "RECONCILED",
          totalPendapatan: 5000,
          totalPengeluaran: 2000,
          totalDilepas: 3000,
          parsedNetTotal: 3000,
          checksumOk: true,
          checksumVariance: 0,
          summaryRaw: {},
          sellerFeesRaw: [],
          adjustmentsRaw: [],
          resyncBatchId: batchId,
          resyncSeededAt: new Date(),
          lines: {
            create: [
              {
                orderNo,
                netIncome: 5000,
                hargaAsliProduk: 5000,
                totalDiskonProduk: 0,
                biayaAdministrasi: 0,
                biayaLayanan: 0,
                biayaKomisiAms: 0,
                biayaProsesPesanan: 0,
                raw: { "No. Pesanan": orderNo },
                matchStatus: "MATCHED",
                matchedSalesOrderId: null,
                cogsSnapshot: 1200,
                profit: 3800,
              },
            ],
          },
        },
        select: { id: true },
      });
      settlementId = settlement.id;

      await seedResyncRows(batchId, ["DONE", "DONE"]);

      const result = await runSettlementRematchSweep({ settlementIds: [settlementId] });
      expect(result).toEqual({ scanned: 1, rematched: 0, skippedReconciled: 1, stillRunning: 0 });

      const after = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
      expect(after.resyncRematchedAt).not.toBeNull();
      expect(after.status).toBe("RECONCILED");

      const line = await prisma.settlementLine.findFirstOrThrow({
        where: { settlementId, orderNo },
      });
      expect(line.matchStatus).toBe("MATCHED");
      expect(Number(line.profit)).toBe(3800);
    } finally {
      await prisma.jubelioSalesOrderResync.deleteMany({ where: { batchId: seededId(batchId) } });
      await prisma.settlementLine.deleteMany({ where: { settlementId: seededId(settlementId) } });
      await prisma.settlement.deleteMany({ where: { id: seededId(settlementId) } });
    }
  });

  it("counts an all-NOT_FOUND batch as terminal and rematches it", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });
    const suffix = Math.random().toString(36).slice(2, 10);
    const batchId = `rematch-notfound-${suffix}`;

    let settlementId = "";
    try {
      const settlement = await prisma.settlement.create({
        data: {
          marketplace: "SHOPEE",
          seller: "elorae.official",
          periodFrom: new Date("2026-06-01T00:00:00+07:00"),
          periodTo: new Date("2026-06-30T00:00:00+07:00"),
          fileName: "t.xlsx",
          uploadedById: admin.id,
          status: "PARSED",
          totalPendapatan: 0,
          totalPengeluaran: 0,
          totalDilepas: 0,
          parsedNetTotal: 0,
          checksumOk: true,
          checksumVariance: 0,
          summaryRaw: {},
          sellerFeesRaw: [],
          adjustmentsRaw: [],
          resyncBatchId: batchId,
          resyncSeededAt: new Date(),
        },
        select: { id: true },
      });
      settlementId = settlement.id;

      await seedResyncRows(batchId, ["NOT_FOUND", "NOT_FOUND"]);

      const result = await runSettlementRematchSweep({ settlementIds: [settlementId] });
      expect(result).toEqual({ scanned: 1, rematched: 1, skippedReconciled: 0, stillRunning: 0 });

      const after = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
      expect(after.resyncRematchedAt).not.toBeNull();
      expect(after.status).toBe("MATCHED");
    } finally {
      await prisma.jubelioSalesOrderResync.deleteMany({ where: { batchId: seededId(batchId) } });
      await prisma.settlementLine.deleteMany({ where: { settlementId: seededId(settlementId) } });
      await prisma.settlement.deleteMany({ where: { id: seededId(settlementId) } });
    }
  });

  it("scope: a settlement not passed in settlementIds is left untouched even with a terminal batch", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });
    const suffix = Math.random().toString(36).slice(2, 10);
    const includedBatchId = `rematch-scope-in-${suffix}`;
    const excludedBatchId = `rematch-scope-out-${suffix}`;

    let includedId = "";
    let excludedId = "";
    try {
      const base = {
        marketplace: "SHOPEE",
        seller: "elorae.official",
        periodFrom: new Date("2026-06-01T00:00:00+07:00"),
        periodTo: new Date("2026-06-30T00:00:00+07:00"),
        fileName: "t.xlsx",
        uploadedById: admin.id,
        status: "PARSED",
        totalPendapatan: 0,
        totalPengeluaran: 0,
        totalDilepas: 0,
        parsedNetTotal: 0,
        checksumOk: true,
        checksumVariance: 0,
        summaryRaw: {},
        sellerFeesRaw: [],
        adjustmentsRaw: [],
      };

      const included = await prisma.settlement.create({
        data: { ...base, resyncBatchId: includedBatchId, resyncSeededAt: new Date() },
        select: { id: true },
      });
      includedId = included.id;

      const excluded = await prisma.settlement.create({
        data: { ...base, resyncBatchId: excludedBatchId, resyncSeededAt: new Date() },
        select: { id: true },
      });
      excludedId = excluded.id;

      await seedResyncRows(includedBatchId, ["DONE"]);
      await seedResyncRows(excludedBatchId, ["DONE"]);

      const result = await runSettlementRematchSweep({ settlementIds: [includedId] });
      expect(result).toEqual({ scanned: 1, rematched: 1, skippedReconciled: 0, stillRunning: 0 });

      const includedAfter = await prisma.settlement.findUniqueOrThrow({ where: { id: includedId } });
      expect(includedAfter.resyncRematchedAt).not.toBeNull();
      expect(includedAfter.status).toBe("MATCHED");

      const excludedAfter = await prisma.settlement.findUniqueOrThrow({ where: { id: excludedId } });
      expect(excludedAfter.resyncRematchedAt).toBeNull();
      expect(excludedAfter.status).toBe("PARSED");
    } finally {
      await prisma.jubelioSalesOrderResync.deleteMany({ where: { batchId: seededId(includedBatchId) } });
      await prisma.jubelioSalesOrderResync.deleteMany({ where: { batchId: seededId(excludedBatchId) } });
      await prisma.settlementLine.deleteMany({ where: { settlementId: { in: [seededId(includedId), seededId(excludedId)] } } });
      await prisma.settlement.deleteMany({ where: { id: { in: [seededId(includedId), seededId(excludedId)] } } });
    }
  });

  it("passing an empty settlementIds array sweeps nothing (never collapses to \"sweep all\")", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });
    const suffix = Math.random().toString(36).slice(2, 10);
    const batchId = `rematch-empty-scope-${suffix}`;

    let settlementId = "";
    try {
      const settlement = await prisma.settlement.create({
        data: {
          marketplace: "SHOPEE",
          seller: "elorae.official",
          periodFrom: new Date("2026-06-01T00:00:00+07:00"),
          periodTo: new Date("2026-06-30T00:00:00+07:00"),
          fileName: "t.xlsx",
          uploadedById: admin.id,
          status: "PARSED",
          totalPendapatan: 0,
          totalPengeluaran: 0,
          totalDilepas: 0,
          parsedNetTotal: 0,
          checksumOk: true,
          checksumVariance: 0,
          summaryRaw: {},
          sellerFeesRaw: [],
          adjustmentsRaw: [],
          resyncBatchId: batchId,
          resyncSeededAt: new Date(),
        },
        select: { id: true },
      });
      settlementId = settlement.id;

      await seedResyncRows(batchId, ["DONE"]);

      const result = await runSettlementRematchSweep({ settlementIds: [] });
      expect(result).toEqual({ scanned: 0, rematched: 0, skippedReconciled: 0, stillRunning: 0 });

      const after = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
      expect(after.resyncRematchedAt).toBeNull();
      expect(after.status).toBe("PARSED");
    } finally {
      await prisma.jubelioSalesOrderResync.deleteMany({ where: { batchId: seededId(batchId) } });
      await prisma.settlementLine.deleteMany({ where: { settlementId: seededId(settlementId) } });
      await prisma.settlement.deleteMany({ where: { id: seededId(settlementId) } });
    }
  });

  it("clears resyncRematchedAt back to null when matchSettlement throws (scoped to the claimed batch, so a later tick's own stamp under a replaced batch survives)", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } });
    const suffix = Math.random().toString(36).slice(2, 10);
    const batchId = `rematch-throw-${suffix}`;

    let settlementId = "";
    /*
     * Force `matchSettlement`'s own read to throw for exactly this test's settlement, without
     * touching any other row `findUniqueOrThrow` serves elsewhere in the same tick. The bound
     * original is captured before spying and pinned back in `finally` — never `mockRestore` or
     * `mockReset` on a Prisma model delegate spy (AGENTS.md): the delegate serves its methods
     * through Prisma's own proxy rather than as own properties, so restoring leaves the method
     * undefined (or returning undefined) for every later test in this file.
     */
    const original = prisma.settlement.findUniqueOrThrow.bind(prisma.settlement);
    const spy = vi.spyOn(prisma.settlement, "findUniqueOrThrow");
    try {
      const settlement = await prisma.settlement.create({
        data: {
          marketplace: "SHOPEE",
          seller: "elorae.official",
          periodFrom: new Date("2026-06-01T00:00:00+07:00"),
          periodTo: new Date("2026-06-30T00:00:00+07:00"),
          fileName: "t.xlsx",
          uploadedById: admin.id,
          status: "PARSED",
          totalPendapatan: 0,
          totalPengeluaran: 0,
          totalDilepas: 0,
          parsedNetTotal: 0,
          checksumOk: true,
          checksumVariance: 0,
          summaryRaw: {},
          sellerFeesRaw: [],
          adjustmentsRaw: [],
          resyncBatchId: batchId,
          resyncSeededAt: new Date(),
        },
        select: { id: true },
      });
      settlementId = settlement.id;

      await seedResyncRows(batchId, ["DONE"]);

      /*
       * Before throwing, simulate a concurrent later tick that already re-stamped and
       * successfully rematched this settlement under a REPLACED batch — this is the guard the
       * un-stamp must respect: it must only clear the stamp for the batch IT claimed under
       * (`batchId`, captured at loop start), never a newer one a later tick already finished.
       */
      const laterBatchId = `${batchId}-later`;
      const laterRematchedAt = new Date("2026-01-01T00:00:00Z");
      spy.mockImplementation(
        (async (args: unknown) => {
          const where = (args as { where?: { id?: string } })?.where;
          if (where?.id === settlementId) {
            await prisma.settlement.update({
              where: { id: settlementId },
              data: { resyncBatchId: laterBatchId, resyncRematchedAt: laterRematchedAt },
            });
            throw new Error("boom");
          }
          return original(args as Parameters<typeof original>[0]);
        }) as unknown as typeof prisma.settlement.findUniqueOrThrow,
      );

      const result = await runSettlementRematchSweep({ settlementIds: [settlementId] });
      expect(result).toEqual({ scanned: 1, rematched: 0, skippedReconciled: 0, stillRunning: 0 });

      // Pin the spy back before reading through it again — it is still wired to throw for
      // this settlement's id, and the sweep's own recovery is the thing under test, not this read.
      spy.mockImplementation(original as unknown as typeof prisma.settlement.findUniqueOrThrow);
      const after = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
      // The un-stamp is scoped to `batchId` (this tick's own claim) — since the row now belongs
      // to `laterBatchId`, the guarded update must have matched zero rows and left the later
      // tick's own stamp alone, rather than blindly clearing it back to null.
      expect(after.resyncBatchId).toBe(laterBatchId);
      expect(after.resyncRematchedAt?.getTime()).toBe(laterRematchedAt.getTime());
      expect(after.status).toBe("PARSED");
    } finally {
      spy.mockImplementation(original as unknown as typeof prisma.settlement.findUniqueOrThrow);
      await prisma.jubelioSalesOrderResync.deleteMany({ where: { batchId: seededId(batchId) } });
      await prisma.settlementLine.deleteMany({ where: { settlementId: seededId(settlementId) } });
      await prisma.settlement.deleteMany({ where: { id: seededId(settlementId) } });
    }
  });
});
