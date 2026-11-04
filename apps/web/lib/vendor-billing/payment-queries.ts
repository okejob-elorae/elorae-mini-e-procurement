import { prisma, type Prisma } from "@elorae/db";

export type VendorPaymentRow = {
  id: string;
  docNumber: string;
  supplier: { id: string; name: string };
  paidAt: Date;
  method: "BANK" | "CASH";
  reference: string | null;
  amount: number;
  billCount: number;
  voidedAt: Date | null;
};

/** Vendor payments made before they closed on 2026-11-01 (`payment-writer.ts`): history only. */
export async function listVendorPayments(filters: { supplierId?: string; from?: Date; to?: Date; search?: string }): Promise<VendorPaymentRow[]> {
  const search = filters.search?.trim();
  const where: Prisma.VendorPaymentWhereInput = {
    ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
    ...(filters.from || filters.to
      ? { paidAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
      : {}),
    ...(search ? { OR: [{ docNumber: { contains: search } }, { reference: { contains: search } }] } : {}),
  };
  const rows = await prisma.vendorPayment.findMany({
    where,
    select: {
      id: true,
      docNumber: true,
      paidAt: true,
      method: true,
      reference: true,
      amount: true,
      voidedAt: true,
      supplier: { select: { id: true, name: true } },
      _count: { select: { allocations: true } },
    },
    orderBy: [{ paidAt: "desc" }, { docNumber: "desc" }],
    take: 500,
  });
  return rows.map(({ _count, ...r }) => ({ ...r, amount: Number(r.amount), billCount: _count.allocations }));
}

export async function getVendorPaymentDetail(id: string) {
  const p = await prisma.vendorPayment.findUnique({
    where: { id },
    select: {
      id: true,
      docNumber: true,
      paidAt: true,
      method: true,
      reference: true,
      amount: true,
      notes: true,
      voidedAt: true,
      voidReason: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      supplier: { select: { id: true, name: true } },
      allocations: {
        select: { id: true, amount: true, bill: { select: { id: true, docNumber: true, vendorInvoiceNo: true, total: true } } },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!p) return null;
  const journals = await prisma.journal.findMany({
    where: { sourceId: id, sourceType: { in: ["VENDOR_PAYMENT", "VENDOR_PAYMENT_REVERSAL"] } },
    select: { id: true, sourceType: true, date: true },
    orderBy: { date: "asc" },
  });
  return {
    ...p,
    amount: Number(p.amount),
    allocations: p.allocations.map((a) => ({ ...a, amount: Number(a.amount), bill: { ...a.bill, total: Number(a.bill.total) } })),
    journals,
  };
}
