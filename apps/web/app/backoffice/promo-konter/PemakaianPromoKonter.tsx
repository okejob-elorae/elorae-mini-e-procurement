"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { BarChart3, Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format/rupiah";
import type { LaporanPemakaian } from "@/lib/spg/promo-konter-kantor-queries";
import { formatPersen } from "./tampilan";

/**
 * Pemakaian promo dalam rentang: per promo jumlah nota dan potongannya, dan —
 * dari kolom yang dibekukan di nota — siapa yang menanggung seluruh potongan
 * (promo dan diskon manual) di toko konsinyasi.
 */
export function PemakaianPromoKonter({ data }: { data: LaporanPemakaian }) {
  const t = useTranslations("promoKonter.pemakaian");
  const tg = data.tanggungan;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            {t("tanggunganJudul")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border p-3">
              <dt className="text-xs text-muted-foreground">{t("konsiPotongan")}</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatRupiah(tg.konsi.potongan)}</dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-xs text-muted-foreground">{t("konsiToko")}</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatRupiah(tg.konsi.toko)}</dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-xs text-muted-foreground">{t("konsiElorae")}</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatRupiah(tg.konsi.elorae)}</dd>
            </div>
          </dl>
          <p className="text-sm text-muted-foreground">{t("putus", { nilai: formatRupiah(tg.putus.potongan) })}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            {t("judul")}
          </CardTitle>
        </CardHeader>
        <CardContent className={data.baris.length === 0 ? undefined : "px-0"}>
          {data.baris.length === 0 ? (
            <EmptyState icon={BarChart3} title={t("kosongJudul")} description={t("kosongIsi")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolom.promo")}</TableHead>
                    <TableHead>{t("kolom.jenis")}</TableHead>
                    <TableHead>{t("kolom.tanggungan")}</TableHead>
                    <TableHead className="text-right">{t("kolom.nota")}</TableHead>
                    <TableHead className="text-right">{t("kolom.potongan")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.baris.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="min-w-[13rem] whitespace-normal">
                        {b.ringkasan !== null ? (
                          <Link href={`/backoffice/promo-konter/${b.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                            {b.name}
                          </Link>
                        ) : (
                          <span className="font-medium">{b.name}</span>
                        )}
                        {b.ringkasan ? <span className="block text-xs text-muted-foreground">{b.ringkasan}</span> : null}
                      </TableCell>
                      <TableCell className="whitespace-normal text-sm">{b.belanja ? t("jenisBelanja") : t("jenisBarang")}</TableCell>
                      <TableCell className="whitespace-normal text-sm">
                        {b.bagianToko === null
                          ? "—"
                          : b.bagianToko <= 0
                            ? t("eloraePenuh")
                            : t("bagiToko", { toko: formatPersen(b.bagianToko) })}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{b.nota}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatRupiah(b.potongan)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={4} className="font-medium">
                      {t("total")}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatRupiah(data.totalPotongan)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
