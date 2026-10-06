import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import {
  buildActionItems,
  getActionItemCounts,
} from "@/lib/dashboard/action-items";
import { getDraftPOCount, getOverduePOCount } from "@/lib/purchase-orders/queries";
import { countOversoldInventory } from "@/lib/dashboard/queries";
import { getMarketplaceKpi } from "@/lib/sales-orders/queries";
import { bagiLencana } from "@/lib/nav/lencana";

export const dynamic = "force-dynamic";


/**
 * Which nav group each waiting-work item belongs to, keyed by the top-level
 * nav href in BackofficeShell. Purchase orders have their own group
 * (Pembelian, `/backoffice/purchase-orders`) since 2026-10-06.
 */
const NAV_GROUP_BY_ITEM: Record<string, string> = {
  overduePOs: "/backoffice/purchase-orders",
  draftPOs: "/backoffice/purchase-orders",
  oversold: "/backoffice/inventory",
  journalPending: "#",
  taxInvoicePending: "#",
  fieldSalesPendingApproval: "/backoffice/sales-orders",
  unshippedOrders: "/backoffice/sales-orders",
  salesReturnPending: "/backoffice/sales-orders",
  storeChangesPending: "/backoffice/suppliers",
};

/**
 * Badge counts for the sidebar — "where is work piling up", answered without
 * opening every menu.
 *
 * Deliberately a client-fetched route rather than data threaded through the
 * layout: the shell renders on every backoffice navigation, and blocking each
 * one on five COUNT queries would trade a real cost for a decoration.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const permissions = session.user.permissions ?? [];

  try {
    const [counts, overduePOs, draftPOs, oversoldSkus, marketplaceKpi] =
      await Promise.all([
        getActionItemCounts(),
        getOverduePOCount(),
        getDraftPOCount(),
        countOversoldInventory(),
        getMarketplaceKpi(),
      ]);

    const items = buildActionItems({
      ...counts,
      overduePOs,
      draftPOs,
      oversoldSkus,
      unshippedOrders: marketplaceKpi.pendingFulfillmentCount,
    });

    /*
     * Same permission filter the panel uses: a badge must never advertise work
     * behind a door this user cannot open.
     *
     * Counted twice on purpose — once against the parent group, and once
     * against the page the work actually lives on. The parent badge says "two
     * things are waiting"; the page badge is the half that answers "where".
     *
     * TWO SEPARATE MAPS, not one keyed by href. Some parents share their href
     * with one of their own children — `production` and its Plan Kerja entry
     * are both `/backoffice/production/planning` — so a single map made that
     * child inherit the whole GROUP's total and wear a badge for work that
     * lives on a different page entirely. Splitting them is the only fix that
     * does not depend on every parent href being unique, which nothing
     * enforces.
     */
    const terlihat = items.filter(
      (item) => !item.permission || hasPermission(permissions, item.permission),
    );
    const { grup, halaman } = bagiLencana(terlihat, NAV_GROUP_BY_ITEM);

    return NextResponse.json({ counts: grup, pages: halaman });
  } catch (err) {
    // A failed badge fetch must never break the shell around it.
    console.error("nav-counts failed:", err);
    return NextResponse.json({ counts: {}, pages: {} });
  }
}
