"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { matchKey } from "@/lib/items/match-key";

export type VariantRatioRow = { variantSku: string; ratioPercent: number };

export type VariantStockEntry = { onHand: number; available: number };

type VariantRatioRowsProps = {
  rows: VariantRatioRow[];
  onChange: (variantSku: string, ratioPercent: number) => void;
  stock: Record<string, VariantStockEntry> | null;
  stockState: "loading" | "ready" | "error";
};

/* A variant without a SKU is keyed `variant-<index>` by the pages; it has no stock row to read. */
const isFallbackKey = (variantSku: string) => /^variant-\d+$/.test(variantSku);

export function VariantRatioRows({ rows, onChange, stock, stockState }: VariantRatioRowsProps) {
  const t = useTranslations("workOrders");
  const sum = rows.reduce((s, x) => s + x.ratioPercent, 0);

  return (
    <div className="space-y-2">
      <Label>{t("ratio.label")}</Label>
      {stockState === "error" && (
        <p className="text-xs text-muted-foreground">{t("ratio.stockUnavailable")}</p>
      )}
      {rows.map((row) => {
        const entry = stock?.[matchKey(row.variantSku)] ?? { onHand: 0, available: 0 };
        const showStock = stockState === "ready" && stock !== null;
        return (
          <div key={row.variantSku} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="w-32 min-w-0 truncate text-sm sm:w-48">{row.variantSku}</span>
            <Input
              type="number"
              min={0}
              max={100}
              step={1}
              value={row.ratioPercent === 0 ? "" : row.ratioPercent}
              onChange={(e) => onChange(row.variantSku, Number(e.target.value) || 0)}
              className="w-20 shrink-0"
            />
            %
            {stockState === "loading" && <Skeleton className="h-4 w-28" />}
            {showStock && isFallbackKey(row.variantSku) && (
              <span className="truncate text-xs text-muted-foreground">—</span>
            )}
            {showStock && !isFallbackKey(row.variantSku) && (
              <span className="min-w-0 text-xs text-muted-foreground">
                {t.rich("ratio.stock", {
                  available: entry.available,
                  onHand: entry.onHand,
                  a: (chunks) => (
                    <span className={cn(entry.available <= 0 && "text-destructive")}>{chunks}</span>
                  ),
                })}
              </span>
            )}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">{t("ratio.sum")} {sum}%</p>
    </div>
  );
}
