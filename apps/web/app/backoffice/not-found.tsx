"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { daftarAsal } from "@/lib/nav/daftar-asal";

/**
 * `notFound()` dan alamat salah DI DALAM kantor: tampil di dalam kerangka kantor
 * (menu samping tetap ada), dengan jalan kembali ke daftar asalnya — dulu jatuh
 * ke halaman tidak-ditemukan akar tanpa menu, dan satu-satunya jalan "Kembali ke
 * beranda".
 */
export default function TidakDitemukanKantor() {
  const t = useTranslations("halamanGalat");
  const daftar = daftarAsal(usePathname());

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-4">
      <Card className="w-full max-w-md py-0">
        <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
          <div className="rounded-full bg-muted p-3">
            <SearchX className="h-6 w-6 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">{t("tidakDitemukan")}</h1>
            <p className="text-sm text-muted-foreground">{t("tidakDitemukanPesan")}</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
            {daftar && (
              <Button asChild>
                <Link href={daftar}>{t("keDaftar")}</Link>
              </Button>
            )}
            <Button asChild variant={daftar ? "outline" : "default"}>
              <Link href="/backoffice">{t("keBeranda")}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
