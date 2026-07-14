"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  deriveStockStatus,
  type StockStatus,
} from "@/lib/inventory/stock-status";
import { StockVariantMatrix } from "@/components/inventory/StockVariantMatrix";

export type StockItemCardData = {
  itemId: string;
  qtyOnHand: number;
  reservedQty: number;
  available: number;
  avgCost: number;
  totalValue: number;
  variants?: Array<{
    variantSku: string;
    available: number;
    label: string;
  }>;
  item: {
    sku: string;
    nameId: string;
    nameEn: string;
    reorderPoint: number | null;
    uom: { code: string };
  };
};

type Props = {
  item: StockItemCardData;
};

function statusBadgeClass(status: StockStatus): string {
  switch (status) {
    case "OK":
      return "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800";
    case "MENIPIS":
      return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800";
    case "HABIS":
      return "bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800";
    case "NEGATIF":
      return "bg-pink-100 text-pink-800 border-pink-200 dark:bg-pink-950 dark:text-pink-300 dark:border-pink-800";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function statusDotClass(status: StockStatus): string {
  switch (status) {
    case "OK":
      return "bg-emerald-500";
    case "MENIPIS":
      return "bg-amber-500";
    case "HABIS":
      return "bg-red-500";
    case "NEGATIF":
      return "bg-pink-500";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function StockItemCard({ item }: Props) {
  const t = useTranslations("inventory.wallboard");
  const [expanded, setExpanded] = useState(false);
  const status = deriveStockStatus(item.available, item.item.reorderPoint);
  const uom = item.item.uom.code || "pcs";
  const variants = item.variants ?? [];
  const hasMatrix = variants.length >= 2;
  const negatifCount = variants.filter((v) => v.available < 0).length;

  return (
    <div className={cn(expanded && hasMatrix && "col-span-full")}>
      <Card className="h-full">
        <CardContent className="flex flex-col gap-3 pt-6">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-primary truncate">{item.item.sku}</p>
              <p className="text-sm text-muted-foreground line-clamp-2">
                {item.item.nameId}
              </p>
            </div>
            <span
              className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", statusDotClass(status))}
              aria-hidden
            />
          </div>

          <div>
            <p
              className={cn(
                "text-2xl font-bold tracking-tight",
                status === "NEGATIF" && "text-pink-600 dark:text-pink-400",
                status === "HABIS" && "text-red-600 dark:text-red-400",
              )}
            >
              {Number(item.available).toLocaleString()}{" "}
              <span className="text-base font-medium text-muted-foreground">{uom}</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t("cardOnHand", { qty: Number(item.qtyOnHand).toLocaleString() })}
              {" · "}
              {t("cardReserved", { qty: Number(item.reservedQty).toLocaleString() })}
            </p>
          </div>

          {hasMatrix ? (
            <div className="space-y-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 w-full justify-between gap-2 font-normal"
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
              >
                <span className="truncate text-left">
                  {negatifCount > 0
                    ? t("variantCueWithNegatif", {
                        count: variants.length,
                        negatif: negatifCount,
                      })
                    : t("variantCue", { count: variants.length })}
                </span>
                {expanded ? (
                  <ChevronUp className="h-4 w-4 shrink-0 opacity-70" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
                )}
              </Button>

              {expanded ? (
                <StockVariantMatrix variants={variants} wide />
              ) : null}
            </div>
          ) : null}

          <div className="mt-auto flex items-end justify-between gap-2">
            <Badge variant="outline" className={cn("border", statusBadgeClass(status))}>
              {t(`status.${status}`)}
            </Badge>
            <div className="text-right text-[11px] text-muted-foreground leading-snug">
              <div>
                {t("cardAvgCost", { value: Number(item.avgCost).toLocaleString() })}
              </div>
              <div>
                {t("cardValue", { value: Number(item.totalValue).toLocaleString() })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
