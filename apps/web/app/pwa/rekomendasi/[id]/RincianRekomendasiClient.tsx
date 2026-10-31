"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, Loader2, MessageCircle, Phone, ShoppingCart, Store, XCircle } from "lucide-react";
import {
  batalkanRekomendasiAction,
  tandaiTokoSetujuAction,
  type HasilTransisiRekomendasiAksi,
} from "@/app/actions/rekomendasi-toko";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { TautanKembali } from "@/app/pwa/TautanKembali";
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
import { tulisSumberKeranjang } from "@/lib/field-sales/isi-keranjang-sumber";
import { dinamis } from "@/lib/i18n/dinamis";
import { BATAS_TEKS_REKOMENDASI, type SumberSetujuToko } from "@/lib/salesman/rekomendasi-aturan";
import type { RincianRekomendasiSaya } from "@/lib/salesman/rekomendasi-queries";
import { CatatanJawaban, DaftarBarisRekomendasi, KepalaRekomendasi } from "../IsiRekomendasi";
import { pesanGagalRekomendasi } from "../tampilan";

/**
 * Rincian rekomendasi untuk pembuatnya. Tindakan yang tersedia mengikuti
 * statusnya: kirim ke manager lewat WhatsApp (TERKIRIM/DITERIMA), tandai toko
 * setuju (TERKIRIM, toko tanpa SPG), buat pesanan (DITERIMA), batalkan
 * (TERKIRIM/DITERIMA). Pesanan dibuat dari katalog yang sudah terisi —
 * katalog butuh kunjungan aktif di toko itu untuk mengirim, jadi tanpa
 * check-in layar ini mengatakannya lebih dulu.
 */
