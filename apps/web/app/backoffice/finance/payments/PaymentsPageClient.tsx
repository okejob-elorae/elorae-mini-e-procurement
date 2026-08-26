"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertCircle, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/utils";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import type { listPayments } from "@/lib/finance/ar/queries";

type PaymentRow = Awaited<ReturnType<typeof listPayments>>["rows"][number];
type PaymentMethodValue = "CASH" | "TRANSFER";
type MethodFilter = PaymentMethodValue | "ALL";
type PaymentStatusValue = "POSTED" | "VOIDED";
type StatusFilter = PaymentStatusValue | "ALL";

type Props = {
  rows: PaymentRow[];
  total: number;
  storeOptions: { id: string; name: string }[];
  storeId: string;
  method: MethodFilter;
  status: StatusFilter;
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize: number;
  loadError: boolean;
};

const BASE_PATH = "/backoffice/finance/payments";
const ALL_STORES = "__all__";

const STATUS_BADGE_CLASS: Record<PaymentStatusValue, string> = {
  POSTED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  VOIDED: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function PaymentsPageClient(props: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("payments");
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

  const hasFilters =
    !!props.storeId || props.method !== "ALL" || props.status !== "ALL" || !!props.dateFrom || !!props.dateTo;

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
            <Select value={props.method} onValueChange={(v) => pushParams({ method: v === "ALL" ? undefined : v })}>
              <SelectTrigger className="h-10 w-full sm:w-[160px]">
                <SelectValue placeholder={t("allMethods")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("allMethods")}</SelectItem>
                <SelectItem value="CASH">{t("methodCash")}</SelectItem>
                <SelectItem value="TRANSFER">{t("methodTransfer")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={props.status} onValueChange={(v) => pushParams({ status: v === "ALL" ? undefined : v })}>
              <SelectTrigger className="h-10 w-full sm:w-[160px]">
                <SelectValue placeholder={t("allStatus")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("allStatus")}</SelectItem>
                <SelectItem value="POSTED">{t("statusPosted")}</SelectItem>
                <SelectItem value="VOIDED">{t("statusVoided")}</SelectItem>
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
                          <TableHead>{t("colDate")}</TableHead>
                          <TableHead>{t("colMethod")}</TableHead>
                          <TableHead className="text-right">{t("colAmount")}</TableHead>
                          <TableHead className="text-right">{t("colAllocations")}</TableHead>
                          <TableHead>{t("colStatus")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {props.rows.map((row) => {
                          const status = row.status as PaymentStatusValue;
                          const voided = status === "VOIDED";
                          return (
                            <TableRow
                              key={row.id}
                              className={cn("cursor-pointer hover:bg-muted/50", voided && "text-muted-foreground")}
                              onClick={() => startTransition(() => router.push(`${BASE_PATH}/${row.id}`))}
                            >
                              <TableCell className="whitespace-nowrap font-mono text-xs">{row.docNo}</TableCell>
                              <TableCell className="max-w-[180px] truncate font-medium">{row.storeName}</TableCell>
                              <TableCell className="whitespace-nowrap">{formatDateOnlyJakarta(row.paidAt)}</TableCell>
                              <TableCell>{t(row.method === "CASH" ? "methodCash" : "methodTransfer")}</TableCell>
                              <TableCell className="text-right whitespace-nowrap tabular-nums font-medium">
                                {formatRupiah(row.amount)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{row.allocationCount}</TableCell>
                              <TableCell>
                                <Badge className={STATUS_BADGE_CLASS[status]}>
                                  {t(status === "POSTED" ? "statusPosted" : "statusVoided")}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })}
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
