"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Layar eksekusi toko (daftar periksa, harga pesaing) hanya terbuka selama
 * check-in di toko ini — sama dengan katalog. Tautan lama atau tombol "kembali"
 * setelah check-out membawa ke sini, bukan ke formulir yang lalu ditolak server.
 */
export function PerluCheckIn({ storeId, nama }: { storeId: string; nama: string }) {
  const t = useTranslations("pwa.checklist");
  return (
    <div className="space-y-4 p-4">
      <div className="beranda-kartu space-y-3 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted">
          <MapPin className="h-5 w-5 text-muted-foreground" aria-hidden />
        </span>
        <h1 className="text-lg font-semibold">{nama}</h1>
        <p className="text-sm text-muted-foreground">{t("perluCheckIn")}</p>
        <Button asChild className="w-full">
          <Link href={`/pwa/stores/${storeId}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t("keToko")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
