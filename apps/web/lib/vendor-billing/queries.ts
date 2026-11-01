import { prisma, type Prisma } from "@elorae/db";
import { grnLineKey, readGrnLines } from "./bill-paid-rule";
import type { VendorBillStatus } from "./status";
import { withSupplierPaid } from "./supplier-paid";
import { stepsOverpaidByVoid } from "./void-guard";

/*
 * Every bill read here carries what BOTH payment paths paid on it (`withSupplierPaid`): the old
 * Vendor Billing payments stored on the bill, and its share of what Supplier payments → Pay paid on
 * its receipts — the only payment path since 2026-11-01. `paidAmount` and `status` are those
 * combined figures; `vendorPaidAmount`/`supplierPaidAmount` split them.
 */

export type VendorBillRow = {
  id: string;
  docNumber: string;
  vendorInvoiceNo: string;
  supplier: { id: string; name: string };
  billDate: Date;
  dueDate: Date | null;
  total: number;
  paidAmount: number;
  vendorPaidAmount: number;
  supplierPaidAmount: number;
  status: VendorBillStatus;
};

/**
 * Stored statuses a bill can have and still read as the asked one. The stored status counts vendor
 * payments only and Supplier payments can only add to what is paid, so a bill reads at its stored
 * status or a later one.
 */
const STORED_STATUSES_FOR: Record<Exclude<VendorBillStatus, "VOID">, VendorBillStatus[]> = {
  UNPAID: ["UNPAID"],
  PARTIAL: ["UNPAID", "PARTIAL"],
  PAID: ["UNPAID", "PARTIAL", "PAID"],
};

/** At most this many bills are listed, newest first. */
const LIST_LIMIT = 500;
const BATCH = 500;

/**
 * Bills, newest first. A paid/partly paid/unpaid filter is the status read with Supplier payments,
 * which the database cannot filter on — since Vendor Billing takes no payment, nearly every bill is
 * stored UNPAID — so bills are read in batches until the list is full or the bills run out; the
 * newest matching bills are listed, never just the matches among the newest 500 bills.
 */
