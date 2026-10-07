import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "./mapping-test-fixture";

// Rewrites JournalAccountMapping rows — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("restoreMappings (test bed only)", () => {
  let realSnapshot: MappingSnapshot | undefined;
  let accountA = "";
  let accountB = "";

  beforeAll(async () => {
    const token = Math.floor(Math.random() * 10_000_000).toString();
    realSnapshot = await snapshotMappings(["BANK", "AR"]);
    const a = await prisma.chartAccount.create({
      data: { code: `9${token}1`, name: "Mapping fixture A (test)", type: "ASET", depth: 1, isActive: true },
    });
    accountA = a.id;
    const b = await prisma.chartAccount.create({
      data: { code: `9${token}2`, name: "Mapping fixture B (test)", type: "ASET", depth: 1, isActive: true },
    });
    accountB = b.id;
  });

  afterAll(async () => {
    const failures: string[] = [];
    if (realSnapshot === undefined) {
      failures.push("mapping snapshot was never taken");
    } else {
      try {
        await restoreMappings(realSnapshot);
      } catch (e) {
        failures.push(`restoreMappings (→ ${JSON.stringify(realSnapshot)}): ${String(e)}`);
      }
    }
    try {
      await prisma.chartAccount.deleteMany({ where: { id: { in: [seededId(accountA), seededId(accountB)] } } });
    } catch (e) {
      failures.push(`chartAccount.deleteMany: ${String(e)}`);
    }
    if (failures.length > 0) {
      console.error(
        "[mapping-test-fixture.test.ts] FAILED TO RESTORE JournalAccountMapping for BANK, AR — " +
          "check Finance → Pemetaan Akun on the :3308 dev DB and re-map by hand if needed.",
        failures,
      );
      throw new Error(failures.join(" | "));
    }
  });

  async function pointBothAt(accountId: string): Promise<void> {
    for (const role of ["BANK", "AR"] as const) {
      await prisma.journalAccountMapping.upsert({
        where: { role },
        create: { role, chartAccountId: accountId },
        update: { chartAccountId: accountId },
      });
    }
  }

  it("a failure on the first role still restores the rest", async () => {
    await pointBothAt(accountA);
    const original = prisma.journalAccountMapping.upsert.bind(prisma.journalAccountMapping);
    /* The `prisma` proxy hands the spy no real original, so pass through to the bound one explicitly. */
    const spy = vi
      .spyOn(prisma.journalAccountMapping, "upsert")
      .mockImplementation(original as unknown as typeof prisma.journalAccountMapping.upsert)
      .mockImplementationOnce((() => {
        throw new Error("boom");
      }) as unknown as typeof prisma.journalAccountMapping.upsert);
    try {
      let message = "";
      try {
        await restoreMappings({ BANK: accountB, AR: accountB });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/BANK/);
      expect(message).not.toMatch(/AR\b/);
      const ar = await prisma.journalAccountMapping.findUnique({ where: { role: "AR" } });
      expect(ar?.chartAccountId).toBe(accountB);
    } finally {
      spy.mockImplementation(original as unknown as typeof prisma.journalAccountMapping.upsert);
    }
  });

  it("a null entry deletes the row after an earlier failure", async () => {
    await pointBothAt(accountA);
    const original = prisma.journalAccountMapping.upsert.bind(prisma.journalAccountMapping);
    /* The `prisma` proxy hands the spy no real original, so pass through to the bound one explicitly. */
    const spy = vi
      .spyOn(prisma.journalAccountMapping, "upsert")
      .mockImplementation(original as unknown as typeof prisma.journalAccountMapping.upsert)
      .mockImplementationOnce((() => {
        throw new Error("boom");
      }) as unknown as typeof prisma.journalAccountMapping.upsert);
    try {
      let message = "";
      try {
        await restoreMappings({ BANK: accountB, AR: null });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/BANK/);
      const ar = await prisma.journalAccountMapping.findUnique({ where: { role: "AR" } });
      expect(ar).toBeNull();
    } finally {
      spy.mockImplementation(original as unknown as typeof prisma.journalAccountMapping.upsert);
    }
  });
});
