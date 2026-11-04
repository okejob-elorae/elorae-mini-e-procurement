import { prisma, type Prisma } from "@elorae/db";
import type { VendorBillStatus } from "./status";
import { withSupplierPaid } from "./supplier-paid";
import { penerimaanLebihBayarJikaDibatalkan } from "./void-guard";
import { koreksiTagihan } from "./koreksi-utang-queries";

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
 * Live Supplier payments allocated to the receipts a bill's lines name — its GRNs (and the old toggle's
 * mirror payment on their POs) and its WO steps — with the whole allocation, for the bill page. What
 * of it the bill itself reads as paid is `supplierPaidAmount`: a receipt's payment is shared by every
 * bill on it, oldest invoice date first.
 */
async function supplierPaymentsOnSources(
  grns: Map<string, { docNumber: string; poId: string | null; poDocNumber: string | null }>,
  steps: Map<string, string>
): Promise<BillSupplierPayment[]> {
  const pos = new Map<string, string>();
  for (const g of grns.values()) if (g.poId) pos.set(g.poId, g.poDocNumber ?? g.poId);
  const or: Prisma.SupplierPaymentAllocationWhereInput[] = [];
  if (steps.size > 0) or.push({ targetType: "WO_STEP", targetId: { in: [...steps.keys()] } });
  if (grns.size > 0) or.push({ targetType: "GRN", targetId: { in: [...grns.keys()] } });
  if (pos.size > 0) or.push({ targetType: "PO", targetId: { in: [...pos.keys()] } });
  if (or.length === 0) return [];
  const rows = await prisma.supplierPaymentAllocation.findMany({
    where: { OR: or, payment: { status: "POSTED" } },
    select: { id: true, targetType: true, targetId: true, amount: true, payment: { select: { id: true, docNumber: true, date: true } } },
    orderBy: [{ payment: { date: "asc" } }, { id: "asc" }],
  });
  return rows.map((r) => {
    const id = r.targetId ?? "";
    const target = (r.targetType === "GRN" ? grns.get(id)?.docNumber : r.targetType === "WO_STEP" ? steps.get(id) : pos.get(id)) ?? id;
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
          grnId: true,
          itemId: true,
          variantSku: true,
          grn: { select: { id: true, docNumber: true, grnDate: true, poId: true, po: { select: { id: true, docNumber: true } } } },
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
  const grns = new Map<string, { docNumber: string; poId: string | null; poDocNumber: string | null }>();
  const steps = new Map<string, string>();
  for (const l of bill.lines) {
    if (l.grn) grns.set(l.grn.id, { docNumber: l.grn.docNumber, poId: l.grn.poId, poDocNumber: l.grn.po?.docNumber ?? null });
    if (l.woStep) steps.set(l.woStep.id, `${l.woStep.wo.docNumber} step ${l.woStep.sequence}${l.woStep.stepName ? ` ${l.woStep.stepName}` : ""}`);
  }
  const itemIds = [...new Set(bill.lines.flatMap((l) => (!l.poItem && l.itemId ? [l.itemId] : [])))];
  const items = itemIds.length
    ? new Map((await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, nameId: true, sku: true } })).map((i) => [i.id, i]))
    : new Map<string, { id: string; nameId: string; sku: string }>();
  const supplierPayments = await supplierPaymentsOnSources(grns, steps);
  // The receipts whose payable voiding this bill would pull below what Supplier payments already paid.
  const voidBlockedReceipts = bill.status === "VOID" ? [] : (await penerimaanLebihBayarJikaDibatalkan(prisma, bill.id)).map((s) => s.label);
  const koreksi = await koreksiTagihan(bill.id);
  return {
    ...bill,
    total: Number(bill.total),
    paidAmount: paid.paidAmount,
    vendorPaidAmount: paid.vendorPaidAmount,
    supplierPaidAmount: paid.supplierPaidAmount,
    status: paid.status,
    supplierPayments,
    voidBlockedReceipts,
    koreksi,
    lines: bill.lines.map((l) => {
      const barang = l.poItem?.item ?? (l.itemId ? items.get(l.itemId) : undefined) ?? null;
      return {
        ...l,
        qty: Number(l.qty),
        price: Number(l.price),
        amount: Number(l.amount),
        refPrice: Number(l.refPrice),
        grn: l.grn ? { id: l.grn.id, docNumber: l.grn.docNumber, grnDate: l.grn.grnDate, poId: l.grn.poId, poDocNumber: l.grn.po?.docNumber ?? null } : null,
        itemName: barang?.nameId ?? null,
        itemSku: barang?.sku ?? null,
        /** A legacy PO_ITEM line names no receipt and covers nothing (R3): void the bill and record it again. */
        tanpaPenerimaan: l.type === "PO_ITEM" && !l.grnId,
      };
    }),
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
  /** The GRN the line bills, or null (a WO step line, or a legacy PO item line that names no receipt). */
  grnDocNumber: string | null;
  /** A GRN_ITEM line on a GRN recorded without a PO. */
  tanpaPo: boolean;
};

const linkedSelect = {
  id: true,
  qty: true,
  price: true,
  amount: true,
  bill: { select: { id: true, docNumber: true, vendorInvoiceNo: true, status: true, total: true, paidAmount: true } },
  itemId: true,
  grn: { select: { docNumber: true, poId: true } },
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
  itemId: string | null;
  grn: { docNumber: string; poId: string | null } | null;
  poItem: { item: { nameId: string } } | null;
  woStep: { sequence: number; stepName: string | null } | null;
};

function toLinked(l: LinkedRecord, status: Map<string, VendorBillStatus>, itemNames: Map<string, string>): LinkedBillLine {
  return {
    id: l.id,
    billId: l.bill.id,
    billDocNumber: l.bill.docNumber,
    vendorInvoiceNo: l.bill.vendorInvoiceNo,
    status: status.get(l.bill.id) ?? l.bill.status,
    label: l.poItem
      ? l.poItem.item.nameId
      : l.itemId
        ? itemNames.get(l.itemId) ?? l.itemId
        : `Step ${l.woStep?.sequence ?? "?"}${l.woStep?.stepName ? ` ${l.woStep.stepName}` : ""}`,
    qty: Number(l.qty),
    price: Number(l.price),
    amount: Number(l.amount),
    grnDocNumber: l.grn?.docNumber ?? null,
    tanpaPo: l.grn != null && l.grn.poId == null,
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
  const ids = [...new Set(lines.flatMap((l) => (!l.poItem && l.itemId ? [l.itemId] : [])))];
  const itemNames = ids.length
    ? new Map((await prisma.item.findMany({ where: { id: { in: ids } }, select: { id: true, nameId: true } })).map((i) => [i.id, i.nameId]))
    : new Map<string, string>();
  return lines.map((l) => toLinked(l, status, itemNames));
}

/** Bill lines on a PO's items or on its GRNs, for the read-only "Tagihan" list on the PO detail page. */
export async function listBillLinesForPo(poId: string): Promise<LinkedBillLine[]> {
  const lines = await prisma.vendorBillLine.findMany({
    where: { OR: [{ poItem: { poId } }, { grn: { poId } }] },
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
