/**
 * The closed set the query layer accepts for `locationTypes` (getItemMovementCard /
 * LedgerLocationType in stock-ledger-card.ts). Restated here rather than imported from
 * there: that module imports the @elorae/db barrel (Prisma), and this file exists
 * precisely so a "use client" file can import a warehouse-option map without any doubt
 * about what comes along with it — this file has no imports of its own.
 */
export const WAREHOUSE_TYPES = ["MAIN", "STORE", "VAN"] as const;
export type WarehouseType = (typeof WAREHOUSE_TYPES)[number];

/**
 * Maps every WarehouseType to its message key under `stockMovements.warehouseOption` in
 * apps/web/lib/i18n/messages/{en,id}.json.
 *
 * Mirrors ledger-ref-display.ts's LEDGER_REF_MESSAGE_KEY: `Record<WarehouseType, string>`
 * is exhaustive over the UNION, so a third warehouse type would fail to compile the
 * moment it landed here without a matching key. It is NOT exhaustive over the LOCALE
 * side of that promise — nothing stops a key here from losing its entry in en.json or
 * id.json, which is what warehouse-option-display.test.ts's parity check is for.
 */
export const WAREHOUSE_OPTION_KEY: Record<WarehouseType, string> = {
  MAIN: "warehouseOption.main",
  STORE: "warehouseOption.store",
  VAN: "warehouseOption.van",
};
