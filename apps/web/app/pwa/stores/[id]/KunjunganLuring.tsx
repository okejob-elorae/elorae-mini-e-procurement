"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CloudOff, Loader2, RotateCw, ShoppingBag, Trash2, TriangleAlert } from "lucide-react";
import { bacaSyaratCheckOut } from "../actions";
import { CheckOutButton } from "./CheckOutButton";
import { VisitPhotoCapture } from "./VisitPhotoCapture";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Button } from "@/components/ui/button";
import { dinamis } from "@/lib/i18n/dinamis";
import { kembaliAman } from "@/lib/pwa/kembali-setelah-checkin";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { hapusLuring, ulangLuring } from "@/lib/pwa/offline/luring-antrean";
import { kunciAlasanLuring } from "@/lib/pwa/offline/luring-klasifikasi";
import { aturanKunjunganDiHp, lupakanKunjunganTerkirim, type KunjunganLokal } from "@/lib/pwa/offline/luring-kunjungan";
import { hariWib, labelMasuk, labelMasukUntuk } from "@/lib/spg/beranda-spg";

/** Jam diformat di klien dengan sengaja: datanya dari HP (IndexedDB), tidak pernah dirender server. */

/** Teks alasan penolakan check-in — sama dengan layar "Belum terkirim". */
export function useAlasanLuring() {
  const ta = dinamis(useTranslations("pwaLuring.alasan"));
  return (kode: string | null | undefined, rinci?: { jarakMeter?: number; radiusMeter?: number } | null) => {
    const kunci = kunciAlasanLuring(kode ?? undefined);
    if (kunci === "DI_LUAR_RADIUS") {
      return typeof rinci?.jarakMeter === "number" && typeof rinci?.radiusMeter === "number"
        ? ta("DI_LUAR_RADIUS", { jarak: rinci.jarakMeter, radius: rinci.radiusMeter })
        : ta("DI_LUAR_RADIUS_UMUM");
    }
    return ta(kunci);
  };
}

/**
 * Kunjungan yang berjalan DI HP (check-in tanpa sinyal) — menggantikan tombol
 * check-in di halaman toko dan beranda SPG selama halaman itu belum tahu dari
 * server.
 *
 * - Masih di antrean / sudah terkirim: kartu kunjungan berjalan dengan
 *   check-out (yang juga diantrekan bila perlu).
 * - Ditolak server: alasannya, dengan Coba lagi dan Hapus. Tombol check-in
 *   biasa tetap tampil di bawahnya (dirender pemanggil).
 */
