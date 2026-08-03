import { prisma } from "@elorae/db";

export type SpgSaleDetail = {
  id: string;
  docNo: string;
  salesmanLabel: string;
  storeName: string;
  saleLat: number | null;
  saleLng: number | null;
  subtotal: number;
  total: number;
  cashReceived: number;
  changeGiven: number;
  note: string | null;
  createdAtIso: string;
  lines: Array<{ productName: string; variantSku: string | null; qty: number; unitPrice: number; lineTotal: number }>;
};

/**
 * Scope to owner (opts.salesmanId) when called from the PWA nota view, so an
 * SPG can only fetch their own sales. Payload carries no cost/margin field —
 * SpgSaleLine has no unitCost (record-only, no stock/COGS snapshot exists).
 */
export async function getSpgSaleById(id: string, opts?: { salesmanId?: string }): Promise<SpgSaleDetail | null> {
  const r = await prisma.spgSale.findFirst({
    where: { id, ...(opts?.salesmanId ? { salesmanId: opts.salesmanId } : {}) },
    include: { salesman: { select: { name: true, email: true } }, store: { select: { name: true } }, lines: true },
  });
  if (!r) return null;
  return {
    id: r.id,
    docNo: r.docNo,
    salesmanLabel: r.salesman.name ?? r.salesman.email,
    storeName: r.store.name,
    saleLat: r.saleLat === null ? null : Number(r.saleLat),
    saleLng: r.saleLng === null ? null : Number(r.saleLng),
    subtotal: Number(r.subtotal),
    total: Number(r.total),
    cashReceived: Number(r.cashReceived),
    changeGiven: Number(r.changeGiven),
    note: r.note,
    createdAtIso: r.createdAt.toISOString(),
    lines: r.lines.map((l) => ({
      productName: l.productName,
      variantSku: l.variantSku || null,
      qty: l.qty,
      unitPrice: Number(l.unitPrice),
      lineTotal: Number(l.lineTotal),
    })),
  };
}
