"use client";

import { useTranslations } from "next-intl";
import type { AlasanSimpanWo } from "@/lib/production/rencana-wo";

/**
 * Kenapa tombol simpan perintah kerja masih mati, ditulis tepat di bawah
 * tombolnya (kekurangan pertama menurut urutan isian, `alasanSimpanWo`).
 */
export function KeteranganSimpanWo({ alasan }: { alasan: AlasanSimpanWo | null }) {
  const t = useTranslations("workOrders.formulir.alasan");
  if (!alasan) return null;
  return (
    <p className="text-sm text-muted-foreground" aria-live="polite">
      {t(alasan)}
    </p>
  );
}
