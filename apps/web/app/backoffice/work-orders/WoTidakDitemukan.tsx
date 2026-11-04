"use client";

import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Keadaan "perintah kerja tidak ditemukan" untuk rincian, keluarkan bahan,
 * terima barang jadi, rekonsiliasi dan ubah. Sebelumnya halaman-halaman itu
 * memutar ikon memuat selamanya bila id-nya tidak ada.
 */
export function WoTidakDitemukan() {
  const t = useTranslations("workOrders.tidakDitemukan");
  return (
    <Card className="py-0">
      <CardContent className="p-0">
        <EmptyState
          icon={ClipboardList}
          title={t("judul")}
          description={t("isi")}
          action={
            <Button asChild variant="outline">
              <Link href="/backoffice/work-orders">{t("kembali")}</Link>
            </Button>
          }
        />
      </CardContent>
    </Card>
  );
}
