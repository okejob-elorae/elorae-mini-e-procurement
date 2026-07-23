"use client";

import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { ArrowLeft, BookText } from "lucide-react";
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

type Props = {
  journal: JournalDetail;
};

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

export function JournalDetailClient({ journal }: Props) {
  const t = useTranslations("financeJournals");
  const locale = useLocale();

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" }).format(
      new Date(iso),
    );

  const totalDebit = journal.lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredit = journal.lines.reduce((sum, l) => sum + l.credit, 0);

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
          <h1 className="text-xl font-semibold truncate">{journal.description}</h1>
          <p className="text-sm text-muted-foreground">{formatDate(journal.date)}</p>
        </div>
        <div className="ml-auto">
          {journal.isManual ? (
            <Badge variant="secondary">{t("sourceManual")}</Badge>
          ) : (
            <Badge variant="outline">{journal.sourceType ?? t("sourceAuto")}</Badge>
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
                {journal.lines.map((line, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <span className="font-mono text-sm mr-2">{line.accountCode}</span>
                      <span>{line.accountName}</span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{line.memo ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.debit > 0 ? formatRupiah(line.debit) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.credit > 0 ? formatRupiah(line.credit) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
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
