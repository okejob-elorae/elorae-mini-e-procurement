import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createVendorPayment, voidVendorPayment, VENDOR_PAYMENTS_CLOSED } from "./payment-writer";
import { deriveBillStatus } from "./status";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../finance/journals/mapping-test-fixture";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("Vendor payment writer (test bed only)", () => {
  let tag = "";
  const ids = { user: "", supplierType: "", supplier: "", other: "", billA: "", billB: "", foreign: "", ap: "", bank: "", cash: "" };
  let mappingSnapshot: MappingSnapshot;

  beforeEach(async () => {
    tag = `VP${Math.floor(Math.random() * 10_000_000)}`;
    mappingSnapshot = await snapshotMappings(["AP", "BANK", "CASH"]);
    ids.user = (await prisma.user.create({ data: { email: `${tag}@test.local`, name: "Test Finance" } })).id;
    ids.supplierType = (await prisma.supplierType.create({ data: { code: `ST-${tag}`, name: "Test Type" } })).id;
    ids.supplier = (await prisma.supplier.create({ data: { code: `SUP-${tag}`, name: "Test CMT", typeId: ids.supplierType } })).id;
    ids.other = (await prisma.supplier.create({ data: { code: `SUP2-${tag}`, name: "Other", typeId: ids.supplierType } })).id;
    const bill = (no: string, supplierId: string, total: number) =>
      prisma.vendorBill.create({
        data: { docNumber: `BILL-${tag}-${no}`, supplierId, vendorInvoiceNo: `INV-${tag}-${no}`, billDate: new Date("2026-10-20"), total, createdById: ids.user },
      });
    ids.billA = (await bill("A", ids.supplier, 100_000)).id;
    ids.billB = (await bill("B", ids.supplier, 50_000)).id;
    ids.foreign = (await bill("F", ids.other, 10_000)).id;

    const account = (n: number, name: string, type: "LIABILITAS" | "ASET") =>
      prisma.chartAccount.create({ data: { code: `9${tag}${n}`, name, type, depth: 1, isActive: true } });
    ids.ap = (await account(1, "Hutang (test)", "LIABILITAS")).id;
    ids.bank = (await account(2, "Bank (test)", "ASET")).id;
    ids.cash = (await account(3, "Kas (test)", "ASET")).id;
    for (const [role, chartAccountId] of [["AP", ids.ap], ["BANK", ids.bank], ["CASH", ids.cash]] as const) {
      await prisma.journalAccountMapping.upsert({ where: { role }, create: { role, chartAccountId }, update: { chartAccountId } });
    }
  });

  afterEach(async () => {
    // seededId refuses an unset id, so a failed fixture hook cannot turn these into whole-table deletes.
    if (ids.user) {
      const journals = await prisma.journal.findMany({ where: { postedById: seededId(ids.user) }, select: { id: true } });
      if (journals.length > 0) {
        await prisma.journalLine.deleteMany({ where: { journalId: { in: journals.map((j) => seededId(j.id)) } } });
        await prisma.journal.deleteMany({ where: { id: { in: journals.map((j) => seededId(j.id)) } } });
      }
    }
    await restoreMappings(mappingSnapshot);
    const suppliers = [ids.supplier, ids.other].filter(Boolean);
    if (suppliers.length > 0) {
      await prisma.vendorPaymentAllocation.deleteMany({ where: { payment: { supplierId: { in: suppliers.map(seededId) } } } });
      await prisma.vendorPayment.deleteMany({ where: { supplierId: { in: suppliers.map(seededId) } } });
      await prisma.vendorBill.deleteMany({ where: { supplierId: { in: suppliers.map(seededId) } } });
    }
    const accounts = [ids.ap, ids.bank, ids.cash].filter(Boolean);
    if (accounts.length > 0) await prisma.chartAccount.deleteMany({ where: { id: { in: accounts.map(seededId) } } });
    if (suppliers.length > 0) await prisma.supplier.deleteMany({ where: { id: { in: suppliers.map(seededId) } } });
    if (ids.supplierType) await prisma.supplierType.deleteMany({ where: { id: seededId(ids.supplierType) } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: seededId(ids.user) } });
    Object.keys(ids).forEach((k) => (ids[k as keyof typeof ids] = ""));
  });

  const billOf = (id: string) => prisma.vendorBill.findUniqueOrThrow({ where: { id } });
  const journalOf = (paymentId: string, sourceType = "VENDOR_PAYMENT") =>
    prisma.journal.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId: paymentId } }, include: { lines: true } });

  /** A vendor payment made before they closed, as the old writer left it: allocations, bill balances, Dr AP / Cr Bank or Kas. */
  let seq = 0;
  async function oldPayment(allocations: Array<{ billId: string; amount: number }>, method: "BANK" | "CASH" = "BANK") {
    const amount = allocations.reduce((s, a) => s + a.amount, 0);
    seq += 1;
    const p = await prisma.vendorPayment.create({
      data: {
        docNumber: `VPAY-${tag}-${seq}`,
        supplierId: ids.supplier,
        paidAt: new Date("2026-10-25"),
        method,
        amount,
        createdById: ids.user,
        allocations: { create: allocations },
      },
      select: { id: true },
    });
    for (const a of allocations) {
      const b = await billOf(a.billId);
      const paid = Number(b.paidAmount) + a.amount;
      await prisma.vendorBill.update({ where: { id: a.billId }, data: { paidAmount: paid, status: deriveBillStatus(Number(b.total), paid, false) } });
    }
    await prisma.journal.create({
      data: {
        date: new Date("2026-10-25"),
        description: `Pembayaran vendor uji ${tag}`,
        sourceType: "VENDOR_PAYMENT",
        sourceId: p.id,
        postedById: ids.user,
        lines: {
          create: [
            { chartAccountId: ids.ap, debit: amount, credit: 0 },
            { chartAccountId: method === "CASH" ? ids.cash : ids.bank, debit: 0, credit: amount },
          ],
        },
      },
    });
    return p.id;
  }

  it("refuses every new payment, pointing to Supplier payments, and writes nothing", async () => {
    await expect(createVendorPayment()).rejects.toMatchObject({ code: VENDOR_PAYMENTS_CLOSED });
    await expect(createVendorPayment()).rejects.toThrow("Pembayaran pemasok");
    expect(await prisma.vendorPayment.count({ where: { supplierId: ids.supplier } })).toBe(0);
    const [a, b] = [await billOf(ids.billA), await billOf(ids.billB)];
    expect([a.status, Number(a.paidAmount), b.status, Number(b.paidAmount)]).toEqual(["UNPAID", 0, "UNPAID", 0]);
  });

  it("voids an old payment: bills back to unpaid, journal reversed", async () => {
    const id = await oldPayment([
      { billId: ids.billA, amount: 40_000 },
      { billId: ids.billB, amount: 50_000 },
    ]);
    expect((await billOf(ids.billB)).status).toBe("PAID");
    await voidVendorPayment(id, "salah rekening", ids.user);
    const [a, b] = [await billOf(ids.billA), await billOf(ids.billB)];
    expect([a.status, Number(a.paidAmount), b.status, Number(b.paidAmount)]).toEqual(["UNPAID", 0, "UNPAID", 0]);
    const rev = await journalOf(id, "VENDOR_PAYMENT_REVERSAL");
    expect(rev!.lines.find((l) => l.chartAccountId === ids.bank)?.debit.toString()).toBe("90000");
    expect(rev!.lines.find((l) => l.chartAccountId === ids.ap)?.credit.toString()).toBe("90000");
    await expect(voidVendorPayment(id, "lagi", ids.user)).rejects.toThrow("sudah dibatalkan");
  });

  it("reverses onto the accounts the payment hit, dated on the void", async () => {
    const id = await oldPayment([{ billId: ids.billB, amount: 50_000 }], "CASH");
    // Re-point CASH after paying: the reversal must still debit the account the payment credited.
    await prisma.journalAccountMapping.update({ where: { role: "CASH" }, data: { chartAccountId: ids.bank } });
    await voidVendorPayment(id, "salah rekening", ids.user);
    const voided = await prisma.vendorPayment.findUniqueOrThrow({ where: { id } });
    const rev = await journalOf(id, "VENDOR_PAYMENT_REVERSAL");
    expect(rev!.date.toISOString()).toBe(voided.voidedAt!.toISOString());
    expect(rev!.lines.find((l) => l.chartAccountId === ids.cash)?.debit.toString()).toBe("50000");
    expect(rev!.lines.some((l) => l.chartAccountId === ids.bank)).toBe(false);
  });

  it("lets only one of two concurrent voids of the same payment land", async () => {
    const id = await oldPayment([{ billId: ids.billA, amount: 60_000 }]);
    const results = await Promise.allSettled([
      voidVendorPayment(id, "dobel 1", ids.user),
      voidVendorPayment(id, "dobel 2", ids.user),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const a = await billOf(ids.billA);
    expect([a.status, Number(a.paidAmount)]).toEqual(["UNPAID", 0]);
    expect(await prisma.journal.count({ where: { sourceType: "VENDOR_PAYMENT_REVERSAL", sourceId: seededId(id) } })).toBe(1);
  });
});
