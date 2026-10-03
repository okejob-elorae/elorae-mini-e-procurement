"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CloudUpload, Loader2, ReceiptText, RotateCw, ShoppingCart, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatDisplayDateTime } from "@/lib/date-only";
import { formatIDR } from "@/lib/sales-orders/format";
import type { PendingSpgSale } from "@/lib/pwa/offline/db";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import {
  buangBagianNotaSpg,
  daftarNotaSpgTertahan,
  hapusNotaSpgTertahan,
  ulangNotaSpgTertahan,
} from "@/lib/pwa/offline/spg-jual-antrean";
import { bagianBisaDibuang, kunciAlasanNotaSpg } from "@/lib/pwa/offline/spg-jual-klasifikasi";
import { jumlahPotongTertahan, namaPembeliTertahan } from "@/lib/pwa/offline/spg-jual-muatan";
import { flushNotaSpgTertahan, type HasilKirimNotaSpg } from "@/lib/pwa/offline/spg-jual-sinkron";
import { flushCheckinTertahan, flushCheckoutTertahan, flushStokTertahan } from "@/lib/pwa/offline/luring-sinkron";
import { AntreanLuring } from "./AntreanLuring";

/** Nama barang yang ditampilkan per nota; sisanya dihitung. */
const TAMPIL_BARANG = 3;

/**
 * Nota penjualan SPG yang masih di HP ini (dijual tanpa sinyal).
 *
 * Yang menunggu sinyal terkirim sendiri — "Kirim sekarang" dan "Coba lagi"
 * hanya mempercepatnya. Yang ditolak server menunjukkan alasannya; kalau
 * penyebabnya diskon SPG atau data pembeli, SPG bisa memilih mengirim ulang
 * tanpa bagian itu supaya penjualannya tetap tercatat. Menghapus nota
 * berarti penjualannya tidak pernah tercatat — konfirmasinya mengatakan itu.
 *
 * Tanggal di layar ini diformat di klien dengan sengaja: isinya berasal dari
 * basis data HP (IndexedDB) dan baru tampil sesudah dimuat, jadi tidak pernah
 * dirender server — tidak ada hidrasi yang bisa berbeda.
 */
