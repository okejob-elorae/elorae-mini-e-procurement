"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, PackageCheck, PackageSearch, PackageX } from "lucide-react";
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
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { laporHasilCekSelisihAction } from "@/app/actions/store-returns";
import { formatDisplayDateTime } from "@/lib/date-only";
import { formatRupiah } from "@/lib/format/rupiah";
import { dinamis } from "@/lib/i18n/dinamis";
import { BATAS_TEKS_HILANG } from "@/lib/spg/hilang";
import type { SelisihReturSaya } from "@/lib/receivables/pwa-queries";

/** Panjang catatan hasil cek — batas yang sama dengan penulisnya (`laporHasilCekSelisih`). */
const BATAS_CATATAN = BATAS_TEKS_HILANG;

type Hasil = "DITEMUKAN" | "TIDAK_DITEMUKAN";

/**
 * "Selisih retur yang perlu Anda cek" (P22, P85, P88): retur toko yang Anda
 * pegang, yang diterima gudang KURANG dari klaim toko. Tanyakan ke toko DAN ke
 * SPG-nya; laporkan hasilnya. Ketemu → kirim balik ke gudang. Tidak ketemu →
 * catatan wajib (apa kata toko dan SPG), lalu kantor memutuskan bebannya.
 * Tombol hanya untuk baris yang masih menunggu laporan Anda (`perluDicek`);
 * yang sudah Anda laporkan tampil di bawahnya sampai kantor memutuskan.
 * Rupiah ditampilkan juga untuk toko konsinyasi (HP salesman menampilkan konsi
 * lengkap, P18/P18a). Butuh sinyal — tidak diantrekan.
 */
export function SelisihPerluDicek({ baris }: { baris: SelisihReturSaya[] }) {
  const t = useTranslations("pwaRetur.selisih");
  if (baris.length === 0) return null;
  const perlu = baris.filter((b) => b.perluDicek);
  const sudah = baris.filter((b) => !b.perluDicek);
  return (
    <section id="selisih" className="space-y-3" aria-labelledby="selisih-judul">
      <div className="space-y-1">
        <h2 id="selisih-judul" className="flex items-center gap-2 text-lg font-semibold">
          <PackageSearch className="h-5 w-5" aria-hidden />
          {perlu.length > 0 ? t("judul") : t("sudahDilaporJudul")}
        </h2>
        <p className="text-sm text-muted-foreground">{perlu.length > 0 ? t("penjelasan") : t("sudahDilaporIsi")}</p>
      </div>
      {perlu.map((b) => (
        <KartuSelisih key={b.chargeId} b={b} />
      ))}
      {perlu.length > 0 && sudah.length > 0 ? (
        <div className="space-y-1 pt-2">
          <h3 className="font-semibold">{t("sudahDilaporJudul")}</h3>
          <p className="text-sm text-muted-foreground">{t("sudahDilaporIsi")}</p>
        </div>
      ) : null}
      {sudah.map((b) => (
        <KartuSelisih key={b.chargeId} b={b} />
      ))}
    </section>
  );
}

