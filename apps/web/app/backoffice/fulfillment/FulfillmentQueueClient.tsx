"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Pager } from "@/components/Pager";
import {
  SALES_CHANNEL_VALUES,
  SALES_ORDER_FULFILLMENT_STATUS_VALUES,
  type SalesOrderFulfillmentStatus,
} from "@/lib/constants/enums";
import { CHANNEL_BADGE, STATUS_BADGE } from "@/lib/sales-orders/badges";
import { formatDateTime } from "@/lib/sales-orders/format";
import { FULFILLMENT_FORBIDDEN_REASON } from "@/lib/sales-orders/fulfillment-result";
import {
  batchFinishPickAction,
  batchFinishPackAction,
  type BatchResult,
  type FulfillmentQueueRow,
  type QueueSortDir,
  type QueueSortField,
} from "@/app/actions/fulfillment-queue";

const ROUTE = "/backoffice/fulfillment";

const FULFILLMENT_BADGE: Record<SalesOrderFulfillmentStatus, string> = {
  PENDING: "bg-zinc-100 text-zinc-700 border-zinc-200",
  PICKED: "bg-amber-100 text-amber-800 border-amber-200",
  PACKED: "bg-blue-100 text-blue-800 border-blue-200",
  SHIPPED: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

type Props = {
  rows: FulfillmentQueueRow[];
  totalCount: number;
  fulfillmentStatus: SalesOrderFulfillmentStatus | "ALL";
  channel: string;
  search: string;
  dateFrom: string;
  dateTo: string;
  sortField: QueueSortField;
  sortDir: QueueSortDir;
  page: number;
  pageSize: number;
  canFulfill: boolean;
};

export function FulfillmentQueueClient(props: Props) {
  const t = useTranslations("fulfillmentQueue");
  const tSalesOrders = useTranslations("salesOrders");
  const locale = useLocale();
  const router = useRouter();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(props.search);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelected(new Set());
  }, [props.rows]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== props.search) pushParam("search", searchInput || undefined);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function pushParams(updates: Record<string, string | undefined>): void {
    const params = new URLSearchParams(sp.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    startTransition(() => router.push(`${ROUTE}?${params.toString()}`));
  }

  function pushParam(key: string, value: string | undefined): void {
    pushParams({ [key]: value, page: undefined });
  }

  function onSortClick(field: QueueSortField): void {
    let nextDir: QueueSortDir = field === "transactionDate" ? "desc" : "asc";
    if (props.sortField === field) {
      nextDir = props.sortDir === "asc" ? "desc" : "asc";
    }
    pushParams({ sortField: field, sortDir: nextDir, page: undefined });
  }

  function reset(): void {
    setSearchInput("");
    startTransition(() => router.push(ROUTE));
  }

  function toggleRow(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    if (selected.size === props.rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(props.rows.map((r) => r.id)));
    }
  }

  function handleBatchResult(r: BatchResult): void {
    if (!r.ok) {
      if (r.reason === FULFILLMENT_FORBIDDEN_REASON) {
        toast.error(t("batch.toast.forbidden"));
      } else {
        toast.error(t("batch.toast.networkError"));
      }
      return;
    }
    if (r.skipped > 0) {
      toast.success(
        t("batch.toast.successWithSkipped", { processed: r.processed, skipped: r.skipped }),
      );
    } else {
      toast.success(t("batch.toast.success", { processed: r.processed }));
    }
    setSelected(new Set());
  }

  function runBatch(action: (ids: string[]) => Promise<BatchResult>): void {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    startTransition(async () => {
      try {
        const r = await action(ids);
        handleBatchResult(r);
      } catch {
        toast.error(t("batch.toast.networkError"));
      }
    });
  }

  const allSelected = props.rows.length > 0 && selected.size === props.rows.length;
  const someSelected = selected.size > 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
        <p className="text-muted-foreground">{t("pageSubtitle")}</p>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-7">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              {t("filter.fulfillmentStatus")}
            </label>
            <Select
              value={props.fulfillmentStatus}
              onValueChange={(v) => pushParam("fulfillmentStatus", v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("filter.all")}</SelectItem>
                {SALES_ORDER_FULFILLMENT_STATUS_VALUES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`fulfillmentStatus.${s}` as never)}
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
                    {tSalesOrders(`channel.${CHANNEL_BADGE[c].labelKey}` as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="lg:col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">
              {t("filter.search")}
            </label>
            <Input
              placeholder={t("filter.searchPlaceholder")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
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

      {someSelected && props.canFulfill && (
        <Card className="p-3 flex items-center justify-between sticky top-0 z-10">
          <span className="text-sm font-medium">
            {t("batch.selectedCount", { count: selected.size })}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => runBatch(batchFinishPickAction)}
            >
              {t("batch.finishPick")}
            </Button>
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => runBatch(batchFinishPackAction)}
            >
              {t("batch.finishPack")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              {t("batch.clear")}
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                {props.canFulfill && (
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                )}
              </TableHead>
              <SortableHead
                label={t("table.orderNo")}
                field="salesorderNo"
                currentField={props.sortField}
                currentDir={props.sortDir}
                onClick={onSortClick}
              />
              <SortableHead
                label={t("table.channel")}
                field="channel"
                currentField={props.sortField}
                currentDir={props.sortDir}
                onClick={onSortClick}
              />
              <TableHead>{t("table.buyer")}</TableHead>
              <SortableHead
                label={t("table.date")}
                field="transactionDate"
                currentField={props.sortField}
                currentDir={props.sortDir}
                onClick={onSortClick}
              />
              <SortableHead
                label={t("table.fulfillmentStatus")}
                field="fulfillmentStatus"
                currentField={props.sortField}
                currentDir={props.sortDir}
                onClick={onSortClick}
              />
              <TableHead>{t("table.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              props.rows.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() =>
                    startTransition(() => router.push(`/backoffice/sales-orders/${r.id}`))
                  }
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {props.canFulfill && (
                      <Checkbox
                        checked={selected.has(r.id)}
                        onCheckedChange={() => toggleRow(r.id)}
                        aria-label={`Select ${r.salesorderNo}`}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/backoffice/sales-orders/${r.id}`}
                      className="font-mono text-sm hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.salesorderNo}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${CHANNEL_BADGE[r.channel].tailwindClass}`}
                    >
                      {tSalesOrders(`channel.${CHANNEL_BADGE[r.channel].labelKey}` as never)}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {r.customerName ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDateTime(r.transactionDate, locale)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${FULFILLMENT_BADGE[r.fulfillmentStatus]}`}
                    >
                      {t(`fulfillmentStatus.${r.fulfillmentStatus}` as never)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${STATUS_BADGE[r.status].tailwindClass}`}
                    >
                      {tSalesOrders(`status.${r.status}` as never)}
                    </span>
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
        onPageChange={(p) => pushParams({ page: String(p) })}
        onPageSizeChange={(size) => pushParams({ pageSize: String(size), page: undefined })}
      />
    </div>
  );
}

function SortableHead({
  label,
  field,
  currentField,
  currentDir,
  onClick,
  className,
}: {
  label: string;
  field: QueueSortField;
  currentField: QueueSortField;
  currentDir: QueueSortDir;
  onClick: (f: QueueSortField) => void;
  className?: string;
}) {
  const active = currentField === field;
  const Icon = active ? (currentDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onClick(field)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <Icon className="h-3.5 w-3.5" />
      </button>
    </TableHead>
  );
}
