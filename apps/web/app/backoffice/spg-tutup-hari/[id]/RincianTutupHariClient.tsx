"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeft, History, Package, Search, Star, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auditActionLabel } from "@/lib/audit/action-label";
import { formatRupiah } from "@/lib/format/rupiah";
import { dinamis } from "@/lib/i18n/dinamis";
import { ENTITAS_TUTUP_HARI, perubahanLaporan, type KolomPerubahan } from "@/lib/spg/tutup-hari";
import type { RincianTutupHariKantor } from "@/lib/spg/tutup-hari-queries";
import { cn } from "@/lib/utils";

const persen = (n: number | null) => (n === null ? "—" : `${String(n).replace(".", ",")}%`);
const RUPIAH: KolomPerubahan[] = ["netTotal", "cashierTotal"];

/**
 * Rincian laporan tutup hari untuk kantor. Kantor melihat rupiah per SPG
 * (HP tidak). Angka laporan = angka sistem SAAT DIKIRIM; bila nota masuk
 * sesudahnya (antrean HP), angka sistem sekarang ditampilkan berdampingan.
 */
export function RincianTutupHariClient({ rincian, labelHari }: { rincian: RincianTutupHariKantor; labelHari: string }) {
  const t = useTranslations("spgTutupHari.kantor");
  const td = dinamis(t);
  const ts = dinamis(useTranslations("spgTutupHari.sumber"));
  const tAudit = useTranslations("auditActions");
  const { laporan: l, ringkasanKantor: k, sistem: s } = rincian;

  const nilai = (kolom: KolomPerubahan, v: string | number | null) =>
    v === null || v === "" ? "—" : RUPIAH.includes(kolom) && typeof v === "number" ? formatRupiah(v) : String(v);

  const baris: { label: string; nilai: string; nada?: "amber" }[] = [
    { label: t("rincian.nota"), nilai: `${l.notaCount} · ${t("pcs", { n: l.pcs })}` },
    { label: t("rincian.kotor"), nilai: formatRupiah(l.grossTotal) },
    { label: t("rincian.potongan"), nilai: formatRupiah(l.discountTotal) },
    { label: t("rincian.retur"), nilai: t("pcs", { n: l.returnPcs }) },
    { label: t("rincian.bersih"), nilai: formatRupiah(l.netTotal) },
    { label: t("kolom.pengunjung"), nilai: l.visitorCount === null ? "—" : String(l.visitorCount) },
    { label: t("rincian.konversi"), nilai: persen(k.konversi) },
    { label: t("kolom.kasir"), nilai: l.cashierTotal === null ? "—" : formatRupiah(l.cashierTotal) },
    ...(k.selisih !== null
      ? [
          {
            label: t("rincian.selisih"),
            nilai: k.adaSelisih ? `${k.selisih > 0 ? "+" : ""}${formatRupiah(k.selisih)}` : t("sesuai"),
            nada: k.adaSelisih ? ("amber" as const) : undefined,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href={`/backoffice/spg-tutup-hari?hari=${l.day}`}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t("kembaliDaftar")}
        </Link>
      </Button>

      <PageHeader
        title={t("rincian.judul", { toko: rincian.toko.nama })}
        meta={`${labelHari} · ${t("olehJam", { nama: k.oleh, jam: k.jam })}`}
      />

      {rincian.berubah ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {t("rincian.berubahIsi", { nota: s.nota, bersih: formatRupiah(s.nilaiBersih) })}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{t("rincian.laporanJudul")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {baris.map((x) => (
                <div key={x.label} className="space-y-0.5">
                  <dt className="text-xs text-muted-foreground">{x.label}</dt>
                  <dd className={cn("font-medium tabular-nums", x.nada === "amber" && "text-amber-700 dark:text-amber-300")}>{x.nilai}</dd>
                </div>
              ))}
            </dl>
            <div className="space-y-0.5 text-sm">
              <p className="text-xs text-muted-foreground">{t("kolom.catatan")}</p>
              <p className="whitespace-pre-line">{l.note ?? "—"}</p>
            </div>
            {l.photoUrls.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {l.photoUrls.map((url, i) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer" aria-label={t("bukaFoto", { n: i + 1 })}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="h-28 w-28 rounded-md border object-cover" loading="lazy" />
                  </a>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              {t("rincian.riwayat")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-4 text-sm">
              {rincian.jejak.map((j) => {
                const ubah = perubahanLaporan(j.before, j.after);
                return (
                  <li key={j.id} className="space-y-1">
                    <p className="font-medium">{auditActionLabel(tAudit, j.action, ENTITAS_TUTUP_HARI)}</p>
                    <p className="text-xs text-muted-foreground">
                      {j.oleh} · {j.jam}
                    </p>
                    {ubah.length > 0 ? (
                      <ul className="space-y-0.5 text-xs">
                        {ubah.map((u) => (
                          <li key={u.kolom}>
                            <span className="text-muted-foreground">{td(`kolomUbah.${u.kolom}`)}: </span>
                            <span className="tabular-nums">
                              {nilai(u.kolom, u.sebelum)} → {nilai(u.kolom, u.sesudah)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {t("rincian.perSpg")}
            </CardTitle>
          </CardHeader>
          <CardContent className={s.perSpg.length === 0 ? undefined : "px-0"}>
            {s.perSpg.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("rincian.kosong")}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("rincian.spg")}</TableHead>
                      <TableHead className="text-right">{t("kolom.nota")}</TableHead>
                      <TableHead className="text-right">{t("rincian.nilaiNota")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.perSpg.map((x) => (
                      <TableRow key={x.userId}>
                        <TableCell className="whitespace-normal font-medium">{x.nama}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {x.nota} · {t("pcs", { n: x.potong })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(x.nilai)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5" />
              {t("rincian.terlaris")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {s.terlaris.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("rincian.kosong")}</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {s.terlaris.map((x, i) => (
                  <li key={`${x.itemId}:${x.variantSku}`} className="flex gap-3">
                    <span className="w-5 shrink-0 font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1">{x.nama}</span>
                    <span className="shrink-0 font-medium tabular-nums">{t("pcs", { n: x.qty })}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {t("rincian.kiriman")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {s.kiriman.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("rincian.kosong")}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {s.kiriman.map((x, i) => (
                  <li key={`${x.docNo}:${i}`} className="space-y-0.5">
                    <p className="font-medium">{x.docNo}</p>
                    <p className="text-xs text-muted-foreground">
                      {ts(x.sourceType)} · {t("rincian.diterima", { pcs: x.diterima })}
                      {x.rusak > 0 ? ` · ${t("rincian.rusak", { pcs: x.rusak })}` : ""}
                      {x.penerima ? ` · ${x.penerima}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              {t("rincian.dicari")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {s.dicari.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("rincian.kosong")}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {s.dicari.map((x, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="min-w-0 flex-1">{x.description}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{t("pcs", { n: x.qty })}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