export async function listVendorBills(filters: {
  supplierId?: string;
  status?: VendorBillStatus;
  from?: Date;
  to?: Date;
  search?: string;
}): Promise<VendorBillRow[]> {
  const search = filters.search?.trim();
  const wanted = filters.status;
  const where: Prisma.VendorBillWhereInput = {
    ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
    ...(wanted === "VOID" ? { status: "VOID" as const } : wanted ? { status: { in: STORED_STATUSES_FOR[wanted] } } : {}),
    ...(filters.from || filters.to
      ? { billDate: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
      : {}),
    ...(search ? { OR: [{ docNumber: { contains: search } }, { vendorInvoiceNo: { contains: search } }] } : {}),
  };
  const read = async (skip: number, take: number) => {
    const bills = await prisma.vendorBill.findMany({
      where,
      select: {
        id: true,
        docNumber: true,
        vendorInvoiceNo: true,
        billDate: true,
        dueDate: true,
        total: true,
        paidAmount: true,
        status: true,
        supplier: { select: { id: true, name: true } },
      },
      orderBy: [{ billDate: "desc" }, { docNumber: "desc" }, { id: "desc" }],
      skip,
      take,
    });
    const rows = await withSupplierPaid(bills.map((b) => ({ ...b, total: Number(b.total), paidAmount: Number(b.paidAmount) })));
    return { count: bills.length, rows };
  };

  if (!wanted || wanted === "VOID") return (await read(0, LIST_LIMIT)).rows;
  const out: VendorBillRow[] = [];
  for (let skip = 0; out.length < LIST_LIMIT; skip += BATCH) {
    const { count, rows } = await read(skip, BATCH);
    out.push(...rows.filter((r) => r.status === wanted));
    if (count < BATCH) break;
  }
  return out.slice(0, LIST_LIMIT);
}

export type BillSupplierPayment = {
  id: string;
  paymentId: string;
  docNumber: string;
  date: Date;
  /** The receipt the allocation names: a GRN number, a WO step, or a PO for the old toggle. */
  target: string;
  amount: number;
};

/**
 * Live Supplier payments allocated to the receipts a bill's lines match — the GRNs of its POs that
 * brought in one of its PO items (and the old toggle's mirror payment on the PO) and its WO steps —
 * with the whole allocation, for the bill page. What of it the bill itself reads as paid is
 * `supplierPaidAmount`: a receipt's payment is shared by every bill on its pieces, oldest saved first.
 */
async function supplierPaymentsOnSources(
  pos: Map<string, { docNumber: string; keys: Set<string> }>,
  steps: Map<string, string>
): Promise<BillSupplierPayment[]> {
  const allGrns = pos.size > 0 ? await prisma.gRN.findMany({ where: { poId: { in: [...pos.keys()] } }, select: { id: true, docNumber: true, poId: true, items: true } }) : [];
  const grns = allGrns.filter((g) => {
    const keys = g.poId ? pos.get(g.poId)?.keys : undefined;
    return !!keys && readGrnLines(g.items).some((l) => keys.has(l.key));
  });
  const grnLabel = new Map(grns.map((g) => [g.id, g.docNumber]));
  const or: Prisma.SupplierPaymentAllocationWhereInput[] = [];
  if (steps.size > 0) or.push({ targetType: "WO_STEP", targetId: { in: [...steps.keys()] } });
  if (grns.length > 0) or.push({ targetType: "GRN", targetId: { in: grns.map((g) => g.id) } });
  if (pos.size > 0) or.push({ targetType: "PO", targetId: { in: [...pos.keys()] } });
  if (or.length === 0) return [];
  const rows = await prisma.supplierPaymentAllocation.findMany({
    where: { OR: or, payment: { status: "POSTED" } },
    select: { id: true, targetType: true, targetId: true, amount: true, payment: { select: { id: true, docNumber: true, date: true } } },
    orderBy: [{ payment: { date: "asc" } }, { id: "asc" }],
  });
  return rows.map((r) => {
    const id = r.targetId ?? "";
    const target = (r.targetType === "GRN" ? grnLabel.get(id) : r.targetType === "WO_STEP" ? steps.get(id) : pos.get(id)?.docNumber) ?? id;
    return { id: r.id, paymentId: r.payment.id, docNumber: r.payment.docNumber, date: r.payment.date, target, amount: Number(r.amount) };
  });
}

export async function getVendorBillDetail(id: string) {
  const bill = await prisma.vendorBill.findUnique({
    where: { id },
    select: {
      id: true,
      docNumber: true,
      vendorInvoiceNo: true,
      billDate: true,
      dueDate: true,
      total: true,
      paidAmount: true,
      status: true,
      notes: true,
      voidedAt: true,
      voidReason: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      supplier: { select: { id: true, name: true } },
      lines: {
        select: {
          id: true,
          type: true,
          qty: true,
          price: true,
          amount: true,
          refPrice: true,
          poItem: { select: { id: true, itemId: true, variantSku: true, item: { select: { nameId: true, sku: true } }, po: { select: { id: true, docNumber: true } } } },
          woStep: { select: { id: true, sequence: true, stepName: true, wo: { select: { id: true, docNumber: true } } } },
        },
        orderBy: { id: "asc" },
      },
      allocations: {
        select: { id: true, amount: true, payment: { select: { id: true, docNumber: true, paidAt: true, voidedAt: true } } },
      },
    },
  });
  if (!bill) return null;
  const journals = await prisma.journal.findMany({
    where: { sourceId: id, sourceType: { in: ["VENDOR_BILL", "VENDOR_BILL_REVERSAL"] } },
    select: { id: true, sourceType: true, date: true },
    orderBy: { date: "asc" },
  });
  const [paid] = await withSupplierPaid([{ id: bill.id, total: Number(bill.total), paidAmount: Number(bill.paidAmount), status: bill.status }]);
  const pos = new Map<string, { docNumber: string; keys: Set<string> }>();
  const steps = new Map<string, string>();
  for (const l of bill.lines) {
    if (l.poItem) {
      const po = pos.get(l.poItem.po.id) ?? { docNumber: l.poItem.po.docNumber, keys: new Set<string>() };
      po.keys.add(grnLineKey(l.poItem.itemId, l.poItem.variantSku));
      pos.set(l.poItem.po.id, po);
    }
    if (l.woStep) steps.set(l.woStep.id, `${l.woStep.wo.docNumber} step ${l.woStep.sequence}${l.woStep.stepName ? ` ${l.woStep.stepName}` : ""}`);
  }
  const supplierPayments = await supplierPaymentsOnSources(pos, steps);
  // The WO steps whose old CMT this bill booked and Supplier payments already paid past what voiding it would leave.
  const voidBlockedSteps = bill.status === "VOID" ? [] : (await stepsOverpaidByVoid(prisma, bill.id)).map((s) => s.label);
  return {
    ...bill,
    total: Number(bill.total),
    paidAmount: paid.paidAmount,
    vendorPaidAmount: paid.vendorPaidAmount,
    supplierPaidAmount: paid.supplierPaidAmount,
    status: paid.status,
    supplierPayments,
    voidBlockedSteps,
    lines: bill.lines.map((l) => ({
      ...l,
      qty: Number(l.qty),
      price: Number(l.price),
      amount: Number(l.amount),
      refPrice: Number(l.refPrice),
    })),
    allocations: bill.allocations.map((a) => ({ ...a, amount: Number(a.amount) })),
    journals,
  };
}

export type LinkedBillLine = {
  id: string;
  billId: string;
  billDocNumber: string;
  vendorInvoiceNo: string;
  status: VendorBillStatus;
  label: string;
  qty: number;
  price: number;
  amount: number;
};

const linkedSelect = {
  id: true,
  qty: true,
  price: true,
  amount: true,
  bill: { select: { id: true, docNumber: true, vendorInvoiceNo: true, status: true, total: true, paidAmount: true } },
  poItem: { select: { item: { select: { nameId: true } } } },
  woStep: { select: { sequence: true, stepName: true } },
} as const;

type LinkedRecord = {
  id: string;
  qty: { toString(): string };
  price: { toString(): string };
  amount: { toString(): string };
  bill: {
    id: string;
    docNumber: string;
    vendorInvoiceNo: string;
    status: VendorBillStatus;
    total: { toString(): string };
    paidAmount: { toString(): string };
  };
  poItem: { item: { nameId: string } } | null;
  woStep: { sequence: number; stepName: string | null } | null;
};

function toLinked(l: LinkedRecord, status: Map<string, VendorBillStatus>): LinkedBillLine {
  return {
    id: l.id,
    billId: l.bill.id,
    billDocNumber: l.bill.docNumber,
    vendorInvoiceNo: l.bill.vendorInvoiceNo,
    status: status.get(l.bill.id) ?? l.bill.status,
    label: l.poItem
      ? l.poItem.item.nameId
      : `Step ${l.woStep?.sequence ?? "?"}${l.woStep?.stepName ? ` ${l.woStep.stepName}` : ""}`,
    qty: Number(l.qty),
    price: Number(l.price),
    amount: Number(l.amount),
  };
}

/** Each line's bill status, read with what Supplier payments paid (`withSupplierPaid`). */
async function linkedLines(lines: LinkedRecord[]): Promise<LinkedBillLine[]> {
  const bills = new Map<string, { id: string; total: number; paidAmount: number; status: VendorBillStatus }>();
  for (const l of lines) {
    bills.set(l.bill.id, { id: l.bill.id, total: Number(l.bill.total), paidAmount: Number(l.bill.paidAmount), status: l.bill.status });
  }
  const read = await withSupplierPaid([...bills.values()]);
  const status = new Map(read.map((b) => [b.id, b.status]));
  return lines.map((l) => toLinked(l, status));
}

/** Bill lines on a PO's items, for the read-only "Tagihan" list on the PO detail page. */
export async function listBillLinesForPo(poId: string): Promise<LinkedBillLine[]> {
  const lines = await prisma.vendorBillLine.findMany({
    where: { poItem: { poId } },
    select: linkedSelect,
    orderBy: [{ bill: { billDate: "asc" } }, { id: "asc" }],
  });
  return linkedLines(lines as LinkedRecord[]);
}

/** Bill lines on a WO's processing steps, for the WO detail page. */
export async function listBillLinesForWo(woId: string): Promise<LinkedBillLine[]> {
  const lines = await prisma.vendorBillLine.findMany({
    where: { woStep: { woId } },
    select: linkedSelect,
    orderBy: [{ bill: { billDate: "asc" } }, { id: "asc" }],
  });
  return linkedLines(lines as LinkedRecord[]);
}
