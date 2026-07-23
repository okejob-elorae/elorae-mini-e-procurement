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

type Props = {
  items: JournalListRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  canManage: boolean;
  filters: { from: string; to: string; source: string; q: string };
};

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

export function JournalsPageClient({ items, totalCount, page, pageSize, canManage, filters }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("financeJournals");
  const locale = useLocale();
  const [, startTransition] = useTransition();

  const [searchInput, setSearchInput] = useState(filters.q);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== filters.q) pushParam("q", searchInput);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" }).format(
      new Date(iso),
    );

  function pushParam(key: string, value: string | undefined) {
    const params = new URLSearchParams(sp.toString());
    if (!value) params.delete(key);
    else params.set(key, value);
    params.delete("page");
    startTransition(() => router.push(`/backoffice/finance/journals?${params.toString()}`));
  }

  function goToPage(p: number) {
    const params = new URLSearchParams(sp.toString());
    params.set("page", String(p));
    startTransition(() => router.push(`/backoffice/finance/journals?${params.toString()}`));
  }

  function reset() {
    setSearchInput("");
    startTransition(() => router.push("/backoffice/finance/journals"));
  }

  const hasFilter = !!(filters.from || filters.to || filters.source || filters.q);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
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

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">{t("filter.search")}</label>
            <Input
              placeholder={t("filter.searchPlaceholder")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("filter.source")}</label>
            <Select
              value={filters.source || "ALL"}
              onValueChange={(v) => pushParam("source", v === "ALL" ? undefined : v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("filter.source")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("filter.all")}</SelectItem>
                <SelectItem value="manual">{t("sourceManual")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("filter.dateFrom")}</label>
            <Input
              type="date"
              value={filters.from}
              onChange={(e) => pushParam("from", e.target.value || undefined)}
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">{t("filter.dateTo")}</label>
              <Input
                type="date"
                value={filters.to}
                onChange={(e) => pushParam("to", e.target.value || undefined)}
              />
            </div>
            <Button variant="outline" onClick={reset}>
              {t("filter.reset")}
            </Button>
          </div>
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
              <p className="text-muted-foreground">{hasFilter ? t("emptyFiltered") : t("empty")}</p>
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
                        <TableCell className="max-w-[320px] truncate">{row.description}</TableCell>
                        <TableCell>
                          {row.isManual ? (
                            <Badge variant="secondary">{t("sourceManual")}</Badge>
                          ) : (
                            <Badge variant="outline">{row.sourceType ?? t("sourceAuto")}</Badge>
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
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
