"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Receipt, X } from "lucide-react";
import type { VanSaleListRow } from "@/lib/canvassing/sale-queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  sales: VanSaleListRow[];
  totalCount: number;
  salesmen: Array<{ id: string; label: string }>;
  salesmanId: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
};

const ALL_SALESMEN = "__all__";

function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function VanSalesListClient({
  sales,
  totalCount,
  salesmen,
  salesmanId,
  from,
  to,
  page,
  pageSize,
}: Props) {
  const t = useTranslations("vanSale.backoffice.list");
  const tTable = useTranslations("vanSale.backoffice.list.table");
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  const hasFilters = !!salesmanId || !!from || !!to;

  function pushParams(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    params.delete("page");
    startTransition(() => router.push(`/backoffice/van-sales?${params.toString()}`));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="space-y-2 w-full sm:w-56">
          <Label className="text-muted-foreground">{t("filters.salesmanLabel")}</Label>
          <SearchableCombobox
            options={[
              { value: ALL_SALESMEN, label: t("filters.allSalesmen") },
              ...salesmen.map((s) => ({ value: s.id, label: s.label })),
            ]}
            value={salesmanId || ALL_SALESMEN}
            onValueChange={(v) => pushParams({ salesmanId: v === ALL_SALESMEN ? undefined : v })}
            placeholder={t("filters.allSalesmen")}
            searchPlaceholder={t("filters.searchSalesmanPlaceholder")}
            emptyMessage={t("filters.noSalesmanFound")}
            triggerClassName="h-9 w-full"
          />
        </div>
        <div className="space-y-2 w-full sm:w-40">
          <Label htmlFor="van-sale-from" className="text-muted-foreground">
            {t("filters.fromLabel")}
          </Label>
          <Input
            id="van-sale-from"
            type="date"
            value={from}
            onChange={(e) => pushParams({ from: e.target.value || undefined })}
            className="h-9"
          />
        </div>
        <div className="space-y-2 w-full sm:w-40">
          <Label htmlFor="van-sale-to" className="text-muted-foreground">
            {t("filters.toLabel")}
          </Label>
          <Input
            id="van-sale-to"
            type="date"
            value={to}
            onChange={(e) => pushParams({ to: e.target.value || undefined })}
            className="h-9"
          />
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => pushParams({ salesmanId: undefined, from: undefined, to: undefined })}
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            {t("filters.reset")}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            {t("cardTitle")}
            <span className="text-sm font-normal text-muted-foreground ml-2">
              ({t("count", { count: totalCount })})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sales.length === 0 ? (
            <div className="text-center py-12">
              <Receipt className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {hasFilters ? t("noResults") : t("empty")}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tTable("docNo")}</TableHead>
                    <TableHead>{tTable("salesman")}</TableHead>
                    <TableHead>{tTable("buyer")}</TableHead>
                    <TableHead className="text-right">{tTable("total")}</TableHead>
                    <TableHead>{tTable("date")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.map((s) => (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() =>
                        startTransition(() => router.push(`/backoffice/van-sales/${s.id}`))
                      }
                    >
                      <TableCell className="font-mono text-xs">{s.docNo}</TableCell>
                      <TableCell className="font-medium">{s.salesmanLabel}</TableCell>
                      <TableCell className="text-muted-foreground">{s.buyerLabel}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatRupiah(s.total)}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(s.createdAtIso)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Pager
        page={page}
        pageSize={pageSize}
        total={totalCount}
        onPageChange={(p) => {
          const params = new URLSearchParams(sp.toString());
          params.set("page", String(p));
          startTransition(() => router.push(`/backoffice/van-sales?${params.toString()}`));
        }}
        onPageSizeChange={(size) => {
          const params = new URLSearchParams(sp.toString());
          params.set("pageSize", String(size));
          params.delete("page");
          startTransition(() => router.push(`/backoffice/van-sales?${params.toString()}`));
        }}
      />
    </div>
  );
}
