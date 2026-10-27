import { prisma, type Prisma } from "@elorae/db";
import type { VendorBillStatus } from "./status";

export type VendorBillRow = {
  id: string;
  docNumber: string;
  vendorInvoiceNo: string;
  supplier: { id: string; name: string };
  billDate: Date;
  dueDate: Date | null;
  total: number;
  paidAmount: number;
  status: VendorBillStatus;
};

export async function listVendorBills(filters: {
  supplierId?: string;
  status?: VendorBillStatus;
  from?: Date;
  to?: Date;
  search?: string;
}): Promise<VendorBillRow[]> {
  const search = filters.search?.trim();
  const where: Prisma.VendorBillWhereInput = {
    ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.from || filters.to
      ? { billDate: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
      : {}),
    ...(search ? { OR: [{ docNumber: { contains: search } }, { vendorInvoiceNo: { contains: search } }] } : {}),
  };
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
    orderBy: [{ billDate: "desc" }, { docNumber: "desc" }],
    take: 500,
  });
  return bills.map((b) => ({ ...b, total: Number(b.total), paidAmount: Number(b.paidAmount) }));
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
          poItem: { select: { id: true, variantSku: true, item: { select: { nameId: true, sku: true } }, po: { select: { id: true, docNumber: true } } } },
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
  return {
    ...bill,
    total: Number(bill.total),
    paidAmount: Number(bill.paidAmount),
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
  bill: { select: { id: true, docNumber: true, vendorInvoiceNo: true, status: true } },
  poItem: { select: { item: { select: { nameId: true } } } },
  woStep: { select: { sequence: true, stepName: true } },
} as const;

type LinkedRecord = {
  id: string;
  qty: { toString(): string };
  price: { toString(): string };
  amount: { toString(): string };
  bill: { id: string; docNumber: string; vendorInvoiceNo: string; status: VendorBillStatus };
  poItem: { item: { nameId: string } } | null;
  woStep: { sequence: number; stepName: string | null } | null;
};

function toLinked(l: LinkedRecord): LinkedBillLine {
  return {
    id: l.id,
    billId: l.bill.id,
    billDocNumber: l.bill.docNumber,
    vendorInvoiceNo: l.bill.vendorInvoiceNo,
    status: l.bill.status,
    label: l.poItem
      ? l.poItem.item.nameId
      : `Step ${l.woStep?.sequence ?? "?"}${l.woStep?.stepName ? ` ${l.woStep.stepName}` : ""}`,
    qty: Number(l.qty),
    price: Number(l.price),
    amount: Number(l.amount),
  };
}

/** Bill lines on a PO's items, for the read-only "Tagihan" list on the PO detail page. */
export async function listBillLinesForPo(poId: string): Promise<LinkedBillLine[]> {
  const lines = await prisma.vendorBillLine.findMany({
    where: { poItem: { poId } },
    select: linkedSelect,
    orderBy: [{ bill: { billDate: "asc" } }, { id: "asc" }],
  });
  return lines.map((l) => toLinked(l as LinkedRecord));
}

/** Bill lines on a WO's processing steps, for the WO detail page. */
export async function listBillLinesForWo(woId: string): Promise<LinkedBillLine[]> {
  const lines = await prisma.vendorBillLine.findMany({
    where: { woStep: { woId } },
    select: linkedSelect,
    orderBy: [{ bill: { billDate: "asc" } }, { id: "asc" }],
  });
  return lines.map((l) => toLinked(l as LinkedRecord));
}