export function AntreanSpgClient() {
  const t = useTranslations("pwa.spgAntrean");
  const tl = useTranslations("pwaLuring.antrean");
  const td = dinamis(t);
  const locale = useLocale();
  const [daftar, setDaftar] = useState<PendingSpgSale[] | null>(null);
  const [sibukId, setSibukId] = useState<string | null>(null);
  const [mengirim, setMengirim] = useState(false);
  // Check-in, check-out, dan pekerjaan stok yang juga masih di HP (`AntreanLuring`).
  const [luring, setLuring] = useState({ total: 0, menunggu: 0 });
  const terimaJumlahLuring = useCallback((j: { total: number; menunggu: number }) => setLuring(j), []);

  const muatUlang = useCallback(() => {
    daftarNotaSpgTertahan().then(
      (d) => setDaftar(d),
      () => setDaftar([]),
    );
  }, []);

  useEffect(() => {
    muatUlang();
    window.addEventListener(PERISTIWA_ANTREAN, muatUlang);
    return () => window.removeEventListener(PERISTIWA_ANTREAN, muatUlang);
  }, [muatUlang]);

  function kabarkanHasil(h: HasilKirimNotaSpg) {
    if (h.sibuk) {
      toast.message(t("busy"));
      return;
    }
    if (h.terkirim > 0) {
      const beda = h.berbeda[0];
      toast.success(t("sent", { count: h.terkirim }), {
        description: beda
          ? t("sentDifferent", { docNo: beda.docNo, total: formatIDR(beda.tercatat), preview: formatIDR(beda.pratinjau), more: h.berbeda.length - 1 })
          : undefined,
      });
    } else if (h.gagal > 0) {
      toast.error(t("rejected", { count: h.gagal }));
    } else if (!navigator.onLine) {
      toast.message(t("stillOffline"));
    } else {
      toast.message(t("notYet"));
    }
  }

  async function jalankan(id: string | null, kerja: () => Promise<void>) {
    if (id) setSibukId(id);
    else setMengirim(true);
    try {
      await kerja();
    } catch {
      toast.error(t("actionFailed"));
    } finally {
      setSibukId(null);
      setMengirim(false);
      muatUlang();
      window.dispatchEvent(new Event(PERISTIWA_ANTREAN));
    }
  }

  /**
   * Kirim semua yang tertahan, urutan sama dengan sinkron latar: check-in dulu
   * (nota dan pekerjaan stok di kunjungan tanpa sinyal menunjuknya), lalu nota,
   * pekerjaan stok, dan check-out paling akhir. Hasil nota dikabarkan seperti
   * sebelumnya; hasil kiriman lain diringkas sendiri.
   */
  const kirimBerurutan = async () => {
    if (!navigator.onLine) {
      toast.message(t("stillOffline"));
      return;
    }
    const masuk = await flushCheckinTertahan();
    const nota = await flushNotaSpgTertahan();
    // Kabar nota hanya bila memang ada nota — "belum terkirim" untuk antrean
    // nota yang kosong menyesatkan saat yang terkirim adalah pekerjaan stok.
    if ((daftar?.length ?? 0) > 0 || nota.terkirim > 0 || nota.gagal > 0) kabarkanHasil(nota);
    const stok = await flushStokTertahan();
    const keluar = await flushCheckoutTertahan();
    const terkirim = masuk.terkirim + stok.terkirim + keluar.terkirim;
    const gagal = masuk.gagal + stok.gagal + keluar.gagal;
    if (gagal > 0) toast.error(tl("ditolakSemua", { count: gagal }));
    else if (terkirim > 0) toast.success(tl("terkirimSemua", { count: terkirim }));
  };

  const kirimSemua = () => jalankan(null, kirimBerurutan);

  const ulang = (n: PendingSpgSale) =>
    jalankan(n.localId, async () => {
      await ulangNotaSpgTertahan(n.localId);
      await kirimBerurutan();
    });

  const kirimTanpa = (n: PendingSpgSale, bagian: "diskon" | "pembeli") =>
    jalankan(n.localId, async () => {
      await buangBagianNotaSpg(n.localId, bagian);
      await kirimBerurutan();
    });

  /** "Coba lagi" pada check-in/check-out/stok — dijalankan oleh `AntreanLuring`. */
  const kirimDariLuring = async () => {
    try {
      await kirimBerurutan();
    } finally {
      muatUlang();
      window.dispatchEvent(new Event(PERISTIWA_ANTREAN));
    }
  };

  const hapus = (n: PendingSpgSale) =>
    jalankan(n.localId, async () => {
      await hapusNotaSpgTertahan(n.localId);
      toast.message(t("deleted"));
    });

  const menunggu = daftar?.filter((n) => n.syncState !== "failed").length ?? 0;

  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan="/pwa/spg/lainnya" />
      </Button>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{tl("subjudul")}</p>
      </header>

      {daftar === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t("loading")}
        </p>
      ) : daftar.length === 0 && luring.total > 0 ? (
        // Tidak ada nota, tapi ada check-in/check-out/pekerjaan stok yang menunggu.
        <section className="beranda-kartu space-y-3">
          <p className="text-sm">{tl("ringkasLain", { count: luring.total, waiting: luring.menunggu })}</p>
          <Button type="button" size="lg" className="w-full" disabled={mengirim || sibukId !== null || luring.menunggu === 0} onClick={kirimSemua}>
            {mengirim ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CloudUpload className="h-4 w-4" aria-hidden />}
            {t("sendNow")}
          </Button>
        </section>
      ) : daftar.length === 0 ? (
        <section className="beranda-kartu space-y-3 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground">
            <ReceiptText className="h-5 w-5" aria-hidden />
          </span>
          <h2 className="text-lg font-semibold">{t("empty.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("empty.body")}</p>
          <Button asChild size="lg" className="w-full">
            <Link href="/pwa/spg/sale">
              <ShoppingCart className="h-4 w-4" aria-hidden />
              {t("empty.cta")}
            </Link>
          </Button>
        </section>
      ) : (
        <>
          <section className="beranda-kartu space-y-3">
            <p className="text-sm">{t("summary", { count: daftar.length, waiting: menunggu })}</p>
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={mengirim || sibukId !== null || menunggu + luring.menunggu === 0}
              onClick={kirimSemua}
            >
              {mengirim ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CloudUpload className="h-4 w-4" aria-hidden />}
              {t("sendNow")}
            </Button>
          </section>

          <ul className="space-y-2">
            {daftar.map((n) => (
              <NotaTertahan
                key={n.localId}
                nota={n}
                waktu={formatDisplayDateTime(n.waktuJual, locale)}
                alasan={n.syncState === "failed" ? td(`alasan.${kunciAlasanNotaSpg(n.error)}`) : null}
                sibuk={sibukId === n.localId || mengirim}
                onUlang={() => ulang(n)}
                onKirimTanpa={(bagian) => kirimTanpa(n, bagian)}
                onHapus={() => hapus(n)}
              />
            ))}
          </ul>
        </>
      )}

      {/* Selalu dipasang (juga saat memuat), supaya jumlahnya sampai ke ringkasan di atas. */}
      <AntreanLuring onJumlah={terimaJumlahLuring} onKirim={kirimDariLuring} sibukLuar={mengirim} />
    </div>
  );
}

