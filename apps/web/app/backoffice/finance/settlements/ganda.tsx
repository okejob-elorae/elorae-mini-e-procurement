"use client";

import { useLocale, useTranslations } from "next-intl";
import { Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDisplayDateTime } from "@/lib/date-only";

/** Unggahan pertama dari sebuah settlement kembar, siap dikirim ke klien (tanggal ISO). */
export type UnggahanPertamaTampil = {
  id: string;
  fileName: string;
  uploadedAtIso: string;
  uploadedByName: string | null;
};

/** Penanda baris daftar: settlement ini kembar dengan unggahan yang lebih awal. */
export function BadgeGanda({ pertama }: { pertama: UnggahanPertamaTampil }) {
  const t = useTranslations("financeSettlements");
  const locale = useLocale();
  return (
    <Badge
      variant="destructive"
      className="gap-1"
      title={t("duplicateBadgeTitle", {
        fileName: pertama.fileName,
        at: formatDisplayDateTime(pertama.uploadedAtIso, locale),
      })}
    >
      <Copy className="h-3 w-3" />
      {t("duplicateBadge")}
    </Badge>
  );
}
