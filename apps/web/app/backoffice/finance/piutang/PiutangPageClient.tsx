"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertCircle, Search, Users, Wallet } from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { isOverdue, type AgingBucket } from "@/lib/finance/ar/aging";
import type { ReceivableRow } from "@/lib/finance/ar/queries";
import { bulkAssignStoreAction, type CollectionActionReason } from "@/app/actions/collections";
import { AgingSummary } from "./AgingSummary";
import { PiutangExportButtons } from "./PiutangExportButtons";

type ReceivableStatusValue = "OUTSTANDING" | "PARTIAL" | "PAID" | "WRITTEN_OFF";
type StatusFilter = ReceivableStatusValue | "ALL";

type Props = {
  rows: ReceivableRow[];
  total: number;
  bucketTotals: Record<AgingBucket, number>;
  grandOutstanding: number;
  storeOptions: { id: string; name: string }[];
  salesmen: { id: string; name: string }[];
  collectors: { id: string; name: string }[];
  canManageCollections: boolean;
  storeId: string;
  salesmanId: string;
  collectorId: string;
  status: StatusFilter;
  bucket: AgingBucket | undefined;
  dateFrom: string;
  dateTo: string;
  search: string;
  page: number;
  pageSize: number;
  asOf: Date;
  loadError: boolean;
};

const BASE_PATH = "/backoffice/finance/piutang";
const ALL_STORES = "__all__";
const ALL_SALESMEN = "__all__";
const ALL_COLLECTORS = "__all__";
const UNASSIGNED_COLLECTOR = "__unassigned__";

