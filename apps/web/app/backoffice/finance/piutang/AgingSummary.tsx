"use client";

import { useTranslations } from "next-intl";
import { AGING_BUCKETS, AGING_BUCKET_LABELS, type AgingBucket } from "@/lib/finance/ar/aging";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  bucketTotals: Record<AgingBucket, number>;
  grandOutstanding: number;
  activeBucket: AgingBucket | undefined;
  onSelectBucket: (bucket: AgingBucket | undefined) => void;
};

function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Six aging tiles that double as filter controls. `CURRENT` renders in the not-yet-due
 * (blue) colour, the five overdue buckets in the overdue (red) colour, per the epic's rule.
 *
 * A zero-total bucket still renders, greyed — a strip whose tiles appear and disappear
 * on filter change is unreadable at a glance.
 */
export function AgingSummary({ bucketTotals, grandOutstanding, activeBucket, onSelectBucket }: Props) {
  const t = useTranslations("piutang");

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {activeBucket ? t("agingTotalFiltered") : t("agingTotalAll")}
        </p>
        <p className="text-xl font-bold tabular-nums">{formatRupiah(grandOutstanding)}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {AGING_BUCKETS.map((bucket) => {
          const total = bucketTotals[bucket];
          const isActive = activeBucket === bucket;
          const isZero = total === 0;
          const isOverdueBucket = bucket !== "CURRENT";
          return (
            <Button
              key={bucket}
              type="button"
              variant="outline"
              aria-pressed={isActive}
              aria-label={`${AGING_BUCKET_LABELS[bucket]}: ${formatRupiah(total)}`}
              onClick={() => onSelectBucket(isActive ? undefined : bucket)}
              className={cn(
                "h-auto min-h-[52px] flex-col items-start gap-1 whitespace-normal px-3 py-2 text-left",
                isZero && "opacity-50",
                isActive && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                !isZero &&
                  (isOverdueBucket
                    ? "border-red-200 bg-red-100 hover:bg-red-200 dark:border-red-800 dark:bg-red-900 dark:hover:bg-red-800"
                    : "border-blue-200 bg-blue-100 hover:bg-blue-200 dark:border-blue-800 dark:bg-blue-900 dark:hover:bg-blue-800"),
              )}
            >
              <span
                className={cn(
                  "text-xs font-medium",
                  isZero
                    ? "text-muted-foreground"
                    : isOverdueBucket
                      ? "text-red-800 dark:text-red-200"
                      : "text-blue-800 dark:text-blue-200",
                )}
              >
                {AGING_BUCKET_LABELS[bucket]}
              </span>
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  isZero
                    ? "text-muted-foreground"
                    : isOverdueBucket
                      ? "text-red-800 dark:text-red-200"
                      : "text-blue-800 dark:text-blue-200",
                )}
              >
                {formatRupiah(total)}
              </span>
            </Button>
          );
        })}
      </div>
      {activeBucket && (
        <p className="text-xs text-muted-foreground">
          {t("agingFilterHint", { bucket: AGING_BUCKET_LABELS[activeBucket] })}
        </p>
      )}
    </div>
  );
}
