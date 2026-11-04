"use client";

import { useTranslations } from "next-intl";
import { CheckCircle2, CircleAlert } from "lucide-react";

/** "Perlu konfirmasi" (kuning) atau "Dikonfirmasi" (hijau) — hanya untuk pengumuman yang wajib dikonfirmasi. */
export function LencanaKonfirmasi({ perlu, sudah }: { perlu: boolean; sudah: boolean }) {
  const t = useTranslations("pwa.pengumuman");
  if (perlu) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-800 dark:text-amber-300">
        <CircleAlert className="h-3 w-3" aria-hidden />
        {t("perluKonfirmasi")}
      </span>
    );
  }
  if (sudah) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-800 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" aria-hidden />
        {t("dikonfirmasi")}
      </span>
    );
  }
  return null;
}
