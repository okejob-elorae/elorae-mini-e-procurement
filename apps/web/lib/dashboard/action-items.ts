import { prisma } from "@elorae/db";
import { PERMISSIONS } from "@/lib/rbac";

/**
 * One row of the "needs your attention" panel on Beranda.
 *
 * The dashboard below this panel answers "how are we doing"; this panel answers
 * "what is waiting for me". Those are different questions, and only the second
 * one decays into a problem when nobody looks — an approval nobody grants blocks
 * a salesman, a failed journal silently leaves the GL wrong.
 *
 * `labelKey` is a key under the `dashboardActions` i18n namespace, not a string:
 * this panel is the first thing an operator reads every morning, so it must
 * follow the locale like everything else around it.
 */
export type ActionItem = {
  key: string;
  labelKey: string;
  count: number;
  href: string;
  /** Permission needed to ACT on it. Null = anyone who can open the dashboard. */
  permission: string | null;
  /** `overdue` already cost someone time; `waiting` is merely queued. */
  tone: "overdue" | "waiting";
};

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

export type BuildActionItemsInput = ActionItemCounts & {
  overduePOs: number;
  submittedPOs: number;
  oversoldSkus: number;
  unshippedOrders: number;
};

/**
 * Pure — so the ordering rule is testable without a database.
 * Zero-count rows are dropped here rather than dimmed in the UI: a list of
 * mostly-zeros trains people to stop reading it.
 */
export function buildActionItems(input: BuildActionItemsInput): ActionItem[] {
  const all: ActionItem[] = [
    {
      key: "overduePOs",
      labelKey: "overduePOs",
      count: input.overduePOs,
      href: "/backoffice/purchase-orders?status=overdue",
      permission: PERMISSIONS.PURCHASE_ORDERS_VIEW,
      tone: "overdue",
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
      href: "/backoffice/returns",
      permission: PERMISSIONS.SALES_RETURNS_VIEW,
      tone: "waiting",
    },
    {
      key: "taxInvoicePending",
      labelKey: "taxInvoicePending",
      count: input.taxInvoicePending,
      href: "/backoffice/finance/faktur-pajak",
      permission: PERMISSIONS.TAX_INVOICES_VIEW,
      tone: "waiting",
    },
    {
      key: "submittedPOs",
      labelKey: "submittedPOs",
      count: input.submittedPOs,
      href: "/backoffice/purchase-orders?status=SUBMITTED",
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
  return all
    .filter((item) => item.count > 0)
    .sort((a, b) => toneRank(a.tone) - toneRank(b.tone) || b.count - a.count);
}
