"use client";

import { startTransition, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CloudUpload, TriangleAlert, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TautanKembali } from "@/app/pwa/TautanKembali";

type Props = { error: Error & { digest?: string }; reset: () => void };

function langgananSinyal(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
const adaSinyal = () => navigator.onLine;
const adaSinyalServer = () => true;

/**
 * Galat di layar HP, tampil di dalam kerangka HP (menu bawah tetap ada).
 *
 * Tanpa sinyal, galat hampir selalu karena halamannya tidak bisa diambil —
 * judulnya mengatakan itu. Kiriman yang sudah masuk antrean HP (pesanan, nota,
 * laporan, foto) tidak tersentuh galat layar: jumlahnya dibaca dari antrean dan
 * disebut (termasuk yang ditolak server — karena itu kalimatnya tidak berjanji
 * "akan terkirim"), dan sinkron latar di tata letak tetap mengirim sisanya.
 *
 * "Coba lagi" menyegarkan data server lalu memasang ulang layarnya. Pesan
 * galat tidak pernah ditampilkan; yang boleh dilaporkan hanya kodenya.
 */
export default function GalatHp({ error, reset }: Props) {
  const t = useTranslations("halamanGalat");
  const router = useRouter();
  const online = useSyncExternalStore(langgananSinyal, adaSinyal, adaSinyalServer);
  const [tertahan, setTertahan] = useState(0);
  // Nota SPG yang tertahan hanya tampil di antrean SPG; selain itu semuanya di "Belum terkirim".
  const [keAntrean, setKeAntrean] = useState("/pwa/orders/pending");

  useEffect(() => {
    console.error(error);
  }, [error]);

  // Antrean dibaca dari basis data HP sesudah mount; gagal membaca = tidak disebut.
  useEffect(() => {
    let hidup = true;
    let lepas: (() => void) | undefined;
    Promise.all([import("@/lib/pwa/offline/hitung"), import("@/lib/pwa/offline/db")])
      .then(([{ hitungBelumTerkirim, PERISTIWA_ANTREAN }, { pwaDb }]) => {
        const hitung = () =>
          Promise.all([hitungBelumTerkirim(), pwaDb.pendingSpgSales.count()]).then(
            ([n, notaSpg]) => {
              if (!hidup) return;
              setTertahan(n);
              setKeAntrean(notaSpg > 0 ? "/pwa/spg/antrean" : "/pwa/orders/pending");
            },
            () => undefined,
          );
        void hitung();
        window.addEventListener(PERISTIWA_ANTREAN, hitung);
        lepas = () => window.removeEventListener(PERISTIWA_ANTREAN, hitung);
        if (!hidup) lepas();
      })
      .catch(() => undefined);
    return () => {
      hidup = false;
      lepas?.();
    };
  }, []);

  function cobaLagi() {
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  const Ikon = online ? TriangleAlert : WifiOff;

  return (
    <div className="flex min-h-dvh flex-col gap-3 p-4">
      <header className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <TautanKembali cadangan="/pwa" />
        </Button>
      </header>

      <Card className="py-0" role="alert">
        <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
          <div className={online ? "rounded-full bg-destructive/10 p-3" : "rounded-full bg-muted p-3"}>
            <Ikon className={online ? "h-6 w-6 text-destructive" : "h-6 w-6 text-muted-foreground"} aria-hidden />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">{online ? t("judul") : t("judulLuring")}</h1>
            <p className="text-sm text-muted-foreground">{online ? t("pesan") : t("pesanLuring")}</p>
          </div>
          <div className="flex w-full flex-col gap-2">
            <Button type="button" size="lg" className="w-full" onClick={cobaLagi}>
              {t("cobaLagi")}
            </Button>
            <Button asChild size="lg" variant="outline" className="w-full">
              <Link href="/pwa">{t("keBeranda")}</Link>
            </Button>
          </div>
          {error.digest && (
            <p className="text-xs text-muted-foreground">
              {t("kode")} <span className="select-all break-all font-mono">{error.digest}</span>
            </p>
          )}
        </CardContent>
      </Card>

      {tertahan > 0 && (
        <Card className="py-0">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <CloudUpload className="h-4 w-4" aria-hidden />
              </span>
              <p className="text-sm">{t("antreanAman", { jumlah: tertahan })}</p>
            </div>
            <Button asChild variant="secondary" className="w-full">
              <Link href={keAntrean}>{t("lihatAntrean")}</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