export function KunjunganLuring({
  kunjungan,
  storeId,
  kembali = null,
  foto = false,
}: {
  kunjungan: KunjunganLokal;
  storeId: string;
  kembali?: string | null;
  /** Halaman toko: foto kunjungan bisa diambil walau check-in-nya masih di HP. */
  foto?: boolean;
}) {
  const t = useTranslations("pwaLuring.checkIn");
  const ta = useTranslations("pwaLuring.antrean");
  const router = useRouter();
  const alasanTeks = useAlasanLuring();
  const [sibuk, setSibuk] = useState(false);
  const [yakin, setYakin] = useState(false);
  // Kunjungan yang masih di HP bisa dari hari lain: jam saja akan terbaca seperti hari ini.
  const [hariIni] = useState(() => hariWib(Date.now()));
  const diperiksa = useRef<string | null>(null);
  const tujuan = kembaliAman(kembali);

  // Check-in sudah terkirim tapi halaman ini belum tahu: tanyakan server
  // sekali. Kunjungannya masih berjalan → muat ulang halaman; sudah ditutup
  // (check-out di tempat lain) → kunjungan di HP dilupakan.
  useEffect(() => {
    if (kunjungan.keadaan !== "terkirim" || !kunjungan.visitId || !navigator.onLine) return;
    if (diperiksa.current === kunjungan.visitId) return;
    diperiksa.current = kunjungan.visitId;
    void bacaSyaratCheckOut(kunjungan.visitId).then(
      (s) => {
        if (s.ok && s.selesai) {
          lupakanKunjunganTerkirim();
          window.dispatchEvent(new Event(PERISTIWA_ANTREAN));
        } else if (s.ok) {
          router.refresh();
        }
      },
      () => undefined,
    );
  }, [kunjungan.keadaan, kunjungan.visitId, router]);

  if (kunjungan.keadaan === "ditolak") {
    const keAntrean = aturanKunjunganDiHp()?.spg ? "/pwa/spg/antrean" : null;
    const ulang = async () => {
      setSibuk(true);
      try {
        await ulangLuring("checkin", kunjungan.clientId);
        if (navigator.onLine) {
          const { kirimSemuaAntrean } = await import("@/lib/pwa/offline/sync");
          await kirimSemuaAntrean();
          window.dispatchEvent(new Event(PERISTIWA_ANTREAN));
        }
      } finally {
        setSibuk(false);
      }
    };
    const hapus = async () => {
      setSibuk(true);
      try {
        await hapusLuring("checkin", kunjungan.clientId);
      } finally {
        setSibuk(false);
      }
    };
    return (
      <>
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>{t("ditolakJudul")}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{alasanTeks(kunjungan.alasan, kunjungan.rinci)}</p>
            <p>{t("ditolakIsi")}</p>
          </AlertDescription>
        </Alert>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" disabled={sibuk} onClick={() => void ulang()} className="h-auto min-h-11 whitespace-normal py-2">
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCw className="h-4 w-4" aria-hidden />}
            {t("cobaLagi")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={sibuk}
            onClick={() => setYakin(true)}
            className="h-auto min-h-11 whitespace-normal py-2 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            {t("hapus")}
          </Button>
        </div>
        {keAntrean ? (
          <Button asChild variant="link" className="h-auto px-0">
            <Link href={keAntrean}>{t("lihatAntrean")}</Link>
          </Button>
        ) : null}
        <AlertDialog open={yakin} onOpenChange={setYakin}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("hapusJudul")}</AlertDialogTitle>
              <AlertDialogDescription>{t("hapusIsi")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("batal")}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  setYakin(false);
                  void hapus().then(() => toast.message(ta("deleted")));
                }}
              >
                {t("hapusYa")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <>
      <section className="beranda-kartu space-y-3" style={{ borderColor: "var(--primary)", borderWidth: 2 }}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="beranda-judul">{t("berjalanJudul")}</h2>
          <span className="text-sm text-muted-foreground">{t("sejak", { jam: labelMasukUntuk(labelMasuk(kunjungan.waktu), hariIni).teks })}</span>
        </div>
        <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{kunjungan.keadaan === "antre" ? t("antreIsi") : t("terkirimIsi")}</span>
        </p>
        {tujuan ? (
          <Button asChild className="w-full">
            <Link href={tujuan}>{t("lanjutkan")}</Link>
          </Button>
        ) : null}
        {/* Salesman: pesanan di kunjungan ini ikut antrean dan terkirim sesudah
            check-in-nya. SPG menjual dari tombol Jual di berandanya sendiri. */}
        {!tujuan && aturanKunjunganDiHp()?.spg === false ? (
          <Button asChild className="w-full">
            <Link href={`/pwa/stores/${storeId}/catalog`}>
              <ShoppingBag className="h-4 w-4" aria-hidden />
              {t("buatPesanan")}
            </Link>
          </Button>
        ) : null}
        <CheckOutButton
          visitId={kunjungan.keadaan === "terkirim" ? kunjungan.visitId : null}
          visitClientId={kunjungan.keadaan === "antre" ? kunjungan.clientId : null}
          storeId={storeId}
          storeName={kunjungan.storeName}
          sejakMs={kunjungan.waktu}
        />
      </section>
      {foto ? (
        <VisitPhotoCapture
          visitId={kunjungan.keadaan === "terkirim" ? kunjungan.visitId : null}
          visitClientId={kunjungan.keadaan === "antre" ? kunjungan.clientId : null}
          storeId={storeId}
          synced={[]}
        />
      ) : null}
    </>
  );
}
