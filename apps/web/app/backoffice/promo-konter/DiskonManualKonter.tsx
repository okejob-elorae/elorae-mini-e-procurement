"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { HandCoins } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format/rupiah";
import type { LaporanDiskonManual } from "@/lib/spg/promo-konter-kantor-queries";
import { formatPersen } from "./tampilan";

/** Nota yang diberi diskon manual oleh SPG — supaya pemilik bisa mengawasinya. */
export function DiskonManualKonter({ data }: { data: LaporanDiskonManual }) {
  const t = useTranslations("promoKonter.manual");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HandCoins className="h-5 w-5" />
          {t("judul")}
        </CardTitle>
        <CardDescription>
          {t("ringkas", { n: data.jumlahNota, nilai: formatRupiah(data.totalNilai) })}
          {data.terpotong ? ` ${t("terpotong", { n: data.baris.length })}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className={data.baris.length === 0 ? undefined : "px-0"}>
        {data.baris.length === 0 ? (
          <EmptyState icon={HandCoins} title={t("kosongJudul")} description={t("kosongIsi")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kolom.tanggal")}</TableHead>
                  <TableHead>{t("kolom.nota")}</TableHead>
                  <TableHead>{t("kolom.toko")}</TableHead>
                  <TableHead>{t("kolom.spg")}</TableHead>
                  <TableHead className="text-right">{t("kolom.diskon")}</TableHead>
                  <TableHead className="hidden text-right 2xl:table-cell">{t("kolom.total")}</TableHead>
                  <TableHead>{t("kolom.alasan")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.baris.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="text-sm">{b.tanggal}</TableCell>
                    <TableCell>
                      <Link href={`/backoffice/spg-sales/${b.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                        {b.docNo}
                      </Link>
                    </TableCell>
                    <TableCell className="min-w-[9rem] whitespace-normal">{b.toko}</TableCell>
                    <TableCell className="min-w-[8rem] whitespace-normal">{b.spg}</TableCell>
                    <TableCell className="text-right">
                      <span className="block tabular-nums">{formatRupiah(b.nilai)}</span>
                      <span className="block text-xs text-muted-foreground tabular-nums">{t("persen", { n: formatPersen(b.persen) })}</span>
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{formatRupiah(b.total)}</TableCell>
                    <TableCell className="min-w-[12rem] max-w-sm whitespace-normal text-sm">
                      {b.alasan ? b.alasan : <span className="text-muted-foreground">{t("tanpaAlasan")}</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
