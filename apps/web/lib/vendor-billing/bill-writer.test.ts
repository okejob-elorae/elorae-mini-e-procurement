import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { periksaAlokasiTerhadapSisa } from "@/lib/purchasing/pembayaran-aturan";
import { bacaHutangPemasok, petaSisaDokumen } from "@/lib/purchasing/pembayaran-hutang-queries";
import { createVendorBill, voidVendorBill, VOID_WOULD_OVERPAY } from "./bill-writer";
import { listBillableSources, oldestBookedBillDateByWo } from "./billable";
import { createVendorPayment, VENDOR_PAYMENTS_CLOSED } from "./payment-writer";
import { getVendorBillDetail, listVendorBills } from "./queries";
import { snapshotMappings, restoreMappings, type MappingSnapshot } from "../finance/journals/mapping-test-fixture";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("Vendor bill writer (test bed only)", () => {
  let tag = "";
  const ids = {
    user: "", supplierType: "", supplier: "", other: "", uom: "", fabric: "", fabric2: "", fg: "",
    po: "", poItem: "", grn: "", wo: "", step: "", receipt: "", service: "", ap: "",
  };
  let mulai = new Date();
  const grnIds: string[] = [];
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
    ids.fabric2 = (await item("FAB2", "FABRIC")).id;
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
    mulai = new Date();

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
    // The step's 80 pieces came in on a finished-goods receipt that booked their CMT payable.
    ids.receipt = (
      await prisma.fGReceipt.create({
        data: {
          docNumber: `RCPT-${tag}`,
          woId: ids.wo,
          receiptType: "GENERIC",
          qtyReceived: 80,
          qtyAccepted: 80,
          materialCost: 0,
          serviceCost: 960_000,
          additionalCost: 0,
          totalCostValue: 960_000,
          receivedById: ids.user,
        },
        select: { id: true },
      })
    ).id;

    ids.service = (await prisma.chartAccount.create({ data: { code: `9${tag}1`, name: "Biaya Jasa (test)", type: "HPP", depth: 1, isActive: true } })).id;
    ids.ap = (await prisma.chartAccount.create({ data: { code: `9${tag}2`, name: "Hutang (test)", type: "LIABILITAS", depth: 1, isActive: true } })).id;
    for (const [role, chartAccountId] of [["PRODUCTION_SERVICE_COST", ids.service], ["AP", ids.ap]] as const) {
      await prisma.journalAccountMapping.upsert({ where: { role }, create: { role, chartAccountId }, update: { chartAccountId } });
    }
    // The PO's 120 received pieces came in on one GRN whose journal booked 5.400.000 of AP (45.000 per piece).
    ids.grn = await grnWithJournal("A", [{ itemId: ids.fabric, qty: 120 }], 5_400_000);
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
      const bills = await prisma.vendorBill.findMany({ where: { supplierId: { in: suppliers.map(seededId) } }, select: { id: true } });
      const billIds = new Set(bills.map((b) => b.id));
      // The price-difference bells this spec's bills wrote (matched in JS: JSON-path filters are unreliable here).
      const bells = await prisma.adminNotification.findMany({
        where: { category: "VENDOR_BILL_PRICE_DIFFERENCE", createdAt: { gte: mulai } },
        select: { id: true, metadata: true },
      });
      const milik = bells.filter((n) => billIds.has(String((n.metadata as { billId?: unknown } | null)?.billId ?? ""))).map((n) => seededId(n.id));
      if (milik.length > 0) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milik) } } });
      await prisma.supplierPayableCorrection.deleteMany({ where: { supplierId: { in: suppliers.map(seededId) } } });
      await prisma.vendorBillLine.deleteMany({ where: { bill: { supplierId: { in: suppliers.map(seededId) } } } });
      await prisma.vendorBill.deleteMany({ where: { supplierId: { in: suppliers.map(seededId) } } });
    }
    if (ids.user) await prisma.auditLog.deleteMany({ where: { userId: seededId(ids.user) } });
    if (ids.wo) {
      await prisma.fGReceipt.deleteMany({ where: { woId: seededId(ids.wo) } });
      await prisma.workOrderStep.deleteMany({ where: { woId: seededId(ids.wo) } });
      await prisma.workOrder.deleteMany({ where: { id: seededId(ids.wo) } });
    }
    if (grnIds.length > 0) await prisma.gRN.deleteMany({ where: { id: { in: grnIds.map(seededId) } } });
    grnIds.length = 0;
    if (ids.po) {
      await prisma.pOItem.deleteMany({ where: { poId: seededId(ids.po) } });
      await prisma.purchaseOrder.deleteMany({ where: { id: seededId(ids.po) } });
    }
    const accounts = [ids.service, ids.ap].filter(Boolean);
    if (accounts.length > 0) await prisma.chartAccount.deleteMany({ where: { id: { in: accounts.map(seededId) } } });
    const items = [ids.fabric, ids.fabric2, ids.fg].filter(Boolean);
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
  /** 50 of the step's 80 pieces came in before receipts booked CMT; the other 30 were booked at receipt (360.000). */
  const useOldPieces = async (receivedAt = new Date()) => {
    await prisma.fGReceipt.update({
      where: { id: seededId(ids.receipt) },
      data: { qtyReceived: 30, qtyAccepted: 30, serviceCost: 360_000, totalCostValue: 360_000, receivedAt },
    });
    await prisma.fGReceipt.create({
      data: { docNumber: `RCPT0-${tag}`, woId: ids.wo, receiptType: "GENERIC", qtyReceived: 50, qtyAccepted: 50, receivedById: ids.user },
    });
  };
  /** A GRN of the fixture PO with the lines it brought in (one unit cost: AP ÷ pieces) and the AP its journal booked. */
  const grnWithJournal = async (no: string, lines: Array<{ itemId: string; qty: number }>, ap: number) => {
    const g = await prisma.gRN.create({
      data: {
        docNumber: `GRN-${tag}-${no}`,
        supplierId: ids.supplier,
        poId: ids.po,
        receivedBy: ids.user,
        totalAmount: ap,
        items: lines.map((l) => {
          const unitCost = Math.round((ap / lines.reduce((t, x) => t + x.qty, 0)) * 100) / 100;
          return { itemId: l.itemId, variantSku: null, qty: l.qty, unitCost, totalCost: Math.round(l.qty * unitCost * 100) / 100 };
        }),
      },
      select: { id: true },
    });
    grnIds.push(g.id);
    await prisma.journal.create({
      data: {
        date: new Date("2026-10-19"),
        description: `GRN uji ${tag}`,
        sourceType: "GRN",
        sourceId: g.id,
        postedById: ids.user,
        lines: {
          create: [
            { chartAccountId: ids.service, debit: ap, credit: 0 },
            { chartAccountId: ids.ap, debit: 0, credit: ap },
          ],
        },
      },
    });
    return g.id;
  };

  it("lists received GRN items and WO steps, and drops what is fully billed", async () => {
    const before = await listBillableSources(ids.supplier);
    expect(before.grnItems.map((i) => [i.grnId, i.remainingQty, i.recordedPrice, i.poItemId])).toEqual([[ids.grn, 120, 45_000, ids.poItem]]);
    expect(before.woSteps.map((s) => [s.woStepId, s.remainingQty])).toEqual([[ids.step, 80]]);

    await createVendorBill({ ...base(), lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 80, price: 12_000 }] }, ids.user);
    const after = await listBillableSources(ids.supplier);
    expect(after.woSteps).toEqual([]);
    expect(after.grnItems).toHaveLength(1);
  });

  it("posts no journal for GRN lines or for step work a finished-goods receipt booked, and holds the step's price difference", async () => {
    const bill = await createVendorBill(
      {
        ...base(),
        lines: [
          { type: "GRN_ITEM", grnId: ids.grn, itemId: ids.fabric, variantSku: null, qty: 120, price: 45_000 },
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
    // The billed price stays beside the step's service price, so the variance is visible.
    expect(saved.lines.find((l) => l.type === "WO_STEP")?.refPrice.toString()).toBe("12000");
    expect(saved.lines.find((l) => l.type === "WO_STEP")?.price.toString()).toBe("12500");
    expect(saved.lines.find((l) => l.type === "GRN_ITEM")?.refPrice.toString()).toBe("45000");
    expect(saved.lines.find((l) => l.type === "GRN_ITEM")?.poItemId).toBe(ids.poItem);

    expect(await journalOf(bill.id)).toBeNull();
    // 12.500 against the WO's 12.000 on 80 booked pieces waits for a decision (P27); the GRN line matches.
    expect(bill.koreksi).toBe(1);
    const k = await prisma.supplierPayableCorrection.findMany({ where: { billId: bill.id } });
    expect(k.map((x) => [x.sourceType, x.status, Number(x.qty)])).toEqual([["WO_STEP", "MENUNGGU", 80]]);
    expect(bill.notifikasi?.category).toBe("VENDOR_BILL_PRICE_DIFFERENCE");
  });

  it("posts no journal for a bill of GRN lines only", async () => {
    const bill = await createVendorBill({ ...base(), lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.fabric, variantSku: null, qty: 50, price: 45_000 }] }, ids.user);
    expect(await journalOf(bill.id)).toBeNull();
  });

  it("refuses over-billing and a foreign supplier's line, and bills a PO already marked paid", async () => {
    await expect(
      createVendorBill({ ...base(), lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.fabric, variantSku: null, qty: 121, price: 45_000 }] }, ids.user)
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

    // Paid before its invoice came: the bill only matches the invoice, so it is still billable, flagged.
    await prisma.purchaseOrder.update({ where: { id: ids.po }, data: { paidAt: new Date() } });
    expect((await listBillableSources(ids.supplier)).grnItems.map((i) => [i.grnId, i.poPaid])).toEqual([[ids.grn, true]]);
    const paidPo = await createVendorBill(
      { ...base(), vendorInvoiceNo: `INV3-${tag}`, lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.fabric, variantSku: null, qty: 1, price: 45_000 }] },
      ids.user
    );
    expect(await journalOf(paidPo.id)).toBeNull();
  });

  it("refuses a vendor invoice number already used for this supplier", async () => {
    await createVendorBill({ ...base(), lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.fabric, variantSku: null, qty: 1, price: 45_000 }] }, ids.user);
    await expect(
      createVendorBill({ ...base(), lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.fabric, variantSku: null, qty: 1, price: 45_000 }] }, ids.user)
    ).rejects.toThrow("sudah dipakai");
  });

  it("lets a voided bill's invoice number be entered again", async () => {
    const first = await createVendorBill({ ...base(), lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.fabric, variantSku: null, qty: 1, price: 45_000 }] }, ids.user);
    await voidVendorBill(first.id, "salah harga", ids.user);
    const again = await createVendorBill({ ...base(), lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.fabric, variantSku: null, qty: 1, price: 44_000 }] }, ids.user);
    expect(again.id).not.toBe(first.id);
  });

  it("holds only the GRN whose over-receive awaits the owner, or whose missing PO awaits the admin", async () => {
    const pending = await prisma.gRN.create({
      data: {
        docNumber: `GRN-${tag}-OVER`,
        supplierId: ids.supplier,
        poId: ids.po,
        receivedBy: ids.user,
        totalAmount: 225_000,
        items: [{ itemId: ids.fabric, variantSku: null, qty: 5, unitCost: 45_000, totalCost: 225_000 }],
        requiresOwnerApproval: true,
      },
    });
    grnIds.push(pending.id);
    const noPo = await prisma.gRN.create({
      data: {
        docNumber: `GRN-${tag}-NOPO`,
        supplierId: ids.supplier,
        receivedBy: ids.user,
        totalAmount: 90_000,
        items: [{ itemId: ids.fabric, variantSku: null, qty: 2, unitCost: 45_000, totalCost: 90_000 }],
        requiresNoPoConfirmation: true,
      },
    });
    grnIds.push(noPo.id);
    const rows = (await listBillableSources(ids.supplier)).grnItems;
    expect(rows.find((i) => i.grnId === pending.id)?.terhalang).toBe("MENUNGGU_PEMILIK");
    expect(rows.find((i) => i.grnId === noPo.id)?.terhalang).toBe("MENUNGGU_KONFIRMASI");
    expect(rows.find((i) => i.grnId === noPo.id)?.poDocNumber).toBeNull();
    await expect(
      createVendorBill({ ...base(), lines: [{ type: "GRN_ITEM", grnId: pending.id, itemId: ids.fabric, variantSku: null, qty: 1, price: 45_000 }] }, ids.user)
    ).rejects.toMatchObject({ code: "GRN_MENUNGGU_PEMILIK" });
    await expect(
      createVendorBill({ ...base(), lines: [{ type: "GRN_ITEM", grnId: noPo.id, itemId: ids.fabric, variantSku: null, qty: 1, price: 45_000 }] }, ids.user)
    ).rejects.toMatchObject({ code: "GRN_MENUNGGU_KONFIRMASI" });
    // A sibling GRN of the same PO stays billable.
    const ok = await createVendorBill({ ...base(), lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.fabric, variantSku: null, qty: 1, price: 45_000 }] }, ids.user);
    expect(ok.koreksi).toBe(0);

    // Confirmed by the admin: billable like any receipt.
    await prisma.gRN.update({ where: { id: noPo.id }, data: { noPoConfirmedAt: new Date() } });
    const confirmed = await createVendorBill(
      { ...base(), vendorInvoiceNo: `INVN-${tag}`, lines: [{ type: "GRN_ITEM", grnId: noPo.id, itemId: ids.fabric, variantSku: null, qty: 2, price: 45_000 }] },
      ids.user
    );
    expect(confirmed.id).toBeTruthy();
  });

  it("refuses the old PO item line shape and a GRN that never received the item", async () => {
    await expect(
      createVendorBill({ ...base(), lines: [{ type: "PO_ITEM", sourceId: ids.poItem, qty: 1, price: 45_000 }] } as never, ids.user)
    ).rejects.toThrow();
    await expect(
      createVendorBill({ ...base(), lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.fabric2, variantSku: null, qty: 1, price: 45_000 }] }, ids.user)
    ).rejects.toMatchObject({ code: "GRN_TANPA_BARANG_INI" });
  });

  it("creates a waiting correction both ways and none at the recorded price (P27, P53)", async () => {
    const naik = await createVendorBill({ ...base(), lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.fabric, variantSku: null, qty: 10, price: 45_500 }] }, ids.user);
    const turun = await createVendorBill(
      { ...base(), vendorInvoiceNo: `INVT-${tag}`, lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.fabric, variantSku: null, qty: 10, price: 44_500 }] },
      ids.user
    );
    const pas = await createVendorBill(
      { ...base(), vendorInvoiceNo: `INVP-${tag}`, lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.fabric, variantSku: null, qty: 10, price: 45_000 }] },
      ids.user
    );
    const jumlah = async (billId: string) => (await prisma.supplierPayableCorrection.findMany({ where: { billId } })).map((k) => [k.status, Number(k.amount)]);
    expect(await jumlah(naik.id)).toEqual([["MENUNGGU", 5_000]]);
    expect(await jumlah(turun.id)).toEqual([["MENUNGGU", -5_000]]);
    expect(await jumlah(pas.id)).toEqual([]);
    expect(pas.notifikasi).toBeNull();
    // A waiting correction never reads PAID, even when the receipt is paid at the recorded price.
    await voidVendorBill(naik.id, "uji", ids.user);
    expect(await jumlah(naik.id)).toEqual([["DIBATALKAN", 5_000]]);
  });

  it("saves a bill of booked step work while the service cost account is unmapped, since it posts nothing", async () => {
    await prisma.journalAccountMapping.deleteMany({ where: { role: "PRODUCTION_SERVICE_COST" } });
    const bill = await createVendorBill({ ...base(), lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 10, price: 12_000 }] }, ids.user);
    expect(await prisma.vendorBill.count({ where: { supplierId: ids.supplier } })).toBe(1);
    expect(await journalOf(bill.id)).toBeNull();
  });

  it("books the CMT payable for step work no finished-goods receipt booked, and only for it", async () => {
    await useOldPieces();

    await prisma.journalAccountMapping.deleteMany({ where: { role: "PRODUCTION_SERVICE_COST" } });
    await expect(
      createVendorBill({ ...base(), lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 60, price: 12_500 }] }, ids.user)
    ).rejects.toThrow("Petakan akun untuk PRODUCTION_SERVICE_COST");
    expect(await prisma.vendorBill.count({ where: { supplierId: ids.supplier } })).toBe(0);
    await prisma.journalAccountMapping.create({ data: { role: "PRODUCTION_SERVICE_COST", chartAccountId: ids.service } });

    const first = await createVendorBill({ ...base(), lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 60, price: 12_500 }] }, ids.user);
    const posted = await journalOf(first.id);
    expect(posted!.lines.find((l) => l.chartAccountId === ids.service)?.debit.toString()).toBe("625000");
    expect(posted!.lines.find((l) => l.chartAccountId === ids.ap)?.credit.toString()).toBe("625000");

    // The first bill holds the 50 unbooked pieces, so the rest of the step books nothing more.
    const second = await createVendorBill(
      { ...base(), vendorInvoiceNo: `INV6-${tag}`, lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 20, price: 12_000 }] },
      ids.user
    );
    expect(await journalOf(second.id)).toBeNull();

    // Voiding mirrors what the bill posted, not its whole step amount (60 × 12.500).
    await voidVendorBill(first.id, "salah harga", ids.user);
    const rev = await journalOf(first.id, "VENDOR_BILL_REVERSAL");
    expect(rev!.lines.find((l) => l.chartAccountId === ids.ap)?.debit.toString()).toBe("625000");
    expect(rev!.lines.find((l) => l.chartAccountId === ids.service)?.credit.toString()).toBe("625000");
  });

  it("does not bill a WO step before a finished-goods receipt has accepted its work", async () => {
    // `receiveFG` stamps the step's qty; a WO with no receipt yet leaves it null.
    await prisma.workOrderStep.update({ where: { id: seededId(ids.step) }, data: { qty: null } });
    expect((await listBillableSources(ids.supplier)).woSteps).toEqual([]);
    await expect(
      createVendorBill({ ...base(), lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 1, price: 12_000 }] }, ids.user)
    ).rejects.toThrow("melebihi sisa");
  });

  it("voids a bill and frees the qty, reversing nothing for a bill that never posted", async () => {
    const bill = await createVendorBill({ ...base(), lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 80, price: 12_000 }] }, ids.user);
    await voidVendorBill(bill.id, "salah input", ids.user);
    expect((await prisma.vendorBill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe("VOID");
    expect(await journalOf(bill.id, "VENDOR_BILL_REVERSAL")).toBeNull();
    expect((await listBillableSources(ids.supplier)).woSteps.map((s) => s.remainingQty)).toEqual([80]);
    await expect(voidVendorBill(bill.id, "lagi", ids.user)).rejects.toThrow("sudah dibatalkan");
  });

  it("still reverses the journal of a bill saved before bills stopped posting one, and refuses a bill with a live payment", async () => {
    const bill = await createVendorBill({ ...base(), lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 80, price: 12_000 }] }, ids.user);
    // What such a bill posted then: Dr service cost / Cr AP for its WO step lines.
    await prisma.journal.create({
      data: {
        date: new Date("2026-10-20"),
        description: `Vendor bill (legacy) ${tag}`,
        sourceType: "VENDOR_BILL",
        sourceId: bill.id,
        postedById: ids.user,
        lines: {
          create: [
            { chartAccountId: ids.service, debit: 960_000, credit: 0 },
            { chartAccountId: ids.ap, debit: 0, credit: 960_000 },
          ],
        },
      },
    });
    await voidVendorBill(bill.id, "salah input", ids.user);
    const rev = await journalOf(bill.id, "VENDOR_BILL_REVERSAL");
    expect(rev!.lines.find((l) => l.chartAccountId === ids.ap)?.debit.toString()).toBe("960000");

    const paid = await createVendorBill(
      { ...base(), vendorInvoiceNo: `INV4-${tag}`, lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.fabric, variantSku: null, qty: 10, price: 45_000 }] },
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

  /** A Supplier payments → Pay document (BYR) as its writer leaves it: posted, allocated to receipts. */
  const supplierPayment = (no: string, allocations: Array<{ targetType: "WO_STEP" | "GRN"; targetId: string; amount: number }>) =>
    prisma.supplierPayment.create({
      data: {
        docNumber: `BYR-${tag}-${no}`,
        supplierId: ids.supplier,
        date: new Date("2026-10-22"),
        grossAmount: allocations.reduce((s, a) => s + a.amount, 0),
        netAmount: allocations.reduce((s, a) => s + a.amount, 0),
        createdById: ids.user,
        allocations: { create: allocations },
      },
      select: { id: true },
    });
  const dropSupplierPayments = async (paymentIds: string[]) => {
    if (paymentIds.length === 0) return;
    await prisma.supplierPaymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds.map(seededId) } } });
    await prisma.supplierPayment.deleteMany({ where: { id: { in: paymentIds.map(seededId) } } });
  };
  const readBill = async (id: string) => {
    const b = await getVendorBillDetail(id);
    return b ? [b.status, b.paidAmount, b.vendorPaidAmount, b.supplierPaidAmount] : null;
  };

  it("takes no vendor payment any more", async () => {
    await createVendorBill({ ...base(), lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 10, price: 12_000 }] }, ids.user);
    await expect(createVendorPayment()).rejects.toMatchObject({ code: VENDOR_PAYMENTS_CLOSED });
    expect(await prisma.vendorPayment.count({ where: { supplierId: ids.supplier } })).toBe(0);
  });

  it("reads a bill as paid from what Supplier payments paid on its receipts, and still voids a bill that booked nothing", async () => {
    const stepBill = await createVendorBill({ ...base(), lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 10, price: 12_000 }] }, ids.user);
    const poBill = await createVendorBill(
      { ...base(), vendorInvoiceNo: `INV5-${tag}`, lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.fabric, variantSku: null, qty: 10, price: 45_000 }] },
      ids.user
    );
    const grn = ids.grn;
    const paid: string[] = [];
    try {
      paid.push(
        (
          await supplierPayment("1", [
            { targetType: "WO_STEP", targetId: ids.step, amount: 50_000 },
            { targetType: "GRN", targetId: grn, amount: 450_000 },
          ])
        ).id
      );
      // 50.000 of the step's 960.000 goes to its only invoice line; the GRN's 450.000 covers the 10 invoiced pieces.
      expect(await readBill(stepBill.id)).toEqual(["PARTIAL", 50_000, 0, 50_000]);
      expect(await readBill(poBill.id)).toEqual(["PAID", 450_000, 0, 450_000]);
      // The stored columns still say what Vendor Billing paid: nothing.
      expect((await prisma.vendorBill.findUniqueOrThrow({ where: { id: poBill.id } })).status).toBe("UNPAID");

      const listed = await listVendorBills({ supplierId: ids.supplier });
      expect(listed.map((b) => [b.docNumber, b.status]).sort()).toEqual(
        [
          [stepBill.docNumber, "PARTIAL"],
          [poBill.docNumber, "PAID"],
        ].sort()
      );
      expect((await listVendorBills({ supplierId: ids.supplier, status: "PAID" })).map((b) => b.id)).toEqual([poBill.id]);
      expect(await listVendorBills({ supplierId: ids.supplier, status: "UNPAID" })).toEqual([]);

      // Neither bill booked a payable, so voiding moves none: a wrongly entered invoice is voided and entered again.
      expect((await getVendorBillDetail(poBill.id))?.voidBlockedReceipts).toEqual([]);
      await voidVendorBill(poBill.id, "nomor invoice salah", ids.user);
      expect(await journalOf(poBill.id, "VENDOR_BILL_REVERSAL")).toBeNull();
      const corrected = await createVendorBill(
        { ...base(), vendorInvoiceNo: `INV10-${tag}`, lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.fabric, variantSku: null, qty: 10, price: 45_000 }] },
        ids.user
      );
      expect(await readBill(corrected.id)).toEqual(["PAID", 450_000, 0, 450_000]);

      // Cancelling the supplier payment hands the bills back.
      await prisma.supplierPayment.update({ where: { id: seededId(paid[0]) }, data: { status: "CANCELLED" } });
      expect(await readBill(stepBill.id)).toEqual(["UNPAID", 0, 0, 0]);
      await voidVendorBill(stepBill.id, "salah input", ids.user);
    } finally {
      await dropSupplierPayments(paid);
    }
  });

  it("pays by value per receipt, oldest INVOICE DATE first, never goods no invoice names (P20, P29)", async () => {
    // Two invoices on the one GRN: the later-recorded one carries the earlier paper date.
    const lateRecorded = await createVendorBill(
      { ...base(), vendorInvoiceNo: `INV-B-${tag}`, billDate: new Date("2026-10-03"), lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.fabric, variantSku: null, qty: 20, price: 45_000 }] },
      ids.user
    );
    const earlyRecorded = await createVendorBill(
      { ...base(), vendorInvoiceNo: `INV-A-${tag}`, billDate: new Date("2026-10-05"), lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.fabric, variantSku: null, qty: 20, price: 45_000 }] },
      ids.user
    );
    await prisma.vendorBill.update({ where: { id: lateRecorded.id }, data: { createdAt: new Date(Date.now() + 60_000) } });
    const paid: string[] = [];
    try {
      paid.push((await supplierPayment("D", [{ targetType: "GRN", targetId: ids.grn, amount: 1_200_000 }])).id);
      // 900.000 to the invoice dated 3 Oct, then 300.000 of the one dated 5 Oct; 80 pieces nobody billed take nothing.
      expect(await readBill(lateRecorded.id)).toEqual(["PAID", 900_000, 0, 900_000]);
      expect(await readBill(earlyRecorded.id)).toEqual(["PARTIAL", 300_000, 0, 300_000]);
    } finally {
      await dropSupplierPayments(paid);
    }
  });

  it("never reads PAID while a lower invoice still waits for its decision (P53)", async () => {
    const bill = await createVendorBill({ ...base(), lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.fabric, variantSku: null, qty: 10, price: 44_000 }] }, ids.user);
    const paid: string[] = [];
    try {
      paid.push((await supplierPayment("L", [{ targetType: "GRN", targetId: ids.grn, amount: 5_400_000 }])).id);
      expect((await readBill(bill.id))?.[0]).toBe("PARTIAL");
    } finally {
      await dropSupplierPayments(paid);
    }
  });

  it("refuses voiding a bill whose old CMT Supplier payments paid past what the step owes without it", async () => {
    await useOldPieces();
    const bill = await createVendorBill({ ...base(), lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 60, price: 12_500 }] }, ids.user);
    const paid: string[] = [];
    try {
      // The step owes 360.000 (receipt) + 625.000 (this bill). 500.000 paid would be 140.000 over once the bill is gone.
      paid.push((await supplierPayment("V1", [{ targetType: "WO_STEP", targetId: ids.step, amount: 500_000 }])).id);
      await expect(voidVendorBill(bill.id, "salah harga", ids.user)).rejects.toMatchObject({ code: VOID_WOULD_OVERPAY });
      expect(await journalOf(bill.id, "VENDOR_BILL_REVERSAL")).toBeNull();
      expect((await prisma.vendorBill.findUniqueOrThrow({ where: { id: bill.id } })).status).not.toBe("VOID");
      expect((await getVendorBillDetail(bill.id))?.voidBlockedReceipts).toEqual([`WO-${tag} step 1 Jahit`]);

      // 300.000 fits inside the 360.000 the receipt booked, so voiding no longer overpays the step.
      await prisma.supplierPayment.update({ where: { id: seededId(paid[0]) }, data: { status: "CANCELLED" } });
      paid.push((await supplierPayment("V2", [{ targetType: "WO_STEP", targetId: ids.step, amount: 300_000 }])).id);
      expect((await getVendorBillDetail(bill.id))?.voidBlockedReceipts).toEqual([]);
      await voidVendorBill(bill.id, "salah harga", ids.user);
      const rev = await journalOf(bill.id, "VENDOR_BILL_REVERSAL");
      expect(rev!.lines.find((l) => l.chartAccountId === ids.ap)?.debit.toString()).toBe("625000");
    } finally {
      await dropSupplierPayments(paid);
    }
  });

  it("lets only one of a void and a supplier payment on the same old CMT through when they race", async () => {
    await useOldPieces();
    const space = `uji-vb-${tag}`;
    const made: string[] = [];
    // What the Supplier payments writer checks before it allocates, in its own serializable transaction.
    const payLikeTheWriter = (no: string) =>
      runSerializable(
        async (tx) => {
          const h = await bacaHutangPemasok({ supplierIds: [ids.supplier], ruangSaldoAwal: space }, tx);
          const cek = periksaAlokasiTerhadapSisa([{ jenis: "WO_STEP", id: ids.step, sen: 50_000_000 }], petaSisaDokumen(h.pemasok[0]));
          if (!cek.ok) return null;
          const p = await tx.supplierPayment.create({
            data: {
              docNumber: `BYR-${tag}-${no}`,
              supplierId: ids.supplier,
              date: new Date("2026-10-22"),
              grossAmount: 500_000,
              netAmount: 500_000,
              createdById: ids.user,
              allocations: { create: [{ targetType: "WO_STEP", targetId: ids.step, amount: 500_000 }] },
            },
            select: { id: true },
          });
          return p.id;
        },
        { timeout: 20_000 }
      );
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      // Each order once, the later one started a few ms after, so neither always reaches its write first.
      for (const [round, voidAfter, payAfter] of [
        [1, 0, 10],
        [2, 10, 0],
      ] as const) {
        const bill = await createVendorBill(
          { ...base(), vendorInvoiceNo: `INVR${round}-${tag}`, lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 60, price: 12_500 }] },
          ids.user
        );
        expect((await journalOf(bill.id))?.lines.find((l) => l.chartAccountId === ids.ap)?.credit.toString()).toBe("625000");
        const [voided, paid] = await Promise.allSettled([
          sleep(voidAfter).then(() => voidVendorBill(bill.id, "balapan", ids.user)),
          sleep(payAfter).then(() => payLikeTheWriter(`R${round}`)),
        ]);
        expect(paid.status).toBe("fulfilled");
        const paymentId = paid.status === "fulfilled" ? paid.value : null;
        if (paymentId) made.push(paymentId);
        // Serially either order lets exactly one through: paid first, the void would overpay the step;
        // voided first, 500.000 no longer fits in the 360.000 left.
        expect(voided.status === "fulfilled").toBe(paymentId == null);
        if (voided.status === "rejected") expect(voided.reason).toMatchObject({ code: VOID_WOULD_OVERPAY });
        if (paymentId) {
          await dropSupplierPayments([paymentId]);
          await voidVendorBill(bill.id, "bersihkan", ids.user);
        }
      }
    } finally {
      await dropSupplierPayments(made);
    }
  });

  it("ages old CMT from the oldest live bill that booked it when that came before the receipt that booked CMT", async () => {
    await useOldPieces(new Date("2026-10-15T03:00:00.000Z"));
    const space = `uji-vb-${tag}`;
    const ageOf = async () =>
      (await bacaHutangPemasok({ supplierIds: [ids.supplier], ruangSaldoAwal: space })).pemasok[0]?.dokumen.find(
        (x) => x.jenis === "WO_STEP" && x.id === ids.step
      )?.tanggal;

    // A bill dated after the receipt that booked CMT leaves the receipt's date.
    const late = await createVendorBill(
      { ...base(), billDate: new Date("2026-10-20"), lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 60, price: 12_500 }] },
      ids.user
    );
    expect(await ageOf()).toBe("2026-10-15");

    // An earlier bill booking the old pieces dates the debt from itself.
    await voidVendorBill(late.id, "tanggal salah", ids.user);
    const early = await createVendorBill(
      { ...base(), vendorInvoiceNo: `INVE-${tag}`, billDate: new Date("2026-10-01"), lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 60, price: 12_500 }] },
      ids.user
    );
    expect((await oldestBookedBillDateByWo(prisma, [ids.wo])).get(ids.wo)?.toISOString()).toBe(new Date("2026-10-01").toISOString());
    expect(await ageOf()).toBe("2026-10-01");

    // A live bill whose booking was reversed books nothing any more, so it no longer dates the debt.
    await prisma.journal.create({
      data: {
        date: new Date("2026-10-21"),
        description: `Vendor bill void uji ${tag}`,
        sourceType: "VENDOR_BILL_REVERSAL",
        sourceId: early.id,
        postedById: ids.user,
        lines: {
          create: [
            { chartAccountId: ids.ap, debit: 625_000, credit: 0 },
            { chartAccountId: ids.service, debit: 0, credit: 625_000 },
          ],
        },
      },
    });
    expect((await oldestBookedBillDateByWo(prisma, [ids.wo])).has(ids.wo)).toBe(false);
    expect(await ageOf()).toBe("2026-10-15");
  });

  it("pays the oldest invoice first and never counts what an old vendor payment paid twice", async () => {
    const first = await createVendorBill({ ...base(), lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 30, price: 12_000 }] }, ids.user);
    const second = await createVendorBill(
      { ...base(), vendorInvoiceNo: `INV7-${tag}`, lines: [{ type: "WO_STEP", sourceId: ids.step, qty: 20, price: 12_000 }] },
      ids.user
    );
    // 100.000 of the first bill (360.000) was paid through Vendor Billing before it closed.
    const old = await prisma.vendorPayment.create({
      data: {
        docNumber: `VPAY7-${tag}`,
        supplierId: ids.supplier,
        paidAt: new Date("2026-10-21"),
        method: "BANK",
        amount: 100_000,
        createdById: ids.user,
        allocations: { create: { billId: first.id, amount: 100_000 } },
      },
      select: { id: true },
    });
    await prisma.vendorBill.update({ where: { id: first.id }, data: { paidAmount: 100_000, status: "PARTIAL" } });
    const paid: string[] = [];
    try {
      paid.push((await supplierPayment("7", [{ targetType: "WO_STEP", targetId: ids.step, amount: 400_000 }])).id);
      // The first bill takes the 260.000 it still owed; the rest of the 400.000 goes to the second.
      expect(await readBill(first.id)).toEqual(["PAID", 360_000, 100_000, 260_000]);
      expect(await readBill(second.id)).toEqual(["PARTIAL", 140_000, 0, 140_000]);
      expect((await listVendorBills({ supplierId: ids.supplier, status: "PAID" })).map((b) => b.id)).toEqual([first.id]);
      expect((await listVendorBills({ supplierId: ids.supplier, status: "PARTIAL" })).map((b) => b.id)).toEqual([second.id]);
    } finally {
      await dropSupplierPayments(paid);
      await prisma.vendorPaymentAllocation.deleteMany({ where: { paymentId: seededId(old.id) } });
      await prisma.vendorPayment.deleteMany({ where: { id: seededId(old.id) } });
    }
  });

  it("reads a PO paid through the old toggle as paying its bills, until the toggle is reversed", async () => {
    const bill = await createVendorBill({ ...base(), lines: [{ type: "GRN_ITEM", grnId: ids.grn, itemId: ids.fabric, variantSku: null, qty: 10, price: 45_000 }] }, ids.user);
    // The toggle paid 450.000 of the payable the PO's receipts booked; FIFO puts it on the fixture GRN.
    const toggle = (sourceType: string, debitAccount: string, creditAccount: string) =>
      prisma.journal.create({
        data: {
          date: new Date("2026-10-23"),
          description: `Tandai lunas uji ${tag}`,
          sourceType,
          sourceId: `${ids.po}#1`,
          postedById: ids.user,
          lines: {
            create: [
              { chartAccountId: debitAccount, debit: 450_000, credit: 0 },
              { chartAccountId: creditAccount, debit: 0, credit: 450_000 },
            ],
          },
        },
      });
    await toggle("SUPPLIER_PAYMENT", ids.ap, ids.service);
    expect(await readBill(bill.id)).toEqual(["PAID", 450_000, 0, 450_000]);
    await toggle("SUPPLIER_PAYMENT_REVERSAL", ids.service, ids.ap);
    expect(await readBill(bill.id)).toEqual(["UNPAID", 0, 0, 0]);
  });
});
