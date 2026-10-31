"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, BookImage, Check, CloudOff, History, ImageIcon, X } from "lucide-react";
import type { RincianHasilChecklist } from "@/lib/salesman/checklist-queries";
import type { NilaiJawaban, RincianPertanyaan } from "@/lib/salesman/checklist-toko";
import { dinamis } from "@/lib/i18n/dinamis";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { varianSkor } from "../LaporanChecklistClient";

const angka = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

function Foto({ url, label, labelBelum }: { url: string | null; label: string; labelBelum: string }) {
  if (!url) {
    return (
      <span className="grid h-28 w-28 place-items-center gap-1 rounded-md border bg-muted p-2 text-center text-[11px] text-muted-foreground">
        <CloudOff className="h-5 w-5" aria-hidden />
        {labelBelum}
      </span>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block h-28 w-28 overflow-hidden rounded-md border bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} className="h-full w-full object-cover" loading="lazy" />
    </a>
  );
}

export function RincianHasilClient({ r }: { r: RincianHasilChecklist }) {
  const t = useTranslations("checklistToko.rincian");
  const tj = dinamis(useTranslations("checklistToko"));

  const tampilJawaban = (x: RincianPertanyaan & { foto: { clientId: string; url: string | null }[] }) => {
    const j: NilaiJawaban | null = x.jawaban;
    if (j === null) return <span className="text-muted-foreground">{t("tidakDijawab")}</span>;
    switch (x.jenis) {
      case "YA_TIDAK":
        return j === true ? (
          <span className="inline-flex items-center gap-1">
            <Check className="h-4 w-4 text-emerald-600" aria-hidden />
            {t("ya")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <X className="h-4 w-4 text-destructive" aria-hidden />
            {t("tidak")}
          </span>
        );
      case "SKALA_1_5":
        return <span className="tabular-nums">{t("skala", { n: Number(j) })}</span>;
      case "ANGKA":
        return <span className="tabular-nums">{angka.format(Number(j))}</span>;
      case "FOTO":
        return (
          <span className="inline-flex items-center gap-1">
            <ImageIcon className="h-4 w-4" aria-hidden />
            {t("jumlahFoto", { n: x.foto.length })}
          </span>
        );
      case "TEKS":
        return <span className="whitespace-pre-line">{String(j)}</span>;
    }
  };

  const fotoJawaban = r.rincian.filter((x) => x.foto.length > 0);

  return (
    <div className="space-y-6">
      <div className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/backoffice/checklist-toko/laporan">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t("kembali")}
          </Link>
        </Button>
      </div>

      <PageHeader
        title={r.toko.nama}
        meta={`${t("deskripsi", { template: r.templateNama, salesman: r.salesman, kunjungan: r.kunjungan })} · ${t("dikirim", { waktu: r.dikirim })}`}
        actions={
          r.toko.id ? (
            <Button asChild variant="outline">
              <Link href={`/backoffice/stores/${r.toko.id}`}>{t("keToko")}</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("skorJudul")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-4xl font-bold tabular-nums">{r.persen === null ? "—" : `${r.persen}%`}</p>
            <p className="text-sm text-muted-foreground">{t("poin", { skor: r.score, maks: r.maxScore })}</p>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" aria-hidden />
              {t("riwayatJudul")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {r.riwayat.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("riwayatKosong")}</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {r.riwayat.map((h) => (
                  <li key={h.id}>
                    <Link
                      href={`/backoffice/checklist-toko/laporan/${h.id}`}
                      className="flex min-h-11 flex-col items-center justify-center rounded-md border px-3 py-1 hover:bg-muted"
                      aria-current={h.id === r.id ? "page" : undefined}
                    >
                      <Badge variant={varianSkor(h.persen)} className="tabular-nums">
                        {h.persen === null ? "—" : `${h.persen}%`}
                      </Badge>
                      <span className={h.id === r.id ? "text-xs font-semibold" : "text-xs text-muted-foreground"}>{h.tanggal}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("jawabanJudul")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-0">#</TableHead>
                  <TableHead>{t("kolPertanyaan")}</TableHead>
                  <TableHead>{t("kolJenis")}</TableHead>
                  <TableHead>{t("kolJawaban")}</TableHead>
                  <TableHead className="text-right">{t("kolPoin")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.rincian.map((x, i) => (
                  <TableRow key={x.id}>
                    <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="whitespace-normal">{x.teks}</TableCell>
                    <TableCell>{tj(`jenis.${x.jenis}`)}</TableCell>
                    <TableCell className="whitespace-normal">{tampilJawaban(x)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {x.maks > 0 ? t("poinBaris", { poin: angka.format(x.poin), maks: x.maks }) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {fotoJawaban.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ImageIcon className="h-4 w-4" aria-hidden />
              {t("fotoJudul")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {fotoJawaban.map((x) => (
              <div key={x.id} className="space-y-2">
                <p className="text-sm font-medium">{x.teks}</p>
                <div className="flex flex-wrap gap-2">
                  {x.foto.map((f) => (
                    <Foto key={f.clientId} url={f.url} label={x.teks} labelBelum={t("fotoBelumNaik")} />
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {r.fotoPanduan.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookImage className="h-4 w-4" aria-hidden />
              {t("fotoPanduanJudul")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            {r.fotoPanduan.map((f) => (
              <figure key={f.id} className="w-28 space-y-1">
                <Foto url={f.url} label={f.judul} labelBelum={t("fotoBelumNaik")} />
                <figcaption className="text-xs text-muted-foreground">{f.judul}</figcaption>
              </figure>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
