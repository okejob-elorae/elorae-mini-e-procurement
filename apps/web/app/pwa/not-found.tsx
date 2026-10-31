"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TautanKembali } from "@/app/pwa/TautanKembali";

/**
 * Data yang dibuka dari layar HP tidak ada (`notFound()` di halaman /pwa —
 * toko, pesanan, nota yang sudah dihapus atau milik orang lain). Tampil di
 * dalam kerangka HP. Alamat /pwa yang sama sekali tidak dikenal ditangani
 * `app/not-found.tsx`.
 */
export default function TidakDitemukanHp() {
  const t = useTranslations("halamanGalat");
  return (
    <div className="flex min-h-dvh flex-col gap-3 p-4">
      <header className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <TautanKembali cadangan="/pwa" />
        </Button>
      </header>
      <Card className="py-0">
        <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
          <div className="rounded-full bg-muted p-3">
            <SearchX className="h-6 w-6 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">{t("tidakDitemukan")}</h1>
            <p className="text-sm text-muted-foreground">{t("tidakDitemukanPesan")}</p>
          </div>
          <Button asChild size="lg" className="w-full">
            <Link href="/pwa">{t("keBeranda")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
