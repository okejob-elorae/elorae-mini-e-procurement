import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { postPaymentReceiptJournal, postPaymentVoidJournal } from "./payment-journal";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../journals/mapping-test-fixture";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const paidAt = new Date("2026-03-01T00:00:00.000+07:00");

d("payment-journal debitRole (test bed only)", () => {
  let token = 0;
  let storeId = "";
  let userId = "";
  let paymentId = "";
  let cashId = "";
  let bankId = "";
  let revId = "";
  let arId = "";
  let mappingSnapshot: MappingSnapshot;

  beforeEach(async () => {
    token = Math.floor(Math.random() * 1_000_000);
    storeId = ""; userId = ""; paymentId = "";
    mappingSnapshot = await snapshotMappings(["CASH", "BANK", "SALES_REVENUE", "AR"]);

    const store = await prisma.store.create({
      data: { code: `TEST-PJ-${token}`, name: "test", address: "test", termsType: "PUTUS" },
    });
    storeId = store.id;
    const user = await prisma.user.create({
      data: { email: `pj-${token}@test.local`, name: "test", role: "ADMIN" },
    });
    userId = user.id;

    const mk = async (code: string, type: "ASET" | "PENDAPATAN") =>
      (await prisma.chartAccount.create({ data: { code, name: "t", type, depth: 1, isActive: true } })).id;
    cashId = await mk(`9${token}1`, "ASET");
    bankId = await mk(`9${token}2`, "ASET");
    revId = await mk(`9${token}3`, "PENDAPATAN");
    arId = await mk(`9${token}4`, "ASET");
    const map = async (role: string, id: string) =>
      prisma.journalAccountMapping.upsert({
        where: { role: role as never },
        create: { role: role as never, chartAccountId: id },
        update: { chartAccountId: id },
      });
    await map("CASH", cashId);
    await map("BANK", bankId);
    await map("SALES_REVENUE", revId);
    await map("AR", arId);
  });

  afterEach(async () => {
    await restoreMappings(mappingSnapshot);
    await prisma.journalLine.deleteMany({ where: { journal: { sourceId: paymentId || "none" } } });
    await prisma.journal.deleteMany({ where: { sourceId: paymentId || "none" } });
    await prisma.payment.deleteMany({ where: { storeId: storeId || "none" } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: [cashId, bankId, revId, arId].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { id: userId || "none" } });
    await prisma.store.deleteMany({ where: { id: storeId || "none" } });
  });

  async function createPayment(method: "CASH" | "TRANSFER" | "RETUR_OFFSET", amount: number): Promise<string> {
    const p = await prisma.payment.create({
      data: { docNo: `TEST-PJ-DOC-${token}`, storeId, paidAt, method, amount, recordedById: userId },
    });
    return p.id;
  }

  it("debits SALES_REVENUE (not CASH/BANK) for a RETUR_OFFSET receipt", async () => {
    paymentId = await createPayment("RETUR_OFFSET", 500);
    const result = await postPaymentReceiptJournal(paymentId, userId);
    expect(result).toMatchObject({ ok: true });
    const j = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "PAYMENT_RECEIPT", sourceId: paymentId } },
      include: { lines: true },
    });
    expect(Number(j!.lines.find((l) => l.chartAccountId === revId)!.debit)).toBe(500);
    expect(Number(j!.lines.find((l) => l.chartAccountId === arId)!.credit)).toBe(500);
  });

  it("void reversal mirrors it: credits SALES_REVENUE back, debits AR", async () => {
    paymentId = await createPayment("RETUR_OFFSET", 500);
    await postPaymentReceiptJournal(paymentId, userId);
    await prisma.payment.update({ where: { id: paymentId }, data: { status: "VOIDED", voidedAt: new Date() } });
    const result = await postPaymentVoidJournal(paymentId, userId);
    expect(result).toMatchObject({ ok: true });
    const j = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "PAYMENT_VOID", sourceId: paymentId } },
      include: { lines: true },
    });
    expect(Number(j!.lines.find((l) => l.chartAccountId === revId)!.credit)).toBe(500);
    expect(Number(j!.lines.find((l) => l.chartAccountId === arId)!.debit)).toBe(500);
  });

  it("CASH still debits CASH, not SALES_REVENUE (unchanged)", async () => {
    paymentId = await createPayment("CASH", 300);
    await postPaymentReceiptJournal(paymentId, userId);
    const j = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "PAYMENT_RECEIPT", sourceId: paymentId } },
      include: { lines: true },
    });
    expect(Number(j!.lines.find((l) => l.chartAccountId === cashId)!.debit)).toBe(300);
  });

  it("TRANSFER still debits BANK, not SALES_REVENUE (unchanged)", async () => {
    paymentId = await createPayment("TRANSFER", 300);
    await postPaymentReceiptJournal(paymentId, userId);
    const j = await prisma.journal.findUnique({
      where: { sourceType_sourceId: { sourceType: "PAYMENT_RECEIPT", sourceId: paymentId } },
      include: { lines: true },
    });
    expect(Number(j!.lines.find((l) => l.chartAccountId === bankId)!.debit)).toBe(300);
  });
});
