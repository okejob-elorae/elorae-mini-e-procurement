"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowUpDown, Info, Layers } from "lucide-react";
/* Subpath import, not the main barrel: this is a client component, and @elorae/db's barrel
   eagerly pulls in Prisma and the mariadb driver, which would follow it into the browser
   bundle. */
import type { StockLedgerRefType } from "@elorae/db/stock-ledger-ref";
import { isStockLedgerRefType } from "@elorae/db/stock-ledger-ref";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { StoreStockCardData } from "@/lib/inventory/store-stock-card";
import { ledgerRefMessageKey } from "@/lib/inventory/ledger-ref-display";
import type { AssortmentGapRow } from "@/lib/stores/assortment/queries";
import { cn } from "@/lib/utils";

export type SerializedStockMovement = Omit<StoreStockCardData["movements"][number], "occurredAt"> & {
  occurredAtIso: string;
};

type Props = {
  rows: StoreStockCardData["rows"];
  negativeCount: number;
  /**
   * Two figures for an ADMIN-origin return that has left this ledger, or is about to, but has
   * not yet reached APPROVED. `raisedQty` — still `PENDING_WAREHOUSE_RECEIVING` — is claimed but
   * not yet decremented, so this ledger OVERSTATES on-hand stock by that amount while the goods
   * are physically on a truck. `receivedQty` — `MISMATCH_PENDING_RESOLUTION` or
   * `PENDING_APPROVAL` — has already been decremented at receipt, so this ledger UNDERSTATES
   * on-hand stock by that amount, with no movement row below to explain the drop until the
   * return is approved. Display only — never netted out of this card's own rows or of the
   * stocktake's `expectedQty`, both of which read the ledger as-is by design.
   */
  inTransitAdminReturn: { raisedQty: number; receivedQty: number };
  movements: SerializedStockMovement[];
  /** True when the movement fetch hit `movementLimit` — older movements exist and were dropped. */
  movementsTruncated: boolean;
  movementLimit: number;
  /**
   * The store's assortment lines the ledger falls short on. A row missing from `rows` entirely
   * is the never-received case; a row present in `rows` at or under target is depleted — the two
   * read identically as an `onHandQty` of 0 from the gap query alone, so this component tells
   * them apart itself by checking membership in `rows`, never by trusting a flag from the query.
   */
  gaps: AssortmentGapRow[];
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Badge color per registry member — exhaustive over ALL twenty StockLedgerRefType members,
 * even though only KonsiTransfer, FieldReturn, SpgSale and StoreStocktake can ever appear on
 * a card scoped to `locationType: "STORE"` (see AGENTS.md's "StoreStock has FIVE writers"
 * landmine entry). A member added to the registry later fails to compile here until it is
 * placed, the same guard `LEDGER_REF_MESSAGE_KEY` applies to copy. Every refType that cannot
 * reach this card stays "secondary" — there is no direction to signal for it here.
 */
const MOVEMENT_BADGE_VARIANT: Record<StockLedgerRefType, "default" | "secondary"> = {
  FGReceipt: "secondary",
  FieldReturn: "secondary",
  FieldSalesConsume: "secondary",
  FulfillmentConsume: "secondary",
  GRN: "secondary",
  JubelioStockAdjustment: "secondary",
  KonsiTransfer: "default",
  MaterialIssue: "secondary",
  OpeningBalance: "secondary",
  OpeningStock: "secondary",
  Reconciliation: "secondary",
  SalesReturn: "secondary",
  SpgSale: "secondary",
  StockAdjustment: "secondary",
  StockOpname: "secondary",
  StoreStocktake: "secondary",
  VanLoad: "secondary",
  VanReconcile: "secondary",
  VanSale: "secondary",
  VendorReturn: "secondary",
};

/**
 * Falls back to "secondary" for a raw refType outside the registry — the column is a
 * free-form String and fixture rows on the shared dev database genuinely hold values like
 * "TEST". Same shape as `ledgerRefMessageKey`: never index the Record directly.
 */
function movementBadgeVariant(refType: string): "default" | "secondary" {
  return isStockLedgerRefType(refType) ? MOVEMENT_BADGE_VARIANT[refType] : "secondary";
}

export function StoreStockCard({
  rows,
  negativeCount,
  inTransitAdminReturn,
  movements,
  movementsTruncated,
  movementLimit,
  gaps,
}: Props) {
  const t = useTranslations("stores.stockCard");
  const tMovements = useTranslations("stockMovements");
  const stockedKeys = new Set(rows.map((row) => `${row.itemId}::${row.variantSku}`));

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" />
            {t("cardTitle")}
            <span className="text-sm font-normal text-muted-foreground ml-2">({rows.length})</span>
            {negativeCount > 0 && (
              <Badge variant="destructive" className="ml-2">
                {t("negativeCount", { count: negativeCount })}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(inTransitAdminReturn.raisedQty > 0 || inTransitAdminReturn.receivedQty > 0) && (
            <div className="space-y-2">
              {inTransitAdminReturn.raisedQty > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-amber-700">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <p className="text-xs">{t("inTransitNote", { qty: inTransitAdminReturn.raisedQty })}</p>
                </div>
              )}
              {inTransitAdminReturn.receivedQty > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-amber-700">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <p className="text-xs">{t("receivedAwaitingApprovalNote", { qty: inTransitAdminReturn.receivedQty })}</p>
                </div>
              )}
            </div>
          )}
          {rows.length === 0 ? (
            <div className="text-center py-8">
              <Layers className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="overflow-auto max-h-96 rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead>{t("colArticle")}</TableHead>
                      <TableHead>{t("colSize")}</TableHead>
                      <TableHead className="text-right">{t("colQty")}</TableHead>
                      <TableHead>{t("colElsewhere")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const isNegative = row.qty < 0;
                      return (
                        <TableRow key={`${row.itemId}::${row.variantSku}`} className={isNegative ? "bg-destructive/5" : undefined}>
                          <TableCell className="text-sm">{row.itemName}</TableCell>
                          <TableCell className="font-mono text-xs">{row.variantSku || "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span className={isNegative ? "font-semibold text-destructive" : undefined}>
                              {row.qty}
                            </span>
                            {isNegative && (
                              <Badge variant="destructive" className="ml-2">
                                {t("negativeBadge")}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {t("elsewhere", { main: row.mainQty, van: row.vanQty })}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {negativeCount > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-destructive">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <p className="text-xs">{t("negativeNote")}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {gaps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4" />
              {t("gapCardTitle")}
              <Badge variant="destructive" className="ml-2">
                {gaps.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">{t("gapNote")}</p>
            <div className="overflow-auto max-h-96 rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead>{t("gapColArticle")}</TableHead>
                    <TableHead>{t("gapColSize")}</TableHead>
                    <TableHead className="text-right">{t("gapColOnHand")}</TableHead>
                    <TableHead>{t("gapColTarget")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gaps.map((gap) => {
                    const key = `${gap.itemId}::${gap.variantSku}`;
                    const isMissing = !stockedKeys.has(key);
                    return (
                      <TableRow key={key}>
                        <TableCell className="text-sm">{gap.productName}</TableCell>
                        <TableCell className="font-mono text-xs">{gap.variantSku || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className={isMissing ? "text-muted-foreground" : "font-semibold text-destructive"}>
                            {gap.onHandQty}
                          </span>
                          <Badge variant={isMissing ? "outline" : "destructive"} className="ml-2">
                            {isMissing ? t("gapStatusMissing") : t("gapStatusDepleted")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {gap.targetQty === null ? (
                            <Badge variant="outline">{t("gapTargetMustBePresent")}</Badge>
                          ) : (
                            <span className="tabular-nums">{t("gapTargetMin", { qty: gap.targetQty })}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowUpDown className="h-4 w-4" />
            {t("movementsTitle")}
            <span className="text-sm font-normal text-muted-foreground ml-2">({movements.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/*
           * Always visible, regardless of movements.length — without it an empty list on a
           * store whose whole history predates the ledger cutover reads as "no movements ever
           * happened" rather than "not recorded here", the same misreading the movements
           * page's own cutover banner exists to prevent.
           */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>{t("movementsCutoverNote")}</AlertDescription>
          </Alert>
          {movementsTruncated && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{t("movementsTruncated", { limit: movementLimit })}</AlertDescription>
            </Alert>
          )}
          {movements.length === 0 ? (
            <div className="text-center py-8">
              <ArrowUpDown className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">{t("movementsEmpty")}</p>
            </div>
          ) : (
            <div className="overflow-auto max-h-96 rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead>{t("colDate")}</TableHead>
                    <TableHead>{t("colDoc")}</TableHead>
                    <TableHead>{t("colArticle")}</TableHead>
                    <TableHead>{t("colType")}</TableHead>
                    <TableHead className="text-right">{t("colQty")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((m) => {
                    const refTypeKey = ledgerRefMessageKey(m.refType);
                    const refTypeLabel = refTypeKey ? tMovements(refTypeKey) : m.refType;
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDateTime(m.occurredAtIso)}
                        </TableCell>
                        <TableCell>
                          {/* refDocNumber defaults to "" for the opening-balance migration
                              rows and a few writers that omit it — render a placeholder
                              rather than a dead cell, never a bare link with empty text. */}
                          {m.docNo ? (
                            m.href ? (
                              <Link href={m.href} className="font-mono text-xs text-primary hover:underline">
                                {m.docNo}
                              </Link>
                            ) : (
                              <span className="font-mono text-xs text-muted-foreground">{m.docNo}</span>
                            )
                          ) : (
                            <span className="font-mono text-xs text-muted-foreground">{tMovements("noDocument")}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {m.itemName}
                          {m.variantSku && <span className="text-muted-foreground"> · {m.variantSku}</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={movementBadgeVariant(m.refType)}>{refTypeLabel}</Badge>
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            m.qty > 0 && "text-emerald-600 dark:text-emerald-400",
                            m.qty < 0 && "text-red-600 dark:text-red-400",
                          )}
                        >
                          {m.qty > 0 ? `+${m.qty.toLocaleString()}` : m.qty.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
