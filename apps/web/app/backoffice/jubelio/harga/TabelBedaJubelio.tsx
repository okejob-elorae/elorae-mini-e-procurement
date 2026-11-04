"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Send, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { formatRupiah } from "@/lib/format/rupiah";
import { hargaSama } from "@/lib/jubelio/harga/aturan";
import type { BarisHargaBeda } from "@/lib/jubelio/harga/queries";
import { kirimUlangHargaJubelioAction } from "@/app/actions/jubelio-harga";
import { usePesanGalatJubelio } from "../RincianGalat";

export type BarisHargaBedaTampil = BarisHargaBeda & { terbacaPadaTampil: string; berubahPadaTampil: string | null };

/**
 * "Harga di Jubelio berbeda dengan ERP" (jawaban pemilik P2, 2026-11-02). Satu-satunya tindakan di
 * sini "Kirim ulang harga ERP" (P74): harga ERP terkonfirmasi menimpa harga di Jubelio dan tercatat
 * di Jejak audit. SATU baris per tekan (rancangan R26): dialognya menyebut harga Jubelio yang akan
 * ditimpa, dan penulisnya membandingkan bacaan Jubelio yang terlihat di sini (P75 "saya tidak
 * setuju jika harga bisa tertimpa"). Tombolnya memanggil aksi yang digerbangi izin yang sama
 * dengan halaman ini (`jubelio_prices:confirm`).
 */
export function TabelBedaJubelio({ baris, total, terpotong }: { baris: BarisHargaBedaTampil[]; total: number; terpotong: boolean }) {
  const t = useTranslations("jubelio.harga");
  const pesanGalat = usePesanGalatJubelio();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [kirimUlang, setKirimUlang] = useState<BarisHargaBedaTampil | null>(null);

  const rp = (nilai: string | null) => {
    const n = nilai == null ? Number.NaN : Number(nilai);
    return Number.isFinite(n) && n > 0 ? formatRupiah(n) : t("tanpaHarga");
  };
  const jubelio = (b: BarisHargaBeda) =>
    b.jubelioTertinggi != null && b.jubelioTerendah != null && !hargaSama(b.jubelioTertinggi, b.jubelioTerendah)
      ? `${rp(b.jubelioTerendah)}–${rp(b.jubelioTertinggi)}`
      : rp(b.jubelioTertinggi ?? b.jubelioTerendah);

  const kirim = () => {
    const b = kirimUlang;
    if (!b) return;
    startTransition(async () => {
      const r = await kirimUlangHargaJubelioAction({ itemId: b.itemId, berubahPada: b.berubahPada });
      setKirimUlang(null);
      if (!r.ok) {
        toast.error(pesanGalat(r));
        return;
      }
      if (r.data.hasil === "DIKIRIM_ULANG") toast.success(t("kirimUlangBerhasil"));
      else toast.error(t(`galat.${r.data.hasil}`));
      router.refresh();
    });
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            {t("bedaCardTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {baris.length === 0 ? (
            <EmptyState icon={AlertTriangle} title={t("bedaKosong")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("colSku")}</TableHead>
                    <TableHead>{t("colNama")}</TableHead>
                    <TableHead className="text-right">{t("colJubelioSekarang")}</TableHead>
                    <TableHead className="text-right">{t("colErpTerkonfirmasi")}</TableHead>
                    <TableHead className="text-right">{t("colErpSekarang")}</TableHead>
                    <TableHead>{t("colSejak")}</TableHead>
                    <TableHead>{t("colKeterangan")}</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">{t("kirimUlang")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => (
                    <TableRow key={b.itemId}>
                      <TableCell className="font-mono text-xs">
                        <Link href={`/backoffice/items/${b.itemId}`} className="underline-offset-2 hover:underline">
                          {b.sku}
                        </Link>
                      </TableCell>
                      <TableCell className="min-w-[180px] max-w-[320px] whitespace-normal">
                        <span>{b.nama}</span>
                        {!b.isActive ? (
                          <Badge variant="outline" className="ml-2">
                            {t("nonaktif")}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-destructive">{jubelio(b)}</TableCell>
                      <TableCell className="text-right tabular-nums">{rp(b.hargaTerkonfirmasi)}</TableCell>
                      <TableCell className="text-right tabular-nums">{rp(b.hargaErp)}</TableCell>
                      <TableCell className="min-w-[140px] whitespace-normal text-sm">
                        <div>{b.berubahPadaTampil ?? t("belumAda")}</div>
                        <div className="text-xs text-muted-foreground">{t("terbacaPada", { waktu: b.terbacaPadaTampil })}</div>
                      </TableCell>
                      <TableCell className="min-w-[220px] max-w-[340px] space-y-1 whitespace-normal text-sm text-muted-foreground">
                        {b.alasan === "ADA_HARGA_BARU" ? (
                          <Link
                            href={`/backoffice/jubelio/harga?jenis=UBAH&cari=${encodeURIComponent(b.sku)}`}
                            className="block underline underline-offset-2"
                          >
                            {t(`alasanKirimUlang.${b.alasan}`)}
                          </Link>
                        ) : b.alasan === "KATEGORI_BELUM_DIPETAKAN" ? (
                          <Link href="/backoffice/jubelio/categories" className="block underline underline-offset-2">
                            {t(`alasanKirimUlang.${b.alasan}`)}
                          </Link>
                        ) : b.alasan ? (
                          <span className="block">{t(`alasanKirimUlang.${b.alasan}`)}</span>
                        ) : null}
                        {b.menungguKonfirmasi && b.alasan !== "ADA_HARGA_BARU" ? <span className="block">{t("menungguJuga")}</span> : null}
                        {b.kirimanDitahan ? <span className="block">{t("kirimanDitahan")}</span> : null}
                        {b.saluran === "OFFLINE" ? <span className="block">{t("saluranOfflineCatatan")}</span> : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" disabled={isPending || b.alasan != null} onClick={() => setKirimUlang(b)}>
                          <Send className="mr-2 h-4 w-4" />
                          {t("kirimUlang")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {terpotong ? <p className="mt-4 text-xs text-muted-foreground">{t("terpotong", { shown: baris.length, total })}</p> : null}
        </CardContent>
      </Card>

      <AlertDialog open={kirimUlang != null} onOpenChange={(v) => !v && !isPending && setKirimUlang(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("kirimUlangJudul")}</AlertDialogTitle>
            <AlertDialogDescription>
              {kirimUlang
                ? t("kirimUlangIsi", { sku: kirimUlang.sku, jubelio: jubelio(kirimUlang), erp: rp(kirimUlang.hargaTerkonfirmasi) })
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending || kirimUlang == null}
              onClick={(e) => {
                e.preventDefault();
                kirim();
              }}
            >
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {t("kirimUlang")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