function NotaTertahan({
  nota,
  waktu,
  alasan,
  sibuk,
  onUlang,
  onKirimTanpa,
  onHapus,
}: {
  nota: PendingSpgSale;
  waktu: string;
  alasan: string | null;
  sibuk: boolean;
  onUlang: () => void;
  onKirimTanpa: (bagian: "diskon" | "pembeli") => void;
  onHapus: () => void;
}) {
  const t = useTranslations("pwa.spgAntrean");
  const [yakin, setYakin] = useState(false);
  const potong = jumlahPotongTertahan(nota);
  const pembeli = namaPembeliTertahan(nota.pembeli);
  const tampil = nota.lines.slice(0, TAMPIL_BARANG);
  const sisa = nota.lines.length - tampil.length;
  const bisaDibuang = nota.syncState === "failed" ? bagianBisaDibuang(nota.error) : null;
  // Tombol "tanpa ..." hanya kalau bagian itu memang ada di nota.
  const tawarkanBuang =
    bisaDibuang === "diskon" ? nota.diskonManual !== null : bisaDibuang === "pembeli" ? nota.pembeli !== null : false;

  return (
    <li>
      <Card className="py-0">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium leading-tight">{t("soldAt", { time: waktu })}</p>
              <p className="text-xs text-muted-foreground">{t("items", { count: potong })}</p>
            </div>
            <Badge
              variant={nota.syncState === "failed" ? "destructive" : nota.syncState === "syncing" ? "default" : "secondary"}
              className="shrink-0"
            >
              {nota.syncState === "failed" ? t("stateFailed") : nota.syncState === "syncing" ? t("stateSyncing") : t("statePending")}
            </Badge>
          </div>

          <ul className="space-y-0.5 text-sm">
            {tampil.map((l, i) => (
              <li key={`${l.itemId}::${l.variantSku ?? ""}::${i}`} className="flex items-start justify-between gap-3">
                <span className="min-w-0 flex-1 break-words">{l.productName}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">× {l.qty}</span>
              </li>
            ))}
            {sisa > 0 ? <li className="text-xs text-muted-foreground">{t("moreItems", { count: sisa })}</li> : null}
          </ul>

          {pembeli ? <p className="text-xs text-muted-foreground">{t("buyer", { name: pembeli })}</p> : null}

          <div className="space-y-0.5">
            {nota.potonganPratinjau > 0 ? (
              <p className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                <span>{t("discount")}</span>
                <span className="shrink-0 whitespace-nowrap tabular-nums">−{formatIDR(nota.potonganPratinjau)}</span>
              </p>
            ) : null}
            <p className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{t("estimatedTotal")}</span>
              <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">{formatIDR(nota.totalPratinjau)}</span>
            </p>
          </div>

          {alasan ? <p className="text-sm text-destructive">{alasan}</p> : null}

          {tawarkanBuang && bisaDibuang ? (
            <Button
              type="button"
              variant="outline"
              className="h-auto min-h-11 w-full whitespace-normal py-2"
              disabled={sibuk}
              onClick={() => onKirimTanpa(bisaDibuang)}
            >
              {bisaDibuang === "diskon" ? t("sendWithoutDiscount") : t("sendWithoutBuyer")}
            </Button>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" disabled={sibuk} onClick={onUlang} className="h-auto min-h-11 whitespace-normal py-2">
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCw className="h-4 w-4" aria-hidden />}
              {t("retry")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={sibuk}
              onClick={() => setYakin(true)}
              className="h-auto min-h-11 whitespace-normal py-2 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              {t("delete")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Nota ini hanya ada di HP ini — sekali dihapus, penjualannya tidak pernah tercatat di mana pun. */}
      <AlertDialog open={yakin} onOpenChange={setYakin}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteBody", { count: potong, total: formatIDR(nota.totalPratinjau) })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("deleteCancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setYakin(false);
                onHapus();
              }}
            >
              {t("deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