export function RincianRekomendasiClient({ rincian, sudahCheckIn }: { rincian: RincianRekomendasiSaya | null; sudahCheckIn: boolean }) {
  const t = useTranslations("pwaRekomendasi.rincian");
  const tr = dinamis(useTranslations("pwaRekomendasi"));
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [setujuBuka, setSetujuBuka] = useState(false);
  const [batalBuka, setBatalBuka] = useState(false);
  const [sumber, setSumber] = useState<SumberSetujuToko>("WHATSAPP");
  const [teks, setTeks] = useState("");

  const kembali = (
    <Button variant="ghost" size="sm" asChild className="-ml-2">
      <TautanKembali cadangan="/pwa/rekomendasi" />
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
            <Link href="/pwa/rekomendasi">{t("keDaftar")}</Link>
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

  const katalog = `/pwa/stores/${rincian.toko.id}/catalog?isi=${encodeURIComponent(tulisSumberKeranjang({ jenis: "rekomendasi", id: rincian.id }))}`;

  return (
    <div className="space-y-4 p-4">
      {kembali}
      <KepalaRekomendasi rincian={rincian} />
      <CatatanJawaban rincian={rincian} />

      {rincian.status === "TERKIRIM" ? (
        <p className="beranda-kartu text-sm text-muted-foreground">{rincian.toko.adaSpg ? t("menungguSpg") : t("menungguToko")}</p>
      ) : null}
      {rincian.status === "SELESAI" && rincian.pesanan ? (
        <section className="beranda-kartu space-y-2">
          <p className="text-sm">{t("selesai", { orderNo: rincian.pesanan.orderNo })}</p>
          <Button asChild variant="outline" className="w-full">
            <Link href={`/pwa/orders/${rincian.pesanan.id}`}>{t("lihatPesanan")}</Link>
          </Button>
        </section>
      ) : null}

      <DaftarBarisRekomendasi rincian={rincian} />

      <section aria-label={t("tindakanLabel")} className="flex flex-col gap-2">
        {rincian.bolehPesan ? (
          <div className="flex flex-col gap-2">
            {sudahCheckIn ? (
              <Button asChild size="lg">
                <Link href={katalog}>
                  <ShoppingCart className="h-4 w-4" aria-hidden />
                  {t("buatPesanan")}
                </Link>
              </Button>
            ) : (
              <>
                <Button size="lg" disabled>
                  <ShoppingCart className="h-4 w-4" aria-hidden />
                  {t("buatPesanan")}
                </Button>
                <KeteranganKirim teks={t("perluCheckIn", { toko: rincian.toko.nama })} />
                <div className="grid grid-cols-2 gap-2">
                  <Button asChild variant="outline" className="h-auto min-h-11 whitespace-normal py-2">
                    <Link href={`/pwa/stores/${rincian.toko.id}`}>
                      <Store className="h-4 w-4 shrink-0" aria-hidden />
                      {t("bukaToko")}
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="h-auto min-h-11 whitespace-normal py-2">
                    <Link href={`${katalog}&jarakJauh=WA`}>
                      <Phone className="h-4 w-4 shrink-0" aria-hidden />
                      {t("pesanJarakJauh")}
                    </Link>
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {rincian.wa ? (
          <div className="flex flex-col gap-1">
            <Button asChild variant={rincian.bolehPesan ? "outline" : "default"}>
              <a href={rincian.wa.tautan} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-4 w-4" aria-hidden />
                {t("waKirim")}
              </a>
            </Button>
            <p className="text-xs text-muted-foreground">{rincian.wa.adaNomor ? t("waPenjelasan") : t("waTanpaNomor")}</p>
          </div>
        ) : null}

        {rincian.bolehTandaiSetuju ? (
          <Button variant="outline" disabled={pending} onClick={() => setSetujuBuka(true)}>
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {t("tandaiSetuju")}
          </Button>
        ) : null}

        {rincian.bolehBatal ? (
          <Button variant="outline" disabled={pending} onClick={() => setBatalBuka(true)}>
            <XCircle className="h-4 w-4" aria-hidden />
            {t("batalkan")}
          </Button>
        ) : null}
      </section>

      <AlertDialog
        open={setujuBuka}
        onOpenChange={(v) => {
          if (pending) return;
          setSetujuBuka(v);
          if (!v) setTeks("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("setujuJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("setujuIsi", { toko: rincian.toko.nama })}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("setujuSumber")}>
              {(["WHATSAPP", "LANGSUNG"] as const).map((s) => (
                <Button
                  key={s}
                  type="button"
                  variant={sumber === s ? "default" : "outline"}
                  aria-pressed={sumber === s}
                  className="h-auto min-h-11 whitespace-normal py-2"
                  onClick={() => setSumber(s)}
                  disabled={pending}
                >
                  {tr(`rincian.sumber.${s}`)}
                </Button>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor="rekomendasi-setuju-catatan">{t("setujuCatatan")}</Label>
              <Textarea
                id="rekomendasi-setuju-catatan"
                value={teks}
                rows={2}
                maxLength={BATAS_TEKS_REKOMENDASI}
                placeholder={t("setujuContoh")}
                onChange={(e) => setTeks(e.target.value)}
                disabled={pending}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("jangan")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                jalankan(
                  () => tandaiTokoSetujuAction({ recommendationId: rincian.id, sumber, catatan: teks.trim() || null }),
                  t("okSetuju"),
                  () => {
                    setSetujuBuka(false);
                    setTeks("");
                  },
                );
              }}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("yaSetuju")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={batalBuka}
        onOpenChange={(v) => {
          if (pending) return;
          setBatalBuka(v);
          if (!v) setTeks("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("batalJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("batalIsi", { toko: rincian.toko.nama })}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rekomendasi-batal-alasan">{t("batalAlasan")}</Label>
            <Textarea
              id="rekomendasi-batal-alasan"
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
                jalankan(
                  () => batalkanRekomendasiAction({ recommendationId: rincian.id, alasan: teks.trim() || null }),
                  t("okBatal"),
                  () => {
                    setBatalBuka(false);
                    setTeks("");
                  },
                );
              }}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("yaBatalkan")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
