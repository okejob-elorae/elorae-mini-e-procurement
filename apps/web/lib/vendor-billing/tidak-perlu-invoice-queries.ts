import { prisma, type Prisma } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";

/*
 * Daftar "Tidak perlu invoice" (P52) — yang berlaku dan yang sudah dibatalkan, terbaru dulu. KHUSUS SERVER.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type BarisTidakPerlu = {
  id: string;
  supplierId: string;
  supplierName: string;
  sourceType: "GRN" | "WO_STEP";
  sourceId: string;
  nomor: string;
  barang: string | null;
  variantSku: string | null;
  qty: number;
  reason: string;
  createdBy: string;
  createdAt: string;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
};

export async function daftarTidakPerluInvoice(o: { supplierId?: string }, db: Db = prisma): Promise<BarisTidakPerlu[]> {
  const rows = await db.supplierInvoiceWaiver.findMany({
    where: o.supplierId ? { supplierId: o.supplierId } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 500,
  });
  if (rows.length === 0) return [];
  const [grns, steps, items, users, suppliers] = await Promise.all([
    db.gRN.findMany({ where: { id: { in: rows.filter((r) => r.sourceType === "GRN").map((r) => r.sourceId) } }, select: { id: true, docNumber: true } }),
    db.workOrderStep.findMany({
      where: { id: { in: rows.filter((r) => r.sourceType === "WO_STEP").map((r) => r.sourceId) } },
      select: { id: true, sequence: true, stepName: true, wo: { select: { docNumber: true } } },
    }),
    db.item.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => (r.itemId ? [r.itemId] : [])))] } }, select: { id: true, nameId: true } }),
    db.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.createdById, ...(r.cancelledById ? [r.cancelledById] : [])]))] } }, select: { id: true, name: true, email: true } }),
    db.supplier.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.supplierId))] } }, select: { id: true, name: true } }),
  ]);
  const grn = new Map(grns.map((g) => [g.id, g.docNumber]));
  const step = new Map(steps.map((s) => [s.id, `${s.wo.docNumber} · ${s.sequence}${s.stepName ? ` ${s.stepName}` : ""}`]));
  const item = new Map(items.map((i) => [i.id, i.nameId]));
  const user = new Map(users.map((u) => [u.id, u.name || u.email || u.id]));
  const sup = new Map(suppliers.map((s) => [s.id, s.name]));
  return rows.map((r) => ({
    id: r.id,
    supplierId: r.supplierId,
    supplierName: sup.get(r.supplierId) ?? "",
    sourceType: r.sourceType === "GRN" ? "GRN" : "WO_STEP",
    sourceId: r.sourceId,
    nomor: (r.sourceType === "GRN" ? grn.get(r.sourceId) : step.get(r.sourceId)) ?? r.sourceId,
    barang: r.itemId ? item.get(r.itemId) ?? r.itemId : null,
    variantSku: r.variantSku,
    qty: Number(r.qty),
    reason: r.reason,
    createdBy: user.get(r.createdById) ?? "",
    createdAt: formatDateOnlyJakarta(r.createdAt),
    cancelledAt: r.cancelledAt ? formatDateOnlyJakarta(r.cancelledAt) : null,
    cancelledBy: r.cancelledById ? user.get(r.cancelledById) ?? null : null,
    cancelReason: r.cancelReason,
  }));
}
