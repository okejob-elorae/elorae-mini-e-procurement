"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Plus, Repeat, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDisplayDate } from "@/lib/date-only";
import { formatRupiah } from "@/lib/format/rupiah";
import { bacaKunciBulan, labelBulan } from "@/lib/finance/periode/periode";
import type { BarisTemplat } from "@/lib/finance/berulang/queries";
import { postingBerulangAction } from "@/app/actions/finance-berulang";
import { nadaKeadaanTemplat } from "./tampilan";
import { pesanGalatBerulang } from "./pesan";

type Props = { baris: BarisTemplat[]; bolehMengelola: boolean; penggunaId: string; gagal: boolean };

export function DaftarTemplatClient({ baris, bolehMengelola, penggunaId, gagal }: Props) {
  const t = useTranslations("jurnalBerulang");
  const locale = useLocale();
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const menunggu = baris.filter((b) => b.keadaan === "MENUNGGU_PERSETUJUAN").length;
  const tertunda = baris.reduce((s, b) => s + b.tertunda, 0);

  const bulan = (k: string | null) => {
    const tb = k ? bacaKunciBulan(k) : null;
    return tb ? labelBulan(tb, locale) : "—";
  };

  const postingSemua = () =>
    mulai(async () => {
      const r = await postingBerulangAction({});
      if (!r.ok) {
        toast.error(pesanGalatBerulang(t, r.kode));
        return;
      }
      if (r.diposting > 0) toast.success(t("posting.hasil", { n: r.diposting }));
      else if (!r.gagal.length) toast.info(t("posting.tidakAda"));
      if (r.dilewati.length) toast.info(t("posting.dilewati", { n: r.dilewati.length }));
      if (r.gagal.length) toast.error(t("posting.gagal", { daftar: r.gagal.map((g) => `${g.nama} ${g.periode}`).join(", ") }));
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={t("meta", { n: baris.length, menunggu })}
        actions={
          bolehMengelola ? (
            <>
              <Button variant="outline" onClick={postingSemua} disabled={pending || tertunda === 0}>
                {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                {t("postingSekarang")}
              </Button>
              <Button asChild>
                <Link href="/backoffice/finance/jurnal-berulang/baru">
                  <Plus className="mr-2 h-4 w-4" />
                  {t("baru")}
                </Link>
              </Button>
            </>
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Repeat className="h-5 w-5" />
            {t("daftar")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {gagal ? (
            <EmptyState icon={Repeat} title={t("gagalMuat")} />
          ) : baris.length === 0 ? (
            <EmptyState
              icon={Repeat}
              title={t("kosong.judul")}
              description={t("kosong.isi")}
              action={
                bolehMengelola ? (
                  <Button asChild>
                    <Link href="/backoffice/finance/jurnal-berulang/baru">{t("baru")}</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">{t("kolom.nama")}</TableHead>
                    <TableHead>{t("kolom.jadwal")}</TableHead>
                    <TableHead className="text-right">{t("kolom.total")}</TableHead>
                    <TableHead>{t("kolom.keadaan")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("kolom.terakhir")}</TableHead>
                    <TableHead>{t("kolom.berikutnya")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("kolom.disetujui")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="baris-berurutan">
                  {baris.map((b) => (
                    <TableRow key={b.id} className="cursor-pointer hover:bg-muted/50" onClick={() => router.push(`/backoffice/finance/jurnal-berulang/${b.id}`)}>
                      <TableCell className="whitespace-normal">
                        <Link href={`/backoffice/finance/jurnal-berulang/${b.id}`} className="font-medium underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>
                          {b.nama}
                        </Link>
                        {b.balikOtomatis ? <p className="text-xs text-muted-foreground">{t("akrual")}</p> : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{t("setiapTanggal", { hari: b.hari })}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatRupiah(b.total)}</TableCell>
                      <TableCell>
                        <StatusPill
                          tone={nadaKeadaanTemplat(b.keadaan)}
                          detail={
                            b.keadaan === "MENUNGGU_PERSETUJUAN" && b.pengubahTerakhirId === penggunaId
                              ? t("menungguOrangLain")
                              : b.tertunda > 0
                                ? t("tertunda", { n: b.tertunda })
                                : undefined
                          }
                        >
                          {t(`keadaan.${b.keadaan}`)}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap 2xl:table-cell">{bulan(b.postingTerakhir)}</TableCell>
                      <TableCell className="whitespace-nowrap">{b.postingBerikutnya ? formatDisplayDate(b.postingBerikutnya, locale) : "—"}</TableCell>
                      <TableCell className="hidden whitespace-normal 2xl:table-cell">{b.disetujuiOleh ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
