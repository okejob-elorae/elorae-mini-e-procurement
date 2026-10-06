"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, CloudOff, PackageCheck, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { KeadaanBuktiTerima } from "@/lib/field-sales/delivery/bukti-terima";
import { dinamis } from "@/lib/i18n/dinamis";
import type { PendingBuktiTerima } from "@/lib/pwa/offline/db";
import { buktiTerimaTertahanPesanan } from "@/lib/pwa/offline/bukti-terima-queue";
import { letakAlasanBuktiTerima } from "@/lib/pwa/offline/bukti-terima-classify";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { cn } from "@/lib/utils";
import { LembarBuktiTerima, type SasaranBuktiTerima } from "./LembarBuktiTerima";
import { BarisTerimaToko, type TerimaTokoTampil } from "./TerimaToko";

/** Satu pengiriman seperti yang ditampilkan HP — semua tanggal sudah diformat server (WIB). */
export type KirimanTampil = {
  id: string;
  docNo: string;
  dikirim: string;
  pcs: number;
  batasAwalIso: string;
  keadaan: KeadaanBuktiTerima;
  receivedByName: string | null;
  diterima: string | null;
  podPhotoUrl: string | null;
  /** Hasil hitung SPG di toko atas pengiriman ini; null = belum dihitung (atau toko tanpa SPG). */
  terimaToko?: TerimaTokoTampil | null;
};

/**
 * Pengiriman pesanan ini dan bukti terimanya.
 *
 * Bukti yang masih di antrean HP ditandai "menunggu sinyal" alih-alih
 * menawarkan tombol konfirmasi lagi — dua bukti untuk satu pengiriman hanya
 * berakhir dengan satu ditolak. Begitu antrean kosong untuk pengiriman itu,
 * halaman dimuat ulang dari server supaya keadaannya yang resmi yang tampil.
 */
export function BuktiTerimaPengiriman({
  orderId,
  storeName,
  kiriman,
}: {
  orderId: string;
  storeName: string;
  kiriman: KirimanTampil[];
}) {
  const t = useTranslations("buktiTerima.hp");
  const tKeadaan = dinamis(useTranslations("buktiTerima.keadaan"));
  const tErr = dinamis(useTranslations("buktiTerima.err"));
  const tFoto = dinamis(useTranslations("foto"));
  const router = useRouter();
  const [tertahan, setTertahan] = useState<Map<string, PendingBuktiTerima>>(new Map());
  const [sasaran, setSasaran] = useState<SasaranBuktiTerima | null>(null);
  const [lihat, setLihat] = useState<KirimanTampil | null>(null);

  const muat = useCallback(() => {
    void buktiTerimaTertahanPesanan(orderId)
      .then((daftar) => {
        setTertahan((lama) => {
          const baru = new Map(daftar.map((b) => [b.deliveryId, b]));
          // Ada yang hilang dari antrean = terkirim (atau dihapus): ambil keadaan resmi dari server.
          if ([...lama.keys()].some((id) => !baru.has(id))) router.refresh();
          return baru;
        });
      })
      .catch(() => {});
  }, [orderId, router]);

  useEffect(() => {
    muat();
    window.addEventListener(PERISTIWA_ANTREAN, muat);
    return () => window.removeEventListener(PERISTIWA_ANTREAN, muat);
  }, [muat]);

  const alasan = (kode: string | undefined) => {
    const letak = letakAlasanBuktiTerima(kode);
    return letak.ruang === "foto" ? tFoto(letak.kunci) : tErr(letak.kunci);
  };

  if (kiriman.length === 0) return null;

  return (
    <section className="beranda-kartu beranda-kartu-daftar" aria-labelledby="bt-judul">
      <h2 id="bt-judul" className="beranda-judul px-4 pt-4">
        {t("judulBagian")}
      </h2>
      <ul className="mt-1 divide-y">
        {kiriman.map((k) => {
          const antre = tertahan.get(k.id);
          const diterima = k.keadaan === "DITERIMA";
          return (
            <li key={k.id} className="space-y-2 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-mono text-sm font-medium">{k.docNo}</span>
                  <span className="block text-xs text-muted-foreground">{t("baris", { date: k.dikirim, pcs: k.pcs })}</span>
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 border-transparent",
                    diterima
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : antre
                        ? "bg-amber-500/10 text-amber-800 dark:text-amber-300"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {diterima ? tKeadaan("DITERIMA") : antre ? t("menungguSinyal") : tKeadaan("BELUM_DITERIMA")}
                </Badge>
              </div>

              {k.terimaToko ? <BarisTerimaToko r={k.terimaToko} /> : null}

              {diterima ? (
                <div className="flex items-center gap-3">
                  {k.podPhotoUrl ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-14 w-14 shrink-0 overflow-hidden p-0"
                      aria-label={t("lihatGambar", { docNo: k.docNo })}
                      onClick={() => setLihat(k)}
                    >
                      {/* Foto dari /api/foto (milik aplikasi, perlu sesi) — next/image tidak dipakai di sini. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={k.podPhotoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </Button>
                  ) : null}
                  <p className="flex items-start gap-1.5 text-sm">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                    <span>{t("diterimaOleh", { name: k.receivedByName ?? "—", date: k.diterima ?? "—" })}</span>
                  </p>
                </div>
              ) : antre ? (
                <div className="space-y-1 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  <p className="flex items-center gap-1.5">
                    <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {antre.syncState === "failed" ? t("gagalIsi", { reason: alasan(antre.error) }) : t("tertahanIsi")}
                  </p>
                  <Link href="/pwa/orders/pending" className="inline-flex min-h-11 items-center font-medium underline underline-offset-4">
                    {t("bukaBelumTerkirim")}
                  </Link>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => setSasaran({ deliveryId: k.id, docNo: k.docNo, batasAwalIso: k.batasAwalIso })}
                >
                  <PackageCheck className="h-4 w-4" aria-hidden />
                  {t("konfirmasi")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <LembarBuktiTerima
        sasaran={sasaran}
        orderId={orderId}
        storeName={storeName}
        onTutup={() => setSasaran(null)}
        onTersimpan={() => {
          setSasaran(null);
          muat();
        }}
      />

      <Dialog open={lihat !== null} onOpenChange={(buka) => !buka && setLihat(null)}>
        <DialogContent className="max-w-lg">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Truck className="h-4 w-4" aria-hidden />
            {lihat ? t("gambarAlt", { docNo: lihat.docNo }) : null}
          </DialogTitle>
          {lihat?.podPhotoUrl ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lihat.podPhotoUrl}
                alt={t("gambarAlt", { docNo: lihat.docNo })}
                className="max-h-[70vh] w-full rounded-md border bg-white object-contain"
              />
              <p className="text-sm text-muted-foreground">
                {t("diterimaOleh", { name: lihat.receivedByName ?? "—", date: lihat.diterima ?? "—" })}
              </p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
