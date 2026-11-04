"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { BookText, Plus } from "lucide-react";
import type { JournalListRow } from "@/lib/finance/journals/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDisplayDate } from "@/lib/date-only";
import { journalSourceLabel } from "./journal-source-label";
import { teksKeteranganJurnal } from "@/lib/finance/journals/keterangan-tampil";
import { rupiahLaporan } from "@/lib/finance/reports/format-laporan";
import { UkuranHalaman } from "./_daftar/UkuranHalaman";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";
import { JENIS_SUMBER_JURNAL } from "./_sumber/tautan";
import { STATUS_DITOLAK, STATUS_DRAF, STATUS_TERTUNDA, type StatusJurnal } from "./_tertunda/sebab";
import type { BarisJurnalTertunda } from "./_tertunda/muat";
import { DaftarJurnalTertunda } from "./_tertunda/DaftarJurnalTertunda";
import { SpandukBukuBesar } from "../_kesiapan/SpandukBukuBesar";
import type { KesiapanBukuBesar } from "../_kesiapan/kesiapan";
import type { AksesSpanduk } from "../_kesiapan/baca";

type Props = {
  status: StatusJurnal;
  items: JournalListRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  canManage: boolean;
  /** Isi tab "Tertunda"; null saat tab terposting yang dibuka. */
  tertunda: BarisJurnalTertunda[] | null;
  jumlahTertunda: number;
  /** Jurnal manual yang menunggu persetujuan orang lain. */
  jumlahDraf: number;
  kesiapan: KesiapanBukuBesar | null;
  akses: AksesSpanduk;
  filters: { from: string; to: string; source: string; q: string };
};

const formatRupiah = rupiahLaporan;

