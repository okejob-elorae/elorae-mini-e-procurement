"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Toko yang dipegang sales lain, saat kunci "hanya toko sendiri" menyala.
 *
 * Pesan yang jelas, bukan halaman 404: tautan lama (riwayat, pesan WhatsApp,
 * bookmark) masih bisa membawa sales ke sini setelah toko dirotasi, dan ia
 * perlu tahu kenapa tokonya "hilang".
 */
export function BukanTokoSaya({ nama }: { nama: string }) {
  const t = useTranslations("pwa.stores");
  return (
    <div className="space-y-4 p-4">
      <div className="beranda-kartu space-y-3 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted">
          <Lock className="h-5 w-5 text-muted-foreground" aria-hidden />
        </span>
        <h1 className="text-lg font-semibold">{nama}</h1>
        <p className="text-sm text-muted-foreground">{t("notYoursBody")}</p>
        <Button asChild className="w-full">
          <Link href="/pwa/stores">{t("notYoursBack")}</Link>
        </Button>
      </div>
    </div>
  );
}
