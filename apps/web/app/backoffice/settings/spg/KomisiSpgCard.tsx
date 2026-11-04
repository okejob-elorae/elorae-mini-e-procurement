"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Komisi SPG di Pengaturan → SPG — hanya penjelasan dan tautan, tanpa isian.
 *
 * Sejak keputusan pemilik 2026-11-01 komisi SPG dihitung SATU cara untuk toko konsinyasi dan toko
 * putus (`lib/spg-commission/payout.ts`): tarif per kategori barang di Pengaturan → Komisi SPG ×
 * potong yang dijual masing-masing SPG. Kartu lama (sakelar dan dasar "dibagi rata / per SPG" atas
 * tarif barang) sudah tidak dipakai hitungan apa pun, jadi tidak ada lagi yang diatur di sini.
 * Tarifnya diatur di halamannya sendiri (`spg_commission:manage`), angka per bulan di SPG → Komisi SPG.
 */
export function KomisiSpgCard({ bolehAturTarif }: { bolehAturTarif: boolean }) {
  const t = useTranslations("pengaturanKomisiPutusSpg");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="h-5 w-5" aria-hidden />
          {t("judul")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">{t("penjelasan")}</p>
        <p className="text-xs text-muted-foreground">{t("catatan")}</p>
        <div className="flex flex-wrap items-center gap-3">
          {bolehAturTarif ? (
            <Button asChild variant="outline">
              <Link href="/backoffice/settings/spg-commission">{t("aturTarif")}</Link>
            </Button>
          ) : null}
          <Button asChild variant="ghost">
            <Link href="/backoffice/komisi-spg">{t("bukaKomisi")}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
