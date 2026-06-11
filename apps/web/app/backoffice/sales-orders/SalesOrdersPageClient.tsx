"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { SALES_CHANNEL_VALUES, SALES_ORDER_STATUS_VALUES } from "@/lib/constants/enums";
import type { SalesOrderListRow } from "@/lib/sales-orders/queries";
import { CHANNEL_BADGE, STATUS_BADGE } from "@/lib/sales-orders/badges";
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
import { Card } from "@/components/ui/card";
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
  orders: SalesOrderListRow[];
  totalCount: number;
  search: string;
  channel: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize: number;
};

export function SalesOrdersPageClient(props: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("salesOrders");
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
    startTransition(() => router.push(`/backoffice/sales-orders?${params.toString()}`));
  }

  function reset() {
    setSearchInput("");
    startTransition(() => router.push("/backoffice/sales-orders"));
  }

  const hasFilter = !!(
    props.search ||
    props.channel ||
    props.status ||
    props.dateFrom ||
    props.dateTo
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
        <p className="text-muted-foreground">{t("pageSubtitle")}</p>
      </div>

      <Card className="p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[240px]">
          <Input
            placeholder={t("filter.searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Select
          value={props.channel || "ALL"}
          onValueChange={(v) => pushParam("channel", v === "ALL" ? undefined : v)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t("filter.channel")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("filter.all")}</SelectItem>
            {SALES_CHANNEL_VALUES.map((c) => (
              <SelectItem key={c} value={c}>
                {t(`channel.${CHANNEL_BADGE[c].labelKey}` as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={props.status || "ALL"}
          onValueChange={(v) => pushParam("status", v === "ALL" ? undefined : v)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t("filter.status")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("filter.all")}</SelectItem>
            {SALES_ORDER_STATUS_VALUES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`status.${s}` as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={props.dateFrom}
          onChange={(e) => pushParam("dateFrom", e.target.value || undefined)}
          className="w-[160px]"
        />
        <Input
          type="date"
          value={props.dateTo}
          onChange={(e) => pushParam("dateTo", e.target.value || undefined)}
          className="w-[160px]"
        />
        <Button variant="outline" onClick={reset}>
          {t("filter.reset")}
        </Button>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.orderNo")}</TableHead>
              <TableHead>{t("table.channel")}</TableHead>
              <TableHead>{t("table.buyer")}</TableHead>
              <TableHead className="text-right">{t("table.total")}</TableHead>
              <TableHead>{t("table.status")}</TableHead>
              <TableHead>{t("table.date")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  {hasFilter ? t("emptyFiltered") : t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              props.orders.map((o) => (
                <TableRow key={o.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell>
                    <Link
                      href={`/backoffice/sales-orders/${o.id}`}
                      className="font-mono text-sm"
                    >
                      {o.salesorderNo}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${CHANNEL_BADGE[o.channel].tailwindClass}`}
                    >
                      {t(`channel.${CHANNEL_BADGE[o.channel].labelKey}` as never)}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {o.customerName ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">{formatIDR(o.grandTotal)}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${STATUS_BADGE[o.status].tailwindClass}`}
                    >
                      {t(`status.${o.status}` as never)}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(o.transactionDate, locale)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {props.totalCount > props.pageSize && (
        <Pager
          page={props.page}
          pageSize={props.pageSize}
          total={props.totalCount}
          onPageChange={(p) => {
            const params = new URLSearchParams(sp.toString());
            params.set("page", String(p));
            startTransition(() =>
              router.push(`/backoffice/sales-orders?${params.toString()}`),
            );
          }}
          onPageSizeChange={() => {}}
        />
      )}
    </div>
  );
}
