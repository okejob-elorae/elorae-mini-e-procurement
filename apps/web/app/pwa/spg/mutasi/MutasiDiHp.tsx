"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CloudOff, Hourglass, Loader2, Truck } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { formatDisplayDateTime } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import type { PendingMutasiAjuan, PendingMutasiKirim } from "@/lib/pwa/offline/db";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { antreKirimMutasi, mutasiDiHp, type MutasiDiHp } from "@/lib/pwa/offline/luring-antrean";
import { pesanGagalMutasi } from "./tampilan";

/**
 * Mutasi toko ini yang masih di HP (dicatat tanpa sinyal), untuk layar mutasi
 * SPG: ajuan yang belum sampai ke kantor dan tanda dikirim yang belum sampai.
 *
 * Isinya dari basis data HP, jadi baru ada sesudah dimuat (render server dan
 * render pertama sama-sama kosong). Dibaca ulang setiap kali antrean berubah
 * atau layar kembali terlihat. Dengan `segarkan`, halaman dimuat ulang dari
 * server begitu sebuah baris hilang dari HP selagi ada sinyal — artinya baris
 * itu baru saja sampai, dan daftar dari server kini memuatnya.
 *
 * `pernahAda`: kunci setiap baris yang pernah terbaca selama layar terbuka —
 * baris yang pernah ada lalu hilang sudah terkirim (atau dihapus), bukan
 * "belum dimuat".
 */
export function useMutasiDiHp(
  storeId: string,
  opsi: { segarkan?: boolean } = {},
): { siap: boolean; data: MutasiDiHp; pernahAda: ReadonlySet<string> } {
  const router = useRouter();
  const [keadaan, setKeadaan] = useState<{ siap: boolean; data: MutasiDiHp; pernahAda: ReadonlySet<string> }>({
    siap: false,
    data: { ajuan: [], kirim: [] },
    pernahAda: new Set(),
  });
  const lama = useRef<Set<string> | null>(null);
  const segarkan = opsi.segarkan === true;

  useEffect(() => {
    let hidup = true;
    const muat = () => {
      void mutasiDiHp(storeId).then((data) => {
        if (!hidup) return;
        const sekarang = new Set([...data.ajuan.map((a) => a.localId), ...data.kirim.map((k) => k.localId)]);
        const sebelum = lama.current;
        lama.current = sekarang;
        setKeadaan((k) => ({ siap: true, data, pernahAda: new Set([...k.pernahAda, ...sekarang]) }));
        if (segarkan && sebelum && [...sebelum].some((id) => !sekarang.has(id)) && navigator.onLine) router.refresh();
      });
    };
    muat();
    const terlihat = () => {
      if (document.visibilityState === "visible") muat();
    };
    window.addEventListener(PERISTIWA_ANTREAN, muat);
    document.addEventListener("visibilitychange", terlihat);
    return () => {
      hidup = false;
      window.removeEventListener(PERISTIWA_ANTREAN, muat);
      document.removeEventListener("visibilitychange", terlihat);
    };
  }, [storeId, segarkan, router]);

  return keadaan;
}

/** Jalankan antrean sekarang bila ada sinyal (mis. tertahan hanya karena check-in-nya masih di HP). */
export function kirimAntreanBilaBisa(): void {
  if (typeof navigator === "undefined" || !navigator.onLine) return;
  void import("@/lib/pwa/offline/sync").then(
    ({ kirimSemuaAntrean }) => kirimSemuaAntrean().then(() => window.dispatchEvent(new Event(PERISTIWA_ANTREAN))),
    () => undefined,
  );
}

const jumlahPcs = (baris: readonly { qty: number }[]) => baris.reduce((n, b) => n + b.qty, 0);

/** Alasan penolakan baris mutasi di HP, dengan kalimat yang sama dengan layar mutasi. */
export function useAlasanMutasiDiHp() {
  const td = dinamis(useTranslations("spgMutasi"));
  return (r: { error?: string; noKonsi?: string[]; kurang?: PendingMutasiKirim["kurang"] }) =>
    pesanGagalMutasi({ code: r.error ?? "", noKonsi: r.noKonsi, kurang: r.kurang }, td);
}

