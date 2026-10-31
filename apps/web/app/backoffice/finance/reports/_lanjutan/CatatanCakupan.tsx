"use client";

import { useLocale, useTranslations } from "next-intl";
import { Info } from "lucide-react";
import { CAKUPAN_LAPORAN_BODY } from "@/lib/finance/reports/cakupan-laporan";

/** Kartu "Cakupan data" laporan lanjutan — daftar sumbernya dari `disclosures.ts` (satu tempat). */
export function CatatanCakupan() {
  const t = useTranslations("laporanLanjutan");
  const locale = useLocale();
  return (
    <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div>
        <p className="font-medium">{t("cakupanJudul")}</p>
        <p className="text-muted-foreground">{locale.toLowerCase().startsWith("id") ? CAKUPAN_LAPORAN_BODY : t("cakupanIsi")}</p>
      </div>
    </div>
  );
}
