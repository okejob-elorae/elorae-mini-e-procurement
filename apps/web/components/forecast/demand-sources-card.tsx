"use client";

import { useTranslations } from "next-intl";
import { Layers } from "lucide-react";
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
import type { DemandSourceCoverage, DemandSourceMonth } from "@/app/actions/forecast";
import type { MarketplaceFamily } from "@/lib/forecast/marketplace-demand";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FAMILIES: MarketplaceFamily[] = ["SHOPEE", "TIKTOK"];

function MarketplaceCell({ month, family }: { month: DemandSourceMonth; family: MarketplaceFamily }) {
  const t = useTranslations("forecast.sources");
  const d = month.marketplace[family];
  const imported = month.importedQty[family];
  if (!d && imported === 0) return <span className="text-muted-foreground">—</span>;

  const notes: string[] = [];
  if (d) {
    if (d.dedupedOrders > 0) notes.push(t("deduped", { count: d.dedupedOrders }));
    if (d.unmappedQty > 0) notes.push(t("unmapped", { qty: d.unmappedQty }));
    if (d.missingPayoutOrders > 0) notes.push(t("missingPayout", { count: d.missingPayoutOrders }));
    if (d.ambiguousOrders > 0) notes.push(t("ambiguous", { count: d.ambiguousOrders }));
    if (d.refundedOrders > 0) notes.push(t("refunded", { count: d.refundedOrders }));
  }

  return (
    <div className="space-y-1">
      {d ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="tabular-nums">{t("synced", { qty: d.countedQty })}</span>
          {d.settled ? (
            <Badge variant="secondary">{t("settled")}</Badge>
          ) : (
            <Badge variant="outline">{t("provisional", { orders: d.provisionalOrders })}</Badge>
          )}
        </div>
      ) : null}
      {imported > 0 ? (
        <div className="text-xs text-muted-foreground tabular-nums">{t("excel", { qty: imported })}</div>
      ) : null}
      {notes.length > 0 ? <div className="text-xs text-muted-foreground">{notes.join(" · ")}</div> : null}
    </div>
  );
}

export function DemandSourcesCard({ sources }: { sources: DemandSourceCoverage }) {
  const t = useTranslations("forecast.sources");

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-5 w-5" />
          {t("title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("description", {
            shopee: sources.payoutDelayDays.SHOPEE,
            tiktok: sources.payoutDelayDays.TIKTOK,
          })}
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("month")}</TableHead>
              <TableHead>{t("shopee")}</TableHead>
              <TableHead>{t("tiktok")}</TableHead>
              <TableHead className="text-right">{t("offline")}</TableHead>
              <TableHead className="text-right">{t("konsi")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...sources.months].reverse().map((m) => (
              <TableRow key={`${m.year}-${m.month}`}>
                <TableCell className="whitespace-nowrap font-medium">
                  {MONTH_LABELS[m.month - 1]} {m.year}
                </TableCell>
                {FAMILIES.map((family) => (
                  <TableCell key={family} className="align-top">
                    <MarketplaceCell month={m} family={family} />
                  </TableCell>
                ))}
                <TableCell className="text-right tabular-nums align-top">
                  {m.offlineQty > 0 ? m.offlineQty.toLocaleString() : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums align-top">
                  {m.konsiQty > 0 ? m.konsiQty.toLocaleString() : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
