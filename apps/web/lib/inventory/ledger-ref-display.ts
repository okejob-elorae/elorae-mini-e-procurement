/* Subpath import, not the main barrel: a client component imports this file, and
   @elorae/db's barrel eagerly pulls in Prisma and the mariadb driver, which would
   follow it into the browser bundle. */
import type { StockLedgerRefType } from "@elorae/db/stock-ledger-ref";
import { isStockLedgerRefType } from "@elorae/db/stock-ledger-ref";

/**
 * Maps every StockLedgerRefType registry member to its message key under the
 * `stockMovements.refType` namespace in apps/web/lib/i18n/messages/{en,id}.json.
 *
 * This map is exhaustive over the REGISTRY: `Record<StockLedgerRefType, string>`
 * fails to compile the moment a new registry member lands without a matching key
 * here, so a new StockLedgerRefType always ships with operator-facing copy in both
 * locales. It is not exhaustive over the COLUMN — see `ledgerRefMessageKey` below.
 */
export const LEDGER_REF_MESSAGE_KEY: Record<StockLedgerRefType, string> = {
  FGReceipt: "refType.fgReceipt",
  FieldReturn: "refType.fieldReturn",
  FieldSalesConsume: "refType.fieldSalesConsume",
  FulfillmentConsume: "refType.fulfillmentConsume",
  GRN: "refType.grn",
  GRNReversal: "refType.grnReversal",
  JubelioStockAdjustment: "refType.jubelioStockAdjustment",
  KonsiTransfer: "refType.konsiTransfer",
  MaterialIssue: "refType.materialIssue",
  OpeningBalance: "refType.openingBalance",
  OpeningStock: "refType.openingStock",
  Reconciliation: "refType.reconciliation",
  SalesReturn: "refType.salesReturn",
  SpgSale: "refType.spgSale",
  StockAdjustment: "refType.stockAdjustment",
  StockOpname: "refType.stockOpname",
  StoreStocktake: "refType.storeStocktake",
  StoreTransfer: "refType.storeTransfer",
  VanLoad: "refType.vanLoad",
  VanReconcile: "refType.vanReconcile",
  VanSale: "refType.vanSale",
  VendorReturn: "refType.vendorReturn",
};

/**
 * Resolves a ledger `refType` to its message key, or `null` when the value is not a
 * registered member. `StockLedgerEntry.refType` is a free-form String column and
 * genuinely holds values outside the registry today (e.g. "TEST" rows written by test
 * fixtures on the shared dev database) — so this must be the only way a caller reads
 * `LEDGER_REF_MESSAGE_KEY`, never a direct index. `null` means "no copy for this
 * value"; the caller renders the raw `refType` instead. Same rule the grouper already
 * applies to an unresolved `locationId`: render what you have, never drop, never throw.
 */
export function ledgerRefMessageKey(refType: string): string | null {
  return isStockLedgerRefType(refType) ? LEDGER_REF_MESSAGE_KEY[refType] : null;
}
