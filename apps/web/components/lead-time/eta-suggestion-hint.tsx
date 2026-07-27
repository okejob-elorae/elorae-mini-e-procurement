"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { toDisplayDate } from "@/lib/date-only";

type Props = {
  supplierCode: string;
  totalDays: number;
  suggestedEta: Date | null;
  onUseDate: () => void;
  hintKey?: "etaHint" | "targetHint";
};

export function EtaSuggestionHint({
  supplierCode,
  totalDays,
  suggestedEta,
  onUseDate,
  hintKey = "etaHint",
}: Props) {
  const t = useTranslations("leadTime.po");
  if (!suggestedEta || totalDays <= 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>
        {t(hintKey, {
          supplier: supplierCode,
          days: totalDays,
          date: toDisplayDate(suggestedEta),
        })}
      </span>
      <Button type="button" size="sm" variant="outline" onClick={onUseDate}>
        {t("useDate")}
      </Button>
    </div>
  );
}
