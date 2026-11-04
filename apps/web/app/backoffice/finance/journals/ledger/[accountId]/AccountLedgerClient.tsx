"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { ArrowLeft, ScrollText } from "lucide-react";
import type { AccountLedger } from "@/lib/finance/journals/queries";
import { Button } from "@/components/ui/button";
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
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { teksKeteranganJurnal } from "@/lib/finance/journals/keterangan-tampil";
import { rupiahLaporan } from "@/lib/finance/reports/format-laporan";
import { halamanBaris } from "../../_daftar/ukuran-halaman";
import { UkuranHalaman } from "../../_daftar/UkuranHalaman";

type Props = {
  accountId: string;
  ledger: AccountLedger;
  filters: { from: string; to: string };
  pilihanAkun: { value: string; label: string; nonaktif: boolean }[];
};

const formatRupiah = rupiahLaporan;

export function AccountLedgerClient({ accountId, ledger, filters, pilihanAkun }: Props) {
  const t = useTranslations("financeJournals");
  const tt = useTranslations("tanggalInput");
  const tCoa = useTranslations("finance.coa");
  const locale = useLocale();
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  const basePath = `/backoffice/finance/journals/ledger/${accountId}`;

  const formatDate = (iso: string) => formatDisplayDate(iso, locale);

  function pushParams(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    startTransition(() => router.push(`${basePath}?${params.toString()}`));
  }

  function reset() {
    startTransition(() => router.push(basePath));
  }

  const hasFilter = !!(filters.from || filters.to);

  /* Cari dan halaman di sisi klien: saldo berjalan butuh semua baris periode, jadi semuanya dimuat. */
  const [cari, setCari] = useState("");
  const [halaman, setHalaman] = useState(1);
  const [per, setPer] = useState(100);
  const barisTampil = useMemo(
    () => ledger.rows.map((r) => ({ ...r, keterangan: teksKeteranganJurnal(t, r.description, { manual: r.isManual }) })),
    [ledger.rows, t],
  );
  const tersaring = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return q ? barisTampil.filter((r) => r.keterangan.toLowerCase().includes(q)) : barisTampil;
  }, [barisTampil, cari]);
  const potong = halamanBaris(tersaring, halaman, per);

  function pindahAkun(id: string) {
    if (!id || id === accountId) return;
    const params = new URLSearchParams(sp.toString());
    const qs = params.toString();
    startTransition(() => router.push(`/backoffice/finance/journals/ledger/${id}${qs ? `?${qs}` : ""}`));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/backoffice/finance/journals/ledger">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("back")}
          </Link>
        </Button>
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <h1 className="text-xl font-semibold">
              <span className="font-mono mr-2">{ledger.accountCode}</span>
              {ledger.accountName}
            </h1>
            <TombolBantuan judul={ledger.accountName} />
          </div>
          <p className="text-sm text-muted-foreground">{tCoa(`type.${ledger.type}` as never)}</p>
        </div>
        <div className="ml-auto w-full sm:w-72">
          <label htmlFor="pilih-akun" className="sr-only">{t("ledger.gantiAkun")}</label>
          <SearchableCombobox
            id="pilih-akun"
            options={pilihanAkun.map((a) => ({ value: a.value, label: a.nonaktif ? `${a.label} (${t("ledger.nonaktif")})` : a.label }))}
            value={accountId}
            onValueChange={pindahAkun}
            placeholder={t("ledger.gantiAkun")}
            triggerClassName="w-full"
          />
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
            <label htmlFor="periode" className="text-xs text-muted-foreground mb-1 block">{tt("periode")}</label>
            <RentangTanggalInput
              id="periode"
              dari={filters.from}
              sampai={filters.to}
              onChange={({ dari, sampai }) => pushParams({ from: dari || undefined, to: sampai || undefined })}
            />
          </div>
          <div>
            <label htmlFor="cari-buku-besar" className="text-xs text-muted-foreground mb-1 block">{t("ledger.cari")}</label>
            <Input
              id="cari-buku-besar"
              value={cari}
              placeholder={t("ledger.cariPlaceholder")}
              onChange={(e) => {
                setCari(e.target.value);
                setHalaman(1);
              }}
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
                  {potong.baris.map((row, idx) => (
                    <TableRow
                      key={`${row.journalId}-${idx}`}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() =>
                        startTransition(() =>
                          router.push(`/backoffice/finance/journals/${row.journalId}`),
                        )
                      }
                    >
                      <TableCell className="whitespace-nowrap">{formatDate(row.date)}</TableCell>
                      <TableCell className="max-w-[320px] truncate">
                        <Link
                          href={`/backoffice/finance/journals/${row.journalId}`}
                          className="hover:underline underline-offset-4"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {row.keterangan}
                        </Link>
                      </TableCell>
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
              {cari.trim() && tersaring.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("ledger.cariKosong")}</p>
              ) : null}
              {tersaring.length > per ? (
                <Pagination
                  page={potong.halaman}
                  totalPages={potong.jumlahHalaman}
                  onPageChange={setHalaman}
                  totalCount={tersaring.length}
                  pageSize={per}
                />
              ) : null}
              {ledger.rows.length > 25 ? (
                <div className="mt-2 flex justify-end">
                  <UkuranHalaman
                    nilai={per}
                    onUbah={(n) => {
                      setPer(n);
                      setHalaman(1);
                    }}
                  />
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
