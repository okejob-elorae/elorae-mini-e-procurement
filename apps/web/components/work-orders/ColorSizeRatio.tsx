"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { matchKey } from "@/lib/items/match-key";
import { getFinishedGoodVariantAxes } from "@/app/actions/work-order-variant-stock";
import {
  evenRatios,
  groupVariantsByColor,
  type RatioRow,
  type VariantAxisRow,
} from "@/lib/work-orders/color-ratio";

export type VariantRatioRow = RatioRow;

export type VariantStockEntry = { onHand: number; available: number };

type ColorSizeRatioProps = {
  finishedGoodId: string;
  rows: VariantRatioRow[];
  onRowsChange: (rows: VariantRatioRow[]) => void;
  stock: Record<string, VariantStockEntry> | null;
  stockState: "loading" | "ready" | "error";
};

/* A variant without a SKU is keyed `variant-<index>` by the pages; it has no stock row to read. */
const isFallbackKey = (variantSku: string) => /^variant-\d+$/.test(variantSku);

/**
 * Colour-first variant ratio (#410): pick some of the finished good's colours, then set the
 * ratio of each colour's sizes. Only the picked colours' variants are rows, so the WO's
 * skuBreakdown — and the material plan and rolls built from it — cover just those colours.
 * Ratios are a share of the whole WO and sum to 100%.
 */
export function ColorSizeRatio({ finishedGoodId, rows, onRowsChange, stock, stockState }: ColorSizeRatioProps) {
  const t = useTranslations("workOrders");
  const [loaded, setLoaded] = useState<{ finishedGoodId: string; rows: VariantAxisRow[] } | null>(null);
  const axes = loaded?.finishedGoodId === finishedGoodId ? loaded.rows : null;

  useEffect(() => {
    let cancelled = false;
    getFinishedGoodVariantAxes(finishedGoodId)
      .then((rows) => {
        if (!cancelled) setLoaded({ finishedGoodId, rows });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ finishedGoodId, rows: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [finishedGoodId]);

  const groups = axes ? groupVariantsByColor(axes) : [];
  const known = new Set((axes ?? []).map((a) => a.variantSku));
  const selected = new Set(
    groups.filter((g) => g.variants.some((v) => rows.some((r) => r.variantSku === v.variantSku))).map((g) => g.colorKey)
  );
  const others = axes ? rows.filter((r) => !known.has(r.variantSku)) : [];

  // One colour only: nothing to choose, so pick it.
  const onlyColor = groups.length === 1 ? groups[0] : null;
  useEffect(() => {
    if (onlyColor && rows.length === 0) onRowsChange(evenRatios(onlyColor.variants.map((v) => v.variantSku)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the colour list loads
  }, [onlyColor?.colorKey]);

  const toggle = (colorKey: string) => {
    const next = new Set(selected);
    if (next.has(colorKey)) next.delete(colorKey);
    else next.add(colorKey);
    onRowsChange(evenRatios(groups.filter((g) => next.has(g.colorKey)).flatMap((g) => g.variants.map((v) => v.variantSku))));
  };

  const sum = rows.reduce((s, x) => s + x.ratioPercent, 0);
  const ratioOf = (sku: string) => rows.find((r) => r.variantSku === sku)?.ratioPercent ?? 0;
  const setRatio = (sku: string, ratioPercent: number) =>
    onRowsChange(rows.map((r) => (r.variantSku === sku ? { ...r, ratioPercent } : r)));

  const renderRow = (variantSku: string, label: string) => {
    const entry = stock?.[matchKey(variantSku)] ?? { onHand: 0, available: 0 };
    const showStock = stockState === "ready" && stock !== null;
    const ratio = ratioOf(variantSku);
    return (
      <div key={variantSku} className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-32 min-w-0 truncate text-sm sm:w-48">
          {label}
          {label !== variantSku && <span className="ml-2 text-xs text-muted-foreground">{variantSku}</span>}
        </span>
        <Input
          type="number"
          min={0}
          max={100}
          step={1}
          value={ratio === 0 ? "" : ratio}
          onChange={(e) => setRatio(variantSku, Number(e.target.value) || 0)}
          className="w-20 shrink-0"
          aria-label={`${label} %`}
        />
        %
        {stockState === "loading" && <Skeleton className="h-4 w-28" />}
        {showStock && isFallbackKey(variantSku) && <span className="truncate text-xs text-muted-foreground">—</span>}
        {showStock && !isFallbackKey(variantSku) && (
          <span className="min-w-0 text-xs text-muted-foreground">
            {t.rich("ratio.stock", {
              available: entry.available,
              onHand: entry.onHand,
              a: (chunks) => <span className={cn(entry.available <= 0 && "text-destructive")}>{chunks}</span>,
            })}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3 sm:col-span-2">
      <div className="space-y-2">
        <Label>{t("ratio.colors")}</Label>
        {axes == null ? (
          <Skeleton className="h-8 w-64" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <Button
                key={g.colorKey}
                type="button"
                size="sm"
                variant={selected.has(g.colorKey) ? "default" : "outline"}
                aria-pressed={selected.has(g.colorKey)}
                onClick={() => toggle(g.colorKey)}
              >
                {g.colorName ?? t("ratio.noColor")}
                <span className="ml-1 opacity-70">({g.variants.length})</span>
              </Button>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("ratio.colorsHint")}</p>
      </div>

      {stockState === "error" && <p className="text-xs text-muted-foreground">{t("ratio.stockUnavailable")}</p>}

      {axes != null && rows.length === 0 && <p className="text-sm text-destructive">{t("ratio.pickColor")}</p>}

      {rows.length > 0 && (
        <div className="space-y-3">
          <Label>{t("ratio.label")}</Label>
          {groups
            .filter((g) => selected.has(g.colorKey))
            .map((g) => {
              const subtotal = g.variants.reduce((s, v) => s + ratioOf(v.variantSku), 0);
              return (
                <div key={g.colorKey} className="space-y-2 rounded-md border p-3">
                  <p className="text-sm font-medium">
                    {g.colorName ?? t("ratio.noColor")}
                    <span className="ml-2 font-normal text-muted-foreground">{t("ratio.subtotal", { percent: subtotal })}</span>
                  </p>
                  {g.variants.map((v) => renderRow(v.variantSku, v.size ?? v.variantSku))}
                </div>
              );
            })}
          {others.length > 0 && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">{t("ratio.otherVariants")}</p>
              {others.map((r) => renderRow(r.variantSku, r.variantSku))}
            </div>
          )}
          <p className={cn("text-xs", Math.abs(sum - 100) < 0.01 ? "text-muted-foreground" : "text-destructive")}>
            {t("ratio.sum")} {sum}%
          </p>
        </div>
      )}
    </div>
  );
}
