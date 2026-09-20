"use server";

import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { isStockLedgerRefType, type StockLedgerRefType } from "@elorae/db/stock-ledger-ref";
import {
  getItemMovementCard,
  QUERY_ENTRY_LIMIT,
  type ItemMovementCard,
  type LedgerLocationType,
} from "@/lib/inventory/stock-ledger-card";

/* Closed set mirroring LedgerLocationType — that type has no runtime array of its own
   (it's a plain string union), so this is the one place that needs to check membership
   against real values rather than just the type. */
const LEDGER_LOCATION_TYPES: readonly LedgerLocationType[] = ["MAIN", "STORE", "VAN"];

function isLedgerLocationType(value: unknown): value is LedgerLocationType {
  return typeof value === "string" && (LEDGER_LOCATION_TYPES as readonly string[]).includes(value);
}

export type GetItemMovementsInput = {
  itemId: string;
  variantSku?: string;
  /** Calendar-day strings ("yyyy-MM-dd"), anchored to WIB, never a raw ISO instant. */
  from?: string;
  to?: string;
  locationTypes?: LedgerLocationType[];
  refTypes?: StockLedgerRefType[];
};

/*
 * The client never imports stock-ledger-card.ts directly — that module imports the
 * @elorae/db barrel (Prisma) at the top, and a "use client" file importing anything from
 * it, even a plain constant, risks dragging Prisma into the browser bundle. So the query
 * ceiling is folded into this action's own return shape instead of being re-exported for
 * the client to import on its own.
 */
export type ItemMovementsResult = ItemMovementCard & { queryEntryLimit: number };

/**
 * Every "use server" export is independently callable regardless of what the page gated
 * on, so this re-checks inventory:view itself rather than trusting the page's redirect.
 */
export async function getItemMovementsAction(input: GetItemMovementsInput): Promise<ItemMovementsResult> {
  const session = await auth();
  const permissions = session?.user?.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.INVENTORY_VIEW)) {
    throw new Error("FORBIDDEN");
  }

  /*
   * The control only ever sends members of the closed set / registry it renders, but this
   * export is independently callable, so the form withholding a bad value is not a
   * guarantee. Reject outright rather than dropping the offending member and proceeding:
   * a silently-narrowed filter would hand the operator a result set that looks like it
   * matches their filter selection when it does not.
   */
  if (input.locationTypes !== undefined && !input.locationTypes.every(isLedgerLocationType)) {
    throw new Error("INVALID_LOCATION_TYPE");
  }
  if (input.refTypes !== undefined && !input.refTypes.every(isStockLedgerRefType)) {
    throw new Error("INVALID_REF_TYPE");
  }

  const card = await getItemMovementCard({
    itemId: input.itemId,
    variantSku: input.variantSku,
    /*
     * WIB-anchored, not a bare `new Date(string)`: the process may run UTC in prod, and a
     * naive parse would shift both boundaries ~7h and pull rows from the wrong calendar day
     * into (or out of) the filter — same class of bug the aging report's landmine entry
     * names for daysOverdue.
     */
    from: input.from ? parseDateOnly(input.from) : undefined,
    to: input.to ? parseDateOnlyEnd(input.to) : undefined,
    locationTypes: input.locationTypes,
    refTypes: input.refTypes,
  });

  return { ...card, queryEntryLimit: QUERY_ENTRY_LIMIT };
}
