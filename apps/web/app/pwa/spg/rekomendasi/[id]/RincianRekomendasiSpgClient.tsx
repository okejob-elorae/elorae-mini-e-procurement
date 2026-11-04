"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { terimaRekomendasiAction, tolakRekomendasiAction, type HasilTransisiRekomendasiAksi } from "@/app/actions/rekomendasi-toko";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { CatatanJawaban, DaftarBarisRekomendasi, KepalaRekomendasi } from "@/app/pwa/rekomendasi/IsiRekomendasi";
import { pesanGagalRekomendasi } from "@/app/pwa/rekomendasi/tampilan";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import { BATAS_TEKS_REKOMENDASI } from "@/lib/salesman/rekomendasi-aturan";
import type { RincianRekomendasiSpg } from "@/lib/salesman/rekomendasi-queries";

/**
 * Rincian rekomendasi untuk SPG toko tujuannya: barang dan jumlah yang
 * disarankan sales (tanpa harga), lalu terima atau tolak. Menolak wajib
 * beralasan supaya sales tahu kenapa — rak penuh, ukuran tidak cocok, dst.
 */
export function RincianRekomendasiSpgClient({ rincian }: { rincian: RincianRekomendasiSpg | null }) {
  const t = useTranslations("spgRekomendasi.rincian");
  const tr = dinamis(useTranslations("pwaRekomendasi"));
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [terimaBuka, setTerimaBuka] = useState(false);
  const [tolakBuka, setTolakBuka] = useState(false);
  const [teks, setTeks] = useState("");

  const kembali = (
    <Button variant="ghost" size="sm" asChild className="-ml-2">
      <TautanKembali cadangan="/pwa/spg/rekomendasi" />
    </Button>
  );

  if (!rincian) {
    return (
      <div className="space-y-4 p-4">
        {kembali}
        <section className="beranda-kartu space-y-3">
          <h1 className="text-lg font-semibold leading-tight">{t("tidakAdaJudul")}</h1>
          <p className="text-sm text-muted-foreground">{t("tidakAdaIsi")}</p>
          <Button asChild className="w-full">
            <Link href="/pwa/spg/rekomendasi">{t("keDaftar")}</Link>
          </Button>
        </section>
      </div>
    );
  }

  const jalankan = (aksi: () => Promise<HasilTransisiRekomendasiAksi>, sukses: string, tutup: () => void) =>
    mulai(async () => {
      let r: HasilTransisiRekomendasiAksi;
      try {
        r = await aksi();
      } catch {
        toast.error(tr("err.JARINGAN"));
        return;
      }
      tutup();
      if (!r.ok) {
        toast.error(pesanGagalRekomendasi(r, tr));
        router.refresh();
        return;
      }
      toast.success(sukses);
      router.refresh();
    });

  const tutupDialog = (setter: (v: boolean) => void) => (v: boolean) => {
    if (pending) return;
    setter(v);
    if (!v) setTeks("");
  };
  const alasanKurang = teks.trim() === "" ? t("alasanWajib") : null;

  return (
    <div className="space-y-4 p-4">
      {kembali}
      <KepalaRekomendasi rincian={rincian} untukSpg />
      <CatatanJawaban rincian={rincian} />
      <DaftarBarisRekomendasi rincian={rincian} />

      {rincian.bolehJawab ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="lg" className="h-auto min-h-11 whitespace-normal py-2" disabled={pending} onClick={() => setTolakBuka(true)}>
            <X className="h-4 w-4 shrink-0" aria-hidden />
            {t("tolak")}
          </Button>
          <Button size="lg" className="h-auto min-h-11 whitespace-normal py-2" disabled={pending} onClick={() => setTerimaBuka(true)}>
            <Check className="h-4 w-4 shrink-0" aria-hidden />
            {t("terima")}
          </Button>
        </div>
      ) : null}

      <AlertDialog open={terimaBuka} onOpenChange={tutupDialog(setTerimaBuka)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("terimaJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("terimaIsi", { pcs: rincian.totalPcs })}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rekomendasi-terima-catatan">{t("terimaCatatan")}</Label>
            <Textarea
              id="rekomendasi-terima-catatan"
              value={teks}
              rows={2}
              maxLength={BATAS_TEKS_REKOMENDASI}
              onChange={(e) => setTeks(e.target.value)}
              disabled={pending}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("jangan")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                jalankan(() => terimaRekomendasiAction({ recommendationId: rincian.id, catatan: teks.trim() || null }), t("okTerima"), () => {
                  setTerimaBuka(false);
                  setTeks("");
                });
              }}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("yaTerima")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={tolakBuka} onOpenChange={tutupDialog(setTolakBuka)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tolakJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("tolakIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rekomendasi-tolak-alasan">{t("tolakAlasan")}</Label>
            <Textarea
              id="rekomendasi-tolak-alasan"
              value={teks}
              rows={2}
              maxLength={BATAS_TEKS_REKOMENDASI}
              placeholder={t("tolakContoh")}
              onChange={(e) => setTeks(e.target.value)}
              disabled={pending}
            />
            <KeteranganKirim teks={alasanKurang} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("jangan")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending || alasanKurang !== null}
              onClick={(e) => {
                e.preventDefault();
                jalankan(() => tolakRekomendasiAction({ recommendationId: rincian.id, alasan: teks.trim() }), t("okTolak"), () => {
                  setTolakBuka(false);
                  setTeks("");
                });
              }}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("yaTolak")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
