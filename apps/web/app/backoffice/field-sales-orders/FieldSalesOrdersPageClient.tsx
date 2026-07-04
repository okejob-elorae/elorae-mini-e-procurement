"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import type { FieldSalesOrderListItem, FieldSalesOrderStatus } from "@/lib/field-sales/queries";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

type StatusFilter = FieldSalesOrderStatus | "ALL";

type Props = {
  orders: FieldSalesOrderListItem[];
  totalCount: number;
  search: string;
  status: StatusFilter;
  page: number;
  pageSize: number;
};

const STATUS_BADGE_VARIANT: Record<FieldSalesOrderStatus, "secondary" | "default" | "destructive"> = {
  PENDING_APPROVAL: "secondary",
  APPROVED: "default",
  REJECTED: "destructive",
};

const STATUS_LABEL_KEY: Record<FieldSalesOrderStatus, "statusPending" | "statusApproved" | "statusRejected"> = {
  PENDING_APPROVAL: "statusPending",
  APPROVED: "statusApproved",
  REJECTED: "statusRejected",
};

function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function FieldSalesOrdersPageClient(props: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("fieldSalesOrders");
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
    startTransition(() => router.push(`/backoffice/field-sales-orders?${params.toString()}`));
  }

  function reset() {
    setSearchInput("");
    startTransition(() => router.push("/backoffice/field-sales-orders"));
  }

  const formatDate = (date: Date) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">{t("search")}</label>
            <Input
              placeholder={t("search")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("status")}</label>
            <Select value={props.status} onValueChange={(v) => pushParam("status", v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("statusAll")}</SelectItem>
                <SelectItem value="PENDING_APPROVAL">{t("statusPending")}</SelectItem>
                <SelectItem value="APPROVED">{t("statusApproved")}</SelectItem>
                <SelectItem value="REJECTED">{t("statusRejected")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col justify-end">
            <Button variant="outline" onClick={reset} className="w-full">
              {t("reset")}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colOrderNo")}</TableHead>
              <TableHead>{t("colStore")}</TableHead>
              <TableHead>{t("colSalesman")}</TableHead>
              <TableHead className="text-right">{t("colTotal")}</TableHead>
              <TableHead>{t("colCreated")}</TableHead>
              <TableHead>{t("colStatus")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              props.orders.map((o) => (
                <TableRow
                  key={o.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() =>
                    startTransition(() => router.push(`/backoffice/field-sales-orders/${o.id}`))
                  }
                >
                  <TableCell className="font-mono text-sm">{o.orderNo}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{o.storeName}</TableCell>
                  <TableCell className="max-w-[160px] truncate">{o.salesmanName}</TableCell>
                  <TableCell className="text-right">{formatRupiah(o.total)}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(o.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE_VARIANT[o.status]}>
                      {t(STATUS_LABEL_KEY[o.status])}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Pager
        page={props.page}
        pageSize={props.pageSize}
        total={props.totalCount}
        onPageChange={(p) => {
          const params = new URLSearchParams(sp.toString());
          params.set("page", String(p));
          startTransition(() =>
            router.push(`/backoffice/field-sales-orders?${params.toString()}`),
          );
        }}
        onPageSizeChange={(size) => {
          const params = new URLSearchParams(sp.toString());
          params.set("pageSize", String(size));
          params.delete("page");
          startTransition(() =>
            router.push(`/backoffice/field-sales-orders?${params.toString()}`),
          );
        }}
      />
    </div>
  );
}
