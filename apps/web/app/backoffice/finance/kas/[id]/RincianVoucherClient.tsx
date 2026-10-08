"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, BookOpenText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiah } from "@/lib/format/rupiah";
import { formatDisplayDateTime } from "@/lib/date-only";
import { labelTanggal } from "@/lib/tanggal-isian";
import { labelKanalJurnal } from "@/lib/finance/journals/kanal";
import { INFO_POTONG_PEMASOK, bacaJenisPotongPemasok } from "@/lib/finance/pajak/pemotongan";
import type { RincianVoucher } from "@/lib/finance/kas/voucher-queries";
import { batalkanVoucherAction } from "@/app/actions/finance-kas";
import { TAUTAN_DOKUMEN } from "@/app/backoffice/purchase-orders/tautan-dokumen";
import { pesanGalatKas } from "../_bersama/pesan-kas";

export function RincianVoucherClient({ voucher: v, bolehKelola }: { voucher: RincianVoucher; bolehKelola: boolean }) {
  const t = useTranslations("financeKas");
  const locale = useLocale();
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [buka, setBuka] = useState(false);
  const [alasan, setAlasan] = useState("");
  const potong = bacaJenisPotongPemasok(v.jenisPotong);

  const batalkan = () =>
    mulai(async () => {
      const r = await batalkanVoucherAction({ id: v.id, alasan });
      if (!r.ok) return void toast.error(pesanGalatKas(t as unknown as Parameters<typeof pesanGalatKas>[0], r));
      toast.success(t("rincian.dibatalkan", { nomor: v.nomor }));
      setBuka(false);
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${t(`jenis.${v.jenis}`)} ${v.nomor}`}
        meta={labelTanggal(v.tanggal, locale)}
        actions={
          <>
            <Link href="/backoffice/finance/kas">
              <Button variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("kembali")}
              </Button>
            </Link>
            {v.jurnalId && (
              <Link href={`/backoffice/finance/journals/${v.jurnalId}`}>
                <Button variant="outline">
                  <BookOpenText className="mr-2 h-4 w-4" />
                  {t("rincian.lihatJurnal")}
                </Button>
              </Link>
            )}
            {bolehKelola && v.status === "POSTED" && (
              <Button variant="destructive" onClick={() => setBuka(true)}>
                {t("rincian.batalkan")}
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>{t("rincian.ringkasan")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pb-6 text-sm">
            <div className="pb-2">{v.status === "CANCELLED" ? <StatusPill tone="inactive">{t("status.CANCELLED")}</StatusPill> : <StatusPill tone="settled">{t("status.POSTED")}</StatusPill>}</div>
            <Baris label={v.jenis === "TRANSFER" ? t("form.rekeningAsal") : t("rincian.rekening")} nilai={v.rekening} />
            {v.rekeningTujuan && <Baris label={t("form.rekeningTujuan")} nilai={v.rekeningTujuan} />}
            {v.pihak && <Baris label={v.jenis === "IN" ? t("form.diterimaDari") : t("form.dibayarKe")} nilai={v.pihak} />}
            {v.pemasok && <Baris label={t("form.pemasok")} nilai={`${v.pemasok.nama} (${v.pemasok.kode})`} />}
            <Baris label={t("form.total")} nilai={formatRupiah(v.total)} />
            {v.potong > 0 && <Baris label={t("rincian.potongJenis", { jenis: potong ? INFO_POTONG_PEMASOK[potong].label : "PPh" })} nilai={`− ${formatRupiah(v.potong)}`} />}
            <Baris label={v.jenis === "IN" ? t("form.netoMasuk") : t("form.netoKeluar")} nilai={formatRupiah(v.neto)} tebal />
            {v.keterangan && <p className="pt-2 whitespace-pre-line">{v.keterangan}</p>}
            {v.fotoUrl && (
              <a href={v.fotoUrl} target="_blank" rel="noreferrer" className={`${TAUTAN_DOKUMEN} inline-block pt-2`}>
                {t("rincian.lihatBukti")}
              </a>
            )}
            {v.mutasiTercocok > 0 && <p className="pt-2 text-xs text-muted-foreground">{t("rincian.sudahDicocokkan")}</p>}
            <p className="pt-3 text-xs text-muted-foreground">{t("rincian.dicatat", { nama: v.pencatat ?? "–", waktu: formatDisplayDateTime(v.dibuat, locale) })}</p>
            {v.dibatalkan && <p className="text-xs text-muted-foreground">{t("rincian.dibatalkanOleh", { nama: v.dibatalkan.oleh ?? "–", waktu: formatDisplayDateTime(v.dibatalkan.pada, locale), alasan: v.dibatalkan.alasan ?? "–" })}</p>}
          </CardContent>
        </Card>

        {v.jenis !== "TRANSFER" && (
          <Card className="py-0 lg:col-span-2">
            <CardHeader className="pt-6">
              <CardTitle>{t("form.barisJudul")}</CardTitle>
            </CardHeader>
            <CardContent className="pb-6">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("rincian.akun")}</TableHead>
                      <TableHead className="hidden xl:table-cell">{t("form.memo")}</TableHead>
                      <TableHead className="text-right">{t("form.jumlah")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {v.baris.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="whitespace-normal">
                          <p className="font-medium">
                            {b.akunKode} · {b.akunNama}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {[b.kategori, b.kanal ? labelKanalJurnal(b.kanal) : null].filter(Boolean).join(" · ") || "–"}
                          </p>
                          {b.memo && <p className="text-xs text-muted-foreground xl:hidden">{b.memo}</p>}
                        </TableCell>
                        <TableCell className="hidden whitespace-normal xl:table-cell">{b.memo ?? "–"}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(b.jumlah)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <AlertDialog open={buka} onOpenChange={(x) => !pending && setBuka(x)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rincian.batalJudul", { nomor: v.nomor })}</AlertDialogTitle>
            <AlertDialogDescription>{t("rincian.batalIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="alasan-batal-voucher">{t("rincian.alasan")}</Label>
            <Textarea id="alasan-batal-voucher" value={alasan} onChange={(e) => setAlasan(e.target.value)} rows={3} maxLength={500} />
            {alasan.trim().length > 0 && alasan.trim().length < 5 && <p className="text-xs text-destructive">{t("err.ALASAN_WAJIB")}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("tutup")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending || alasan.trim().length < 5}
              onClick={(e) => {
                e.preventDefault();
                batalkan();
              }}
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("rincian.batalkan")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Baris({ label, nilai, tebal }: { label: string; nilai: string; tebal?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${tebal ? "border-t pt-2 font-semibold" : ""}`}>
      <span className={tebal ? "" : "text-muted-foreground"}>{label}</span>
      <span className="text-right tabular-nums">{nilai}</span>
    </div>
  );
}
