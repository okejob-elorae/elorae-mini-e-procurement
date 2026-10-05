"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeft, ArrowRight, History, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auditActionLabel } from "@/lib/audit/action-label";
import { dinamis } from "@/lib/i18n/dinamis";
import type { RincianMutasiKantor } from "@/lib/spg/mutasi-queries";
import { cn } from "@/lib/utils";
import { nadaStatusMutasi } from "@/app/pwa/spg/mutasi/tampilan";
import { TombolMutasiKantor } from "./TombolMutasiKantor";
import { TombolSuratJalanKantor } from "./TombolSuratJalanKantor";

export function RincianMutasiKantorClient({
  rincian: r,
  bolehPutuskan,
  bolehTerima,
  milikSendiri,
}: {
  rincian: RincianMutasiKantor;
  bolehPutuskan: boolean;
  bolehTerima: boolean;
  milikSendiri: boolean;
}) {
  const t = useTranslations("spgMutasi");
  const td = dinamis(t);
  const tAudit = useTranslations("auditActions");
  const adaTerima = r.baris.some((b) => b.diterima !== null);
  const totalKirim = r.baris.reduce((n, b) => n + b.qty, 0);
  const totalTerima = r.baris.reduce((n, b) => n + (b.diterima ?? 0), 0);

  const info: { label: string; nilai: string | null; merah?: boolean }[] = [
    { label: t("kantor.info.pengaju"), nilai: `${r.pengaju} · ${r.diajukan}` },
    { label: t("kantor.info.alasan"), nilai: r.alasan },
    {
      label: t("kantor.info.disetujui"),
      nilai: r.disetujui ? `${r.disetujui.oleh ?? t("kantor.info.otomatis")} · ${r.disetujui.pada}` : null,
    },
    { label: t("kantor.info.dikirim"), nilai: r.dikirim ? `${r.dikirim.oleh} · ${r.dikirim.pada}` : null },
    { label: t("kantor.info.dibatalkan"), nilai: r.dibatalkan ? `${r.dibatalkan.oleh} · ${r.dibatalkan.pada}` : null },
    {
      label: t("kantor.info.catatanKantor"),
      nilai: r.catatanKantor,
      merah: r.status === "DITOLAK" || r.status === "DIBATALKAN" || r.status === "DIKEMBALIKAN",
    },
    {
      label: t("kantor.info.tandaTerima"),
      nilai: r.tandaTerima ? `${td(`kantor.sumber.${r.tandaTerima.sumber}`)} · ${r.tandaTerima.oleh} · ${r.tandaTerima.pada}` : null,
    },
    { label: t("kantor.info.catatanTerima"), nilai: r.tandaTerima?.catatan ?? null },
    { label: t("kantor.info.selisihCatatan"), nilai: r.selisihCatatan },
  ];

  const toko = (judul: string, x: RincianMutasiKantor["asal"]) => (
    <div className="min-w-0 space-y-0.5">
      <p className="text-xs text-muted-foreground">{judul}</p>
      <p className="font-medium">{x.name}</p>
      <p className="text-xs text-muted-foreground">
        {x.termsType} · {x.spg.length > 0 ? t("kantor.spgToko", { nama: x.spg.join(", ") }) : t("kantor.tanpaSpg")}
      </p>
    </div>
  );

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/backoffice/spg-transfers">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t("kantor.kembaliDaftar")}
        </Link>
      </Button>

      <PageHeader
        title={r.docNo}
        meta={t("kantor.rincianDeskripsi", { asal: r.asal.name, tujuan: r.tujuan.name })}
        actions={
          <>
            <TombolSuratJalanKantor id={r.id} status={r.status} />
            <TombolMutasiKantor rincian={r} bolehPutuskan={bolehPutuskan} bolehTerima={bolehTerima} milikSendiri={milikSendiri} />
          </>
        }
      />

      {r.macet ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {t("kantor.macetIsi", { hari: r.hariPengingat })}
        </p>
      ) : null}
      {r.selisihStatus === "TERBUKA" ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {t("kantor.selisihIsi", { kurang: totalKirim - totalTerima })}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{t("kantor.rincianJudul")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <span className="flex flex-wrap gap-1.5">
              <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-sm font-medium", nadaStatusMutasi(r.status))}>{td(`status.${r.status}`)}</span>
              {r.selisihStatus ? (
                <span className="inline-block rounded-full bg-muted px-2.5 py-0.5 text-sm font-medium">{td(`kantor.selisih.${r.selisihStatus}`)}</span>
              ) : null}
            </span>
            <div className="flex items-start gap-3">
              {toko(t("kantor.asal"), r.asal)}
              <ArrowRight className="mt-5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              {toko(t("kantor.tujuan"), r.tujuan)}
            </div>
            <dl className="space-y-3 text-sm">
              {info
                .filter((x) => x.nilai)
                .map((x) => (
                  <div key={x.label} className="space-y-0.5">
                    <dt className="text-xs text-muted-foreground">{x.label}</dt>
                    <dd className={cn("whitespace-pre-line", x.merah && "text-destructive")}>{x.nilai}</dd>
                  </div>
                ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              {t("kantor.riwayat")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {r.riwayat.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("kantor.riwayatKosong")}</p>
            ) : (
              <ol className="space-y-3 text-sm">
                {r.riwayat.map((j) => (
                  <li key={j.id} className="space-y-0.5">
                    <p className="font-medium">{auditActionLabel(tAudit, j.action, "StoreTransfer")}</p>
                    <p className="text-xs text-muted-foreground">
                      {j.oleh} · {j.pada}
                    </p>
                    {j.alasan ? <p className="text-xs">{j.alasan}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {t("kantor.barangJudul", { baris: r.baris.length, pcs: totalKirim })}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kantor.kolom.barang")}</TableHead>
                  <TableHead className="text-right">{t("kantor.kolom.dikirim")}</TableHead>
                  {adaTerima ? <TableHead className="text-right">{t("kantor.kolom.diterima")}</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.baris.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="min-w-[14rem] whitespace-normal">
                      <span className="block font-medium">{b.productName}</span>
                      {b.variantSku ? <span className="block text-xs text-muted-foreground">{b.variantSku}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.qty}</TableCell>
                    {adaTerima ? (
                      <TableCell className={cn("text-right tabular-nums", (b.diterima ?? 0) < b.qty && "font-medium text-destructive")}>
                        {b.diterima ?? 0}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