const STATUS_BADGE_CLASS: Record<ReceivableStatusValue, string> = {
  OUTSTANDING: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  PARTIAL: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  PAID: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  WRITTEN_OFF: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

const STATUS_LABEL_KEY: Record<
  ReceivableStatusValue,
  "statusOutstanding" | "statusPartial" | "statusPaid" | "statusWrittenOff"
> = {
  OUTSTANDING: "statusOutstanding",
  PARTIAL: "statusPartial",
  PAID: "statusPaid",
  WRITTEN_OFF: "statusWrittenOff",
};

function errKey(reason: CollectionActionReason): string {
  return `err.${reason}`;
}

function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function PiutangPageClient(props: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("piutang");
  const tCommon = useTranslations("common");
  const tErr = useTranslations("financeCollections");
  const [isPending, startTransition] = useTransition();
  const [isBulkAssignPending, startBulkAssignTransition] = useTransition();

  const [searchInput, setSearchInput] = useState(props.search);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkCollectorId, setBulkCollectorId] = useState<string>("");

  function pushParams(next: Record<string, string | undefined>): void {
    const params = new URLSearchParams(sp.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    params.delete("page");
    startTransition(() => router.push(`${BASE_PATH}?${params.toString()}`));
  }

  /*
   * Debounced push, not a local filter: `listReceivables` now takes `search` as a real query
   * param, so this has to reach the server and re-narrow the aging strip's totals along with the
   * table — a client-side filter over just the current page would silently miss matches sitting
   * on other pages.
   */
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput.trim() !== props.search) pushParams({ search: searchInput.trim() || undefined });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce fires on searchInput only
  }, [searchInput]);

  function reset(): void {
    setSearchInput("");
    startTransition(() => router.push(BASE_PATH));
  }

  function goToPage(p: number): void {
    const params = new URLSearchParams(sp.toString());
    params.set("page", String(p));
    startTransition(() => router.push(`${BASE_PATH}?${params.toString()}`));
  }

  function openBulkAssign(): void {
    setBulkCollectorId("");
    setBulkAssignOpen(true);
  }

  function closeBulkAssign(): void {
    if (isBulkAssignPending) return;
    setBulkAssignOpen(false);
    setBulkCollectorId("");
  }

  function handleBulkAssign(): void {
    if (!props.storeId || !bulkCollectorId) return;
    const collectorId = bulkCollectorId === UNASSIGNED_COLLECTOR ? null : bulkCollectorId;
    startBulkAssignTransition(async () => {
      try {
        const r = await bulkAssignStoreAction(props.storeId, collectorId);
        if (r.ok) {
          const count = typeof r.assignedCount === "number" ? r.assignedCount : 0;
          toast.success(t("bulkAssignSuccessToast", { count }));
          setBulkAssignOpen(false);
          setBulkCollectorId("");
          router.refresh();
        } else {
          toast.error(tErr(errKey(r.reason)));
        }
      } catch {
        toast.error(tErr("err.ERROR"));
      }
    });
  }

  const hasOtherFilters =
    !!props.storeId ||
    !!props.salesmanId ||
    !!props.collectorId ||
    props.status !== "ALL" ||
    !!props.bucket ||
    !!props.dateFrom ||
    !!props.dateTo;
  const selectedStoreName = props.storeOptions.find((s) => s.id === props.storeId)?.name ?? "";

  const exportFilters = {
    storeId: props.storeId || undefined,
    salesmanId: props.salesmanId || undefined,
    collectorId: props.collectorId || undefined,
    status: props.status === "ALL" ? undefined : props.status,
    bucket: props.bucket,
    dateFrom: props.dateFrom ? new Date(props.dateFrom) : undefined,
    dateTo: props.dateTo ? new Date(props.dateTo) : undefined,
    search: props.search || undefined,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <PiutangExportButtons filters={exportFilters} />
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
          <AgingSummary
            bucketTotals={props.bucketTotals}
            grandOutstanding={props.grandOutstanding}
            activeBucket={props.bucket}
            onSelectBucket={(bucket) => pushParams({ bucket })}
          />

          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("searchPlaceholder")}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9"
              />
            </div>
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
              triggerClassName="h-10 w-full sm:w-[200px]"
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
              triggerClassName="h-10 w-full sm:w-[180px]"
            />
            <SearchableCombobox
              options={[
                { value: ALL_COLLECTORS, label: t("allCollectors") },
                ...props.collectors.map((c) => ({ value: c.id, label: c.name })),
              ]}
              value={props.collectorId || ALL_COLLECTORS}
              onValueChange={(v) => pushParams({ collectorId: v === ALL_COLLECTORS ? undefined : v })}
              placeholder={t("allCollectors")}
              searchPlaceholder={t("collectorSearchPlaceholder")}
              emptyMessage={t("collectorSearchEmpty")}
              triggerClassName="h-10 w-full sm:w-[180px]"
            />
            <Select value={props.status} onValueChange={(v) => pushParams({ status: v === "ALL" ? undefined : v })}>
              <SelectTrigger className="w-full sm:w-[160px]">
                <SelectValue placeholder={t("allStatus")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("allStatus")}</SelectItem>
                <SelectItem value="OUTSTANDING">{t("statusOutstanding")}</SelectItem>
                <SelectItem value="PARTIAL">{t("statusPartial")}</SelectItem>
                <SelectItem value="PAID">{t("statusPaid")}</SelectItem>
                <SelectItem value="WRITTEN_OFF">{t("statusWrittenOff")}</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={props.dateFrom}
              onChange={(e) => pushParams({ from: e.target.value || undefined })}
              className="h-10 w-full sm:w-[150px]"
              aria-label={t("fromLabel")}
            />
            <Input
              type="date"
              value={props.dateTo}
              onChange={(e) => pushParams({ to: e.target.value || undefined })}
              className="h-10 w-full sm:w-[150px]"
              aria-label={t("toLabel")}
            />
            <Button variant="outline" className="h-10" onClick={reset}>
              {t("reset")}
            </Button>
            {props.canManageCollections && props.storeId && (
              <Button variant="outline" className="h-10" onClick={openBulkAssign}>
                <Users className="h-4 w-4 mr-2" />
                {t("bulkAssignTitle")}
              </Button>
            )}
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
                  <p className="text-muted-foreground">
                    {props.search
                      ? t("noSearchResults", { search: props.search })
                      : hasOtherFilters
                        ? t("noResults")
                        : t("empty")}
                  </p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("colStore")}</TableHead>
                          <TableHead>{t("colDocNo")}</TableHead>
                          <TableHead>{t("colSalesman")}</TableHead>
                          <TableHead>{t("colCollector")}</TableHead>
                          <TableHead>{t("colInvoiceDate")}</TableHead>
                          <TableHead>{t("colDueDate")}</TableHead>
                          <TableHead className="text-right">{t("colDaysOverdue")}</TableHead>
                          <TableHead className="text-right">{t("colOriginal")}</TableHead>
                          <TableHead className="text-right">{t("colOutstanding")}</TableHead>
                          <TableHead>{t("colStatus")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {props.rows.map((row) => {
                          const overdue = isOverdue(row.dueDate, props.asOf);
                          const status = row.status as ReceivableStatusValue;
                          return (
                            <TableRow
                              key={row.id}
                              className={cn(
                                "cursor-pointer",
                                overdue
                                  ? "bg-red-50 hover:bg-red-100 dark:bg-red-950/20 dark:hover:bg-red-950/40"
                                  : "hover:bg-muted/50",
                              )}
                              onClick={() => startTransition(() => router.push(`${BASE_PATH}/${row.id}`))}
                            >
                              <TableCell className="max-w-[180px] truncate font-medium">{row.storeName}</TableCell>
                              <TableCell className="whitespace-nowrap font-mono text-xs">{row.docNo}</TableCell>
                              <TableCell className="max-w-[140px] truncate">{row.salesmanName}</TableCell>
                              <TableCell className="max-w-[140px] truncate">{row.collectorName ?? "—"}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                {formatDateOnlyJakarta(row.invoiceDate)}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                {formatDateOnlyJakarta(row.dueDate)}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap tabular-nums">
                                {overdue ? (
                                  <span className="font-medium text-red-600 dark:text-red-400">
                                    {row.daysOverdue}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">{t("notYetDue")}</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap tabular-nums">
                                {formatRupiah(row.originalAmount)}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap tabular-nums font-medium">
                                {formatRupiah(row.outstandingAmount)}
                              </TableCell>
                              <TableCell>
                                <Badge className={STATUS_BADGE_CLASS[status]}>{t(STATUS_LABEL_KEY[status])}</Badge>
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

      <AlertDialog open={bulkAssignOpen} onOpenChange={(open) => (open ? setBulkAssignOpen(true) : closeBulkAssign())}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("bulkAssignTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("bulkAssignConfirm")}
              {selectedStoreName && <span className="block font-medium text-foreground mt-1">{selectedStoreName}</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <SearchableCombobox
            options={[
              { value: UNASSIGNED_COLLECTOR, label: t("unassignedLabel") },
              ...props.collectors.map((c) => ({ value: c.id, label: c.name })),
            ]}
            value={bulkCollectorId}
            onValueChange={setBulkCollectorId}
            placeholder={t("selectCollectorPlaceholder")}
            searchPlaceholder={t("collectorSearchPlaceholder")}
            emptyMessage={t("collectorSearchEmpty")}
            triggerClassName="h-10 w-full"
            disabled={isBulkAssignPending}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkAssignPending}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={isBulkAssignPending || !bulkCollectorId} onClick={handleBulkAssign}>
              {tCommon("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
