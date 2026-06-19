"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { SALES_CHANNEL_VALUES, SALES_RETURN_STATUS_VALUES } from "@/lib/constants/enums";
import type { SalesReturnsListRow, SalesReturnsKpi } from "@/lib/sales-returns/queries";
import { CHANNEL_BADGE } from "@/lib/sales-orders/badges";
import { RETURN_STATUS_BADGE } from "@/lib/sales-returns/badges";
import { formatIDR, formatDateTime } from "@/lib/sales-orders/format";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pager } from "@/components/Pager";

type Props = {
  rows: SalesReturnsListRow[];
  totalCount: number;
  kpi: SalesReturnsKpi;
  search: string;
  channel: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize: number;
};

function fmtPercent(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("id-ID", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

export function SalesReturnsPageClient(props: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("salesReturns.list");
  const tOrders = useTranslations("salesOrders");
  const locale = useLocale();
  const [, startTransition] = useTransition();

  const [searchInput, setSearchInput] = useState(props.search);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== props.search) pushParam("search", searchInput);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function pushParam(key: string, value: string | undefined) {
    const params = new URLSearchParams(sp.toString());
    if (!value) params.delete(key);
    else params.set(key, value);
    params.delete("page");
    startTransition(() => router.push(`/backoffice/returns?${params.toString()}`));
  }

  function reset() {
    setSearchInput("");
    startTransition(() => router.push("/backoffice/returns"));
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
        <p className="text-muted-foreground">{t("pageSubtitle")}</p>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("kpi.totalCount")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{props.kpi.totalCount}</div>
            <p className="text-xs text-muted-foreground">{t("kpi.totalCountDesc")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("kpi.pendingCount")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{props.kpi.pendingCount}</div>
            <p className="text-xs text-muted-foreground">{t("kpi.pendingCountDesc")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("kpi.acceptanceRate")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtPercent(props.kpi.acceptanceRate)}</div>
            <p className="text-xs text-muted-foreground">{t("kpi.acceptanceRateDesc")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("kpi.totalValue")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatIDR(props.kpi.totalValue)}</div>
            <p className="text-xs text-muted-foreground">{t("kpi.totalValueDesc")}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-7">
          <div className="lg:col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">
              {t("filter.searchPlaceholder")}
            </label>
            <Input
              placeholder={t("filter.searchPlaceholder")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              {t("filter.status")}
            </label>
            <Select
              value={props.status || "ALL"}
              onValueChange={(v) => pushParam("status", v === "ALL" ? undefined : v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("filter.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("filter.all")}</SelectItem>
                {SALES_RETURN_STATUS_VALUES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`status.${RETURN_STATUS_BADGE[s].labelKey}` as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              {t("filter.channel")}
            </label>
            <Select
              value={props.channel || "ALL"}
              onValueChange={(v) => pushParam("channel", v === "ALL" ? undefined : v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("filter.channel")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("filter.all")}</SelectItem>
                {SALES_CHANNEL_VALUES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {tOrders(`channel.${CHANNEL_BADGE[c].labelKey}` as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              {t("filter.dateRange")}
            </label>
            <Input
              type="date"
              value={props.dateFrom}
              onChange={(e) => pushParam("dateFrom", e.target.value || undefined)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">&nbsp;</label>
            <Input
              type="date"
              value={props.dateTo}
              onChange={(e) => pushParam("dateTo", e.target.value || undefined)}
            />
          </div>
          <div className="flex flex-col justify-end">
            <Button variant="outline" onClick={reset} className="w-full">
              {t("filter.reset")}
            </Button>
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.returnNo")}</TableHead>
              <TableHead>{t("table.channel")}</TableHead>
              <TableHead>{t("table.orderNo")}</TableHead>
              <TableHead>{t("table.buyer")}</TableHead>
              <TableHead className="text-right">{t("table.qty")}</TableHead>
              <TableHead className="text-right">{t("table.value")}</TableHead>
              <TableHead>{t("table.status")}</TableHead>
              <TableHead>{t("table.received")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  {props.search || props.channel || props.status || props.dateFrom || props.dateTo
                    ? t("emptyFiltered")
                    : t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              props.rows.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() =>
                    startTransition(() => router.push(`/backoffice/returns/${r.id}`))
                  }
                >
                  <TableCell className="font-mono text-sm">
                    {r.jubelioReturnNo ?? `#${r.jubelioReturnId}`}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${CHANNEL_BADGE[r.channel].tailwindClass}`}
                    >
                      {tOrders(`channel.${CHANNEL_BADGE[r.channel].labelKey}` as never)}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {r.channelOrderNo ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {r.buyerName ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">{r.totalQty}</TableCell>
                  <TableCell className="text-right">{formatIDR(r.totalValue)}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${RETURN_STATUS_BADGE[r.status].tailwindClass}`}
                    >
                      {t(`status.${RETURN_STATUS_BADGE[r.status].labelKey}` as never)}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(r.receivedAt, locale)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Pager — always rendered */}
      <Pager
        page={props.page}
        pageSize={props.pageSize}
        total={props.totalCount}
        onPageChange={(p) => {
          const params = new URLSearchParams(sp.toString());
          params.set("page", String(p));
          startTransition(() =>
            router.push(`/backoffice/returns?${params.toString()}`),
          );
        }}
        onPageSizeChange={(size) => {
          const params = new URLSearchParams(sp.toString());
          params.set("pageSize", String(size));
          params.delete("page");
          startTransition(() =>
            router.push(`/backoffice/returns?${params.toString()}`),
          );
        }}
      />
    </div>
  );
}
