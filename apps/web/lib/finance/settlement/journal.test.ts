import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { postSettlementJournal } from "./journal";
import { GL_CUTOVER_SETTING_KEY } from "../sales/sweep";
import { setAccountMapping, clearAccountMapping } from "../journals/mapping";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../journals/mapping-test-fixture";

// Posts journal + mapping rows — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("postSettlementJournal (test bed only)", () => {
  let token = ""; // unique per file run — digits only (CoA codes are numeric)
  let adminId = "";
  let bankId = "";
  let feeId = "";
  let arId = "";
  let feeAdminAccountId = "";
  let feeServiceAccountId = "";
  let feeCommissionAccountId = "";
  let feeProcessingAccountId = "";
  let feeOtherAccountId = "";
  let settlementId = "";
  let mappingSnapshot: MappingSnapshot | undefined;
  /* The user and chart accounts are seeded once per file; each test gets its own sale, numbered by this counter. */
  let orderSeq = 0;
  let orderNo = "";
  /* `undefined` until this test's snapshot is taken, so a hook that died earlier restores nothing rather than a stale value. */
  let cutoverSnapshot: string | null | undefined;
  /* Set by the only two helpers that change the cutover, so `afterEach` restores it only after a test moved it. */
  let cutoverTouched = false;
  let orderId = "";
  let orderJournalId = "";

  /*
   * The revenue-journal gate needs every line matched to a sales order whose
   * `SALESORDER_REVENUE` journal stands, so each settlement here is matched to
   * one fixture sale (dated 2026-03-02) carrying a bare journal; the gate only
   * checks that the journal exists. The cutover is read only to classify a
   * refusal, so only the tests that refuse on an unjournaled sale set it, and
   * `afterEach` puts back what they found. It is never armed for the whole
   * spec: this bed is shared, and a `next dev` running beside it would let its
   * cron sweep journal real dev orders for as long as the cutover stays set.
   */
  const CUTOVER_BEFORE_THE_SALE = "2026-01-01";
  const CUTOVER_AFTER_THE_SALE = "2026-06-01";

  const writeCutover = async (value: string): Promise<void> => {
    await prisma.systemSetting.upsert({
      where: { key: GL_CUTOVER_SETTING_KEY },
      create: { key: GL_CUTOVER_SETTING_KEY, value },
      update: { value },
    });
  };

  const setCutover = async (value: string): Promise<void> => {
    cutoverTouched = true;
    await writeCutover(value);
  };

  const clearCutover = async (): Promise<void> => {
    cutoverTouched = true;
    await prisma.systemSetting.deleteMany({ where: { key: GL_CUTOVER_SETTING_KEY } });
  };

  async function journalTheOrder(): Promise<void> {
    const journal = await prisma.journal.create({
      data: {
        date: new Date("2026-03-02"),
        description: "fixture",
        sourceType: "SALESORDER_REVENUE",
        sourceId: orderId,
        postedById: adminId,
      },
      select: { id: true },
    });
    orderJournalId = journal.id;
  }

  async function unjournalTheOrder(): Promise<void> {
    await prisma.journal.delete({ where: { id: seededId(orderJournalId) } });
    orderJournalId = "";
  }

  const settlementJournalCount = (): Promise<number> =>
    prisma.journal.count({ where: { sourceType: "SETTLEMENT", sourceId: seededId(settlementId) } });

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
            matchStatus: "MATCHED",
            matchedSalesOrderId: orderId,
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

  const accountIds = () =>
    [bankId, feeId, arId, feeAdminAccountId, feeServiceAccountId, feeCommissionAccountId, feeProcessingAccountId, feeOtherAccountId].map(seededId);

  /* Collects every teardown failure instead of stopping at the first, so one failed delete cannot strand the rest. */
  const isolated = () => {
    const failures: string[] = [];
    const step = async (what: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        failures.push(`${what}: ${String(e)}`);
      }
    };
    return { failures, step };
  };

  beforeAll(async () => {
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

  });

  beforeEach(async () => {
    orderId = "";
    orderJournalId = "";
    settlementId = "";
    cutoverSnapshot = undefined;
    cutoverTouched = false;
    const setting = await prisma.systemSetting.findUnique({
      where: { key: GL_CUTOVER_SETTING_KEY },
      select: { value: true },
    });
    cutoverSnapshot = setting?.value ?? null;
    orderSeq += 1;
    orderNo = `SO-STL-${token}-${orderSeq}`;

    /* Several tests clear category roles, so every test re-points all eight. */
    await setAccountMapping("BANK", bankId);
    await setAccountMapping("MARKETPLACE_FEE", feeId);
    await setAccountMapping("AR", arId);
    await setAccountMapping("MARKETPLACE_FEE_ADMIN", feeAdminAccountId);
    await setAccountMapping("MARKETPLACE_FEE_SERVICE", feeServiceAccountId);
    await setAccountMapping("MARKETPLACE_FEE_COMMISSION", feeCommissionAccountId);
    await setAccountMapping("MARKETPLACE_FEE_PROCESSING", feeProcessingAccountId);
    await setAccountMapping("MARKETPLACE_FEE_OTHER", feeOtherAccountId);

    /* Negative Jubelio id: real `salesorderId`s on the shared bed are positive, so this cannot collide with one. */
    const order = await prisma.salesOrder.create({
      data: {
        salesorderId: -(1_000_000_000 + Number(token) * 100 + orderSeq),
        salesorderNo: orderNo,
        channel: "SHOPEE",
        sourceName: "t",
        status: "COMPLETED",
        subTotal: 1000,
        totalDisc: 0,
        totalTax: 0,
        shippingCost: 0,
        grandTotal: 1000,
        transactionDate: new Date("2026-03-01"),
        shippedAt: new Date("2026-03-02"),
      },
      select: { id: true },
    });
    orderId = order.id;
    await journalTheOrder();

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
        lines: {
          create: [
            {
              orderNo,
              netIncome: 1000,
              hargaAsliProduk: 0,
              totalDiskonProduk: 0,
              biayaAdministrasi: 0,
              biayaLayanan: 0,
              biayaKomisiAms: 0,
              biayaProsesPesanan: 0,
              raw: {},
              matchStatus: "MATCHED",
              matchedSalesOrderId: orderId,
            },
          ],
        },
      },
      select: { id: true },
    });
    settlementId = settlement.id;
  });

  afterEach(async () => {
    const { failures, step } = isolated();
    /* Live config first: the dev cron arms itself off the cutover, so no delete below may stand between a failure and restoring it. */
    if (cutoverTouched) {
      const snapshot = cutoverSnapshot;
      await step("cutover", async () => {
        if (snapshot === null) {
          await prisma.systemSetting.deleteMany({ where: { key: GL_CUTOVER_SETTING_KEY } });
        } else if (snapshot !== undefined) {
          await writeCutover(snapshot);
        }
      });
    }
    await step("settlement journal", async () => {
      const journal = await prisma.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: "SETTLEMENT", sourceId: seededId(settlementId) } },
        select: { id: true },
      });
      if (journal) {
        await prisma.journalLine.deleteMany({ where: { journalId: journal.id } });
        await prisma.journal.delete({ where: { id: journal.id } });
      }
    });
    await step("settlement", () => prisma.settlement.deleteMany({ where: { id: seededId(settlementId) } }));
    await step("order journal", () =>
      prisma.journal.deleteMany({ where: { sourceType: "SALESORDER_REVENUE", sourceId: seededId(orderId) } }),
    );
    await step("order", () => prisma.salesOrder.deleteMany({ where: { id: seededId(orderId) } }));
    if (failures.length > 0) throw new Error(failures.join(" | "));
  });

  afterAll(async () => {
    const { failures, step } = isolated();
    /* Mappings first: they point the shared bed's live roles at throwaway accounts until restored. */
    if (mappingSnapshot === undefined) {
      failures.push("mapping snapshot was never taken");
    } else {
      const snapshot = mappingSnapshot;
      await step(`restoreMappings (→ ${JSON.stringify(snapshot)})`, () => restoreMappings(snapshot));
    }
    await step("chartAccount.deleteMany", () => prisma.chartAccount.deleteMany({ where: { id: { in: accountIds() } } }));
    await step("user.deleteMany", () => prisma.user.deleteMany({ where: { id: seededId(adminId) } }));
    if (failures.length > 0) {
      console.error(
        "[settlement/journal.test.ts] teardown failed — JournalAccountMapping may still point at throwaway test accounts. " +
          "Check Finance → Pemetaan Akun on the :3308 dev DB and re-map by hand if needed.",
        failures,
      );
      throw new Error(failures.join(" | "));
    }
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
        /* One line matched to the journaled fixture sale, or the revenue gate refuses a line-less settlement. TikTok shape: fee columns zeroed. */
        lines: {
          create: [
            {
              orderNo,
              netIncome: 4500,
              hargaAsliProduk: 0,
              totalDiskonProduk: 0,
              biayaAdministrasi: 0,
              biayaLayanan: 0,
              biayaKomisiAms: 0,
              biayaProsesPesanan: 0,
              raw: {},
              matchStatus: "MATCHED",
              matchedSalesOrderId: orderId,
            },
          ],
        },
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

  it("omits the bank line instead of throwing BAD_LINE when totalDilepas is exactly zero", async () => {
    /* A fully refunded period: nothing released, expenses equal income. */
    await prisma.settlement.update({
      where: { id: settlementId },
      data: { totalPendapatan: 500, totalPengeluaran: 500, totalDilepas: 0, parsedNetTotal: 0 },
    });
    const r = await postSettlementJournal(settlementId, adminId, prisma);
    expect(r).toMatchObject({ ok: true, created: true });

    const j = await prisma.journal.findUniqueOrThrow({
      where: { sourceType_sourceId: { sourceType: "SETTLEMENT", sourceId: settlementId } },
      include: { lines: true },
    });
    expect(j.lines).toHaveLength(2);
    expect(j.lines.some((l) => l.chartAccountId === bankId)).toBe(false);
    expect(j.lines.reduce((sum, l) => sum + Number(l.debit) - Number(l.credit), 0)).toBe(0);
  });

  it("returns UNBALANCED instead of throwing BAD_LINE when totalPendapatan is exactly zero", async () => {
    await prisma.settlement.update({
      where: { id: settlementId },
      data: { totalPendapatan: 0, totalPengeluaran: 0, totalDilepas: 500, parsedNetTotal: 500 },
    });
    const r = await postSettlementJournal(settlementId, adminId, prisma);
    expect(r).toMatchObject({ ok: false, code: "UNBALANCED" });

    const s = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(s.status).toBe("MATCHED");
  });

  it("returns NOTHING_TO_POST and leaves the settlement untouched when every total is zero", async () => {
    await prisma.settlement.update({
      where: { id: settlementId },
      data: { totalPendapatan: 0, totalPengeluaran: 0, totalDilepas: 0, parsedNetTotal: 0 },
    });
    const r = await postSettlementJournal(settlementId, adminId, prisma);
    expect(r).toEqual({ ok: false, code: "NOTHING_TO_POST" });

    const journal = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "SETTLEMENT", sourceId: settlementId } },
    });
    expect(journal).toBeNull();
    const s = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(s.status).toBe("MATCHED");
  });

  it("refuses LINES_UNMATCHED when a line has no matched order, posting nothing", async () => {
    await prisma.settlementLine.updateMany({
      where: { settlementId },
      data: { matchStatus: "UNMATCHED", matchedSalesOrderId: null },
    });
    const r = await postSettlementJournal(settlementId, adminId, prisma);
    expect(r).toEqual({ ok: false, code: "LINES_UNMATCHED", count: 1 });
    expect(await settlementJournalCount()).toBe(0);
    const s = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(s.status).toBe("MATCHED");
  });

  it("refuses ORIGINAL_SALE_NOT_JOURNALED_YET when the matched sale is inside the ledger but unswept", async () => {
    await unjournalTheOrder();
    await setCutover(CUTOVER_BEFORE_THE_SALE);
    const r = await postSettlementJournal(settlementId, adminId, prisma);
    expect(r).toEqual({ ok: false, code: "ORIGINAL_SALE_NOT_JOURNALED_YET", count: 1 });
    expect(await settlementJournalCount()).toBe(0);
  });

  it("refuses ORIGINAL_SALE_OUTSIDE_LEDGER when the matched sale predates the cutover", async () => {
    await unjournalTheOrder();
    await setCutover(CUTOVER_AFTER_THE_SALE);
    const r = await postSettlementJournal(settlementId, adminId, prisma);
    expect(r).toEqual({ ok: false, code: "ORIGINAL_SALE_OUTSIDE_LEDGER", count: 1 });
    expect(await settlementJournalCount()).toBe(0);
  });

  it("refuses GL_CUTOVER_NOT_CONFIGURED when no cutover is set", async () => {
    await unjournalTheOrder();
    await clearCutover();
    const r = await postSettlementJournal(settlementId, adminId, prisma);
    expect(r).toEqual({ ok: false, code: "GL_CUTOVER_NOT_CONFIGURED", count: 1 });
    expect(await settlementJournalCount()).toBe(0);
  });

  it("reports the permanent refusal ahead of an unmatched line", async () => {
    await unjournalTheOrder();
    await setCutover(CUTOVER_AFTER_THE_SALE);
    await prisma.settlementLine.create({
      data: {
        settlementId,
        orderNo: `${orderNo}-unmatched`,
        netIncome: 0,
        hargaAsliProduk: 0,
        totalDiskonProduk: 0,
        biayaAdministrasi: 0,
        biayaLayanan: 0,
        biayaKomisiAms: 0,
        biayaProsesPesanan: 0,
        raw: {},
      },
    });
    const r = await postSettlementJournal(settlementId, adminId, prisma);
    expect(r).toEqual({ ok: false, code: "ORIGINAL_SALE_OUTSIDE_LEDGER", count: 1 });
    expect(await settlementJournalCount()).toBe(0);
  });

  it("posts on retry once the refused sale is journaled, and flips RECONCILED", async () => {
    await unjournalTheOrder();
    await setCutover(CUTOVER_BEFORE_THE_SALE);
    expect(await postSettlementJournal(settlementId, adminId, prisma)).toMatchObject({
      ok: false,
      code: "ORIGINAL_SALE_NOT_JOURNALED_YET",
    });

    await journalTheOrder();
    expect(await postSettlementJournal(settlementId, adminId, prisma)).toMatchObject({ ok: true, created: true });
    const s = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(s.status).toBe("RECONCILED");
  });

  /* A voucher-covered order: nothing to journal on the order, so only the line's own amounts decide. */
  async function zeroTheOrder(): Promise<void> {
    await prisma.salesOrder.update({ where: { id: orderId }, data: { subTotal: 0, grandTotal: 0 } });
  }

  async function zeroTheLines(): Promise<void> {
    await prisma.settlementLine.updateMany({ where: { settlementId: seededId(settlementId) }, data: { netIncome: 0 } });
  }

  it("does not block on a zero-value order whose line carries nothing, before the cutover", async () => {
    await unjournalTheOrder();
    await zeroTheOrder();
    await zeroTheLines();
    await setCutover(CUTOVER_AFTER_THE_SALE);
    expect(await postSettlementJournal(settlementId, adminId, prisma)).toMatchObject({ ok: true, created: true });
  });

  it("does not block on a zero-value order whose line carries nothing, above the cutover", async () => {
    await unjournalTheOrder();
    await zeroTheOrder();
    await zeroTheLines();
    await setCutover(CUTOVER_BEFORE_THE_SALE);
    expect(await postSettlementJournal(settlementId, adminId, prisma)).toMatchObject({ ok: true, created: true });
  });

  it("refuses ORIGINAL_SALE_OUTSIDE_LEDGER for a zero-value order whose line the marketplace still paid income on", async () => {
    await unjournalTheOrder();
    await zeroTheOrder();
    await setCutover(CUTOVER_BEFORE_THE_SALE);
    const r = await postSettlementJournal(settlementId, adminId, prisma);
    expect(r).toEqual({ ok: false, code: "ORIGINAL_SALE_OUTSIDE_LEDGER", count: 1 });
    expect(await settlementJournalCount()).toBe(0);
    const s = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(s.status).toBe("MATCHED");
  });

  it("refuses a zero-value TikTok line, whose stored columns cannot show its fees", async () => {
    await unjournalTheOrder();
    await zeroTheOrder();
    await zeroTheLines();
    await prisma.settlement.update({ where: { id: settlementId }, data: { marketplace: "TIKTOK" } });
    await setCutover(CUTOVER_BEFORE_THE_SALE);
    const r = await postSettlementJournal(settlementId, adminId, prisma);
    expect(r).toEqual({ ok: false, code: "ORIGINAL_SALE_OUTSIDE_LEDGER", count: 1 });
    expect(await settlementJournalCount()).toBe(0);
  });

  it("refuses ORIGINAL_SALE_NOT_SHIPPED when the matched sale is one the sweep will not journal", async () => {
    await unjournalTheOrder();
    await prisma.salesOrder.update({ where: { id: orderId }, data: { status: "PROCESSING", fulfillmentStatus: "PACKED" } });
    await setCutover(CUTOVER_BEFORE_THE_SALE);
    const r = await postSettlementJournal(settlementId, adminId, prisma);
    expect(r).toEqual({ ok: false, code: "ORIGINAL_SALE_NOT_SHIPPED", count: 1 });
    expect(await settlementJournalCount()).toBe(0);
    const s = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(s.status).toBe("MATCHED");
  });

  it("keeps ORIGINAL_SALE_NOT_JOURNALED_YET for an order the sweep admits by its local fulfilment status alone", async () => {
    await unjournalTheOrder();
    await prisma.salesOrder.update({ where: { id: orderId }, data: { status: "PROCESSING", fulfillmentStatus: "SHIPPED" } });
    await setCutover(CUTOVER_BEFORE_THE_SALE);
    const r = await postSettlementJournal(settlementId, adminId, prisma);
    expect(r).toEqual({ ok: false, code: "ORIGINAL_SALE_NOT_JOURNALED_YET", count: 1 });
  });

  it("refuses LINES_UNMATCHED with a count of 0 when the settlement has no lines at all", async () => {
    await prisma.settlementLine.deleteMany({ where: { settlementId: seededId(settlementId) } });
    const r = await postSettlementJournal(settlementId, adminId, prisma);
    expect(r).toEqual({ ok: false, code: "LINES_UNMATCHED", count: 0 });
    expect(await settlementJournalCount()).toBe(0);
    const s = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(s.status).toBe("MATCHED");
  });

  it("reports CHECKSUM_BLOCKED and NOTHING_TO_POST ahead of the gate", async () => {
    await prisma.settlementLine.updateMany({
      where: { settlementId },
      data: { matchStatus: "UNMATCHED", matchedSalesOrderId: null },
    });
    await prisma.settlement.update({ where: { id: settlementId }, data: { checksumOk: false } });
    expect(await postSettlementJournal(settlementId, adminId, prisma)).toMatchObject({
      ok: false,
      code: "CHECKSUM_BLOCKED",
    });

    await prisma.settlement.update({
      where: { id: settlementId },
      data: { checksumOk: true, totalPendapatan: 0, totalPengeluaran: 0, totalDilepas: 0, parsedNetTotal: 0 },
    });
    expect(await postSettlementJournal(settlementId, adminId, prisma)).toEqual({ ok: false, code: "NOTHING_TO_POST" });
  });
});
