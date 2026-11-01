/*
 * How much of a vendor bill has been paid, split over its two payment paths. Import-free: a pure
 * rule, tested on its own (`bill-paid-rule.test.ts`), shared by the vendor payment split in
 * `billable.ts` and the Supplier payments split in `supplier-paid.ts`.
 *
 * Supplier payments → Pay pays receipts, not invoices: an allocation names a GRN (goods) or a WO
 * step (CMT and other step work). A bill only matches those receipts. So what Supplier payments
 * settled is read in PIECES, per SOURCE — the PO item for a PO item line, the WO step for a step line:
 * - a GRN's settled share (`paidFraction`: what Supplier payments paid on it over its booked payable,
 *   PPN included) applies to every piece it received, so each PO item gets that share of its OWN
 *   pieces in that GRN (`paidPiecesByPoItem`) — a payment on one GRN never pays an item another GRN
 *   brought in;
 * - a WO step's settled share of its booked payable applies to its booked pieces.
 * Those pieces are handed to the live bill lines on that source in the order the bills were saved —
 * the order `createVendorBill` books unbooked step pieces in, so the bills that booked a payable are
 * the first to read as paid — each line taking at most what is left of it after its share of the
 * bill's own vendor payments (the old Vendor Billing payment path), at the line's own invoice price.
 * Counting pieces rather than rupiah keeps the receipt's basis (PPN, receipt price) apart from the
 * invoice's: a bill line reads paid exactly as far as the receipts its pieces came on are settled,
 * and a rupiah is never counted on a bill twice. Pieces a source holds beyond its lines are received
 * work no bill has matched yet.
 */

/** `total` cents split over `weights`, largest remainder first, so the parts add up to `total` exactly. */
export function splitCents(total: number, weights: number[]): number[] {
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
 * Cents of each line still open after the bill's vendor payments, which are allocated to the bill,
 * not to a line, and split over the lines by amount (the split `vendorPaidBySource` books).
 */
export function lineRooms(vendorPaidCents: number, lineAmountCents: number[]): number[] {
  const amounts = lineAmountCents.map((a) => Math.max(0, a));
  const vendor = splitCents(vendorPaidCents, amounts);
  return amounts.map((a, i) => Math.max(0, a - vendor[i]));
}

/** 0..1: the share of a receipt's booked payable that payments settled. Nothing booked settles nothing. */
export function paidFraction(paidCents: number, payableCents: number): number {
  if (payableCents <= 0 || paidCents <= 0) return 0;
  return Math.min(1, paidCents / payableCents);
}

/** The key a GRN line and a PO item match on — item and trimmed variant, as `createGRN` matches them. */
export function grnLineKey(itemId: string, variantSku?: string | null): string {
  return `${itemId}\t${variantSku?.trim() ?? ""}`;
}

/** The lines stored on `GRN.items` (a JSON array, or that array as a JSON string), as key and qty. */
export function readGrnLines(raw: unknown): Array<{ key: string; qty: number }> {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: Array<{ key: string; qty: number }> = [];
  for (const l of arr) {
    if (typeof l !== "object" || l === null) continue;
    const { itemId, variantSku, qty } = l as { itemId?: unknown; variantSku?: unknown; qty?: unknown };
    const n = Number(qty);
    if (typeof itemId !== "string" || !Number.isFinite(n) || n <= 0) continue;
    out.push({ key: grnLineKey(itemId, typeof variantSku === "string" ? variantSku : null), qty: n });
  }
  return out;
}

export type GrnPaidPieces = { fraction: number; lines: ReadonlyArray<{ key: string; qty: number }> };
export type PoItemSlot = { id: string; key: string; receivedQty: number };

/**
 * Pieces of each PO item that payments settled: of every GRN of the PO, its settled `fraction` of the
 * pieces it brought in under each key, handed to the PO's items with that key in the order given,
 * each up to what it received. A PO item no settled GRN brought in gets 0.
 */
export function paidPiecesByPoItem(grns: readonly GrnPaidPieces[], items: readonly PoItemSlot[]): Map<string, number> {
  const perKey = new Map<string, number>();
  for (const g of grns) {
    if (g.fraction <= 0) continue;
    for (const l of g.lines) perKey.set(l.key, (perKey.get(l.key) ?? 0) + l.qty * g.fraction);
  }
  const out = new Map<string, number>();
  for (const it of items) {
    const left = perKey.get(it.key) ?? 0;
    const take = Math.max(0, Math.min(left, it.receivedQty));
    out.set(it.id, take);
    perKey.set(it.key, left - take);
  }
  return out;
}

export type SupplierPaidLine = { billId: string; source: string; qty: number; amountCents: number; roomCents: number };

const QTY_EPS = 1e-6;

/**
 * Hands each source's settled pieces to its lines, in the order given (oldest saved bill first). A
 * line's room in pieces is its qty in the proportion its `roomCents` bears to its amount; it takes at
 * most that, at its own price, and a full room takes exactly `roomCents`. Returns cents per bill; a
 * bill no pool reached is absent.
 */
export function allocateSupplierPaid(lines: readonly SupplierPaidLine[], poolPieces: ReadonlyMap<string, number>): Map<string, number> {
  const left = new Map(poolPieces);
  const byBill = new Map<string, number>();
  for (const l of lines) {
    const pool = left.get(l.source) ?? 0;
    if (pool <= QTY_EPS || l.roomCents <= 0 || l.amountCents <= 0 || l.qty <= 0) continue;
    const roomCents = Math.min(l.roomCents, l.amountCents);
    const roomQty = (l.qty * roomCents) / l.amountCents;
    const take = Math.min(pool, roomQty);
    const cents = take >= roomQty - QTY_EPS ? roomCents : Math.round((roomCents * take) / roomQty);
    left.set(l.source, pool - take);
    if (cents > 0) byBill.set(l.billId, (byBill.get(l.billId) ?? 0) + cents);
  }
  return byBill;
}
