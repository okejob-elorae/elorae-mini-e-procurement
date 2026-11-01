import type { Prisma } from "@elorae/db";

/**
 * The receivables a collections screen on the phone may read: never a konsi one. Konsi prices and
 * totals never reach the salesman's phone, so a konsi store's receivable — and every sell-through
 * report's, which is valued at konsi prices whatever the store's terms read today — is collected
 * from the backoffice only. The store half is the rule `daftarPiutang` applies to the whole
 * receivables module.
 *
 * Spread into the `where` of every phone read (`listAmplop`, `listCollectionQueue`,
 * `getReceivableCollectionAccess`). The backoffice verification reads deliberately leave it out.
 */
export const RECEIVABLES_ON_PHONE = {
  sellThroughId: null,
  store: { termsType: { not: "KONSI" } },
} satisfies Prisma.ReceivableWhereInput;
