import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { postSettlementJournal } from "./journal";

// Posts journal + mapping rows — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("postSettlementJournal (test bed only)", () => {
  let token: string; // unique per test — digits only (CoA codes are numeric)
  let adminId: string;
  let bankId: string;
  let feeId: string;
  let arId: string;
  let settlementId: string;

  beforeEach(async () => {
    token = Math.floor(Math.random() * 10_000_000).toString();
    const user = await prisma.user.create({
      data: { email: `test-settlement-journal-${token}@test.local`, name: "Test Admin" },
    });
    adminId = user.id;

    const bank = await prisma.chartAccount.create({
      data: { code: `9${token}1`, name: "Bank (test)", type: "ASET", depth: 1, isActive: true },
    });
    bankId = bank.id;
    const fee = await prisma.chartAccount.create({
      data: { code: `9${token}2`, name: "Marketplace Fee (test)", type: "BEBAN", depth: 1, isActive: true },
    });
    feeId = fee.id;
    const ar = await prisma.chartAccount.create({
      data: { code: `9${token}3`, name: "AR (test)", type: "ASET", depth: 1, isActive: true },
    });
    arId = ar.id;

    await prisma.journalAccountMapping.upsert({
      where: { role: "BANK" },
      create: { role: "BANK", chartAccountId: bankId },
      update: { chartAccountId: bankId },
    });
    await prisma.journalAccountMapping.upsert({
      where: { role: "MARKETPLACE_FEE" },
      create: { role: "MARKETPLACE_FEE", chartAccountId: feeId },
      update: { chartAccountId: feeId },
    });
    await prisma.journalAccountMapping.upsert({
      where: { role: "AR" },
      create: { role: "AR", chartAccountId: arId },
      update: { chartAccountId: arId },
    });

    const settlement = await prisma.settlement.create({
      data: {
        marketplace: "SHOPEE",
        seller: "elorae.official",
        periodFrom: new Date("2026-06-01T00:00:00+07:00"),
        periodTo: new Date("2026-06-30T00:00:00+07:00"),
        fileName: "t.xlsx",
        uploadedById: adminId,
        status: "MATCHED",
        totalPendapatan: 1000,
        totalPengeluaran: 60,
        totalDilepas: 940,
        parsedNetTotal: 940,
        checksumOk: true,
        checksumVariance: 0,
        summaryRaw: {},
        sellerFeesRaw: [],
        adjustmentsRaw: [],
      },
      select: { id: true },
    });
    settlementId = settlement.id;
  });

  afterEach(async () => {
    const journal = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "SETTLEMENT", sourceId: settlementId } },
      select: { id: true },
    });
    if (journal) {
      await prisma.journalLine.deleteMany({ where: { journalId: journal.id } });
      await prisma.journal.delete({ where: { id: journal.id } });
    }
    await prisma.journalAccountMapping.deleteMany({ where: { chartAccountId: { in: [bankId, feeId, arId] } } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: [bankId, feeId, arId] } } });
    await prisma.settlement.delete({ where: { id: settlementId } });
    await prisma.user.delete({ where: { id: adminId } });
  });

  it("posts a balanced DR Bank + DR Fee, CR AR journal + marks RECONCILED", async () => {
    const r = await postSettlementJournal(settlementId, adminId, prisma);
    expect(r).toMatchObject({ ok: true, created: true });

    const j = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "SETTLEMENT", sourceId: settlementId } },
      include: { lines: true },
    });
    expect(j!.lines).toHaveLength(3);

    const s = await prisma.settlement.findUnique({ where: { id: settlementId } });
    expect(s!.status).toBe("RECONCILED");
  });

  it("is idempotent (re-post returns created:false, no 2nd journal)", async () => {
    const a = await postSettlementJournal(settlementId, adminId, prisma);
    const b = await postSettlementJournal(settlementId, adminId, prisma);
    expect(a).toMatchObject({ ok: true, created: true });
    expect(b).toMatchObject({ ok: true, created: false });
    if (a.ok && b.ok) expect(b.journalId).toBe(a.journalId);
  });

  it("blocks when checksum failed", async () => {
    await prisma.settlement.update({ where: { id: settlementId }, data: { checksumOk: false } });
    const r = await postSettlementJournal(settlementId, adminId, prisma);
    expect(r).toMatchObject({ ok: false, code: "CHECKSUM_BLOCKED" });
  });

  it("blocks when a required role is unmapped", async () => {
    await prisma.journalAccountMapping.delete({ where: { role: "BANK" } });
    const r = await postSettlementJournal(settlementId, adminId, prisma);
    expect(r).toMatchObject({ ok: false, code: "UNMAPPED_ROLE", role: "BANK" });
  });
});
