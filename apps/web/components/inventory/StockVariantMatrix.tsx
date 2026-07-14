"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export type StockVariantMatrixChip = {
  variantSku: string;
  available: number;
  label: string;
};

type Props = {
  variants: StockVariantMatrixChip[];
  /** Wider chip grid when the parent card spans the full row */
  wide?: boolean;
};

export function StockVariantMatrix({ variants, wide = false }: Props) {
  const t = useTranslations("inventory.wallboard");
  if (variants.length < 2) return null;

  return (
    <div
      className={cn(
        "max-h-72 overflow-y-auto rounded-md border bg-muted/10 p-2",
        wide
          ? "grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10"
          : "grid grid-cols-4 gap-2",
      )}
      role="group"
      aria-label={t("variantMatrixAria")}
    >
      {variants.map((v) => (
        <div
          key={v.variantSku}
          className="rounded-md border bg-background px-1.5 py-1.5 text-center"
          title={v.variantSku}
        >
          <div className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {v.label}
          </div>
          <div
            className={cn(
              "text-sm font-semibold tabular-nums",
              v.available < 0 && "text-pink-600 dark:text-pink-400",
              v.available === 0 && "text-muted-foreground",
            )}
          >
            {Number(v.available).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}