function KartuSelisih({ b }: { b: SelisihReturSaya }) {
  const t = useTranslations("pwaRetur.selisih");
  const ts = dinamis(t);
  const locale = useLocale();
  // Barang temuan sudah datang tetapi masih ada sisa: perlu dicek lagi, apa pun laporan terakhirnya.
  const label = b.perluDicek ? "DITANYAKAN" : b.cek;
  return (
    <Card className="py-0">
      <CardContent className="space-y-3 py-4">
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block font-semibold">{b.noNrt}</span>
            <span className="block text-xs text-muted-foreground">{[b.storeName, b.noNri].filter(Boolean).join(" · ")}</span>
          </span>
          <Badge variant={b.perluDicek ? "destructive" : "secondary"} className="shrink-0">
            {ts(`cek.${label}`)}
          </Badge>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("nilaiKurang")}</p>
          <p className="font-bold tabular-nums">{formatRupiah(b.nilai)}</p>
        </div>
        {b.barang.length > 0 ? (
          <ul className="divide-y rounded-md border text-sm">
            {b.barang.map((k, i) => (
              <li key={`${k.itemName}:${k.variantSku ?? ""}:${i}`} className="flex items-start justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block font-medium leading-tight">{k.itemName}</span>
                  {k.variantSku ? <span className="block text-xs text-muted-foreground">{k.variantSku}</span> : null}
                </span>
                <span className="shrink-0 tabular-nums">{t("kurangPcs", { n: k.qtyKurang })}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {b.spg.length > 0 ? <p className="text-sm">{t("spgToko", { nama: b.spg.join(", ") })}</p> : null}
        {b.cek !== "DITANYAKAN" && b.cekPada ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm">
            <span className="block font-medium">{t("laporTerakhir", { pada: formatDisplayDateTime(b.cekPada, locale) })}</span>
            {b.cekCatatan ? <span className="block whitespace-pre-line break-words">{b.cekCatatan}</span> : null}
          </p>
        ) : null}
        {b.perluDicek ? (
          <div className="grid grid-cols-2 gap-2">
            <TombolHasil chargeId={b.chargeId} noNrt={b.noNrt} hasil="DITEMUKAN" />
            <TombolHasil chargeId={b.chargeId} noNrt={b.noNrt} hasil="TIDAK_DITEMUKAN" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TombolHasil({ chargeId, noNrt, hasil }: { chargeId: string; noNrt: string; hasil: Hasil }) {
  const t = useTranslations("pwaRetur.selisih");
  const te = dinamis(t);
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [catatan, setCatatan] = useState("");
  const [sibuk, mulai] = useTransition();
  const wajib = hasil === "TIDAK_DITEMUKAN";
  const kurang = !sibuk && wajib && catatan.trim() === "" ? t("kurangCatatan") : null;
  const idCatatan = `selisih-${hasil}-${chargeId}`;

  const kirim = () =>
    mulai(async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        toast.error(t("butuhSinyal"));
        return;
      }
      let h: Awaited<ReturnType<typeof laporHasilCekSelisihAction>>;
      try {
        h = await laporHasilCekSelisihAction(chargeId, hasil, catatan);
      } catch {
        toast.error(t("err.GAGAL"));
        return;
      }
      if (h.ok) {
        toast.success(hasil === "DITEMUKAN" ? t("okDitemukan") : t("okTidakDitemukan"));
        setBuka(false);
        setCatatan("");
        router.refresh();
        return;
      }
      toast.error(t.has(`err.${h.kode}`) ? te(`err.${h.kode}`) : t("err.GAGAL"));
      router.refresh();
    });

  return (
    <>
      <Button type="button" variant={wajib ? "outline" : "default"} className="h-auto whitespace-normal py-3" onClick={() => setBuka(true)}>
        {wajib ? <PackageX className="h-4 w-4 shrink-0" aria-hidden /> : <PackageCheck className="h-4 w-4 shrink-0" aria-hidden />}
        {wajib ? t("tidakDitemukan") : t("ditemukan")}
      </Button>
      <AlertDialog open={buka} onOpenChange={(o) => !sibuk && setBuka(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{wajib ? t("tidakDitemukanJudul", { noNrt }) : t("ditemukanJudul", { noNrt })}</AlertDialogTitle>
            <AlertDialogDescription>{wajib ? t("tidakDitemukanIsi") : t("ditemukanIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor={idCatatan}>{wajib ? t("catatanWajib") : t("catatanBoleh")}</Label>
            <Textarea
              id={idCatatan}
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              maxLength={BATAS_CATATAN}
              disabled={sibuk}
              rows={3}
            />
          </div>
          <KeteranganKirim teks={kurang} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              variant={wajib ? "destructive" : "default"}
              disabled={sibuk || kurang !== null}
              onClick={(e) => {
                e.preventDefault();
                kirim();
              }}
            >
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("kirim")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
