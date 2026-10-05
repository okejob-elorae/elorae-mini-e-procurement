import { prisma } from "@elorae/db";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bolehMembacaPiutang } from "@/lib/receivables/izin";
import type { ActionItem } from "./action-items-shared";

// Client components import the row type and the total from the shared module;
// this one pulls Prisma and must stay server-only.
export { totalActionDocuments, type ActionItem } from "./action-items-shared";

export type ActionItemCounts = {
  fieldSalesPendingApproval: number;
  storeChangesPending: number;
  taxInvoicePending: number;
  salesReturnPending: number;
  journalPending: number;
};

/**
 * Counts that no other dashboard query already fetches. Everything the page
 * loads anyway (overdue POs, oversold stock, submitted POs, unshipped orders)
 * is folded in by `buildActionItems` instead of being counted twice.
 */
export async function getActionItemCounts(): Promise<ActionItemCounts> {
  const [
    fieldSalesPendingApproval,
    storeChangesPending,
    taxInvoicePending,
    salesReturnPending,
    journalPending,
  ] = await Promise.all([
    prisma.fieldSalesOrder.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.storeChangeRequest.count({ where: { status: "PENDING" } }),
    prisma.taxInvoice.count({ where: { status: "PENDING" } }),
    prisma.salesReturn.count({ where: { status: "PENDING" } }),
    prisma.adminNotification.count({
      where: { category: "JOURNAL_PENDING", readAt: null },
    }),
  ]);

  return {
    fieldSalesPendingApproval,
    storeChangesPending,
    taxInvoicePending,
    salesReturnPending,
    journalPending,
  };
}

/**
 * Payment claims (BKM) a salesperson reported that finance has not yet matched
 * against the bank statement — status `DIKIRIM`. Same definition as the
 * receivables dashboard (`muatDasbor`: count of DIKIRIM claims, Σ
 * `receivedAmount`), as a single aggregate: that helper also loads every
 * receivable, return and photo, which this panel has no use for.
 *
 * Dashboard-only on purpose — not part of `getActionItemCounts`, which also
 * feeds the sidebar badges on every navigation.
 */
export async function getClaimsAwaitingVerification(): Promise<{ count: number; amount: number }> {
  const agg = await prisma.paymentClaim.aggregate({
    where: { status: "DIKIRIM" },
    _count: { _all: true },
    _sum: { receivedAmount: true },
  });
  return { count: agg._count._all, amount: Number(agg._sum.receivedAmount ?? 0) };
}

export type BuildActionItemsInput = ActionItemCounts & {
  overduePOs: number;
  /** DRAFT POs: written by purchasing, waiting for an approver to send them to the supplier. */
  draftPOs: number;
  oversoldSkus: number;
  unshippedOrders: number;
  /** Rupiah value of the overdue POs, when the caller has it. */
  overduePOsAmount?: number;
  /** Invoices past the promised payment date (receivables state `lewat`). */
  overduePromises?: { count: number; amount: number };
  /** BKM claims waiting for finance to verify. */
  claimsAwaitingVerification?: { count: number; amount: number };
};

/**
 * Baris yang pagarnya bukan satu izin. "Lewat janji bayar" memakai aturan yang
 * SAMA dengan kartu piutang di sebelahnya (`bolehMembacaPiutang`: view ATAU
 * manage) — dengan `receivables:view` saja, pemegang receivables:manage melihat
 * angka "lewat janji" di kartu tetapi barisnya hilang dari daftar tindakan.
 *
 * Satu kode izin tidak bisa menyatakan "view ATAU manage", jadi baris ini
 * selalu keluar dengan `permission: null` dan pagarnya dipegang di dua tempat:
 * - dengan `izin`, di sini (`bolehMembacaPiutang`);
 * - tanpa `izin`, oleh pemanggil: `overduePromises` hanya boleh diisi untuk
 *   penonton yang lolos `bolehMembacaPiutang` — beranda mengisinya dari
 *   ringkasan piutang yang hanya dimuat untuk kartu piutang (`kartuBeranda`).
 *   Tanpa datanya hitungannya nol, dan baris nol dibuang.
 */
const CUSTOM_GATES: Readonly<Record<string, (izin: string[]) => boolean>> = {
  overduePromises: bolehMembacaPiutang,
};

/**
 * Pure — so the ordering rule is testable without a database.
 * Zero-count rows are dropped here rather than dimmed in the UI: a list of
 * mostly-zeros trains people to stop reading it.
 *
 * Dengan `izin` (izin penonton), baris disaring DI SINI: baris satu-izin lewat
 * `hasPermission`, baris berpagar khusus lewat aturannya sendiri. Tanpa `izin`
 * baris satu-izin memegang izinnya untuk saringan `!permission ||
 * hasPermission(…)` pemanggil, dan baris berpagar khusus bergantung pada
 * pemanggil yang hanya mengisi datanya untuk penonton yang berhak (lihat
 * `CUSTOM_GATES`).
 */
