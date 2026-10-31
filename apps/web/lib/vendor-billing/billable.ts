import { prisma, type Prisma } from "@elorae/db";

type Db = Prisma.TransactionClient | typeof prisma;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** An over-receive GRN the owner has neither approved nor declined yet. */
export const PENDING_OWNER_DECISION = { requiresOwnerApproval: true, ownerApprovedAt: null, ownerDeclinedAt: null } as const;

export type BillablePoItem = {
  poItemId: string;
  poId: string;
  poDocNumber: string;
  /** Marked paid through the old Supplier Payment toggle: shown, but not billable. */
  poPaid: boolean;
  itemName: string;
  sku: string;
  variantSku: string | null;
  uomCode: string;
  receivedQty: number;
  billedQty: number;
  remainingQty: number;
  price: number;
  ppnIncluded: boolean;
};

export type BillableWoStep = {
  woStepId: string;
  woId: string;
  woDocNumber: string;
  sequence: number;
  stepName: string | null;
  qty: number;
  billedQty: number;
  remainingQty: number;
  servicePrice: number;
  servicePpnIncluded: boolean;
};

/** Qty already on live (non-VOID) bills, per PO item. */
export async function billedQtyByPoItem(db: Db, poItemIds: string[]): Promise<Map<string, number>> {
  if (poItemIds.length === 0) return new Map();
  const rows = await db.vendorBillLine.groupBy({
    by: ["poItemId"],
    where: { poItemId: { in: poItemIds }, bill: { status: { not: "VOID" } } },
    _sum: { qty: true },
  });
  return new Map(rows.map((r) => [r.poItemId!, Number(r._sum.qty ?? 0)]));
}

/** Qty already on live (non-VOID) bills, per WO step. */
export async function billedQtyByWoStep(db: Db, woStepIds: string[]): Promise<Map<string, number>> {
  if (woStepIds.length === 0) return new Map();
  const rows = await db.vendorBillLine.groupBy({
    by: ["woStepId"],
    where: { woStepId: { in: woStepIds }, bill: { status: { not: "VOID" } } },
    _sum: { qty: true },
  });
  return new Map(rows.map((r) => [r.woStepId!, Number(r._sum.qty ?? 0)]));
}

/**
 * Of the given POs and WO steps, those on a live bill that a live vendor payment has (partly) paid.
 * A receipt has one payment path: Supplier payments → Pay must not settle these again
 * (`lib/purchasing/pembayaran-writer.ts`), just as a vendor payment refuses receipts that page
 * already paid (`payment-writer.ts`).
 */
export async function paidThroughVendorPayments(
  db: Db,
  scope: { poIds: string[]; woStepIds: string[] }
): Promise<{ poIds: Set<string>; woStepIds: Set<string> }> {
  const or: Prisma.VendorBillLineWhereInput[] = [];
  if (scope.poIds.length > 0) or.push({ poItem: { poId: { in: scope.poIds } } });
  if (scope.woStepIds.length > 0) or.push({ woStepId: { in: scope.woStepIds } });
  if (or.length === 0) return { poIds: new Set(), woStepIds: new Set() };
  const lines = await db.vendorBillLine.findMany({
    where: { OR: or, bill: { status: { not: "VOID" }, allocations: { some: { payment: { voidedAt: null } } } } },
    select: { woStepId: true, poItem: { select: { poId: true } } },
  });
  const poIds = new Set<string>();
  const woStepIds = new Set<string>();
  for (const l of lines) {
    if (l.poItem) poIds.add(l.poItem.poId);
    if (l.woStepId) woStepIds.add(l.woStepId);
  }
  return { poIds, woStepIds };
}

/**
 * What a supplier can still bill: received PO items of its live POs, and its WO processing steps
 * on live WOs, each less the qty already on live bills. Fully billed rows drop out.
 */
export async function listBillableSources(
  supplierId: string,
  db: Db = prisma
): Promise<{ poItems: BillablePoItem[]; woSteps: BillableWoStep[] }> {
  const [poItems, woSteps] = await Promise.all([
    db.pOItem.findMany({
      // A PO with an over-receive awaiting the owner is not billable until it is decided: a decline
      // reverses its AP and received qty, which a PO bill line (no journal) cannot follow.
      where: {
        receivedQty: { gt: 0 },
        po: { supplierId, status: { not: "CANCELLED" }, grns: { none: PENDING_OWNER_DECISION } },
      },
      select: {
        id: true,
        variantSku: true,
        receivedQty: true,
        price: true,
        ppnIncluded: true,
        uomId: true,
        item: { select: { nameId: true, sku: true } },
        po: { select: { id: true, docNumber: true, paidAt: true } },
      },
      orderBy: [{ po: { docNumber: "asc" } }, { createdAt: "asc" }],
    }),
    db.workOrderStep.findMany({
      where: { supplierId, qty: { gt: 0 }, wo: { status: { not: "CANCELLED" } } },
      select: {
        id: true,
        sequence: true,
        stepName: true,
        qty: true,
        servicePrice: true,
        servicePpnIncluded: true,
        wo: { select: { id: true, docNumber: true } },
      },
      orderBy: [{ wo: { docNumber: "asc" } }, { sequence: "asc" }],
    }),
  ]);

  const [poBilled, stepBilled, uoms] = await Promise.all([
    billedQtyByPoItem(db, poItems.map((i) => i.id)),
    billedQtyByWoStep(db, woSteps.map((s) => s.id)),
    db.uOM.findMany({ where: { id: { in: [...new Set(poItems.map((i) => i.uomId))] } }, select: { id: true, code: true } }),
  ]);
  const uomCode = new Map(uoms.map((u) => [u.id, u.code]));

  return {
    poItems: poItems
      .map((i) => {
        const receivedQty = Number(i.receivedQty);
        const billedQty = poBilled.get(i.id) ?? 0;
        return {
          poItemId: i.id,
          poId: i.po.id,
          poDocNumber: i.po.docNumber,
          poPaid: i.po.paidAt != null,
          itemName: i.item.nameId,
          sku: i.item.sku,
          variantSku: i.variantSku,
          uomCode: uomCode.get(i.uomId) ?? "",
          receivedQty,
          billedQty,
          remainingQty: round2(receivedQty - billedQty),
          price: Number(i.price),
          ppnIncluded: i.ppnIncluded,
        };
      })
      .filter((i) => i.remainingQty > 0),
    woSteps: woSteps
      .map((s) => {
        const qty = Number(s.qty ?? 0);
        const billedQty = stepBilled.get(s.id) ?? 0;
        return {
          woStepId: s.id,
          woId: s.wo.id,
          woDocNumber: s.wo.docNumber,
          sequence: s.sequence,
          stepName: s.stepName,
          qty,
          billedQty,
          remainingQty: round2(qty - billedQty),
          servicePrice: Number(s.servicePrice),
          servicePpnIncluded: s.servicePpnIncluded,
        };
      })
      .filter((s) => s.remainingQty > 0),
  };
}
