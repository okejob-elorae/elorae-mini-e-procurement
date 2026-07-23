"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { ArrowLeft, ScrollText } from "lucide-react";
import type { AccountLedger } from "@/lib/finance/journals/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  accountId: string;
  ledger: AccountLedger;
  filters: { from: string; to: string };
};

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

export function AccountLedgerClient({ accountId, ledger, filters }: Props) {
  const t = useTranslations("financeJournals");
  const tCoa = useTranslations("finance.coa");
  const locale = useLocale();
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  const basePath = `/backoffice/finance/journals/ledger/${accountId}`;

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" }).format(
      new Date(iso),
    );

  function pushParam(key: string, value: string | undefined) {
    const params = new URLSearchParams(sp.toString());
    if (!value) params.delete(key);
    else params.set(key, value);
    startTransition(() => router.push(`${basePath}?${params.toString()}`));
  }

  function reset() {
    startTransition(() => router.push(basePath));
  }

  const hasFilter = !!(filters.from || filters.to);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/backoffice/finance/coa">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("back")}
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">
            <span className="font-mono mr-2">{ledger.accountCode}</span>
            {ledger.accountName}
          </h1>
          <p className="text-sm text-muted-foreground">{tCoa(`type.${ledger.type}` as never)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
        <Card className="gap-1 p-3">
          <p className="text-xs text-muted-foreground">{t("ledger.openingBalance")}</p>
          <p className="text-lg font-semibold tabular-nums">{formatRupiah(ledger.opening)}</p>
        </Card>
        <Card className="gap-1 p-3">
          <p className="text-xs text-muted-foreground">{t("ledger.closingBalance")}</p>
          <p className="text-lg font-semibold tabular-nums">{formatRupiah(ledger.closing)}</p>
        </Card>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("ledger.dateFrom")}</label>
            <Input
              type="date"
              value={filters.from}
              onChange={(e) => pushParam("from", e.target.value || undefined)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("ledger.dateTo")}</label>
            <Input
              type="date"
              value={filters.to}
              onChange={(e) => pushParam("to", e.target.value || undefined)}
            />
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={reset} disabled={!hasFilter} className="w-full">
              {t("ledger.reset")}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="h-5 w-5" />
            {t("ledger.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ledger.rows.length === 0 ? (
            <div className="text-center py-12">
              <ScrollText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">{t("ledger.empty")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("ledger.colDate")}</TableHead>
                    <TableHead>{t("ledger.colDescription")}</TableHead>
                    <TableHead className="text-right">{t("ledger.colDebit")}</TableHead>
                    <TableHead className="text-right">{t("ledger.colCredit")}</TableHead>
                    <TableHead className="text-right">{t("ledger.colRunningBalance")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-muted/30">
                    <TableCell colSpan={4} className="text-sm text-muted-foreground">
                      {t("ledger.openingBalance")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatRupiah(ledger.opening)}
                    </TableCell>
                  </TableRow>
                  {ledger.rows.map((row, idx) => (
                    <TableRow
                      key={idx}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() =>
                        startTransition(() =>
                          router.push(`/backoffice/finance/journals/${row.journalId}`),
                        )
                      }
                    >
                      <TableCell className="whitespace-nowrap">{formatDate(row.date)}</TableCell>
                      <TableCell className="max-w-[320px] truncate">{row.description}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.debit > 0 ? formatRupiah(row.debit) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.credit > 0 ? formatRupiah(row.credit) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatRupiah(row.runningBalance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={4} className="font-medium">
                      {t("ledger.closingBalance")}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatRupiah(ledger.closing)}
                    </TableCell>
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
