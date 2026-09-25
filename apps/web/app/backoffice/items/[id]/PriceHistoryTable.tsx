"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDisplayDateTime } from "@/lib/date-only";
import {
  getItemPriceHistory,
  type ItemPriceHistoryRow,
} from "@/app/actions/item-price-history";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatPrice(v: number | null): string {
  if (v == null) return "—";
  return `Rp ${v.toLocaleString("id-ID")}`;
}

export function PriceHistoryTable({ itemId }: { itemId: string }) {
  const t = useTranslations("items.priceHistory");
  const locale = useLocale();
  const [rows, setRows] = useState<ItemPriceHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getItemPriceHistory(itemId, { limit: 50, offset: 0 })
      .then((res) => {
        if (!cancelled) {
          setRows(res.rows);
          setTotal(res.total);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground">{t("loading")}</div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {total > 50 && (
        <div className="text-xs text-muted-foreground">
          {t("showingFirst", { shown: 50, total })}
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("colChangedAt")}</TableHead>
            <TableHead>{t("colTrigger")}</TableHead>
            <TableHead className="text-right">{t("colOldPrice")}</TableHead>
            <TableHead className="text-right">{t("colNewPrice")}</TableHead>
            <TableHead className="text-right">{t("colAvgCost")}</TableHead>
            <TableHead className="text-right">{t("colMargin")}</TableHead>
            <TableHead>{t("colSource")}</TableHead>
            <TableHead>{t("colActor")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{formatDisplayDateTime(r.changedAt, locale)}</TableCell>
              <TableCell>{t(`trigger.${r.triggerReason}`)}</TableCell>
              <TableCell className="text-right">
                {formatPrice(r.oldSellingPrice)}
              </TableCell>
              <TableCell className="text-right">
                {formatPrice(r.newSellingPrice)}
              </TableCell>
              <TableCell className="text-right">
                {formatPrice(r.newAvgCost)}
              </TableCell>
              <TableCell className="text-right">
                {r.marginPercentUsed != null ? `${r.marginPercentUsed}%` : "—"}
              </TableCell>
              <TableCell>{r.fgReceiptDocNumber ?? "—"}</TableCell>
              <TableCell>{r.changedByName ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
