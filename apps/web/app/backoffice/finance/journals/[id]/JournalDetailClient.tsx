"use client";

import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { ArrowLeft, BookText, ExternalLink } from "lucide-react";
import type { JournalDetail } from "@/lib/finance/journals/queries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDisplayDate } from "@/lib/date-only";
import { journalSourceLabel } from "../journal-source-label";
import { memoJurnal, teksKeteranganJurnal } from "@/lib/finance/journals/keterangan-tampil";
import { tautanBukuBesar } from "../_sumber/tautan";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";

/** Dokumen yang membuat jurnal otomatis ini. */
export type SumberJurnalTampil = { href: string; nomor: string | null };

type Props = {
  journal: JournalDetail;
  sumber: SumberJurnalTampil | null;
  /** Kode akun → id akun, untuk tautan ke buku besarnya. */
  akunIds: Record<string, string>;
  /** Bulan jurnal ini — buku besar akun dibuka pada rentang yang sama. */
  rentangBukuBesar: { dari: string; sampai: string } | null;
};

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

export function JournalDetailClient({ journal, sumber, akunIds, rentangBukuBesar }: Props) {
  const t = useTranslations("financeJournals");
  const locale = useLocale();

  const formatDate = (iso: string) => formatDisplayDate(iso, locale);
  /* Keterangan & memo lama tersimpan berbahasa Inggris / berupa kode peran — diterjemahkan saat tampil. */
  const tPeran = useTranslations("financeAccountMapping");
  const keterangan = teksKeteranganJurnal(t, journal.description, { manual: journal.isManual });
  const labelPeran = (peran: string) => (tPeran.has(`role.${peran}`) ? tPeran(`role.${peran}`) : null);

  const totalDebit = journal.lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredit = journal.lines.reduce((sum, l) => sum + l.credit, 0);

  function bukuBesarAkun(kode: string): string | null {
    const akunId = akunIds[kode];
    return akunId ? tautanBukuBesar(akunId, rentangBukuBesar ?? undefined) : null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/backoffice/finance/journals">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("back")}
          </Link>
        </Button>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1">
            <h1 className="min-w-0 text-xl font-semibold truncate">{keterangan}</h1>
            <TombolBantuan judul={keterangan} />
          </div>
          <p className="text-sm text-muted-foreground">
            {formatDate(journal.date)}
            {journal.originalDate ? ` · ${t("detail.tanggalAsli", { tanggal: formatDate(journal.originalDate) })}` : ""}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {journal.status !== "POSTED" ? (
            <Badge variant={journal.status === "DRAFT" ? "outline" : "destructive"}>{t(`persetujuan.status.${journal.status}` as never)}</Badge>
          ) : null}
          {journal.isManual ? (
            <Badge variant="secondary">{t("sourceManual")}</Badge>
          ) : (
            <Badge variant="outline">{journalSourceLabel(t, journal.sourceType)}</Badge>
          )}
          {sumber && (
            <Button variant="outline" size="sm" asChild>
              <Link href={sumber.href}>
                <ExternalLink className="h-4 w-4 mr-2" />
                {sumber.nomor
                  ? t("detail.openSourceNumber", { nomor: sumber.nomor })
                  : t("detail.openSource")}
              </Link>
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookText className="h-5 w-5" />
            {t("detail.linesTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("detail.colAccount")}</TableHead>
                  <TableHead>{t("detail.colMemo")}</TableHead>
                  <TableHead className="text-right">{t("detail.colDebit")}</TableHead>
                  <TableHead className="text-right">{t("detail.colCredit")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {journal.lines.map((line, idx) => {
                  const bukuBesar = bukuBesarAkun(line.accountCode);
                  return (
                  <TableRow key={idx}>
                    <TableCell className="whitespace-normal min-w-[200px]">
                      <span className="font-mono text-sm mr-2">{line.accountCode}</span>
                      {bukuBesar ? (
                        <Link
                          href={bukuBesar}
                          className="underline underline-offset-4"
                          title={t("detail.openLedger")}
                        >
                          {line.accountName}
                        </Link>
                      ) : (
                        <span>{line.accountName}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-normal min-w-[160px] max-w-[360px]">
                      {memoJurnal(line.memo, labelPeran) ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.debit > 0 ? formatRupiah(line.debit) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.credit > 0 ? formatRupiah(line.credit) : "—"}
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2} className="font-medium">
                    {t("detail.totalsLabel")}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatRupiah(totalDebit)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatRupiah(totalCredit)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
