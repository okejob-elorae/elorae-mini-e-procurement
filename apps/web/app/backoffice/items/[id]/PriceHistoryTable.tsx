"use client";

import { useEffect, useState } from "react";
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

const TRIGGER_LABELS: Record<ItemPriceHistoryRow["triggerReason"], string> = {
  FG_RECEIPT: "FG receipt",
  MARGIN_CHANGE: "Margin change",
  DEFAULTS_CHANGE: "Defaults change",
  MANUAL_EDIT: "Manual edit",
};

function formatPrice(v: number | null): string {
  if (v == null) return "—";
  return `Rp ${v.toLocaleString("en-US")}`;
}

function formatDateTime(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(d));
}

export function PriceHistoryTable({ itemId }: { itemId: string }) {
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
      <div className="text-sm text-muted-foreground">Loading price history…</div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No price changes recorded yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {total > 50 && (
        <div className="text-xs text-muted-foreground">
          Showing first 50 of {total} entries.
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Changed at</TableHead>
            <TableHead>Trigger</TableHead>
            <TableHead className="text-right">Old price</TableHead>
            <TableHead className="text-right">New price</TableHead>
            <TableHead className="text-right">avgCost basis</TableHead>
            <TableHead className="text-right">Margin used</TableHead>
            <TableHead>FG Receipt</TableHead>
            <TableHead>Actor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{formatDateTime(r.changedAt)}</TableCell>
              <TableCell>{TRIGGER_LABELS[r.triggerReason]}</TableCell>
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
