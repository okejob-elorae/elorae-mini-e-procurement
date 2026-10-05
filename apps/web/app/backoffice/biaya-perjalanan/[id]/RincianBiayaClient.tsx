"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, History, ImageIcon, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import type { RincianBiaya } from "@/lib/salesman/biaya-queries";
import { cn } from "@/lib/utils";
import { IkonKategori, nadaStatus } from "@/app/pwa/biaya/tampilan";
import { TombolKeputusan } from "../TombolKeputusan";

export function RincianBiayaClient({
  rincian: r,
  bolehSetujui,
  bolehBayar,
  milikSendiri,
}: {
  rincian: RincianBiaya;
  bolehSetujui: boolean;
  bolehBayar: boolean;
  /** Klaim milik orang yang sedang membuka — server menolak ia memutuskannya. */
  milikSendiri: boolean;
}) {
  const t = useTranslations("biayaPerjalanan");
  const td = dinamis(t);
  const ringkas = `${td(`kategori.${r.kategori}`)} · ${formatIDR(r.nilai)} · ${r.salesman}`;

  const baris: { label: string; nilai: string | null; merah?: boolean }[] = [
    { label: t("kolom.salesman"), nilai: r.salesman },
    { label: t("kolom.tanggal"), nilai: r.tanggal },
    { label: t("kolom.toko"), nilai: r.toko },
    { label: t("kolom.catatan"), nilai: r.catatan },
    { label: t("kolom.diajukan"), nilai: r.diajukan },
    { label: t("kolom.diputuskanOleh"), nilai: r.diputuskanOleh ? `${r.diputuskanOleh} · ${r.diputuskanPada ?? ""}` : null },
    { label: t("kolom.alasan"), nilai: r.alasanTolak, merah: true },
    { label: t("kolom.dibayarOleh"), nilai: r.dibayarOleh ? `${r.dibayarOleh} · ${r.dibayarPada ?? ""}` : null },
  ];

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/backoffice/biaya-perjalanan">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t("kembali")}
        </Link>
      </Button>

      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <IkonKategori kategori={r.kategori} className="h-6 w-6 text-muted-foreground" />
            {td(`kategori.${r.kategori}`)} · {formatIDR(r.nilai)}
          </span>
        }
        meta={t("rincianDeskripsi", { salesman: r.salesman, tanggal: r.tanggal })}
        actions={
          milikSendiri ? undefined : (
            <TombolKeputusan
              id={r.id}
              status={r.status}
              ringkas={ringkas}
              bolehSetujui={bolehSetujui}
              bolehBayar={bolehBayar}
              tata="baris"
            />
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              {t("rincianJudul")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-sm font-medium", nadaStatus(r.status))}>
              {td(`status.${r.status}`)}
            </span>
            {milikSendiri && (r.status === "DIAJUKAN" || r.status === "DISETUJUI") ? (
              <p className="text-sm text-muted-foreground">{t("milikSendiri")}</p>
            ) : null}
            <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              {baris
                .filter((b) => b.nilai)
                .map((b) => (
                  <div key={b.label} className="contents">
                    <dt className="text-muted-foreground">{b.label}</dt>
                    <dd className={cn("whitespace-pre-wrap", b.merah && "text-destructive")}>{b.nilai}</dd>
                  </div>
                ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5" />
              {t("kolom.foto")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {r.fotoUrl ? (
              <a href={r.fotoUrl} target="_blank" rel="noopener noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.fotoUrl} alt={t("lihatStruk")} className="max-h-[32rem] w-full rounded-lg border object-contain" />
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">{t("tanpaFoto")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            {t("jejakJudul")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {r.jejak.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("jejakKosong")}</p>
          ) : (
            <ol className="space-y-3">
              {r.jejak.map((j) => (
                <li key={j.id} className="border-l-2 border-muted pl-3 text-sm">
                  <span className="block font-medium">{td(`jejak.${j.aksi}`)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {j.oleh} · {j.pada}
                  </span>
                  {j.alasan ? <span className="mt-0.5 block text-xs">{j.alasan}</span> : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
