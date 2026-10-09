"use client";

import { startTransition, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Props = { error: Error & { digest?: string }; reset: () => void };

/**
 * Beranda menurut alamat. Halaman ini juga menangkap galat di TATA LETAK HP dan
 * kantor (galat di halamannya ditangkap `pwa/error.tsx`/`backoffice/error.tsx`),
 * sedangkan "/" mengarahkan setiap pengguna yang masuk ke kantor — salesman
 * berakhir di layar tanpa akses. Portal toko: tanpa beranda (berandanya halaman
 * masuk kantor).
 */
function berandaUntuk(pathname: string | null): string | null {
  if (!pathname) return "/";
  if (pathname.startsWith("/toko/") || pathname.startsWith("/data-kol/")) return null;
  for (const area of ["/pwa", "/gudang-retur", "/backoffice"]) {
    if (pathname === area || pathname.startsWith(`${area}/`)) return area;
  }
  return "/";
}

/**
 * Galat di halaman di luar kantor dan HP (masuk, portal toko, gudang retur,
 * cetak). Kantor dan HP punya halaman galatnya sendiri di dalam kerangkanya
 * (`backoffice/error.tsx`, `pwa/error.tsx`).
 *
 * "Coba lagi" menyegarkan data server lalu memasang ulang segmennya — `reset()`
 * saja hanya merender ulang di klien, jadi galat dari server tidak pulih.
 * Pesan galat tidak pernah ditampilkan (bisa membawa rincian server); yang
 * boleh dilaporkan hanya kodenya (`digest`).
 */
export default function GalatHalaman({ error, reset }: Props) {
  const t = useTranslations("halamanGalat");
  const router = useRouter();
  const pathname = usePathname();
  const beranda = berandaUntuk(pathname);

  useEffect(() => {
    console.error(error);
  }, [error]);

  function cobaLagi() {
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-md py-0" role="alert">
        <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
          <div className="rounded-full bg-destructive/10 p-3">
            <TriangleAlert className="h-6 w-6 text-destructive" aria-hidden />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">{t("judul")}</h1>
            <p className="text-sm text-muted-foreground">{t("pesan")}</p>
          </div>
          <div className="flex w-full flex-col gap-2">
            <Button type="button" size="lg" className="w-full" onClick={cobaLagi}>
              {t("cobaLagi")}
            </Button>
            {beranda && (
              <Button asChild size="lg" variant="outline" className="w-full">
                <Link href={beranda}>{t("keBeranda")}</Link>
              </Button>
            )}
          </div>
          {error.digest && (
            <p className="text-xs text-muted-foreground">
              {t("kode")} <span className="select-all break-all font-mono">{error.digest}</span>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
