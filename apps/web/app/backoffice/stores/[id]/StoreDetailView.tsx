"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  Clock,
  ExternalLink,
  Images,
  MapPin,
  Phone,
  ShoppingBag,
  Store,
  User as UserIcon,
} from "lucide-react";
import type { StoreListItem } from "@/lib/stores/queries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StoreForm } from "../StoreForm";
import { StoreChangeReviewCard } from "./StoreChangeReviewCard";

type PendingChangeFields = { name: string; address: string; phone: string | null; contactName: string | null; lat: number | null; lng: number | null };

type OrderRow = {
  id: string;
  orderNo: string;
  orderType: "PUTUS" | "KONSI";
  status: "PENDING_APPROVAL" | "APPROVED";
  total: number;
  createdAtIso: string;
};

type Visit = {
  id: string;
  checkinAtIso: string;
  checkoutAtIso: string | null;
  checkinLat: number;
  checkinLng: number;
  autoClosed: boolean;
  userLabel: string;
  checkinOutOfRadius: boolean;
  checkinDistanceMeters: number | null;
  photos: Array<{ id: string; url: string; caption: string | null; capturedAtIso: string }>;
};

type Props = {
  store: StoreListItem;
  canEdit: boolean;
  visits: Visit[];
  orders: OrderRow[];
  pendingChange: {
    requestId: string;
    requestedByLabel: string;
    proposed: PendingChangeFields;
    old: PendingChangeFields;
  } | null;
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

const ORDER_STATUS_LABEL: Record<"PENDING_APPROVAL" | "APPROVED", "statusPending" | "statusApproved"> = {
  PENDING_APPROVAL: "statusPending",
  APPROVED: "statusApproved",
};

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return "—";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}

