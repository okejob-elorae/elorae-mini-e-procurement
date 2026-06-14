"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ArrowUpDown, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pager } from "@/components/Pager";
import { formatDateTime } from "@/lib/sales-orders/format";
import {
  syncJubelioCouriers,
  type CourierSortDir,
  type CourierSortField,
  type JubelioCourierRow,
} from "@/app/actions/jubelio-couriers";

const ROUTE = "/backoffice/jubelio/couriers";

type Props = {
  couriers: JubelioCourierRow[];
  totalCount: number;
  search: string;
  sortField: CourierSortField;
  sortDir: CourierSortDir;
  page: number;
  pageSize: number;
};

export function CouriersPageClient(props: Props) {
  const t = useTranslations("jubelioCouriers");
  const locale = useLocale();
  const router = useRouter();
  const sp = useSearchParams();
  const [isSyncing, startSyncing] = useTransition();
  const [, startNav] = useTransition();
  const [searchInput, setSearchInput] = useState(props.search);

  // Debounce search input → URL push
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
    startNav(() => router.push(`${ROUTE}?${params.toString()}`));
  }

  function pushParam(key: string, value: string | undefined): void {
    pushParams({ [key]: value, page: undefined });
  }

  function onSyncClick(): void {
    startSyncing(async () => {
      try {
        const r = await syncJubelioCouriers();
        toast.success(t("toast.syncSuccess", { count: r.count }));
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : t("toast.syncError");
        toast.error(message);
      }
    });
  }

  function onSortClick(field: CourierSortField): void {
    let nextDir: CourierSortDir = "asc";
    if (props.sortField === field) {
      nextDir = props.sortDir === "asc" ? "desc" : "asc";
    }
    pushParams({ sortField: field, sortDir: nextDir, page: undefined });
  }

  function reset(): void {
    setSearchInput("");
    startNav(() => router.push(ROUTE));
  }

  const lastSyncedAt = props.couriers.length > 0
    ? props.couriers.reduce((acc, c) => (c.syncedAt > acc ? c.syncedAt : acc), props.couriers[0].syncedAt)
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
          <p className="text-muted-foreground">{t("pageSubtitle")}</p>
        </div>
        <Button onClick={onSyncClick} disabled={isSyncing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? "animate-spin" : ""}`} />
          {t("syncButton")}
        </Button>
      </div>

      {lastSyncedAt && (
        <p className="text-sm text-muted-foreground">
          {t("lastSyncedAt", { when: formatDateTime(lastSyncedAt, locale) })}
        </p>
      )}

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-3">
            <label className="text-xs text-muted-foreground mb-1 block">
              {t("filter.searchLabel")}
            </label>
            <Input
              placeholder={t("filter.searchPlaceholder")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div className="flex flex-col justify-end">
            <Button variant="outline" onClick={reset} className="w-full">
              {t("filter.reset")}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead
                label={t("table.id")}
                field="id"
                currentField={props.sortField}
                currentDir={props.sortDir}
                onClick={onSortClick}
                className="w-[120px]"
              />
              <SortableHead
                label={t("table.name")}
                field="name"
                currentField={props.sortField}
                currentDir={props.sortDir}
                onClick={onSortClick}
              />
              <SortableHead
                label={t("table.syncedAt")}
                field="syncedAt"
                currentField={props.sortField}
                currentDir={props.sortDir}
                onClick={onSortClick}
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.couriers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                  {props.search ? t("emptyFiltered") : t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              props.couriers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-sm">{c.id}</TableCell>
                  <TableCell>{c.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(c.syncedAt, locale)}
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
  field: CourierSortField;
  currentField: CourierSortField;
  currentDir: CourierSortDir;
  onClick: (f: CourierSortField) => void;
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
