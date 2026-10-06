"use client";

import { startTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Props = { error: Error & { digest?: string }; reset: () => void };

/**
 * Galat di halaman kantor, tampil DI DALAM kerangka kantor (menu samping dan
 * kepala tetap ada), jadi pengguna tidak terlempar ke layar kosong.
 *
 * "Coba lagi" menyegarkan data server lalu memasang ulang halamannya —
 * `reset()` saja hanya merender ulang di klien, jadi galat dari server tidak
 * pulih. Pesan galat tidak pernah ditampilkan (bisa membawa rincian server);
 * yang boleh dilaporkan hanya kodenya (`digest`).
 */
export default function GalatKantor({ error, reset }: Props) {
  const t = useTranslations("halamanGalat");
  const router = useRouter();

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
    <div className="flex min-h-[50vh] items-center justify-center">
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
            <Button type="button" className="w-full" onClick={cobaLagi}>
              {t("cobaLagi")}
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href="/backoffice">{t("keBeranda")}</Link>
            </Button>
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
