"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CloudUpload, UserX } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { hitungBelumTerkirim, PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { TombolKeluar } from "./TombolKeluar";

/**
 * Layar HP untuk SPG yang sudah ditandai berhenti (pemilik P66): layar SPG ditutup, tetapi
 * penyinkron latar tetap dipasang layout. Aksi antrean membaca tokonya lewat
 * `tokoSpgUntukAntrean` (`lib/pwa/peran.ts`): pekerjaan yang ditangkap di HP paling lambat akhir
 * hari terakhirnya (WIB) dicatat ke toko yang dilepasnya, yang ditangkap sesudahnya ditolak.
 * Aturan "sampai hari terakhir" itu belum punya jawaban pemilik (pertanyaan terbuka yang dicatat
 * di `tokoSpgUntukAntrean`). Layar ini hanya menunjukkan berapa yang masih menunggu sinyal, supaya
 * ia tidak keluar akun (yang menghapusnya) sebelum semuanya terkirim. Tanggal dan nama toko sudah
 * diformat di server.
 */
export function SpgBerhentiLayar({
  namaToko,
  hariTerakhir,
  onLogout,
}: {
  namaToko: string;
  hariTerakhir: string;
  onLogout: () => Promise<void>;
}) {
  const t = useTranslations("pwa.spgBerhenti");
  const [tertahan, setTertahan] = useState<number | null>(null);

  useEffect(() => {
    let hidup = true;
    const muat = () =>
      void hitungBelumTerkirim()
        .then((n) => {
          if (hidup) setTertahan(n);
        })
        .catch(() => {
          // Basis data HP tidak bisa dibuka (mode privat): tanpa hitungan.
          if (hidup) setTertahan(null);
        });
    muat();
    window.addEventListener(PERISTIWA_ANTREAN, muat);
    return () => {
      hidup = false;
      window.removeEventListener(PERISTIWA_ANTREAN, muat);
    };
  }, []);

  return (
    <div className="space-y-4 p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <UserX className="h-5 w-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <h1 className="text-xl font-bold leading-tight">{t("judul")}</h1>
            <p className="text-sm text-muted-foreground">{t("isi", { toko: namaToko, tanggal: hariTerakhir })}</p>
          </div>
        </div>
        <TombolKeluar onLogout={onLogout} />
      </header>

      {tertahan !== null && tertahan > 0 && (
        <Card className="py-0">
          <CardContent className="flex items-start gap-3 py-4">
            <CloudUpload className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <p className="text-sm leading-relaxed">{t("antrean", { count: tertahan })}</p>
          </CardContent>
        </Card>
      )}
      {tertahan === 0 && <p className="text-sm text-muted-foreground">{t("antreanKosong")}</p>}
    </div>
  );
}