/**
 * Satu ajuan mutasi yang masih di HP. Arah tanpa persetujuan kantor (menurut
 * aturan saat diajukan) boleh langsung ditandai dikirim — tandanya ikut
 * diantrekan dan terkirim SESUDAH ajuannya sampai.
 */
export function KartuAjuanDiHp({
  ajuan,
  kirim,
  ikatan,
}: {
  ajuan: PendingMutasiAjuan;
  /** Tanda dikirim untuk ajuan ini yang juga masih di HP, bila ada. */
  kirim: PendingMutasiKirim | null;
  /** Kunjungan untuk menandai dikirim sekarang; `null` = belum check-in. */
  ikatan: { visitId: string | null; visitClientId: string | null } | null;
}) {
  const t = useTranslations("spgMutasi");
  const locale = useLocale();
  const alasan = useAlasanMutasiDiHp();
  const [buka, setBuka] = useState(false);
  const [sibuk, mulai] = useTransition();
  const pcs = jumlahPcs(ajuan.baris);
  const ditolak = ajuan.syncState === "failed";
  const bolehTandai = ajuan.langsung && !ditolak && !kirim;

  const tandai = () => {
    if (!ikatan) return;
    mulai(async () => {
      // Stok keluar pada waktu ditandai di sini, bukan saat terkirim.
      const waktu = Date.now();
      try {
        await antreKirimMutasi({
          localId: newLocalId(),
          storeId: ajuan.storeId,
          transferId: null,
          ajuanLocalId: ajuan.localId,
          docNo: null,
          tujuanNama: ajuan.tujuanNama,
          pcs,
          waktu,
          visitId: ikatan.visitId,
          visitClientId: ikatan.visitClientId,
        });
      } catch {
        toast.error(t("luring.gagalSimpan"));
        return;
      }
      setBuka(false);
      toast.success(t("luring.kirimTersimpanAjuan"));
      kirimAntreanBilaBisa();
    });
  };

  return (
    <Card className="py-0">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <CloudOff className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="break-words font-medium leading-tight">{t("keToko", { toko: ajuan.tujuanNama })}</p>
            <p className="text-xs text-muted-foreground">{t("isi", { baris: ajuan.baris.length, pcs })}</p>
            <p className="text-xs text-muted-foreground">{t("luring.diajukanPada", { waktu: formatDisplayDateTime(ajuan.waktu, locale) })}</p>
          </div>
          <Badge variant={ditolak ? "destructive" : "secondary"} className="shrink-0">
            {ditolak ? t("luring.ditolak") : t("luring.menunggu")}
          </Badge>
        </div>

        <p className={ditolak ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {ditolak ? alasan(ajuan) : t("luring.menungguIsi")}
        </p>

        {kirim ? (
          <p className={kirim.syncState === "failed" ? "flex items-start gap-2 text-sm text-destructive" : "flex items-start gap-2 text-sm"}>
            <Truck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{kirim.syncState === "failed" ? alasan(kirim) : t("luring.kirimMenungguAjuan")}</span>
          </p>
        ) : null}

        {bolehTandai ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t("luring.langsungIsi")}</p>
            <Button type="button" className="w-full" disabled={!ikatan || sibuk} onClick={() => setBuka(true)}>
              <Truck className="h-4 w-4" aria-hidden />
              {t("rincian.tandaiDikirim")}
            </Button>
            <KeteranganKirim teks={!ikatan ? t("rincian.perluCheckInKirim") : null} />
          </div>
        ) : null}

        {ditolak || kirim?.syncState === "failed" ? (
          <Button asChild variant="outline" className="h-auto min-h-11 w-full whitespace-normal py-2">
            <Link href="/pwa/spg/antrean">
              <Hourglass className="h-4 w-4" aria-hidden />
              {t("luring.lihatAntrean")}
            </Link>
          </Button>
        ) : null}
      </CardContent>

      <AlertDialog open={buka} onOpenChange={(v) => !sibuk && setBuka(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rincian.kirimJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("luring.kirimIsiAjuan", { pcs, toko: ajuan.tujuanNama })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("rincian.periksaLagi")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={sibuk}
              onClick={(e) => {
                e.preventDefault();
                tandai();
              }}
            >
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("rincian.yaKirim")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
