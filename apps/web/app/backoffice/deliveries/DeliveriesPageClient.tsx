"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

type Props = { initialItems: ShipmentRow[]; initialTotal: number };

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

export function DeliveriesPageClient({ initialItems, initialTotal }: Props) {
  const t = useTranslations("deliveryShipments");
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("");
  const [method, setMethod] = useState<string>("");
  const [isPending, startTransition] = useTransition();
  const [trackingShipmentId, setTrackingShipmentId] = useState<string | null>(null);
  const [completingShipmentId, setCompletingShipmentId] = useState<string | null>(null);

  function refetch(nextPage: number, nextStatus: string, nextMethod: string): void {
    startTransition(async () => {
      try {
        const result = await listShipmentsAction({
          status: nextStatus ? (nextStatus as any) : undefined,
          method: nextMethod ? (nextMethod as any) : undefined,
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={status}
          disabled={isPending}
          onValueChange={(v) => {
            const next = v === "ALL" ? "" : v;
            setStatus(next);
            refetch(1, next, method);
          }}
        >
          <SelectTrigger className="w-[180px]">
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
          value={method}
          disabled={isPending}
          onValueChange={(v) => {
            const next = v === "ALL" ? "" : v;
            setMethod(next);
            refetch(1, status, next);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("filterMethod")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("filterMethod")}</SelectItem>
            <SelectItem value="EXPEDITION">{t("methodExpedition")}</SelectItem>
            <SelectItem value="SALESMAN_CARRY">{t("methodSalesmanCarry")}</SelectItem>
          </SelectContent>
        </Select>
        {(status || method) && (
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => {
              setStatus("");
              setMethod("");
              refetch(1, "", "");
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
                          {item.status === "PACKED" && (
                            <Button size="sm" variant="outline" onClick={() => setTrackingShipmentId(item.id)}>
                              {t("editTracking")}
                            </Button>
                          )}
                          {item.status === "IN_TRANSIT" && (
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
                  onPageChange={(p) => refetch(p, status, method)}
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
          onDone={() => refetch(page, status, method)}
        />
      )}
      {completingShipmentId && (
        <CompleteShipmentDialog
          shipmentId={completingShipmentId}
          open={!!completingShipmentId}
          onOpenChange={(open) => !open && setCompletingShipmentId(null)}
          onDone={() => refetch(page, status, method)}
        />
      )}
    </div>
  );
}