export function buildActionItems(input: BuildActionItemsInput, izin?: string[]): ActionItem[] {
  const all: ActionItem[] = [
    {
      key: "overduePOs",
      labelKey: "overduePOs",
      count: input.overduePOs,
      href: "/backoffice/purchase-orders?status=overdue",
      permission: PERMISSIONS.PURCHASE_ORDERS_VIEW,
      tone: "overdue",
      amount: input.overduePOsAmount,
    },
    {
      key: "overduePromises",
      labelKey: "overduePromises",
      count: input.overduePromises?.count ?? 0,
      href: "/backoffice/piutang?keadaan=lewat",
      // Pagarnya `bolehMembacaPiutang`, bukan satu kode — lihat CUSTOM_GATES.
      permission: null,
      tone: "overdue",
      amount: input.overduePromises?.amount,
    },
    {
      key: "oversold",
      labelKey: "oversold",
      count: input.oversoldSkus,
      href: "/backoffice/inventory?tab=stock&oversold=1",
      permission: PERMISSIONS.INVENTORY_VIEW,
      tone: "overdue",
    },
    {
      key: "journalPending",
      labelKey: "journalPending",
      count: input.journalPending,
      href: "/backoffice/finance/journals",
      permission: PERMISSIONS.JOURNALS_VIEW,
      tone: "overdue",
    },
    {
      key: "fieldSalesPendingApproval",
      labelKey: "fieldSalesPendingApproval",
      count: input.fieldSalesPendingApproval,
      href: "/backoffice/field-sales-orders?status=PENDING_APPROVAL",
      permission: PERMISSIONS.FIELD_SALES_ORDERS_VIEW,
      tone: "waiting",
    },
    {
      key: "claimsAwaitingVerification",
      labelKey: "claimsAwaitingVerification",
      count: input.claimsAwaitingVerification?.count ?? 0,
      href: "/backoffice/pelunasan",
      // Verifying a claim is finance's call (`journals:manage`, see
      // `lib/receivables/izin.ts`) — a row nobody here can act on is noise.
      permission: PERMISSIONS.JOURNALS_MANAGE,
      tone: "waiting",
      amount: input.claimsAwaitingVerification?.amount,
    },
    {
      key: "unshippedOrders",
      labelKey: "unshippedOrders",
      count: input.unshippedOrders,
      href: "/backoffice/fulfillment",
      permission: PERMISSIONS.SALES_ORDERS_VIEW,
      tone: "waiting",
    },
    {
      key: "salesReturnPending",
      labelKey: "salesReturnPending",
      count: input.salesReturnPending,
      href: "/backoffice/returns?status=PENDING",
      permission: PERMISSIONS.SALES_RETURNS_VIEW,
      tone: "waiting",
    },
    {
      key: "taxInvoicePending",
      labelKey: "taxInvoicePending",
      count: input.taxInvoicePending,
      href: "/backoffice/finance/faktur-pajak?status=PENDING",
      permission: PERMISSIONS.TAX_INVOICES_VIEW,
      tone: "waiting",
    },
    {
      // SUBMITTED means approved and sent to the supplier (only an approver can
      // submit — `changePOStatus`); what waits for approval is a DRAFT.
      key: "draftPOs",
      labelKey: "draftPOs",
      count: input.draftPOs,
      href: "/backoffice/purchase-orders?status=DRAFT",
      permission: PERMISSIONS.PURCHASE_ORDERS_VIEW,
      tone: "waiting",
    },
    {
      key: "storeChangesPending",
      labelKey: "storeChangesPending",
      count: input.storeChangesPending,
      href: "/backoffice/stores",
      permission: PERMISSIONS.STORES_VIEW,
      tone: "waiting",
    },
  ];

  // Overdue before waiting, then by size. Stable within a tone so the list does
  // not reshuffle under someone's cursor when two rows share a count.
  const toneRank = (t: ActionItem["tone"]) => (t === "overdue" ? 0 : 1);
  const visible =
    izin === undefined
      ? all
      : all.flatMap((item): ActionItem[] => {
          const gate = CUSTOM_GATES[item.key];
          if (gate) return gate(izin) ? [item] : [];
          return !item.permission || hasPermission(izin, item.permission) ? [item] : [];
        });
  return visible
    .filter((item) => item.count > 0)
    .sort((a, b) => toneRank(a.tone) - toneRank(b.tone) || b.count - a.count);
}
