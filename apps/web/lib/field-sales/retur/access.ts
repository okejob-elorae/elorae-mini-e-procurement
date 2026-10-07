import { hasPermission, PERMISSIONS } from "@/lib/rbac";

/**
 * EITHER `field_sales_orders:view` OR `field_returns:manage` opens the field retur register and
 * its detail page, so a warehouse-only role can reach the register it receives against. The gate
 * lives in the two server pages, not in `ROUTE_PERMISSIONS`, because that map holds exactly one
 * permission per route; the deliveries register is gated the same way for the same reason. Each
 * action inside the register still enforces its own permission.
 */
export function canViewFieldReturns(permissions: string[]): boolean {
  return (
    hasPermission(permissions, PERMISSIONS.FIELD_SALES_ORDERS_VIEW) ||
    hasPermission(permissions, PERMISSIONS.FIELD_RETURNS_MANAGE)
  );
}
