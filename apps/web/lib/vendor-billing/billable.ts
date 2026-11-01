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
 * Accepted pieces per WO from finished-goods receipts that booked no service payable: received
 * before receipts started booking CMT (`FGReceipt.serviceCost` null, never backfilled). Their step
 * work reaches the books only through a vendor bill (`bill-journal.ts`).
 */
export async function unbookedReceiptQtyByWo(db: Db, woIds: string[]): Promise<Map<string, number>> {
  if (woIds.length === 0) return new Map();
  const rows = await db.fGReceipt.groupBy({
    by: ["woId"],
    where: { woId: { in: woIds }, serviceCost: null },
    _sum: { qtyAccepted: true },
  });
  return new Map(rows.map((r) => [r.woId, Number(r._sum.qtyAccepted ?? 0)]));
}

function linesOf(scope: { poIds: string[]; woStepIds: string[] }): Prisma.VendorBillLineWhereInput[] {
  const or: Prisma.VendorBillLineWhereInput[] = [];
  if (scope.poIds.length > 0) or.push({ poItem: { poId: { in: scope.poIds } } });
  if (scope.woStepIds.length > 0) or.push({ woStepId: { in: scope.woStepIds } });
  return or;
}

const cents = (v: Prisma.Decimal | number) => Math.round(Number(v) * 100);

/** `total` cents split over `weights`, largest remainder first, so the parts add up to `total` exactly. */
function splitCents(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map((r) => Math.floor(r));
  let left = total - parts.reduce((s, p) => s + p, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) parts[order[k].i] += 1;
  return parts;
}

/**
 * What live vendor payments have paid, in cents: per PO for its PO item lines, per WO step for its
 * step lines. A payment is allocated to a bill, not to a line, so each live bill's live allocations
 * are split over its lines in proportion to their amounts; the parts of one bill add up to what was
 * paid on it, and the vendor payment journal debits AP by those same allocations. The supplier
 * payable sub-ledger reads the PO part as a credit on that PO's receipts
 * (`lib/purchasing/pembayaran-hutang-queries.ts`) and the step part as paid on that step
 * (`daftarHutangJasa`), so it stays equal to the general ledger. The step part also covers payments
 * of step work the bill booked itself (`bill-journal.ts`), whose payable no finished-goods receipt
 * holds; `billBookedByWoStep` gives the sub-ledger that payable.
 */
export async function vendorPaidBySource(
  db: Db,
  scope: { poIds: string[]; woStepIds: string[] }
): Promise<{ byPo: Map<string, number>; byWoStep: Map<string, number> }> {
  const byPo = new Map<string, number>();
  const byWoStep = new Map<string, number>();
  const or = linesOf(scope);
  if (or.length === 0) return { byPo, byWoStep };
  const bills = await db.vendorBill.findMany({
    where: { status: { not: "VOID" }, lines: { some: { OR: or } }, allocations: { some: { payment: { voidedAt: null } } } },
    select: {
      allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } },
      lines: { orderBy: { id: "asc" }, select: { amount: true, woStepId: true, poItem: { select: { poId: true } } } },
    },
  });
  const pos = new Set(scope.poIds);
  const steps = new Set(scope.woStepIds);
  for (const b of bills) {
    const paid = b.allocations.reduce((s, a) => s + cents(a.amount), 0);
    const parts = splitCents(paid, b.lines.map((l) => Math.max(0, cents(l.amount))));
    b.lines.forEach((l, i) => {
      const poId = l.poItem?.poId;
      if (poId && pos.has(poId)) byPo.set(poId, (byPo.get(poId) ?? 0) + parts[i]);
      if (l.woStepId && steps.has(l.woStepId)) byWoStep.set(l.woStepId, (byWoStep.get(l.woStepId) ?? 0) + parts[i]);
    });
  }
  return { byPo, byWoStep };
}

/**
 * The step payable vendor bills booked themselves (`bill-journal.ts`), per WO step: `cents` of AP and
 * the `qty` pieces it covers. Each bill's amount is its standing `VENDOR_BILL` journal (the AP credit,
 * less a posted `VENDOR_BILL_REVERSAL`), so the parts add up to the general ledger. That journal holds
 * one total per bill, so it is split over the bill's step lines by the share `createVendorBill` booked
 * for each, replayed here: the pieces of the step's WO that no finished-goods receipt booked, less
 * what the step's bills saved earlier and still live at that moment held. When the replay no longer
 * adds up to the journal (data changed since), the journal is split by the replayed shares, or by
 * line amount when none is left.
 */
