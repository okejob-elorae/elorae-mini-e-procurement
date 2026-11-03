import { type Prisma } from "@elorae/db";
import { nilaiBelumDinota } from "@/lib/field-sales/delivery/undelivered-residual";
import type { EksposurKredit } from "@/lib/salesman/kredit";

export type CreditExposure = EksposurKredit & {
  total: number;
  /** The receivables counted in `openInvoiceCount` — what the mode layer lists beside the figure. */
  openReceivableIds: string[];
};

/**
 * A store's live credit exposure — the ONE credit "sisa tagihan" every credit surface reads: the
 * team's create-time flag and approve gate, the approval-page and konsi-push previews, the store
 * page, AND Max's warn/hold/block mode layer (the phone catalog banner, the create-time decision,
 * the approval panel and the phone store summary, through `keadaanDariEksposur`). Owner decision
 * 2026-10-29 ("dasar tim + mode + batas nota"), applied 2026-11-02 (Q10: an approved order that is
 * not on a nota yet counts in BOTH checks). Every comparison against a limit goes through
 * `lewatBatasNilai` (`lib/salesman/kredit.ts`).
 *
 * - `receivableOutstanding`: Σ the team `outstandingAmount` of the store's OUTSTANDING/PARTIAL
 *   receivables, any source, konsi bills included.
 * - `undeliveredOrderResidual`: Σ `nilaiBelumDinota` over the store's APPROVED putus orders that are
 *   not CLOSED — the value of each order's OPEN line quantity, floored at zero PER ORDER (never on
 *   the grand sum, so an over-delivered line lends no headroom to a sibling's shortfall).
 * - `openInvoiceCount` / `openReceivableIds`: the receivables whose balance rounds to at least one
 *   rupiah. A sub-rupiah residue is not an invoice anyone collects, but its sen stay in
 *   `receivableOutstanding`.
 *
 * A receivable is created at the nota, not at approve, so an approved order that is not on a nota
 * yet is committed exposure the receivable ledger cannot see without the residual term — see
 * docs/superpowers/specs/2026-08-27-credit-limit-enforcement-design.md § 2. The residual is measured
 * from the order's own open quantity rather than from its delivery rows, so a nota voided ("tidak
 * jadi dikirim", P16/P25) or corrected at handover (retur langsung P24, lost in transit) needs no
 * special case here: credit follows the order line and the receivable.
 *
 * DELIVERED orders are read too and add 0 (every line settled). Only CLOSED is left out, because
 * CLOSED is terminal for reopening: `closeFieldSalesOrderRemainder` refuses while a shipment is in
 * flight, and both a door refusal and "tidak jadi dikirim" act only on an in-flight shipment. A
 * DELIVERED order, by contrast, reopens pieces through exactly those two paths; reading only
 * PENDING/PARTIAL orders would rest on every such writer recomputing `deliveryStatus` in the same
 * transaction, and one that forgot would silently wave the reopened value through both checks.
 *
 * INVARIANTS this figure rests on (docs/landmines/finance-ar.md):
 * 1. every nota writer raises `FieldSalesOrderLine.deliveredQty` AND creates the nota's receivable
 *    in ONE transaction (`recordFieldSalesDelivery`/`recordFieldSalesDeliveryInTx`); a path writing
 *    a nota without raising deliveredQty would count its pieces twice;
 * 2. an order never reads CLOSED while a line still has open quantity (`nextDeliveryStatus`);
 * 3. every receivable writer keeps both column families in step: `originalAmount = amount`, and
 *    `outstandingAmount = outstanding` = the opening balance (the whole amount for a nota, a manual
 *    invoice, a sell-through report or a konsi cycle; the imported `sisa` for an import, with
 *    `paidBeforeImport = amount − sisa`), a value correction re-runs `hitungUlangPiutang`, and a
 *    void writes `status VOIDED` with `outstandingAmount 0` and `outstanding 0`
 *    (`kolom-piutang.test.ts`). A creator writing only `amount`/`outstanding` would count Rp 0
 *    toward every credit limit, silently.
 *
 * The residual is read from the order's LINES, so an order with no lines adds 0. Every real order
 * has lines; a test fixture that seeds exposure through an approved order must give it an open line
 * (e.g. qty 1, lineTotal = total, deliveredQty 0) or seed a receivable that writes both families.
 *
 * Takes a transaction client so the gating callers run this inside their own serializable
 * transaction against a consistent snapshot, rather than racing the writes they are gating
 * through the un-transacted `prisma` singleton: `createFieldSalesOrder`'s create-time flag and mode
 * decision (read once, shared by both), and `enforceApproveCreditLimit` (`lib/field-sales/writer.ts`),
 * called by the putus approve tail and by `approveKonsiOrderInTx`, the konsi approve core both
 * `approveFieldSalesOrder` and the admin push (`createKonsiPushOrder`) go through. The display
 * previews pass the plain `prisma` client instead and gate nothing: the field-sales order detail
 * page, the konsi push page, the store detail page and `keadaanTagihanToko`.
 */
export async function computeStoreCreditExposure(
  client: Prisma.TransactionClient,
  storeId: string,
): Promise<CreditExposure> {
  const receivables = await client.receivable.findMany({
    where: { storeId, status: { in: ["OUTSTANDING", "PARTIAL"] } },
    select: { id: true, outstandingAmount: true },
  });
  const receivableOutstanding = receivables.reduce((sum, r) => sum + Number(r.outstandingAmount), 0);
  const terbuka = receivables.filter((r) => Math.round(Number(r.outstandingAmount)) >= 1);

  const approvedOrders = await client.fieldSalesOrder.findMany({
    where: { storeId, status: "APPROVED", orderType: "PUTUS", deliveryStatus: { not: "CLOSED" } },
    select: {
      total: true,
      orderDiscountAmount: true,
      lines: { select: { qty: true, deliveredQty: true, cancelledQty: true, lineTotal: true, discountAmount: true } },
    },
  });
  let undeliveredOrderResidual = 0;
  for (const order of approvedOrders) {
    undeliveredOrderResidual += nilaiBelumDinota({
      total: Number(order.total),
      orderDiscountAmount: Number(order.orderDiscountAmount),
      lines: order.lines.map((l) => ({
        qty: l.qty,
        deliveredQty: l.deliveredQty,
        cancelledQty: l.cancelledQty,
        lineTotal: Number(l.lineTotal),
        discountAmount: Number(l.discountAmount),
      })),
    });
  }

  return {
    receivableOutstanding,
    undeliveredOrderResidual,
    openInvoiceCount: terbuka.length,
    openReceivableIds: terbuka.map((r) => r.id),
    total: receivableOutstanding + undeliveredOrderResidual,
  };
}