export function JournalsPageClient({
  status,
  items,
  totalCount,
  page,
  pageSize,
  canManage,
  tertunda,
  jumlahTertunda,
  jumlahDraf,
  kesiapan,
  akses,
  filters,
}: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("financeJournals");
  const tt = useTranslations("tanggalInput");
  const locale = useLocale();
  const [, startTransition] = useTransition();

  const [searchInput, setSearchInput] = useState(filters.q);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== filters.q) pushParams({ q: searchInput });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const formatDate = (iso: string) => formatDisplayDate(iso, locale);

  function pushParams(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    params.delete("page");
    startTransition(() => router.push(`/backoffice/finance/journals?${params.toString()}`));
  }

  function goToPage(p: number) {
    const params = new URLSearchParams(sp.toString());
    params.set("page", String(p));
    startTransition(() => router.push(`/backoffice/finance/journals?${params.toString()}`));
  }

  function ubahUkuran(n: number) {
    const params = new URLSearchParams(sp.toString());
    params.set("per", String(n));
    params.delete("page");
    startTransition(() => router.push(`/backoffice/finance/journals?${params.toString()}`));
  }

  function reset() {
    setSearchInput("");
    startTransition(() => router.push(status === "terposting" ? "/backoffice/finance/journals" : `/backoffice/finance/journals?status=${status}`));
  }

  const hasFilter = !!(filters.from || filters.to || filters.source || filters.q);

  function gantiTab(v: string) {
    setSearchInput("");
    startTransition(() =>
      router.push(
        v === STATUS_TERTUNDA || v === STATUS_DRAF || v === STATUS_DITOLAK ? `/backoffice/finance/journals?status=${v}` : "/backoffice/finance/journals",
      ),
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
          <TombolBantuan judul={t("pageTitle")} />
        </div>
        {canManage && (
          <Button asChild>
            <Link href="/backoffice/finance/journals/new">
              <Plus className="mr-2 h-4 w-4" />
              {t("newJournal")}
            </Link>
          </Button>
        )}
      </div>

      <SpandukBukuBesar kesiapan={kesiapan} akses={akses} tanpaTautanTertunda />

      <Tabs value={status} onValueChange={gantiTab}>
        <TabsList>
          <TabsTrigger value="terposting">{t("tabPosted")}</TabsTrigger>
          <TabsTrigger value={STATUS_TERTUNDA}>
            {t("tabPending")} ({jumlahTertunda})
          </TabsTrigger>
          <TabsTrigger value={STATUS_DRAF}>
            {t("persetujuan.tabDraf")} ({jumlahDraf})
          </TabsTrigger>
          <TabsTrigger value={STATUS_DITOLAK}>{t("persetujuan.tabDitolak")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {status === "tertunda" ? (
        <DaftarJurnalTertunda rows={tertunda ?? []} />
      ) : (
        <>
          <Card className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full min-w-[220px] sm:w-auto sm:flex-[2_1_260px]">
                <label className="text-xs text-muted-foreground mb-1 block">{t("filter.search")}</label>
                <Input
                  placeholder={t("filter.searchPlaceholder")}
                  aria-label={t("filter.searchPlaceholder")}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              {status === "terposting" ? (
              <div className="w-full sm:w-auto sm:flex-[1_1_160px]">
                <label className="text-xs text-muted-foreground mb-1 block">{t("filter.source")}</label>
                <Select
                  value={filters.source || "ALL"}
                  onValueChange={(v) => pushParams({ source: v === "ALL" ? undefined : v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("filter.source")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{t("filter.all")}</SelectItem>
                    <SelectItem value="manual">{t("sourceManual")}</SelectItem>
                    {JENIS_SUMBER_JURNAL.map((jenis) => (
                      <SelectItem key={jenis} value={jenis}>
                        {journalSourceLabel(t, jenis)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              ) : null}
              <div className="w-full sm:w-auto sm:flex-[1_1_240px]">
                <label htmlFor="periode" className="text-xs text-muted-foreground mb-1 block">{tt("periode")}</label>
                <RentangTanggalInput
                  id="periode"
                  dari={filters.from}
                  sampai={filters.to}
                  onChange={({ dari, sampai }) => pushParams({ from: dari || undefined, to: sampai || undefined })}
                />
              </div>
              <Button variant="outline" onClick={reset}>
                {t("filter.reset")}
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookText className="h-5 w-5" />
                {t("listTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <div className="text-center py-12">
                  <BookText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    {hasFilter
                      ? t("emptyFiltered")
                      : status === "draf"
                        ? t("persetujuan.kosongDraf")
                        : status === "ditolak"
                          ? t("persetujuan.kosongDitolak")
                          : t("empty")}
                  </p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("colDate")}</TableHead>
                          <TableHead>{t("colDescription")}</TableHead>
                          <TableHead>{t("colSource")}</TableHead>
                          <TableHead className="text-right">{t("colTotal")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((row) => (
                          <TableRow
                            key={row.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() =>
                              startTransition(() =>
                                router.push(`/backoffice/finance/journals/${row.id}`),
                              )
                            }
                          >
                            <TableCell className="whitespace-nowrap">{formatDate(row.date)}</TableCell>
                            <TableCell className="max-w-[320px] truncate">
                              {/* Tautan sungguhan: bisa difokus, dibuka dengan papan ketik atau di tab baru (audit G8). */}
                              <Link
                                href={`/backoffice/finance/journals/${row.id}`}
                                className="hover:underline underline-offset-4"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {teksKeteranganJurnal(t, row.description, { manual: row.isManual })}
                              </Link>
                            </TableCell>
                            <TableCell>
                              {row.isManual ? (
                                <Badge variant="secondary">{t("sourceManual")}</Badge>
                              ) : (
                                <Badge variant="outline">{journalSourceLabel(t, row.sourceType)}</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatRupiah(row.total)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <Pagination
                    page={page}
                    totalPages={Math.max(1, Math.ceil(totalCount / pageSize))}
                    onPageChange={goToPage}
                    totalCount={totalCount}
                    pageSize={pageSize}
                  />
                  <div className="mt-2 flex justify-end">
                    <UkuranHalaman nilai={pageSize} onUbah={ubahUkuran} />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
