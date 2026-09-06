"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { AlertCircle, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/utils";
import type {
  SettlementQueueRow,
  SettlementStatusValue,
} from "@/lib/finance/ar-settlement/queries";

type StatusFilter = SettlementStatusValue | "ALL";

type Props = {
  rows: SettlementQueueRow[];
  total: number;
  salesmen: { id: string; name: string }[];
  storeOptions: { id: string; name: string }[];
  storeId: string;
  salesmanId: string;
  status: StatusFilter;
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize: number;
  loadError: boolean;
};

const BASE_PATH = "/backoffice/finance/pelunasan";
const ALL_STORES = "__all__";
const ALL_SALESMEN = "__all__";

const SETTLEMENT_STATUS_BADGE_CLASS: Record<SettlementStatusValue, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  APPROVED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  REJECTED: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

const SETTLEMENT_STATUS_LABEL_KEY: Record<
  SettlementStatusValue,
  "statusPending" | "statusApproved" | "statusRejected"
> = {
  PENDING: "statusPending",
  APPROVED: "statusApproved",
  REJECTED: "statusRejected",
};

function formatRupiahExact(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function SettlementQueuePageClient(props: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("financeStoreSettlements");
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();

  function pushParams(next: Record<string, string | undefined>): void {
    const params = new URLSearchParams(sp.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    params.delete("page");
    startTransition(() => router.push(`${BASE_PATH}?${params.toString()}`));
  }

  function reset(): void {
    startTransition(() => router.push(BASE_PATH));
  }

  function goToPage(p: number): void {
    const params = new URLSearchParams(sp.toString());
    params.set("page", String(p));
    startTransition(() => router.push(`${BASE_PATH}?${params.toString()}`));
  }

  const formatFiledAt = (date: Date) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);

  const hasFilters =
    !!props.storeId ||
    !!props.salesmanId ||
    props.status !== "PENDING" ||
    !!props.dateFrom ||
    !!props.dateTo;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      {props.loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <div>
              <p className="font-medium">{t("loadErrorTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("loadErrorMessage")}</p>
            </div>
            <Button variant="outline" className="h-10" onClick={() => router.refresh()}>
              {t("loadErrorRetry")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row flex-wrap gap-3">
            <SearchableCombobox
              options={[
                { value: ALL_STORES, label: t("allStores") },
                ...props.storeOptions.map((s) => ({ value: s.id, label: s.name })),
              ]}
              value={props.storeId || ALL_STORES}
              onValueChange={(v) => pushParams({ storeId: v === ALL_STORES ? undefined : v })}
              placeholder={t("allStores")}
              searchPlaceholder={t("storeSearchPlaceholder")}
              emptyMessage={t("storeSearchEmpty")}
              triggerClassName="h-10 w-full sm:w-[220px]"
            />
            <SearchableCombobox
              options={[
                { value: ALL_SALESMEN, label: t("allSalesmen") },
                ...props.salesmen.map((s) => ({ value: s.id, label: s.name })),
              ]}
              value={props.salesmanId || ALL_SALESMEN}
              onValueChange={(v) => pushParams({ salesmanId: v === ALL_SALESMEN ? undefined : v })}
              placeholder={t("allSalesmen")}
              searchPlaceholder={t("salesmanSearchPlaceholder")}
              emptyMessage={t("salesmanSearchEmpty")}
              triggerClassName="h-10 w-full sm:w-[220px]"
            />
            <Select value={props.status} onValueChange={(v) => pushParams({ status: v })}>
              <SelectTrigger className="h-10 w-full sm:w-[160px]">
                <SelectValue placeholder={t("statusPending")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PENDING">{t("statusPending")}</SelectItem>
                <SelectItem value="APPROVED">{t("statusApproved")}</SelectItem>
                <SelectItem value="REJECTED">{t("statusRejected")}</SelectItem>
                <SelectItem value="ALL">{t("allStatus")}</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={props.dateFrom}
              onChange={(e) => pushParams({ from: e.target.value || undefined })}
              className="h-10 w-full sm:w-[160px]"
              aria-label={t("fromLabel")}
            />
            <Input
              type="date"
              value={props.dateTo}
              onChange={(e) => pushParams({ to: e.target.value || undefined })}
              className="h-10 w-full sm:w-[160px]"
              aria-label={t("toLabel")}
            />
            <Button variant="outline" className="h-10" onClick={reset}>
              {t("reset")}
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                {t("listTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isPending ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : props.rows.length === 0 ? (
                <div className="text-center py-12">
                  <Wallet className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">{hasFilters ? t("noResults") : t("empty")}</p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("colDocNo")}</TableHead>
                          <TableHead>{t("colStore")}</TableHead>
                          <TableHead>{t("colSalesman")}</TableHead>
                          <TableHead className="text-right">{t("colInvoices")}</TableHead>
                          <TableHead className="text-right">{t("colExpected")}</TableHead>
                          <TableHead className="text-right">{t("colActual")}</TableHead>
                          <TableHead className="text-right">{t("colVariance")}</TableHead>
                          <TableHead>{t("colStatus")}</TableHead>
                          <TableHead>{t("colFiledAt")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {props.rows.map((row) => (
                          <TableRow
                            key={row.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => startTransition(() => router.push(`${BASE_PATH}/${row.id}`))}
                          >
                            <TableCell className="whitespace-nowrap font-mono text-xs">{row.docNo}</TableCell>
                            <TableCell className="max-w-[180px] truncate font-medium">{row.storeName}</TableCell>
                            <TableCell className="max-w-[160px] truncate">{row.salesmanName}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.invoiceCount}</TableCell>
                            <TableCell className="text-right whitespace-nowrap tabular-nums">
                              {formatRupiahExact(row.expectedAmount)}
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap tabular-nums font-medium">
                              {formatRupiahExact(row.actualAmount)}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "text-right whitespace-nowrap tabular-nums",
                                row.varianceAmount !== 0 && "text-destructive font-medium",
                              )}
                            >
                              {formatRupiahExact(row.varianceAmount)}
                            </TableCell>
                            <TableCell>
                              <Badge className={SETTLEMENT_STATUS_BADGE_CLASS[row.status]}>
                                {t(SETTLEMENT_STATUS_LABEL_KEY[row.status])}
                              </Badge>
                            </TableCell>
                            <TableCell className="whitespace-nowrap">{formatFiledAt(row.createdAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <Pagination
                    page={props.page}
                    totalPages={Math.max(1, Math.ceil(props.total / props.pageSize))}
                    onPageChange={goToPage}
                    totalCount={props.total}
                    pageSize={props.pageSize}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