export function StoreDetailView({ store, canEdit, visits, orders, pendingChange }: Props) {
  const t = useTranslations("stores");
  const tBadge = useTranslations("stores.badge");
  const tDetail = useTranslations("stores.detail");
  const tTable = useTranslations("stores.list.table");
  const tOrders = useTranslations("stores.orders");
  const tFso = useTranslations("fieldSalesOrders");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [lightbox, setLightbox] = useState<{ url: string; caption: string | null } | null>(null);
  const [gallery, setGallery] = useState<{ label: string; photos: Array<{ id: string; url: string; caption: string | null; capturedAtIso: string }> } | null>(null);

  const totalVisits = visits.length;
  const lastVisit = visits[0];

  return (
    <div className="space-y-6">
      <div className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/backoffice/stores">
            <ArrowLeft className="h-4 w-4" />
            {t("title")}
          </Link>
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{store.name}</h1>
            <Badge variant={store.isActive ? "default" : "outline"}>
              {store.isActive ? tTable("active") : tBadge("inactive")}
            </Badge>
            <Badge variant={store.termsType === "PUTUS" ? "outline" : "secondary"}>
              {store.termsType === "PUTUS" ? tBadge("putus") : tBadge("konsi")}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground font-mono">{store.code}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6 min-w-0">
          {pendingChange && (
            <StoreChangeReviewCard
              requestId={pendingChange.requestId}
              storeId={store.id}
              requestedByLabel={pendingChange.requestedByLabel}
              proposed={pendingChange.proposed}
              old={pendingChange.old}
              canManage={canEdit}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{tDetail("editTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <StoreForm
                key={String(store.updatedAt)}
                mode="edit"
                storeId={store.id}
                readOnly={!canEdit}
                hideHeader
                initial={{
                  code: store.code,
                  name: store.name,
                  address: store.address,
                  phone: store.phone,
                  contactName: store.contactName,
                  termsType: store.termsType,
                  paymentTempo: store.paymentTempo,
                  marginPercent: store.marginPercent,
                  lat: store.lat,
                  lng: store.lng,
                  checkinRadiusMeters: store.checkinRadiusMeters,
                  isActive: store.isActive,
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4" />
                {tDetail("historyTitle")}
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  ({totalVisits})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {visits.length === 0 ? (
                <div className="text-center py-8">
                  <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">{tDetail("noVisits")}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tDetail("visitTable.checkin")}</TableHead>
                        <TableHead>{tDetail("visitTable.checkout")}</TableHead>
                        <TableHead>{tDetail("visitTable.duration")}</TableHead>
                        <TableHead>{tDetail("visitTable.user")}</TableHead>
                        <TableHead>{tDetail("visitTable.coords")}</TableHead>
                        <TableHead>Foto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visits.map(v => (
                        <TableRow key={v.id}>
                          <TableCell className="whitespace-nowrap">{formatDateTime(v.checkinAtIso)}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {v.checkoutAtIso ? (
                              formatDateTime(v.checkoutAtIso)
                            ) : (
                              <Badge variant="secondary">{tDetail("stillOpen")}</Badge>
                            )}
                            {v.autoClosed && (
                              <Badge variant="outline" className="ml-2">{tDetail("autoClosed")}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">
                            {formatDuration(v.checkinAtIso, v.checkoutAtIso)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{v.userLabel}</TableCell>
                          <TableCell>
                            <a
                              href={`https://www.google.com/maps?q=${v.checkinLat},${v.checkinLng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
                            >
                              <MapPin className="h-3 w-3" />
                              {v.checkinLat.toFixed(4)}, {v.checkinLng.toFixed(4)}
                            </a>
                            {v.checkinOutOfRadius && (
                              <Badge variant="outline" className="ml-2 border-amber-500/40 text-amber-700">
                                {tDetail("visitTable.outOfRadius")}{v.checkinDistanceMeters !== null ? ` · ${v.checkinDistanceMeters} m` : ""}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {v.photos.length > 0 ? (
                              <Button
                                variant="outline"
                                className="gap-1.5"
                                onClick={() => setGallery({ label: formatDateTime(v.checkinAtIso), photos: v.photos })}
                              >
                                <Images className="h-4 w-4" /> {v.photos.length} foto
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingBag className="h-4 w-4" />
                {tOrders("cardTitle")}
                <span className="text-sm font-normal text-muted-foreground ml-2">({orders.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {orders.length === 0 ? (
                <div className="text-center py-8">
                  <ShoppingBag className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">{tOrders("empty")}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tOrders("colOrderNo")}</TableHead>
                        <TableHead>{tOrders("colType")}</TableHead>
                        <TableHead>{tOrders("colStatus")}</TableHead>
                        <TableHead>{tOrders("colDate")}</TableHead>
                        <TableHead className="text-right">{tOrders("colTotal")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map(o => (
                        <TableRow
                          key={o.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => startTransition(() => router.push(`/backoffice/field-sales-orders/${o.id}`))}
                        >
                          <TableCell className="font-mono text-xs">{o.orderNo}</TableCell>
                          <TableCell>
                            <Badge variant={o.orderType === "PUTUS" ? "outline" : "secondary"}>
                              {o.orderType === "KONSI" ? tFso("typeKonsi") : tFso("typePutus")}
                            </Badge>
                          </TableCell>
                          <TableCell><Badge variant="outline">{tFso(ORDER_STATUS_LABEL[o.status])}</Badge></TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(o.createdAtIso)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {o.orderType === "KONSI" && o.status !== "APPROVED" ? "—" : formatRupiah(o.total)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{tDetail("infoTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="flex-1">{store.address}</span>
                </div>
                {store.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                    <a href={`tel:${store.phone}`} className="hover:underline">{store.phone}</a>
                  </div>
                )}
                {store.contactName && (
                  <div className="flex items-center gap-2">
                    <UserIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span>{store.contactName}</span>
                  </div>
                )}
              </div>

              {store.lat !== null && store.lng !== null && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground font-mono">
                      {store.lat}, {store.lng}
                    </p>
                    <Button asChild variant="outline" size="sm" className="w-full">
                      <a
                        href={`https://www.google.com/maps?q=${store.lat},${store.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MapPin className="h-3 w-3" />
                        {tDetail("openInMaps")}
                        <ExternalLink className="ml-auto h-3 w-3" />
                      </a>
                    </Button>
                  </div>
                </>
              )}

              <Separator />

              <dl className="space-y-3">
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <Store className="h-4 w-4" />
                    {tDetail("stats.totalVisits")}
                  </dt>
                  <dd className="font-semibold tabular-nums">{totalVisits}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="flex items-center gap-2 text-muted-foreground shrink-0">
                    <Clock className="h-4 w-4" />
                    {tDetail("stats.lastVisit")}
                  </dt>
                  <dd className="text-right text-xs">
                    {lastVisit ? formatDateTime(lastVisit.checkinAtIso) : tDetail("noVisits")}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <UserIcon className="h-4 w-4" />
                    {tDetail("stats.terms")}
                  </dt>
                  <dd className="text-right tabular-nums">
                    {store.paymentTempo}d · {store.marginPercent ?? "—"}%
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </aside>
      </div>

      <Dialog open={!!gallery} onOpenChange={(o) => !o && setGallery(null)}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>Foto Kunjungan{gallery ? ` — ${gallery.label}` : ""}</DialogTitle>
          {gallery && (
            <div className="grid max-h-[70vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
              {gallery.photos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setLightbox({ url: p.url, caption: p.caption })}
                  className="space-y-1 text-left"
                  aria-label={p.caption ?? "Foto kunjungan"}
                >
                  <div className="aspect-square overflow-hidden rounded-md border bg-muted">
                    <img src={p.url} alt={p.caption ?? ""} className="h-full w-full object-cover" loading="lazy" />
                  </div>
                  {p.caption && <p className="truncate text-xs text-muted-foreground">{p.caption}</p>}
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="max-w-lg">
          <DialogTitle className="sr-only">Foto kunjungan</DialogTitle>
          {lightbox && (
            <div className="space-y-2">
              <img src={lightbox.url} alt={lightbox.caption ?? ""} className="max-h-[70vh] w-full rounded-md object-contain" />
              {lightbox.caption && <p className="text-sm text-muted-foreground">{lightbox.caption}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
