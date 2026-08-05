import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { postSettlementJournal } from "./journal";
import { setAccountMapping, clearAccountMapping } from "../journals/mapping";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../journals/mapping-test-fixture";

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
  let feeAdminAccountId: string;
  let feeServiceAccountId: string;
  let feeCommissionAccountId: string;
  let feeProcessingAccountId: string;
  let feeOtherAccountId: string;
  let settlementId: string;
  let mappingSnapshot: MappingSnapshot;

  /**
   * Creates a Settlement with SettlementLine rows so `postSettlementJournal`
   * can aggregate real per-category fee totals. `SettlementLine` cascades on
   * `Settlement` delete, so the caller only needs to delete the settlement.
   */
  async function seedSettlementWithLines(opts: {
    totalPendapatan: number;
    totalPengeluaran: number;
    totalDilepas: number;
    lines: Array<{
      biayaAdministrasi: number;
      biayaLayanan: number;
      biayaKomisiAms: number;
      biayaProsesPesanan: number;
    }>;
  }): Promise<string> {
    const settlement = await prisma.settlement.create({
      data: {
        marketplace: "SHOPEE",
        seller: "elorae.official",
        periodFrom: new Date("2026-06-01T00:00:00+07:00"),
        periodTo: new Date("2026-06-30T00:00:00+07:00"),
        fileName: "t-fee-split.xlsx",
        uploadedById: adminId,
        status: "MATCHED",
        totalPendapatan: opts.totalPendapatan,
        totalPengeluaran: opts.totalPengeluaran,
        totalDilepas: opts.totalDilepas,
        parsedNetTotal: opts.totalDilepas,
        checksumOk: true,
        checksumVariance: 0,
        summaryRaw: {},
        sellerFeesRaw: [],
        adjustmentsRaw: [],
        lines: {
          create: opts.lines.map((l, i) => ({
            orderNo: `SO-fee-split-${i}`,
            netIncome: opts.totalPendapatan,
            hargaAsliProduk: 0,
            totalDiskonProduk: 0,
            biayaAdministrasi: l.biayaAdministrasi,
            biayaLayanan: l.biayaLayanan,
            biayaKomisiAms: l.biayaKomisiAms,
            biayaProsesPesanan: l.biayaProsesPesanan,
            raw: {},
          })),
        },
      },
      select: { id: true },
    });
    return settlement.id;
  }

  /** Tears down a settlement created outside the shared `beforeEach` fixture. */
  async function teardownSettlementJournal(id: string): Promise<void> {
    const journal = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "SETTLEMENT", sourceId: id } },
      select: { id: true },
    });
    if (journal) {
      await prisma.journalLine.deleteMany({ where: { journalId: journal.id } });
      await prisma.journal.delete({ where: { id: journal.id } });
    }
    await prisma.settlement.delete({ where: { id } });
  }

  beforeEach(async () => {
    token = Math.floor(Math.random() * 10_000_000).toString();
    mappingSnapshot = await snapshotMappings([
      "BANK",
      "MARKETPLACE_FEE",
      "MARKETPLACE_FEE_ADMIN",
      "MARKETPLACE_FEE_SERVICE",
      "MARKETPLACE_FEE_COMMISSION",
      "MARKETPLACE_FEE_PROCESSING",
      "MARKETPLACE_FEE_OTHER",
      "AR",
    ]);
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
    const feeAdmin = await prisma.chartAccount.create({
      data: { code: `9${token}4`, name: "Marketplace Fee Admin (test)", type: "BEBAN", depth: 1, isActive: true },
    });
    feeAdminAccountId = feeAdmin.id;
    const feeService = await prisma.chartAccount.create({
      data: { code: `9${token}5`, name: "Marketplace Fee Service (test)", type: "BEBAN", depth: 1, isActive: true },
    });
    feeServiceAccountId = feeService.id;
    const feeCommission = await prisma.chartAccount.create({
      data: { code: `9${token}6`, name: "Marketplace Fee Commission (test)", type: "BEBAN", depth: 1, isActive: true },
    });
    feeCommissionAccountId = feeCommission.id;
    const feeProcessing = await prisma.chartAccount.create({
      data: { code: `9${token}7`, name: "Marketplace Fee Processing (test)", type: "BEBAN", depth: 1, isActive: true },
    });
    feeProcessingAccountId = feeProcessing.id;
    const feeOther = await prisma.chartAccount.create({
      data: { code: `9${token}8`, name: "Marketplace Fee Other (test)", type: "BEBAN", depth: 1, isActive: true },
    });
    feeOtherAccountId = feeOther.id;

    await setAccountMapping("BANK", bankId);
    await setAccountMapping("MARKETPLACE_FEE", feeId);
    await setAccountMapping("AR", arId);
    await setAccountMapping("MARKETPLACE_FEE_ADMIN", feeAdminAccountId);
    await setAccountMapping("MARKETPLACE_FEE_SERVICE", feeServiceAccountId);
    await setAccountMapping("MARKETPLACE_FEE_COMMISSION", feeCommissionAccountId);
    await setAccountMapping("MARKETPLACE_FEE_PROCESSING", feeProcessingAccountId);
    await setAccountMapping("MARKETPLACE_FEE_OTHER", feeOtherAccountId);

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
    await restoreMappings(mappingSnapshot);
    await prisma.chartAccount.deleteMany({
      where: {
        id: {
          in: [
            bankId,
            feeId,
            arId,
            feeAdminAccountId,
            feeServiceAccountId,
            feeCommissionAccountId,
            feeProcessingAccountId,
            feeOtherAccountId,
          ],
        },
      },
    });
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

  it("posts a balanced journal for a TikTok settlement whose totals were derived by the fixed parser identity", async () => {
    // Regression: the TikTok parser used to sum independent "Total Pendapatan"
    // / "Total Biaya" columns, which could disagree with totalDilepas +
    // totalPengeluaran (UNBALANCED) or produce a negative totalPengeluaran
    // (BAD_LINE, uncaught here). These totals are built the way the fixed
    // parser derives them — totalPendapatan = totalDilepas + totalPengeluaran,
    // totalPengeluaran normalized non-negative — proving postSettlementJournal
    // (marketplace-blind, totals-only) accepts a TikTok settlement cleanly.
    const tiktokSettlement = await prisma.settlement.create({
      data: {
        marketplace: "TIKTOK",
        seller: "TikTok Shop",
        periodFrom: new Date("2026-06-01T00:00:00+07:00"),
        periodTo: new Date("2026-06-30T00:00:00+07:00"),
        fileName: "t-tiktok.xlsx",
        uploadedById: adminId,
        status: "MATCHED",
        totalPendapatan: 4500,
        totalPengeluaran: 1500,
        totalDilepas: 3000,
        parsedNetTotal: 3000,
        checksumOk: true,
        checksumVariance: 0,
        summaryRaw: {},
        sellerFeesRaw: [],
        adjustmentsRaw: [],
      },
      select: { id: true },
    });

    try {
      const r = await postSettlementJournal(tiktokSettlement.id, adminId, prisma);
      expect(r).toMatchObject({ ok: true, created: true });

      const j = await prisma.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: "SETTLEMENT", sourceId: tiktokSettlement.id } },
        include: { lines: true },
      });
      expect(j!.lines).toHaveLength(3);

      const s = await prisma.settlement.findUnique({ where: { id: tiktokSettlement.id } });
      expect(s!.status).toBe("RECONCILED");
    } finally {
      const journal = await prisma.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: "SETTLEMENT", sourceId: tiktokSettlement.id } },
        select: { id: true },
      });
      if (journal) {
        await prisma.journalLine.deleteMany({ where: { journalId: journal.id } });
        await prisma.journal.delete({ where: { id: journal.id } });
      }
      await prisma.settlement.delete({ where: { id: tiktokSettlement.id } });
    }
  });

  it("posts one line per fee category plus a residual when all fee roles are mapped", async () => {
    /*
     * Real Shopee data stores fee columns AND the summary totalPengeluaran
     * as NEGATIVE (deductions) — see reference/finance/Income.sudah
     * dilepas.id.20260601_20260630.xlsx. Seed that sign profile so an
     * un-normalized implementation (missing Math.abs) fails this spec
     * instead of an inverted-but-coincidentally-balanced journal passing it.
     * Lines total 2.000 in itemized fees (unsigned); totalPengeluaran 2.500
     * (unsigned) leaves a 500 residual. totalPendapatan = totalDilepas +
     * |totalPengeluaran| = 7.500 + 2.500 = 10.000, matching the identity the
     * real export satisfies (816.565.654 + 236.119.746 = 1.052.685.400).
     */
    const feeSplitSettlementId = await seedSettlementWithLines({
      totalPendapatan: 10_000,
      totalPengeluaran: -2_500,
      totalDilepas: 7_500,
      lines: [{ biayaAdministrasi: -1_000, biayaLayanan: -500, biayaKomisiAms: -300, biayaProsesPesanan: -200 }],
    });

    try {
      const res = await postSettlementJournal(feeSplitSettlementId, adminId, prisma);

      expect(res).toMatchObject({ ok: true });
      const journal = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "SETTLEMENT", sourceId: feeSplitSettlementId } },
        include: { lines: true },
      });
      expect(journal.lines).toHaveLength(7);
      const totalDebit = journal.lines.reduce((sum, l) => sum + Number(l.debit), 0);
      const totalCredit = journal.lines.reduce((sum, l) => sum + Number(l.credit), 0);
      expect(totalDebit).toBe(totalCredit);
      const byAccount = new Map(journal.lines.map((l) => [l.chartAccountId, Number(l.debit)]));
      expect(byAccount.get(feeAdminAccountId)).toBe(1_000);
      expect(byAccount.get(feeServiceAccountId)).toBe(500);
      expect(byAccount.get(feeCommissionAccountId)).toBe(300);
      expect(byAccount.get(feeProcessingAccountId)).toBe(200);
      expect(byAccount.get(feeOtherAccountId)).toBe(500);
    } finally {
      await teardownSettlementJournal(feeSplitSettlementId);
    }
  });

  it("posts a realistic Shopee-shaped breakdown scaled from the real income export", async () => {
    /*
     * Proportions taken from reference/finance/Income.sudah
     * dilepas.id.20260601_20260630.xlsx, scaled down by 1/10,000 (values
     * rounded to 2 decimals — SettlementLine columns are Decimal(18,2)):
     * admin -86.847.349, service -109.821.025, commission -30.867.841,
     * processing -4.641.762; totalPengeluaran -236.119.746, totalDilepas
     * 816.565.654, totalPendapatan 1.052.685.400. The expected residual
     * (394.18 here) matches the real export's known "Other Adjustments"
     * bucket (3.941.769 unscaled, /10,000 = 394.1769 ≈ 394.18).
     */
    const feeSplitSettlementId = await seedSettlementWithLines({
      totalPendapatan: 105_268.54,
      totalPengeluaran: -23_611.97,
      totalDilepas: 81_656.57,
      lines: [
        {
          biayaAdministrasi: -8_684.73,
          biayaLayanan: -10_982.1,
          biayaKomisiAms: -3_086.78,
          biayaProsesPesanan: -464.18,
        },
      ],
    });

    try {
      const res = await postSettlementJournal(feeSplitSettlementId, adminId, prisma);

      expect(res).toMatchObject({ ok: true });
      const journal = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "SETTLEMENT", sourceId: feeSplitSettlementId } },
        include: { lines: true },
      });
      expect(journal.lines).toHaveLength(7);
      const totalDebit = journal.lines.reduce((sum, l) => sum + Number(l.debit), 0);
      const totalCredit = journal.lines.reduce((sum, l) => sum + Number(l.credit), 0);
      expect(totalDebit).toBe(totalCredit);
      const byAccount = new Map(journal.lines.map((l) => [l.chartAccountId, Number(l.debit)]));
      expect(byAccount.get(feeAdminAccountId)).toBe(8_684.73);
      expect(byAccount.get(feeServiceAccountId)).toBe(10_982.1);
      expect(byAccount.get(feeCommissionAccountId)).toBe(3_086.78);
      expect(byAccount.get(feeProcessingAccountId)).toBe(464.18);
      expect(byAccount.get(feeOtherAccountId)).toBe(394.18);
    } finally {
      await teardownSettlementJournal(feeSplitSettlementId);
    }
  });

  it("falls back to the legacy lumped fee account when category roles are unmapped", async () => {
    const feeSplitSettlementId = await seedSettlementWithLines({
      totalPendapatan: 10_000,
      totalPengeluaran: -2_000,
      totalDilepas: 8_000,
      lines: [{ biayaAdministrasi: -1_000, biayaLayanan: -1_000, biayaKomisiAms: 0, biayaProsesPesanan: 0 }],
    });
    /* Only the legacy role is mapped — the categories this settlement actually hits are absent. */
    await clearAccountMapping("MARKETPLACE_FEE_ADMIN");
    await clearAccountMapping("MARKETPLACE_FEE_SERVICE");
    await clearAccountMapping("MARKETPLACE_FEE_OTHER");

    try {
      const res = await postSettlementJournal(feeSplitSettlementId, adminId, prisma);

      expect(res).toMatchObject({ ok: true });
      const journal = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "SETTLEMENT", sourceId: feeSplitSettlementId } },
        include: { lines: true },
      });
      const feeLines = journal.lines.filter((l) => l.chartAccountId === feeId);
      expect(feeLines).toHaveLength(2);
      expect(feeLines.reduce((sum, l) => sum + Number(l.debit), 0)).toBe(2_000);
    } finally {
      await teardownSettlementJournal(feeSplitSettlementId);
    }
  });

  it("reports the category role, not the legacy fallback, when both are unmapped", async () => {
    const feeSplitSettlementId = await seedSettlementWithLines({
      totalPendapatan: 10_000,
      totalPengeluaran: -1_000,
      totalDilepas: 9_000,
      lines: [{ biayaAdministrasi: -1_000, biayaLayanan: 0, biayaKomisiAms: 0, biayaProsesPesanan: 0 }],
    });
    /* Neither the category the settlement hits nor the legacy fallback is mapped. */
    await clearAccountMapping("MARKETPLACE_FEE_ADMIN");
    await clearAccountMapping("MARKETPLACE_FEE");

    try {
      const res = await postSettlementJournal(feeSplitSettlementId, adminId, prisma);

      expect(res).toMatchObject({
        ok: false,
        code: "UNMAPPED_ROLE",
        role: "MARKETPLACE_FEE_ADMIN",
      });
    } finally {
      await teardownSettlementJournal(feeSplitSettlementId);
    }
  });

  it("mixes fallback and directly-mapped fee accounts across the five roles", async () => {
    /*
     * ADMIN and SERVICE are unmapped (fall back to the legacy MARKETPLACE_FEE
     * account); COMMISSION, PROCESSING, and the OTHER residual stay mapped
     * to their own accounts. All five categories carry a nonzero amount so a
     * role<->account cross-wiring bug (e.g. COMMISSION's amount landing on
     * PROCESSING's account) would be caught. The `memo` stamp (one per
     * category role) disambiguates the two lines that share `feeId`.
     */
    const feeSplitSettlementId = await seedSettlementWithLines({
      totalPendapatan: 10_000,
      totalPengeluaran: -3_000,
      totalDilepas: 7_000,
      lines: [{ biayaAdministrasi: -1_200, biayaLayanan: -800, biayaKomisiAms: -500, biayaProsesPesanan: -300 }],
    });
    await clearAccountMapping("MARKETPLACE_FEE_ADMIN");
    await clearAccountMapping("MARKETPLACE_FEE_SERVICE");

    try {
      const res = await postSettlementJournal(feeSplitSettlementId, adminId, prisma);

      expect(res).toMatchObject({ ok: true });
      const journal = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "SETTLEMENT", sourceId: feeSplitSettlementId } },
        include: { lines: true },
      });
      expect(journal.lines).toHaveLength(7);
      const totalDebit = journal.lines.reduce((sum, l) => sum + Number(l.debit), 0);
      const totalCredit = journal.lines.reduce((sum, l) => sum + Number(l.credit), 0);
      expect(totalDebit).toBe(totalCredit);

      const byMemo = new Map(journal.lines.map((l) => [l.memo, l]));
      const adminLine = byMemo.get("MARKETPLACE_FEE_ADMIN")!;
      const serviceLine = byMemo.get("MARKETPLACE_FEE_SERVICE")!;
      const commissionLine = byMemo.get("MARKETPLACE_FEE_COMMISSION")!;
      const processingLine = byMemo.get("MARKETPLACE_FEE_PROCESSING")!;
      const otherLine = byMemo.get("MARKETPLACE_FEE_OTHER")!;

      expect(adminLine.chartAccountId).toBe(feeId);
      expect(Number(adminLine.debit)).toBe(1_200);
      expect(serviceLine.chartAccountId).toBe(feeId);
      expect(Number(serviceLine.debit)).toBe(800);
      expect(commissionLine.chartAccountId).toBe(feeCommissionAccountId);
      expect(Number(commissionLine.debit)).toBe(500);
      expect(processingLine.chartAccountId).toBe(feeProcessingAccountId);
      expect(Number(processingLine.debit)).toBe(300);
      expect(otherLine.chartAccountId).toBe(feeOtherAccountId);
      expect(Number(otherLine.debit)).toBe(200);
    } finally {
      await teardownSettlementJournal(feeSplitSettlementId);
    }
  });

  it("puts every fee in the residual line when no fee column is itemized", async () => {
    /* TikTok shape: the parser zeroes all four fee columns. */
    const feeSplitSettlementId = await seedSettlementWithLines({
      totalPendapatan: 10_000,
      totalPengeluaran: -1_500,
      totalDilepas: 8_500,
      lines: [{ biayaAdministrasi: 0, biayaLayanan: 0, biayaKomisiAms: 0, biayaProsesPesanan: 0 }],
    });

    try {
      const res = await postSettlementJournal(feeSplitSettlementId, adminId, prisma);

      expect(res).toMatchObject({ ok: true });
      const journal = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "SETTLEMENT", sourceId: feeSplitSettlementId } },
        include: { lines: true },
      });
      expect(journal.lines).toHaveLength(3);
      const otherLine = journal.lines.find((l) => l.chartAccountId === feeOtherAccountId);
      expect(otherLine).toBeDefined();
      expect(Number(otherLine!.debit)).toBe(1_500);
    } finally {
      await teardownSettlementJournal(feeSplitSettlementId);
    }
  });
});
