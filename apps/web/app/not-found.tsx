"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Alamat yang tidak dikenal di mana pun, dan `notFound()` di halaman kantor.
 * Halaman ini tampil di tata letak akar saja (tanpa kerangka kantor/HP), jadi
 * berandanya dipilih dari alamatnya: /pwa → beranda HP (selebar HP), portal
 * toko → tanpa tombol beranda (berandanya halaman masuk kantor), gudang retur →
 * berandanya sendiri, selain itu beranda kantor. `notFound()` di layar HP ditangani `pwa/not-found.tsx`.
 */
function berandaUntuk(pathname: string | null): string | null {
  if (!pathname) return "/";
  if (pathname === "/pwa" || pathname.startsWith("/pwa/")) return "/pwa";
  if (pathname.startsWith("/toko/")) return null;
  if (pathname === "/backoffice" || pathname.startsWith("/backoffice/")) return "/backoffice";
  if (pathname === "/gudang-retur" || pathname.startsWith("/gudang-retur/")) return "/gudang-retur";
  return "/";
}

export default function TidakDitemukan() {
  const t = useTranslations("halamanGalat");
  const beranda = berandaUntuk(usePathname());
  const hp = beranda === "/pwa";

  return (
    <div className={hp ? "mx-auto flex min-h-dvh w-full max-w-xl flex-col p-4" : "flex min-h-[60vh] items-center justify-center p-4"}>
      <Card className={hp ? "py-0" : "w-full max-w-md py-0"}>
        <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
          <div className="rounded-full bg-muted p-3">
            <SearchX className="h-6 w-6 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">{t("tidakDitemukan")}</h1>
            <p className="text-sm text-muted-foreground">{t("tidakDitemukanPesan")}</p>
          </div>
          {beranda && (
            <Button asChild size="lg" className="w-full">
              <Link href={beranda}>{t("keBeranda")}</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
