"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CloudOff, Loader2, ReceiptText, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";
import { tarikReturPembeliAction } from "@/app/actions/spg-retur";
import { dinamis } from "@/lib/i18n/dinamis";
import { pwaDb } from "@/lib/pwa/offline/db";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import type { ReturPembeliHp } from "@/lib/spg/retur-pembeli-queries";
import { BATAS_ALASAN_RETUR_PEMBELI, type StatusReturPembeli } from "@/lib/spg/retur-pembeli-status";
import { cn } from "@/lib/utils";

/** Warna lencana per status: menunggu kuning, disetujui utama, ditolak merah, ditarik garis saja. */
const LENCANA: Record<StatusReturPembeli, { variant: "default" | "destructive" | "outline"; className?: string }> = {
  MENUNGGU: { variant: "outline", className: "border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  DISETUJUI: { variant: "default" },
  DITOLAK: { variant: "destructive" },
  DIBATALKAN: { variant: "outline" },
};

/**
 * Laporan barang kembali dari pembeli milik SPG ini, terbaru dulu, dengan statusnya. Laporan baru
 * berpengaruh (stok toko, penjualan bersih, komisi) sesudah kantor menyetujuinya; yang masih
 * menunggu boleh ditarik pelapornya sendiri, dengan alasan — laporannya tidak hilang, kantor tetap
 * melihatnya sebagai ditarik. Tanpa harga dan total.
 *
 * Laporan yang dicatat tanpa sinyal belum ada di sini sampai terkirim; jumlahnya dibaca dari HP
 * (`pendingSpgReturns`) dan menunjuk ke "Belum terkirim".
 */
export function ReturPembeliSayaClient({ laporan }: { laporan: ReturPembeliHp[] }) {
  const t = useTranslations("spgRetur.pembeliSaya");
  const tk = dinamis(useTranslations("spgRetur"));
  const ts = dinamis(t);
  const locale = useLocale();
  const [tertahan, setTertahan] = useState(0);

  useEffect(() => {
    let hidup = true;
    const muat = async () => {
      try {
        const n = await pwaDb.pendingSpgReturns.count();
        if (hidup) setTertahan(n);
      } catch {
        // Basis data HP tidak bisa dibuka (mode privat, penyimpanan penuh): tanpa spanduk.
        if (hidup) setTertahan(0);
      }
    };
    void muat();
    const segarkan = () => void muat();
    window.addEventListener(PERISTIWA_ANTREAN, segarkan);
    return () => {
      hidup = false;
      window.removeEventListener(PERISTIWA_ANTREAN, segarkan);
    };
  }, []);

  return (
    <div className="@container flex min-h-dvh flex-col gap-4 p-4">
      <header className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <TautanKembali cadangan="/pwa/spg/lainnya" />
        </Button>
      </header>

      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("judul")}</h1>
          <TombolBantuanHp judul={t("judul")} />
        </div>
        <p className="text-sm text-muted-foreground">{t("penjelasan")}</p>
      </div>

      {tertahan > 0 ? (
        <Link
          href="/pwa/spg/antrean"
          className="flex min-h-11 items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
        >
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {t("tertahan", { n: tertahan })} <span className="font-medium underline underline-offset-4">{t("lihatAntrean")}</span>
          </span>
        </Link>
      ) : null}

      {laporan.length === 0 ? (
        <Card className="py-0">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">{t("kosong")}</CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {laporan.map((r) => {
            const lencana = LENCANA[r.status];
            return (
              <li key={r.id}>
                <Card className="py-0">
                  <CardContent className="space-y-3 py-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <Link
                          href={`/pwa/spg/${encodeURIComponent(r.spgSaleId)}/nota`}
                          className="inline-flex min-h-11 items-center gap-1 font-mono text-sm font-medium underline decoration-primary decoration-2 underline-offset-4"
                        >
                          <ReceiptText className="h-4 w-4 shrink-0" aria-hidden />
                          {t("nota", { docNo: r.docNo })}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {t("dilaporkan", { tanggal: locale === "en" ? r.dilaporkan.en : r.dilaporkan.id })}
                        </p>
                      </div>
                      <Badge variant={lencana.variant} className={cn("shrink-0", lencana.className)}>
                        {ts(`status.${r.status}`)}
                      </Badge>
                    </div>

                    <p className="text-sm">{ts(`statusKet.${r.status}`)}</p>

                    <ul className="divide-y rounded-md border text-sm">
                      {r.baris.map((b, i) => (
                        <li key={`${b.variantSku}:${b.kondisi}:${i}`} className="flex items-start justify-between gap-3 px-3 py-2">
                          <span className="min-w-0">
                            <span className="block font-medium leading-tight">{b.productName}</span>
                            {b.variantSku ? <span className="block text-xs text-muted-foreground">{b.variantSku}</span> : null}
                          </span>
                          <span className="shrink-0 text-right tabular-nums">
                            <span className="block">{t("pcs", { n: b.qty })}</span>
                            <span className="block text-xs text-muted-foreground">{tk(`kondisi${b.kondisi}`)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>

                    <div className="space-y-1 text-sm">
                      <p className="text-xs text-muted-foreground">{t("alasanPembeli")}</p>
                      <p className="whitespace-pre-line break-words">{r.alasan}</p>
                    </div>
                    {r.alasanKeputusan && (r.status === "DITOLAK" || r.status === "DIBATALKAN") ? (
                      <div className="space-y-1 text-sm">
                        <p className="text-xs text-muted-foreground">{r.status === "DITOLAK" ? t("alasanTolak") : t("alasanTarik")}</p>
                        <p className="whitespace-pre-line break-words">{r.alasanKeputusan}</p>
                      </div>
                    ) : null}

                    {r.bisaDitarik ? <TombolTarik returnId={r.id} docNo={r.docNo} /> : null}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Tarik laporan yang masih menunggu kantor. Alasan wajib; server memeriksa ulang semuanya (laporan
 * milik orang lain, toko lain, atau yang sudah diputuskan ditolak) — tombol ini hanya tampil untuk
 * laporan yang biasanya masih boleh ditarik.
 */
function TombolTarik({ returnId, docNo }: { returnId: string; docNo: string }) {
  const t = useTranslations("spgRetur.pembeliSaya");
  const te = dinamis(t);
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [alasan, setAlasan] = useState("");
  const [sibuk, mulai] = useTransition();
  const idAlasan = `tarik-alasan-${returnId}`;

  const kirim = () =>
    mulai(async () => {
      let hasil: Awaited<ReturnType<typeof tarikReturPembeliAction>>;
      try {
        hasil = await tarikReturPembeliAction({ returnId, alasan });
      } catch {
        toast.error(t("err.GAGAL"));
        return;
      }
      if (hasil.ok) {
        toast.success(t("tarikOk"));
        setBuka(false);
        setAlasan("");
        router.refresh();
        return;
      }
      toast.error(t.has(`err.${hasil.kode}`) ? te(`err.${hasil.kode}`) : t("err.GAGAL"));
      // Sudah diputuskan kantor sementara layar ini terbuka: tampilkan keadaan terbarunya.
      if (hasil.kode === "SUDAH_DIPUTUSKAN") {
        setBuka(false);
        router.refresh();
      }
    });

  return (
    <>
      <Button type="button" variant="outline" className="w-full" onClick={() => setBuka(true)}>
        <Undo2 className="h-4 w-4" aria-hidden />
        {t("tarik")}
      </Button>
      <AlertDialog open={buka} onOpenChange={(o) => !sibuk && setBuka(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tarikJudul", { docNo })}</AlertDialogTitle>
            <AlertDialogDescription>{t("tarikPenjelasan")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor={idAlasan}>{t("tarikAlasan")}</Label>
            <Textarea
              id={idAlasan}
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              placeholder={t("tarikAlasanContoh")}
              maxLength={BATAS_ALASAN_RETUR_PEMBELI}
              disabled={sibuk}
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("tarikBatal")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={sibuk || alasan.trim() === ""}
              onClick={(e) => {
                // Dialog tetap terbuka sampai server menjawab — ditutup sendiri kalau berhasil.
                e.preventDefault();
                kirim();
              }}
            >
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("tarikKonfirmasi")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
