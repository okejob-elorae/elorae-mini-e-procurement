"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Pagination } from "@/components/ui/pagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listShipmentsAction } from "@/app/actions/delivery-shipments";
import { ShipmentTrackingDialog } from "./ShipmentTrackingDialog";
import { CompleteShipmentDialog } from "./CompleteShipmentDialog";

type ShipmentRow = {
  id: string;
  docNo: string;
  status: string;
  method: string;
  storeName: string;
  orderNo: string;
  carrierName: string | null;
  resiNumber: string | null;
  packedAt: Date;
};

type Props = {
  initialItems: ShipmentRow[];
  initialTotal: number;
  storeOptions: { id: string; name: string }[];
  carriers: { id: string; name: string }[];
  canShip: boolean;
  canPod: boolean;
};

/** Sentinel for "no store filter" — a Select/Combobox cannot carry an empty-string option value. */
const ALL_STORES = "__ALL__";

type Filters = {
  status: string;
  method: string;
  storeId: string;
  dateFrom: string;
  dateTo: string;
};

const EMPTY_FILTERS: Filters = { status: "", method: "", storeId: "", dateFrom: "", dateTo: "" };

const STATUS_BADGE: Record<string, string> = {
  PACKED: "bg-slate-100 text-slate-700",
  IN_TRANSIT: "bg-blue-100 text-blue-700",
  DELIVERED: "bg-green-100 text-green-700",
  PARTIALLY_DELIVERED: "bg-amber-100 text-amber-700",
  CANCELLED: "bg-red-100 text-red-700",
};

const STATUS_LABEL_KEY: Record<
  string,
  "statusPacked" | "statusInTransit" | "statusDelivered" | "statusPartiallyDelivered" | "statusCancelled"
> = {
  PACKED: "statusPacked",
  IN_TRANSIT: "statusInTransit",
  DELIVERED: "statusDelivered",
  PARTIALLY_DELIVERED: "statusPartiallyDelivered",
  CANCELLED: "statusCancelled",
};

