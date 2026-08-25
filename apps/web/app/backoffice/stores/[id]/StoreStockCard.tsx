"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowUpDown, Layers } from "lucide-react";
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
import type {
  StoreStockCardData,
  StoreStockMovementKind,
} from "@/lib/inventory/store-stock-card";

type SerializedMovement = Omit<StoreStockCardData["movements"][number], "occurredAt"> & {
  occurredAtIso: string;
};

type Props = {
  rows: StoreStockCardData["rows"];
  negativeCount: number;
  movements: SerializedMovement[];
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

const MOVEMENT_BADGE_VARIANT: Record<StoreStockMovementKind, "default" | "secondary"> = {
  TRANSFER_IN: "default",
  RETUR_OUT: "secondary",
};

export function StoreStockCard({ rows, negativeCount, movements }: Props) {
  const t = useTranslations("stores.stockCard");

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
        <CardContent>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowUpDown className="h-4 w-4" />
            {t("movementsTitle")}
            <span className="text-sm font-normal text-muted-foreground ml-2">({movements.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
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
                  {movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(m.occurredAtIso)}
                      </TableCell>
                      <TableCell>
                        <Link href={m.href} className="font-mono text-xs text-primary hover:underline">
                          {m.docNo}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">
                        {m.itemName}
                        {m.variantSku && <span className="text-muted-foreground"> · {m.variantSku}</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={MOVEMENT_BADGE_VARIANT[m.kind]}>
                          {m.kind === "TRANSFER_IN" ? t("movementIn") : t("movementOut")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{m.qty}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
