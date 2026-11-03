import type { Prisma } from "@elorae/db";

/**
 * The receivables a team collections screen on the phone may read: never a konsi one. A konsi bill
 * — a consignment cycle's receivable (`isConsignment`), a sell-through report's, or any receivable
 * of a store whose terms read KONSI today — is paid from the phone in exactly ONE way, the store
 * payment report (BKM, `lib/receivables/claim-writer.ts`; owner decision 2026-10-29), which finance
 * then verifies against the bank statement. Keeping the team's collection queue, amplop and
 * collector check-in konsi-free is what keeps it one path. It is no longer about hiding prices: the
 * salesman phone shows konsi in full since the owner's answer P18 (2026-11-02).
 *
 * Spread into the `where` of every phone read (`listAmplop`, `listCollectionQueue`,
 * `getReceivableCollectionAccess`). The backoffice verification reads deliberately leave it out.
 */
export const RECEIVABLES_ON_PHONE = {
  sellThroughId: null,
  isConsignment: false,
  store: { termsType: { not: "KONSI" } },
} satisfies Prisma.ReceivableWhereInput;

/**
 * The writer-side twin of the screen scope above: a receivable that is a konsi bill BY ITS OWN
 * MARKS — a consignment cycle's bill or a paper konsi debt typed in by hand (`isConsignment`), or a
 * sell-through report's (`sellThroughId`). Hiding it from the phone screens is not enough, because
 * every `"use server"` export is an independently callable endpoint: the team's settlement document
 * (`submitSettlement`), the collector's submission (`submitCollection`) and a collector assignment
 * (`assignCollector`) each refuse it with `KONSI_LEWAT_BKM`, so its one payment path stays the BKM
 * (owner decision 2026-10-29: "satu jalur bayar (BKM + cek)").
 *
 * The store-terms arm of `RECEIVABLES_ON_PHONE` is deliberately NOT part of this: a putus invoice at
 * a store whose terms read KONSI only today is still a putus invoice (its BKM credits AR_STORE,
 * `lib/finance/lapangan/jurnal.ts`), and no owner answer moves it off these writers, so they keep
 * accepting it as before.
 */
export function isKonsiBill(receivable: { isConsignment: boolean; sellThroughId: string | null }): boolean {
  return receivable.isConsignment || receivable.sellThroughId !== null;
}