export function DeliveriesPageClient({
  initialItems,
  initialTotal,
  storeOptions,
  carriers,
  canShip,
  canPod,
}: Props) {
  const t = useTranslations("deliveryShipments");
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [isPending, startTransition] = useTransition();
  const [trackingShipmentId, setTrackingShipmentId] = useState<string | null>(null);
  const [completingShipmentId, setCompletingShipmentId] = useState<string | null>(null);

  const hasFilters =
    !!filters.status || !!filters.method || !!filters.storeId || !!filters.dateFrom || !!filters.dateTo;

  function refetch(nextPage: number, nextFilters: Filters): void {
    startTransition(async () => {
      try {
        const result = await listShipmentsAction({
          status: nextFilters.status ? (nextFilters.status as any) : undefined,
          method: nextFilters.method ? (nextFilters.method as any) : undefined,
          storeId: nextFilters.storeId || undefined,
          dateFrom: nextFilters.dateFrom || undefined,
          dateTo: nextFilters.dateTo || undefined,
          page: nextPage,
          pageSize: DEFAULT_PAGE_SIZE,
        });
        setItems(result.items);
        setTotal(result.total);
        setPage(nextPage);
      } catch {
        toast.error("Failed to load deliveries");
      }
    });
  }

  /** Every control funnels through here so a filter change always resets to page 1. */
  function applyFilters(patch: Partial<Filters>): void {
    const next = { ...filters, ...patch };
    setFilters(next);
    refetch(1, next);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col flex-wrap gap-3 sm:flex-row sm:items-center">
        <Select
          value={filters.status}
          disabled={isPending}
          onValueChange={(v) => applyFilters({ status: v === "ALL" ? "" : v })}
        >
          <SelectTrigger className="h-10 w-full sm:w-[180px]">
            <SelectValue placeholder={t("filterStatus")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("filterStatus")}</SelectItem>
            <SelectItem value="PACKED">{t("statusPacked")}</SelectItem>
            <SelectItem value="IN_TRANSIT">{t("statusInTransit")}</SelectItem>
            <SelectItem value="DELIVERED">{t("statusDelivered")}</SelectItem>
            <SelectItem value="PARTIALLY_DELIVERED">{t("statusPartiallyDelivered")}</SelectItem>
            <SelectItem value="CANCELLED">{t("statusCancelled")}</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.method}
          disabled={isPending}
          onValueChange={(v) => applyFilters({ method: v === "ALL" ? "" : v })}
        >
          <SelectTrigger className="h-10 w-full sm:w-[180px]">
            <SelectValue placeholder={t("filterMethod")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("filterMethod")}</SelectItem>
            <SelectItem value="EXPEDITION">{t("methodExpedition")}</SelectItem>
            <SelectItem value="SALESMAN_CARRY">{t("methodSalesmanCarry")}</SelectItem>
          </SelectContent>
        </Select>
        <SearchableCombobox
          options={[
            { value: ALL_STORES, label: t("filterStore") },
            ...storeOptions.map((s) => ({ value: s.id, label: s.name })),
          ]}
          value={filters.storeId || ALL_STORES}
          disabled={isPending}
          onValueChange={(v) => applyFilters({ storeId: v === ALL_STORES ? "" : v })}
          placeholder={t("filterStore")}
          searchPlaceholder={t("storeSearchPlaceholder")}
          emptyMessage={t("storeSearchEmpty")}
          triggerClassName="h-10 w-full sm:w-[220px]"
        />
        <Input
          type="date"
          value={filters.dateFrom}
          max={filters.dateTo || undefined}
          disabled={isPending}
          onChange={(e) => applyFilters({ dateFrom: e.target.value })}
          className="h-10 w-full sm:w-[160px]"
          aria-label={t("filterDateFrom")}
        />
        <Input
          type="date"
          value={filters.dateTo}
          min={filters.dateFrom || undefined}
          disabled={isPending}
          onChange={(e) => applyFilters({ dateTo: e.target.value })}
          className="h-10 w-full sm:w-[160px]"
          aria-label={t("filterDateTo")}
        />
        {hasFilters && (
          <Button
            variant="ghost"
            className="h-10"
            disabled={isPending}
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              refetch(1, EMPTY_FILTERS);
            }}
          >
            {t("reset")}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <Truck className="h-5 w-5" />
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={isPending ? "opacity-60 pointer-events-none" : ""}>
            {items.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("docNo")}</TableHead>
                      <TableHead>{t("order")}</TableHead>
                      <TableHead>{t("store")}</TableHead>
                      <TableHead>{t("method")}</TableHead>
                      <TableHead>{t("status")}</TableHead>
                      <TableHead>{t("resi")}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.docNo}</TableCell>
                        <TableCell>{item.orderNo}</TableCell>
                        <TableCell className="max-w-[160px] truncate">{item.storeName}</TableCell>
                        <TableCell>
                          {item.method === "EXPEDITION" ? t("methodExpedition") : t("methodSalesmanCarry")}
                        </TableCell>
                        <TableCell>
                          <Badge className={STATUS_BADGE[item.status] ?? ""}>
                            {t(STATUS_LABEL_KEY[item.status] ?? "statusPacked")}
                          </Badge>
                        </TableCell>
                        <TableCell>{item.resiNumber ?? "-"}</TableCell>
                        <TableCell className="text-right">
                          {/**
                           * Both buttons are permission-gated, and on the permission the action
                           * they open actually checks — tracking/ship/cancel are
                           * `deliveries:ship`, completion is `deliveries:pod`. Either can be held
                           * without the other, so an ungated button here is a button that 403s on
                           * submit with nothing explaining why.
                           */}
                          {canShip && item.status === "PACKED" && (
                            <Button size="sm" variant="outline" onClick={() => setTrackingShipmentId(item.id)}>
                              {t("editTracking")}
                            </Button>
                          )}
                          {canPod && item.status === "IN_TRANSIT" && (
                            <Button size="sm" onClick={() => setCompletingShipmentId(item.id)}>
                              {t("complete")}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Pagination
                  page={page}
                  totalPages={Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE))}
                  onPageChange={(p) => refetch(p, filters)}
                  totalCount={total}
                  pageSize={DEFAULT_PAGE_SIZE}
                />
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {trackingShipmentId && (
        <ShipmentTrackingDialog
          shipmentId={trackingShipmentId}
          open={!!trackingShipmentId}
          onOpenChange={(open) => !open && setTrackingShipmentId(null)}
          onDone={() => refetch(page, filters)}
          carriers={carriers}
        />
      )}
      {completingShipmentId && (
        <CompleteShipmentDialog
          shipmentId={completingShipmentId}
          open={!!completingShipmentId}
          onOpenChange={(open) => !open && setCompletingShipmentId(null)}
          onDone={() => refetch(page, filters)}
        />
      )}
    </div>
  );
}
