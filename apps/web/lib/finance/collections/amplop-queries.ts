import { prisma } from "@elorae/db";
import { roundCents } from "@elorae/db/pricing";
import { daysOverdue, isOverdue } from "@/lib/finance/ar/aging";
import { getStoreAvailableCreditMap } from "@/lib/finance/ar/retur-offset-queries";

export type AmplopReceivableRow = {
  receivableId: string;
  docNo: string;
  dueDate: Date;
  outstandingAmount: number;
  daysOverdue: number;
  taxInvoiceStatus: string | null;
  pendingSubmittedAmount: number;
};

export type AmplopStoreCard = {
  storeId: string;
  storeName: string;
  rows: AmplopReceivableRow[];
  totalOutstanding: number;
  totalOverdue: number;
  availableCredit: number;
};

export type Amplop = {
  stores: AmplopStoreCard[];
  totalOutstanding: number;
  totalOverdue: number;
};

/**
 * The whole "amplop digital" screen in one query, grouped by store.
 *
 * The store set is the union of stores where `userId` is the assigned collector
 * (`Receivable.collectorId`) and stores where `userId` is the ORDER's salesman
 * (`delivery.order.salesmanId`) — deliberately NOT `delivery.deliveredById`, which since the
 * delivery-shipment work is frequently a backoffice admin completing an expedition shipment
 * rather than the salesman who actually visits the store. Keying on `deliveredById` would file
 * stores into that admin's amplop and silently drop them from the salesman's.
 *
 * `asOf` defaults to `new Date()` but is a real parameter so aging is deterministic in tests.
 */
export async function listAmplop(userId: string, asOf: Date = new Date()): Promise<Amplop> {
  const receivables = await prisma.receivable.findMany({
    where: {
      status: { in: ["OUTSTANDING", "PARTIAL"] },
      OR: [
        { collectorId: userId },
        { delivery: { order: { salesmanId: userId } } },
      ],
    },
    orderBy: { dueDate: "asc" },
    select: {
      id: true,
      storeId: true,
      outstandingAmount: true,
      dueDate: true,
      store: { select: { name: true } },
      delivery: {
        select: {
          docNo: true,
          taxInvoice: { select: { status: true } },
        },
      },
      submissions: { where: { status: "PENDING" }, select: { amount: true } },
    },
  });

  const cardsByStore = new Map<string, AmplopStoreCard>();

  for (const r of receivables) {
    let card = cardsByStore.get(r.storeId);
    if (!card) {
      card = {
        storeId: r.storeId,
        storeName: r.store.name,
        rows: [],
        totalOutstanding: 0,
        totalOverdue: 0,
        availableCredit: 0,
      };
      cardsByStore.set(r.storeId, card);
    }

    const outstandingAmount = roundCents(Number(r.outstandingAmount));
    const row: AmplopReceivableRow = {
      receivableId: r.id,
      docNo: r.delivery.docNo,
      dueDate: r.dueDate,
      outstandingAmount,
      daysOverdue: daysOverdue(r.dueDate, asOf),
      taxInvoiceStatus: r.delivery.taxInvoice?.status ?? null,
      pendingSubmittedAmount: roundCents(r.submissions.reduce((sum, sub) => sum + Number(sub.amount), 0)),
    };

    card.rows.push(row);
    card.totalOutstanding = roundCents(card.totalOutstanding + outstandingAmount);
    if (isOverdue(r.dueDate, asOf)) {
      card.totalOverdue = roundCents(card.totalOverdue + outstandingAmount);
    }
  }

  const storeIds = Array.from(cardsByStore.keys());
  const creditMap = await getStoreAvailableCreditMap(storeIds);
  for (const [storeId, card] of cardsByStore) {
    /**
     * Deliberately store-wide, unlike `totalOutstanding`/`totalOverdue` above which are summed
     * from only this user's matched rows — `availableCredit` is the store's entire offsettable
     * retur balance, so two salesmen serving the same store both see the same figure. That is
     * intentional: it is genuinely the store's standing credit, not a per-user share of it, and
     * slice 3's settlement computation draws its offset from this same store-wide figure.
     */
    card.availableCredit = creditMap.get(storeId) ?? 0;
  }

  const stores = Array.from(cardsByStore.values()).sort((a, b) => {
    if (b.totalOverdue !== a.totalOverdue) return b.totalOverdue - a.totalOverdue;
    return a.storeName.localeCompare(b.storeName);
  });

  const totalOutstanding = roundCents(stores.reduce((sum, c) => sum + c.totalOutstanding, 0));
  const totalOverdue = roundCents(stores.reduce((sum, c) => sum + c.totalOverdue, 0));

  return { stores, totalOutstanding, totalOverdue };
}
