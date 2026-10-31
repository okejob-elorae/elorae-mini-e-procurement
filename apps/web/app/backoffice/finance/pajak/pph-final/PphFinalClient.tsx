"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Loader2, Percent } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiah } from "@/lib/format/rupiah";
import { bukaPphFinalAction, postingPphFinalAction } from "@/app/actions/finance-pajak";
import type { PphFinalMasa } from "@/lib/finance/pajak/pph-final-writer";
import { NavPajak, SpandukPajak, type AksesPajak } from "../_bersama/NavPajak";
import { labelMasa } from "../_bersama/akses";

type Props = {
  tahun: number;
  masaIni: string;
  aktif: boolean;
  bentukUsaha: string;
  daftar: PphFinalMasa[];
  statusPkp: string;
  rezimPph: string;
  akses: AksesPajak & { kelola: boolean };
  gagal: boolean;
};

export function PphFinalClient({ tahun, masaIni, aktif, bentukUsaha, daftar, statusPkp, rezimPph, akses, gagal }: Props) {
  const t = useTranslations("financeTax.pphFinal");
  const locale = useLocale();
  const router = useRouter();
  const [pindah, mulaiPindah] = useTransition();
  const [pending, mulai] = useTransition();
  const [buka, setBuka] = useState<string | null>(null);
  const [alasan, setAlasan] = useState("");
  const pergi = (th: number) => mulaiPindah(() => router.replace(`/backoffice/finance/pajak/pph-final?tahun=${th}`, { scroll: false }));
  const pesan = (kode: string, peran?: string) =>
    kode === "UNMAPPED_ROLE" ? t("err.UNMAPPED_ROLE", { peran: peran ?? "" }) : t.has(`err.${kode}`) ? t(`err.${kode}`) : t("err.GAGAL");
  const lewatBatas = daftar.some((d) => d.hasil.lewatBatas);

  const posting = (masa: string) =>
    mulai(async () => {
      const h = await postingPphFinalAction({ masa });
      if (!h.ok) {
        toast.error(pesan(h.kode, "peran" in h ? h.peran : undefined));
        return;
      }
      toast.success(t("postingOk", { masa: labelMasa(masa, locale) }));
      router.refresh();
    });

  const bukaKembali = () =>
    mulai(async () => {
      if (!buka) return;
      const h = await bukaPphFinalAction({ masa: buka, alasan });
      if (!h.ok) {
        toast.error(pesan(h.kode));
        return;
      }
      toast.success(t("bukaOk", { masa: labelMasa(buka, locale) }));
      setBuka(null);
      setAlasan("");
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <PageHeader title={t("judul")} meta={aktif ? t("meta", { tahun }) : undefined} />
      <NavPajak aktif="pphFinal" akses={akses} />
      <SpandukPajak statusPkp={statusPkp} rezimPph={rezimPph} akses={akses} />

      {!aktif ? (
        <Card>
          <CardContent className="space-y-3">
            <p className="font-medium">{t("tidakAktif")}</p>
            {akses.pengaturan ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/backoffice/settings/tax">{t("aturProfil")}</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" aria-label={t("tahunSebelum")} onClick={() => pergi(tahun - 1)} disabled={pindah}>
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <p className="min-w-16 text-center font-medium tabular-nums">{tahun}</p>
            <Button variant="outline" size="icon" aria-label={t("tahunSesudah")} onClick={() => pergi(tahun + 1)} disabled={pindah || tahun >= Number(masaIni.slice(0, 4))}>
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          {bentukUsaha === "ORANG_PRIBADI" ? <p className="text-sm text-muted-foreground">{t("ambangOp")}</p> : null}
          {lewatBatas ? <p className="text-sm text-red-700 dark:text-red-300">{t("lewatBatas")}</p> : null}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Percent className="h-5 w-5" aria-hidden />
                {t("daftar", { tahun })}
              </CardTitle>
            </CardHeader>
            <CardContent className={pindah ? "opacity-60 transition-opacity" : undefined}>
              {gagal ? (
                <p className="text-sm text-destructive">{t("gagal")}</p>
              ) : daftar.length === 0 ? (
                <EmptyState icon={Percent} title={t("kosong", { tahun })} />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("kolom.masa")}</TableHead>
                        <TableHead className="text-right">{t("kolom.omzet")}</TableHead>
                        <TableHead className="hidden text-right 2xl:table-cell">{t("kolom.dasar")}</TableHead>
                        <TableHead className="text-right">{t("kolom.pajak")}</TableHead>
                        <TableHead className="text-right">{t("kolom.kredit")}</TableHead>
                        <TableHead className="text-right">{t("kolom.terutang")}</TableHead>
                        <TableHead>{t("kolom.status")}</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {daftar.map((d) => {
                        const final = d.tersimpan?.status === "FINAL";
                        // Masa FINAL menampilkan angka yang dibekukan; selain itu angka hidup dari buku besar.
                        const pajak = final ? d.tersimpan!.keluaran : d.hasil.pajak;
                        const kredit = final ? d.tersimpan!.masukan : d.hasil.kreditPph22;
                        const terutang = final ? d.tersimpan!.saldo : d.hasil.terutang;
                        const berubah = final && Math.round(d.tersimpan!.keluaranDpp * 100) !== Math.round(d.hasil.omzet * 100);
                        return (
                          <TableRow key={d.masa}>
                            <TableCell className="whitespace-nowrap capitalize">{labelMasa(d.masa, locale)}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatRupiah(final ? d.tersimpan!.keluaranDpp : d.hasil.omzet)}
                              {berubah ? <span className="block text-xs text-amber-700 dark:text-amber-300">{t("berubah", { omzet: formatRupiah(d.hasil.omzet) })}</span> : null}
                            </TableCell>
                            <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{formatRupiah(final ? d.tersimpan!.masukanDpp : d.hasil.dasar)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatRupiah(pajak)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatRupiah(kredit)}</TableCell>
                            <TableCell className="text-right font-medium tabular-nums">{formatRupiah(terutang)}</TableCell>
                            <TableCell>
                              <StatusPill tone={final ? "settled" : d.masa < masaIni ? "waiting" : "inactive"}>{t(final ? "status.FINAL" : d.masa < masaIni ? "status.BELUM" : "status.BERJALAN")}</StatusPill>
                            </TableCell>
                            <TableCell className="text-right">
                              {akses.kelola && d.masa < masaIni ? (
                                final ? (
                                  <Button size="sm" variant="outline" onClick={() => setBuka(d.masa)} disabled={pending}>
                                    {t("bukaKembali")}
                                  </Button>
                                ) : (
                                  <Button size="sm" onClick={() => posting(d.masa)} disabled={pending}>
                                    {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                                    {t("posting")}
                                  </Button>
                                )
                              ) : null}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={buka !== null} onOpenChange={(v) => !v && !pending && setBuka(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("bukaJudul", { masa: buka ? labelMasa(buka, locale) : "" })}</DialogTitle>
            <DialogDescription>{t("bukaIsi")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="alasan-buka-pph">{t("alasan")}</Label>
            <Textarea id="alasan-buka-pph" rows={3} maxLength={500} value={alasan} onChange={(e) => setAlasan(e.target.value)} />
            {alasan.trim().length < 5 ? <p className="text-xs text-muted-foreground">{t("alasanMin")}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuka(null)} disabled={pending}>
              {t("batal")}
            </Button>
            <Button variant="destructive" onClick={bukaKembali} disabled={pending || alasan.trim().length < 5}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("bukaKembali")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
