"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeft, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import type { DeliveryShipmentDetail } from "@/lib/delivery/shipment-queries";
import { SHIPMENT_STATUS_BADGE, SHIPMENT_STATUS_LABEL_KEY } from "@/lib/delivery/shipment-status-display";
import { ShipmentPhotoPanel } from "./ShipmentPhotoPanel";

type Props = {
  shipment: DeliveryShipmentDetail;
};

function formatDateTime(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

export function ShipmentDetailClient({ shipment }: Props) {
  const t = useTranslations("deliveryShipments");
  const td = useTranslations("deliveryShipments.detail");
  const locale = useLocale();

  const isCarry = shipment.method === "SALESMAN_CARRY";
  const isKonsi = shipment.orderType === "KONSI";
  const isCompleted = shipment.status === "DELIVERED" || shipment.status === "PARTIALLY_DELIVERED";
  const isCancelled = shipment.status === "CANCELLED";
  const hasGps = shipment.gpsLat !== null && shipment.gpsLng !== null;
  const unknownActor = td("actorUnknown");

  /* Photo empty-state copy follows what the shipment could have collected, not just "missing". */
  let goodsEmpty = td("noPhotoYet");
  if (isCancelled) goodsEmpty = td("photoCancelled");
  else if (isCompleted) goodsEmpty = td("noPhotoRecorded");

  let notaEmpty = td("noPhotoYet");
  if (!isCarry) notaEmpty = td("notaNotRequired");
  else if (isCancelled) notaEmpty = td("photoCancelled");
  else if (isCompleted) notaEmpty = td("noPhotoRecorded");

  let gpsEmpty = td("gpsPending");
  if (!isCarry) gpsEmpty = td("gpsNotRequired");
  else if (isCancelled) gpsEmpty = td("photoCancelled");
  else if (isCompleted) gpsEmpty = td("gpsNone");

  const timeline: Array<{ key: string; label: string; actor: string | null; at: Date | null }> = [
    { key: "packed", label: td("packed"), actor: shipment.packedByName, at: shipment.packedAt },
    { key: "shipped", label: td("shipped"), actor: shipment.shippedByName, at: shipment.shippedAt },
    { key: "delivered", label: td("delivered"), actor: shipment.deliveredByName, at: shipment.deliveredAt },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" className="h-10" asChild>
          <Link href="/backoffice/deliveries">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {td("back")}
          </Link>
        </Button>
        <h1 className="min-w-0 max-w-full truncate font-mono text-2xl font-semibold" title={shipment.docNo}>
          {shipment.docNo}
        </h1>
        <Badge className={SHIPMENT_STATUS_BADGE[shipment.status] ?? ""}>
          {t(SHIPMENT_STATUS_LABEL_KEY[shipment.status] ?? "statusPacked")}
        </Badge>
        <Badge variant="outline">
          {isCarry ? t("methodSalesmanCarry") : t("methodExpedition")}
        </Badge>
        {isKonsi && <Badge variant="outline">{t("typeKonsi")}</Badge>}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{td("detailsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <dl className="space-y-3">
              <DetailRow label={t("store")}>
                <span className="block truncate" title={shipment.storeName}>{shipment.storeName}</span>
              </DetailRow>
              <DetailRow label={t("order")}>
                <Link
                  href={`/backoffice/field-sales-orders/${shipment.orderId}`}
                  className="font-mono underline-offset-4 hover:underline"
                >
                  {shipment.orderNo}
                </Link>
              </DetailRow>
              {isCarry ? (
                <DetailRow label={t("carriedByLabel")}>
                  {shipment.carriedByName ?? <Dash />}
                </DetailRow>
              ) : (
                <>
                  <DetailRow label={t("carrier")}>{shipment.carrierName ?? <Dash />}</DetailRow>
                  <DetailRow label={t("resi")}>{shipment.resiNumber ?? <Dash />}</DetailRow>
                </>
              )}
              {!isKonsi && (
                <>
                  <DetailRow label={t("invoiceDateLabel")}>
                    {shipment.invoiceDate ? formatDateOnlyJakarta(shipment.invoiceDate) : <Dash />}
                  </DetailRow>
                  <DetailRow label={t("dueDateLabel2")}>
                    {shipment.dueDate ? formatDateOnlyJakarta(shipment.dueDate) : <Dash />}
                  </DetailRow>
                </>
              )}
              <DetailRow label={isKonsi ? td("konsiTransfer") : td("accountingRecord")}>
                {(isKonsi ? shipment.konsiTransferDocNo : shipment.accountingDocNo) ?? (
                  <span className="text-muted-foreground">{td("notCreated")}</span>
                )}
              </DetailRow>
            </dl>

            <div className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-medium">{td("timelineTitle")}</h3>
              <dl className="space-y-3">
                {timeline.map((step) => (
                  <DetailRow key={step.key} label={step.label}>
                    {step.at ? (
                      <>
                        <span className="tabular-nums">{formatDateTime(step.at, locale)} WIB</span>
                        <span className="text-muted-foreground"> · {step.actor ?? unknownActor}</span>
                      </>
                    ) : (
                      <Dash />
                    )}
                  </DetailRow>
                ))}
              </dl>
              {shipment.completedOfflineAt && (
                <p className="text-sm text-muted-foreground">
                  {td("completedOffline", { at: `${formatDateTime(shipment.completedOfflineAt, locale)} WIB` })}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{td("proofTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <ShipmentPhotoPanel
                title={td("goodsPhoto")}
                url={shipment.goodsPhoto.url}
                unavailable={shipment.goodsPhoto.unavailable}
                emptyText={goodsEmpty}
              />
              <ShipmentPhotoPanel
                title={td("notaPhoto")}
                url={shipment.notaPhoto.url}
                unavailable={shipment.notaPhoto.unavailable}
                emptyText={notaEmpty}
                caption={
                  shipment.signedByName ? td("receivedBy", { name: shipment.signedByName }) : null
                }
              />
            </div>

            <div className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-medium">{td("gpsTitle")}</h3>
              {hasGps ? (
                <>
                  <dl className="space-y-3">
                    <DetailRow label={td("coordinates")}>
                      <span className="tabular-nums">
                        {shipment.gpsLat}, {shipment.gpsLng}
                      </span>
                    </DetailRow>
                    <DetailRow label={td("distanceFromStore")}>
                      {shipment.gpsDistanceMeters === null ? (
                        <Dash />
                      ) : (
                        <span className="tabular-nums">
                          {td("meters", { value: shipment.gpsDistanceMeters })}
                        </span>
                      )}
                    </DetailRow>
                    {shipment.storeCheckinRadiusMeters !== null && (
                      <DetailRow label={td("storeRadius")}>
                        <span className="tabular-nums">
                          {td("meters", { value: shipment.storeCheckinRadiusMeters })}
                        </span>
                      </DetailRow>
                    )}
                  </dl>
                  <Button variant="outline" className="h-10" asChild>
                    <a
                      href={`https://www.google.com/maps?q=${shipment.gpsLat},${shipment.gpsLng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MapPin className="mr-2 h-4 w-4" />
                      {td("openInMaps")}
                    </a>
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{gpsEmpty}</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{td("linesTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {shipment.lines.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{td("noLines")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{td("product")}</TableHead>
                  <TableHead>{td("variant")}</TableHead>
                  <TableHead className="text-right">{t("plannedQty")}</TableHead>
                  <TableHead className="text-right">{t("deliveredQty")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shipment.lines.map((line) => {
                  const isShort = line.deliveredQty !== null && line.deliveredQty < line.plannedQty;
                  return (
                    <TableRow key={line.id}>
                      <TableCell className="max-w-[240px] truncate" title={line.productName}>
                        {line.productName || <Dash />}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{line.variantSku || <Dash />}</TableCell>
                      <TableCell className="text-right tabular-nums">{line.plannedQty}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${isShort ? "font-medium text-amber-700" : ""}`}
                      >
                        {line.deliveredQty === null ? (
                          <Dash />
                        ) : (
                          <span className="inline-flex items-center justify-end gap-1">
                            {isShort && (
                              <AlertTriangle
                                className="h-4 w-4"
                                aria-label={td("shortDelivered")}
                              />
                            )}
                            {line.deliveredQty}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
