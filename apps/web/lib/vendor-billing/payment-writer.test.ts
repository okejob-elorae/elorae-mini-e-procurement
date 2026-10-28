import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createVendorPayment, voidVendorPayment } from "./payment-writer";
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

  const base = () => ({ supplierId: ids.supplier, paidAt: new Date("2026-10-25"), method: "BANK" as const });
  const billOf = (id: string) => prisma.vendorBill.findUniqueOrThrow({ where: { id } });
  const journalOf = (paymentId: string, sourceType = "VENDOR_PAYMENT") =>
    prisma.journal.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId: paymentId } }, include: { lines: true } });

  it("pays two bills in one payment and posts Dr AP / Cr Bank", async () => {
    const p = await createVendorPayment(
      { ...base(), allocations: [{ billId: ids.billA, amount: 100_000 }, { billId: ids.billB, amount: 20_000 }] },
      ids.user
    );
    expect(p.docNumber).toMatch(/^VPAY\//);
    const [a, b] = [await billOf(ids.billA), await billOf(ids.billB)];
    expect([a.status, Number(a.paidAmount)]).toEqual(["PAID", 100_000]);
    expect([b.status, Number(b.paidAmount)]).toEqual(["PARTIAL", 20_000]);

    const j = await journalOf(p.id);
    expect(j?.date.toISOString()).toBe(new Date("2026-10-25").toISOString());
    expect(j!.lines.map((l) => [l.chartAccountId, Number(l.debit), Number(l.credit)]).sort()).toEqual(
      [
        [ids.ap, 120_000, 0],
        [ids.bank, 0, 120_000],
      ].sort()
    );
  });

  it("credits Kas for a cash payment", async () => {
    const p = await createVendorPayment({ ...base(), method: "CASH", allocations: [{ billId: ids.billB, amount: 50_000 }] }, ids.user);
    const j = await journalOf(p.id);
    expect(j!.lines.find((l) => l.chartAccountId === ids.cash)?.credit.toString()).toBe("50000");
  });

  it("refuses an over-allocation, another supplier's bill and a paid bill", async () => {
    await expect(createVendorPayment({ ...base(), allocations: [{ billId: ids.billB, amount: 50_001 }] }, ids.user)).rejects.toThrow(
      "melebihi sisa"
    );
    await expect(createVendorPayment({ ...base(), allocations: [{ billId: ids.foreign, amount: 1 }] }, ids.user)).rejects.toThrow(
      "bukan milik supplier ini"
    );
    await createVendorPayment({ ...base(), allocations: [{ billId: ids.billB, amount: 50_000 }] }, ids.user);
    await expect(createVendorPayment({ ...base(), allocations: [{ billId: ids.billB, amount: 1 }] }, ids.user)).rejects.toThrow(
      "tidak bisa dibayar"
    );
    expect(await prisma.vendorPayment.count({ where: { supplierId: ids.supplier } })).toBe(1);
  });

  it("voids a payment: bills back to unpaid, journal reversed", async () => {
    const p = await createVendorPayment(
      { ...base(), allocations: [{ billId: ids.billA, amount: 40_000 }, { billId: ids.billB, amount: 50_000 }] },
      ids.user
    );
    await voidVendorPayment(p.id, "salah rekening", ids.user);
    const [a, b] = [await billOf(ids.billA), await billOf(ids.billB)];
    expect([a.status, Number(a.paidAmount), b.status, Number(b.paidAmount)]).toEqual(["UNPAID", 0, "UNPAID", 0]);
    const rev = await journalOf(p.id, "VENDOR_PAYMENT_REVERSAL");
    expect(rev!.lines.find((l) => l.chartAccountId === ids.bank)?.debit.toString()).toBe("90000");
    await expect(voidVendorPayment(p.id, "lagi", ids.user)).rejects.toThrow("sudah dibatalkan");
  });

  it("lets only one of two concurrent payments settle the same bill", async () => {
    const results = await Promise.allSettled([
      createVendorPayment({ ...base(), allocations: [{ billId: ids.billB, amount: 50_000 }] }, ids.user),
      createVendorPayment({ ...base(), allocations: [{ billId: ids.billB, amount: 50_000 }] }, ids.user),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(Number((await billOf(ids.billB)).paidAmount)).toBe(50_000);
  });
});
