"use client";

import { useLocale, useTranslations } from "next-intl";
import { History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auditActionLabel, type AuditLabelTranslator } from "@/lib/audit/action-label";
import { formatDisplayDateTime } from "@/lib/date-only";
import type { BarisRiwayat } from "@/lib/receivables/koreksi";

/**
 * Riwayat keputusan atas sebuah dokumen piutang/retur — siapa, kapan, apa,
 * dan kenapa. Barisnya sendiri hanya menyimpan keadaan terakhir; nota yang
 * dipindah toko hanya menampilkan toko barunya, dan dari mana ia datang hanya
 * terbaca di sini.
 */
export function RiwayatDokumen({ baris }: { baris: BarisRiwayat[] }) {
  const t = useTranslations("riwayatDokumen");
  const tAksi = useTranslations("auditActions") as unknown as AuditLabelTranslator;
  const locale = useLocale();
  if (baris.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" aria-hidden />
          {t("judul")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {baris.map((b) => (
            <li key={b.id} className="border-l-2 pl-3 text-sm">
              <span className="block font-medium">{auditActionLabel(tAksi, b.action, b.entityType)}</span>
              <span className="block text-xs text-muted-foreground">
                {[b.oleh, formatDisplayDateTime(b.pada, locale)].filter(Boolean).join(" · ")}
              </span>
              {b.tokoTujuan && (
                <span className="block">{t("pindahToko", { asal: b.tokoAsal ?? t("tanpaToko"), tujuan: b.tokoTujuan })}</span>
              )}
              {b.nomorTerkait && <span className="block">{t("terkait", { nomor: b.nomorTerkait })}</span>}
              {b.alasan && <span className="block text-muted-foreground">{t("alasan", { alasan: b.alasan })}</span>}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
