import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createVendorBill, voidVendorBill } from "./bill-writer";
import { listBillableSources } from "./billable";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../finance/journals/mapping-test-fixture";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("Vendor bill writer (test bed only)", () => {
  let tag = "";
  const ids = {
    user: "", supplierType: "", supplier: "", other: "", uom: "", fabric: "", fg: "",
    po: "", poItem: "", wo: "", step: "", service: "", ap: "",
  };
  let mappingSnapshot: MappingSnapshot;

  beforeEach(async () => {
    tag = `VB${Math.floor(Math.random() * 10_000_000)}`;
    mappingSnapshot = await snapshotMappings(["PRODUCTION_SERVICE_COST", "AP"]);
    ids.user = (await prisma.user.create({ data: { email: `${tag}@test.local`, name: "Test Finance" } })).id;
    ids.supplierType = (await prisma.supplierType.create({ data: { code: `ST-${tag}`, name: "Test Type" } })).id;
    ids.supplier = (await prisma.supplier.create({ data: { code: `SUP-${tag}`, name: "Test CMT", typeId: ids.supplierType, paymentTermsDays: 14 } })).id;
    ids.other = (await prisma.supplier.create({ data: { code: `SUP2-${tag}`, name: "Other", typeId: ids.supplierType } })).id;
    ids.uom = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "meter", nameEn: "meter" } })).id;
    const item = (sku: string, type: "FINISHED_GOOD" | "FABRIC") =>
      prisma.item.create({ data: { sku: `${tag}-${sku}`, nameId: `${sku} ${tag}`, nameEn: sku, type, uomId: ids.uom, isActive: true } });
    ids.fabric = (await item("FAB", "FABRIC")).id;
    ids.fg = (await item("FG", "FINISHED_GOOD")).id;

    const po = await prisma.purchaseOrder.create({
      data: {
        docNumber: `PO-${tag}`,
        supplierId: ids.supplier,
        createdById: ids.user,
        status: "PARTIAL",
        paymentTermsDays: 30,
        items: { create: { itemId: ids.fabric, qty: 200, price: 45_000, uomId: ids.uom, receivedQty: 120 } },
      },
      select: { id: true, items: { select: { id: true } } },
    });
    ids.po = po.id;
    ids.poItem = po.items[0].id;

    ids.wo = (
      await prisma.workOrder.create({
        data: {
          docNumber: `WO-${tag}`,
          vendorId: ids.supplier,
          finishedGoodId: ids.fg,
          plannedQty: 100,
          status: "PARTIAL",
          consumptionPlan: [],
          createdById: ids.user,
          steps: { create: { sequence: 1, stepName: "Jahit", supplierId: ids.supplier, servicePrice: 12_000, qty: 80 } },
        },
        select: { id: true },
      })
    ).id;
    ids.step = (await prisma.workOrderStep.findFirstOrThrow({ where: { woId: ids.wo } })).id;

    ids.service = (await prisma.chartAccount.create({ data: { code: `9${tag}1`, name: "Biaya Jasa (test)", type: "HPP", depth: 1, isActive: true } })).id;
    ids.ap = (await prisma.chartAccount.create({ data: { code: `9${tag}2`, name: "Hutang (test)", type: "LIABILITAS", depth: 1, isActive: true } })).id;
    for (const [role, chartAccountId] of [["PRODUCTION_SERVICE_COST", ids.service], ["AP", ids.ap]] as const) {
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
      await prisma.vendorBillLine.deleteMany({ where: { bill: { supplierId: { in: suppliers.map(seededId) } } } });
      await prisma.vendorBill.deleteMany({ where: { supplierId: { in: suppliers.map(seededId) } } });
    }
    if (ids.wo) {
      await prisma.workOrderStep.deleteMany({ where: { woId: seededId(ids.wo) } });
      await prisma.workOrder.deleteMany({ where: { id: seededId(ids.wo) } });
    }
    if (ids.po) {
      await prisma.pOItem.deleteMany({ where: { poId: seededId(ids.po) } });
      await prisma.purchaseOrder.deleteMany({ where: { id: seededId(ids.po) } });
    }
    const accounts = [ids.service, ids.ap].filter(Boolean);
    if (accounts.length > 0) await prisma.chartAccount.deleteMany({ where: { id: { in: accounts.map(seededId) } } });
    const items = [ids.fabric, ids.fg].filter(Boolean);
    if (items.length > 0) await prisma.item.deleteMany({ where: { id: { in: items.map(seededId) } } });
    if (ids.uom) await prisma.uOM.deleteMany({ where: { id: seededId(ids.uom) } });
    if (suppliers.length > 0) await prisma.supplier.deleteMany({ where: { id: { in: suppliers.map(seededId) } } });
    if (ids.supplierType) await prisma.supplierType.deleteMany({ where: { id: seededId(ids.supplierType) } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: seededId(ids.user) } });
    Object.keys(ids).forEach((k) => (ids[k as keyof typeof ids] = ""));
  });

  const base = () => ({ supplierId: ids.supplier, vendorInvoiceNo: `INV-${tag}`, billDate: new Date("2026-10-20") });
  const journalOf = (billId: string, sourceType = "VENDOR_BILL") =>
    prisma.journal.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId: billId } }, include: { lines: true } });

  it("lists received PO items and WO steps, and drops what is fully billed", async () => {
    const before = await listBillableSources(ids.supplier);
    expect(before.poItems.map((i) => [i.poItemId, i.remainingQty])).toEqual([[ids.poItem, 120]]);
    expect(before.woSteps.map((s) => [s.woStepId, s.remainingQty])).toEqual([[ids.step, 80]]);

    await createVendorBill({ ...base(), lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 80, price: 12_000 }] }, ids.user);
    const after = await listBillableSources(ids.supplier);
    expect(after.woSteps).toEqual([]);
    expect(after.poItems).toHaveLength(1);
  });

  it("posts Dr service cost / Cr AP for WO step lines only, dated on the bill", async () => {
    const bill = await createVendorBill(
      {
        ...base(),
        lines: [
          { type: "PO_ITEM", sourceId: ids.poItem, qty: 120, price: 45_000 },
          { type: "WO_STEP", sourceId: ids.step, qty: 80, price: 12_500 },
        ],
      },
      ids.user
    );
    const saved = await prisma.vendorBill.findUniqueOrThrow({ where: { id: bill.id }, include: { lines: true } });
    expect(Number(saved.total)).toBe(120 * 45_000 + 80 * 12_500);
    expect(saved.status).toBe("UNPAID");
    // The linked PO's 30-day terms win over the supplier's 14.
    expect(saved.dueDate?.toISOString()).toBe(new Date("2026-11-19").toISOString());
    expect(saved.lines.find((l) => l.type === "WO_STEP")?.refPrice.toString()).toBe("12000");

    const j = await journalOf(bill.id);
    expect(j?.date.toISOString()).toBe(new Date("2026-10-20").toISOString());
    expect(j!.lines.map((l) => [l.chartAccountId, Number(l.debit), Number(l.credit)]).sort()).toEqual(
      [
        [ids.ap, 0, 1_000_000],
        [ids.service, 1_000_000, 0],
      ].sort()
    );
  });

  it("posts no journal for a bill of PO lines only", async () => {
    const bill = await createVendorBill({ ...base(), lines: [{ type: "PO_ITEM", sourceId: ids.poItem, qty: 50, price: 45_000 }] }, ids.user);
    expect(await journalOf(bill.id)).toBeNull();
  });

  it("refuses over-billing, a foreign supplier's line and a PO paid through the old toggle", async () => {
    await expect(
      createVendorBill({ ...base(), lines: [{ type: "PO_ITEM", sourceId: ids.poItem, qty: 121, price: 45_000 }] }, ids.user)
    ).rejects.toThrow("melebihi sisa");
    await createVendorBill({ ...base(), lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 50, price: 12_000 }] }, ids.user);
    await expect(
      createVendorBill({ ...base(), vendorInvoiceNo: `INV2-${tag}`, lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 31, price: 12_000 }] }, ids.user)
    ).rejects.toThrow("melebihi sisa");

    await expect(
      createVendorBill(
        { ...base(), supplierId: ids.other, lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 1, price: 12_000 }] },
        ids.user
      )
    ).rejects.toThrow("bukan milik supplier ini");

    await prisma.purchaseOrder.update({ where: { id: ids.po }, data: { paidAt: new Date() } });
    await expect(
      createVendorBill({ ...base(), vendorInvoiceNo: `INV3-${tag}`, lines: [{ type: "PO_ITEM", sourceId: ids.poItem, qty: 1, price: 45_000 }] }, ids.user)
    ).rejects.toThrow("sudah ditandai lunas");
  });

  it("refuses a vendor invoice number already used for this supplier", async () => {
    await createVendorBill({ ...base(), lines: [{ type: "PO_ITEM", sourceId: ids.poItem, qty: 1, price: 45_000 }] }, ids.user);
    await expect(
      createVendorBill({ ...base(), lines: [{ type: "PO_ITEM", sourceId: ids.poItem, qty: 1, price: 45_000 }] }, ids.user)
    ).rejects.toThrow("sudah dipakai");
  });

  it("lets a voided bill's invoice number be entered again", async () => {
    const first = await createVendorBill({ ...base(), lines: [{ type: "PO_ITEM", sourceId: ids.poItem, qty: 1, price: 45_000 }] }, ids.user);
    await voidVendorBill(first.id, "salah harga", ids.user);
    const again = await createVendorBill({ ...base(), lines: [{ type: "PO_ITEM", sourceId: ids.poItem, qty: 1, price: 44_000 }] }, ids.user);
    expect(again.id).not.toBe(first.id);
  });

  it("hides and refuses PO lines while an over-receive awaits the owner", async () => {
    const grn = await prisma.gRN.create({
      data: { docNumber: `GRN-${tag}`, supplierId: ids.supplier, poId: ids.po, receivedBy: ids.user, totalAmount: 0, items: [], requiresOwnerApproval: true },
    });
    try {
      expect((await listBillableSources(ids.supplier)).poItems).toEqual([]);
      await expect(
        createVendorBill({ ...base(), lines: [{ type: "PO_ITEM", sourceId: ids.poItem, qty: 1, price: 45_000 }] }, ids.user)
      ).rejects.toThrow("menunggu keputusan owner");

      await prisma.gRN.update({ where: { id: grn.id }, data: { ownerApprovedAt: new Date() } });
      expect((await listBillableSources(ids.supplier)).poItems).toHaveLength(1);
    } finally {
      await prisma.gRN.deleteMany({ where: { id: seededId(grn.id) } });
    }
  });

  it("commits nothing when the service cost account is unmapped", async () => {
    await prisma.journalAccountMapping.deleteMany({ where: { role: "PRODUCTION_SERVICE_COST" } });
    await expect(
      createVendorBill({ ...base(), lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 10, price: 12_000 }] }, ids.user)
    ).rejects.toThrow("Petakan akun untuk PRODUCTION_SERVICE_COST");
    expect(await prisma.vendorBill.count({ where: { supplierId: ids.supplier } })).toBe(0);
  });

  it("voids a bill, reverses its journal and frees the qty; refuses a bill with a live payment", async () => {
    const bill = await createVendorBill({ ...base(), lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 80, price: 12_000 }] }, ids.user);
    await voidVendorBill(bill.id, "salah input", ids.user);
    expect((await prisma.vendorBill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe("VOID");
    const rev = await journalOf(bill.id, "VENDOR_BILL_REVERSAL");
    expect(rev!.lines.find((l) => l.chartAccountId === ids.ap)?.debit.toString()).toBe("960000");
    expect((await listBillableSources(ids.supplier)).woSteps.map((s) => s.remainingQty)).toEqual([80]);
    await expect(voidVendorBill(bill.id, "lagi", ids.user)).rejects.toThrow("sudah dibatalkan");

    const paid = await createVendorBill(
      { ...base(), vendorInvoiceNo: `INV4-${tag}`, lines: [{ type: "PO_ITEM", sourceId: ids.poItem, qty: 10, price: 45_000 }] },
      ids.user
    );
    const payment = await prisma.vendorPayment.create({
      data: {
        docNumber: `VPAY-${tag}`,
        supplierId: ids.supplier,
        paidAt: new Date(),
        method: "BANK",
        amount: 100_000,
        createdById: ids.user,
        allocations: { create: { billId: paid.id, amount: 100_000 } },
      },
    });
    try {
      await expect(voidVendorBill(paid.id, "x", ids.user)).rejects.toThrow("batalkan pembayarannya dulu");
    } finally {
      await prisma.vendorPaymentAllocation.deleteMany({ where: { paymentId: seededId(payment.id) } });
      await prisma.vendorPayment.deleteMany({ where: { id: seededId(payment.id) } });
    }
  });
});
