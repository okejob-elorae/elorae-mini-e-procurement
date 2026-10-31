"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Pintu masuk pre-order di halaman toko (hanya toko PUTUS, hanya bila ada
 * jendela yang sedang BUKA — keduanya dinilai di server sebelum komponen ini
 * dipasang). Satu jendela langsung membuka katalog pre-order-nya; lebih dari
 * satu membuka katalog stok siap, yang menampilkan daftar jendelanya.
 */
export function TombolPreorder({
  storeId,
  jendela,
}: {
  storeId: string;
  jendela: Array<{ id: string; name: string; tutup: string }>;
}) {
  const t = useTranslations("pwa.inden");
  if (jendela.length === 0) return null;
  const satu = jendela.length === 1 ? jendela[0] : null;
  const href = satu ? `/pwa/stores/${storeId}/catalog?inden=${encodeURIComponent(satu.id)}` : `/pwa/stores/${storeId}/catalog`;
  return (
    <Button asChild variant="outline" className="h-auto w-full justify-start border-amber-500/40 bg-amber-500/5 py-2 text-left">
      <Link href={href}>
        <CalendarClock className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{satu ? t("tokoSatu", { nama: satu.name }) : t("tokoBanyak", { n: jendela.length })}</span>
          {satu && <span className="block truncate text-xs font-normal text-muted-foreground">{t("tutup", { tanggal: satu.tutup })}</span>}
        </span>
      </Link>
    </Button>
  );
}