export async function billBookedByWoStep(db: Db, woStepIds: string[]): Promise<Map<string, { cents: number; qty: number }>> {
  const result = new Map<string, { cents: number; qty: number }>();
  if (woStepIds.length === 0) return result;
  const touching = await db.vendorBillLine.findMany({ where: { woStepId: { in: woStepIds } }, select: { billId: true } });
  const billIds = [...new Set(touching.map((l) => l.billId))];
  if (billIds.length === 0) return result;
  const journals = await db.journal.findMany({
    where: { sourceType: { in: ["VENDOR_BILL", "VENDOR_BILL_REVERSAL"] }, sourceId: { in: billIds }, status: "POSTED" },
    select: { sourceType: true, sourceId: true, lines: { select: { debit: true, credit: true } } },
  });
  // A bill journal credits only AP and its reversal debits only AP, so those sides are the AP amounts.
  const standing = new Map<string, number>();
  for (const j of journals) {
    if (!j.sourceId) continue;
    const ap =
      j.sourceType === "VENDOR_BILL" ? j.lines.reduce((s, l) => s + cents(l.credit), 0) : -j.lines.reduce((s, l) => s + cents(l.debit), 0);
    standing.set(j.sourceId, (standing.get(j.sourceId) ?? 0) + ap);
  }
  const booked = new Set([...standing].filter(([, n]) => n !== 0).map(([id]) => id));
  if (booked.size === 0) return result;

  const stepsOfBooked = await db.vendorBillLine.findMany({
    where: { billId: { in: [...booked] }, woStepId: { not: null } },
    select: { woStepId: true },
  });
  const history = await db.vendorBillLine.findMany({
    where: { woStepId: { in: [...new Set(stepsOfBooked.map((l) => l.woStepId!))] } },
    orderBy: { id: "asc" },
    select: {
      billId: true,
      woStepId: true,
      qty: true,
      price: true,
      amount: true,
      bill: { select: { createdAt: true, voidedAt: true } },
      woStep: { select: { woId: true } },
    },
  });
  const unbooked = await unbookedReceiptQtyByWo(db, [...new Set(history.flatMap((l) => (l.woStep ? [l.woStep.woId] : [])))]);
  const byStep = new Map<string, typeof history>();
  for (const l of history) byStep.set(l.woStepId!, [...(byStep.get(l.woStepId!) ?? []), l]);

  const perBill = new Map<string, Array<{ woStepId: string; qty: number; weight: number; amount: number }>>();
  for (const l of history) {
    if (!booked.has(l.billId)) continue;
    const at = l.bill.createdAt.getTime();
    const held = (byStep.get(l.woStepId!) ?? [])
      .filter((o) => o.billId !== l.billId && o.bill.createdAt.getTime() < at && (o.bill.voidedAt == null || o.bill.voidedAt.getTime() > at))
      .reduce((s, o) => s + Number(o.qty), 0);
    const left = Math.max(0, round2((l.woStep ? unbooked.get(l.woStep.woId) ?? 0 : 0) - held));
    const qty = Math.min(Number(l.qty), left);
    const rows = perBill.get(l.billId) ?? [];
    rows.push({ woStepId: l.woStepId!, qty, weight: cents(round2(qty * Number(l.price))), amount: Math.max(0, cents(l.amount)) });
    perBill.set(l.billId, rows);
  }

  const wanted = new Set(woStepIds);
  for (const [billId, rows] of perBill) {
    const total = standing.get(billId) ?? 0;
    const sum = rows.reduce((s, r) => s + r.weight, 0);
    const parts =
      sum === Math.abs(total) ? rows.map((r) => r.weight) : splitCents(Math.abs(total), sum > 0 ? rows.map((r) => r.weight) : rows.map((r) => r.amount));
    rows.forEach((r, i) => {
      if (!wanted.has(r.woStepId)) return;
      const cur = result.get(r.woStepId) ?? { cents: 0, qty: 0 };
      cur.cents += Math.sign(total) * parts[i];
      if (total > 0) cur.qty = round2(cur.qty + r.qty);
      result.set(r.woStepId, cur);
    });
  }
  return result;
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
  const or = linesOf(scope);
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
 * on live WOs, each less the qty already on live bills. Fully billed rows drop out. A step's `qty`
 * is the accepted pieces of its WO's finished-goods receipts (`receiveFG` stamps it; null before
 * the first receipt), so a step bills only work a receipt has taken in, as a PO line bills only
 * what a GRN received.
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
