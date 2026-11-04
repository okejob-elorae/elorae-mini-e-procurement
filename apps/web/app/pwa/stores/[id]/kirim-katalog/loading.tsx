"use client";

import { useTranslations } from "next-intl";

/*
 * Komponen klien, bukan `getTranslations` dari `next-intl/server`: aplikasi ini
 * tidak punya konfigurasi next-intl di server (bahasa hanya diketahui klien),
 * jadi versi server melempar galat saat layar pemuatan ini tampil.
 */
export default function Loading() {
  const t = useTranslations("pwa.kirimKatalog");
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-4">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
      <p className="text-sm text-muted-foreground">{t("loading")}</p>
    </div>
  );
}
