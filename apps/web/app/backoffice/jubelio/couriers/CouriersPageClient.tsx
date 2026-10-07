"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ArrowUpDown, RefreshCw, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pager } from "@/components/Pager";
import { formatDisplayDateTime } from "@/lib/date-only";
import { PageHeader } from "@/components/ui/page-header";
import { Label } from "@/components/ui/label";
import { usePesanGalatJubelio } from "../RincianGalat";
import {
  sinkronkanKurirJubelio,
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
  const pesanGalat = usePesanGalatJubelio();
  const locale = useLocale();
  const router = useRouter();
  const sp = useSearchParams();
  const [isSyncing, startSyncing] = useTransition();
  const [, startNav] = useTransition();
  const [searchInput, setSearchInput] = useState(props.search);

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

  // Debounce search input → URL push
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== props.search) pushParam("search", searchInput || undefined);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function onSyncClick(): void {
    startSyncing(async () => {
      const r = await sinkronkanKurirJubelio();
      if (!r.ok) {
        toast.error(pesanGalat(r));
        return;
      }
      toast.success(t("toast.syncSuccess", { count: r.data.count }));
      router.refresh();
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
    <div className="space-y-6">
      <PageHeader
        title={t("pageTitle")}
        meta={
          lastSyncedAt
            ? t("lastSyncedAt", { when: formatDisplayDateTime(lastSyncedAt, locale) })
            : undefined
        }
        actions={
          <Button onClick={onSyncClick} disabled={isSyncing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
            {t("syncButton")}
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-sm space-y-1">
          <Label htmlFor="kurir-cari" className="text-xs text-muted-foreground">
            {t("filter.searchLabel")}
          </Label>
          <Input
            id="kurir-cari"
            placeholder={t("filter.searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Button variant="outline" onClick={reset}>
          {t("filter.reset")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            {t("listTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
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
                  <TableCell className="whitespace-normal">{c.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDisplayDateTime(c.syncedAt, locale)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </CardContent>
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
        className="inline-flex items-center gap-1 [letter-spacing:inherit] [text-transform:inherit] hover:text-foreground"
      >
        {label}
        <Icon className="h-3.5 w-3.5" />
      </button>
    </TableHead>
  );
}
