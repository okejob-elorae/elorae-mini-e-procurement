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
  Package,
  Pencil,
  Phone,
  ShoppingBag,
  Store,
  User as UserIcon,
} from "lucide-react";
import type { StoreListItem } from "@/lib/stores/queries";
import type { StoreSentItemRow } from "@/lib/field-sales/queries";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { StoreChangeReviewCard } from "./StoreChangeReviewCard";
import { StoreStockCard } from "./StoreStockCard";
import type { StoreStockCardData } from "@/lib/inventory/store-stock-card";

let lastMapsOpenAt = 0;

function openStoreInMaps(lat: number, lng: number) {
  const now = Date.now();
  if (now - lastMapsOpenAt < 500) return;
  lastMapsOpenAt = now;
  window.open(
    `https://www.google.com/maps?q=${lat},${lng}`,
    "_blank",
    "noopener,noreferrer",
  );
}

type PendingChangeFields = {
  name: string;
  address: string;
  phone: string | null;
  contactName: string | null;
  lat: number | null;
  lng: number | null;
};

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

type SerializedStockMovement = Omit<StoreStockCardData["movements"][number], "occurredAt"> & {
  occurredAtIso: string;
};

type StockCardProps = {
  rows: StoreStockCardData["rows"];
  negativeCount: number;
  movements: SerializedStockMovement[];
};

type Props = {
  store: StoreListItem;
  canEdit: boolean;
  visits: Visit[];
  orders: OrderRow[];
  sentItems: StoreSentItemRow[];
  /** Only ever populated for a KONSI store — a PUTUS store never has a stock ledger to show. */
  stockCard: StockCardProps | null;
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

function groupSentItemsByArticle(
  rows: StoreSentItemRow[],
): Array<{ articleSku: string; articleName: string; variants: Array<{ variantSku: string; totalQty: number }> }> {
  const groups: Array<{
    articleSku: string;
    articleName: string;
    variants: Array<{ variantSku: string; totalQty: number }>;
  }> = [];
  const indexByArticle = new Map<string, number>();
  for (const row of rows) {
    let idx = indexByArticle.get(row.itemId);
    if (idx === undefined) {
      idx = groups.length;
      indexByArticle.set(row.itemId, idx);
      groups.push({ articleSku: row.articleSku, articleName: row.articleName, variants: [] });
    }
    groups[idx].variants.push({ variantSku: row.variantSku, totalQty: row.totalQty });
  }
  return groups;
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function StoreDetailView({ store, canEdit, visits, orders, sentItems, stockCard, pendingChange }: Props) {
  const t = useTranslations("stores");
  const tBadge = useTranslations("stores.badge");
  const tDetail = useTranslations("stores.detail");
  const tForm = useTranslations("stores.form");
  const tTable = useTranslations("stores.list.table");
  const tOrders = useTranslations("stores.orders");
  const tSentItems = useTranslations("stores.sentItems");
  const tFso = useTranslations("fieldSalesOrders");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [lightbox, setLightbox] = useState<{ url: string; caption: string | null } | null>(null);
  const [gallery, setGallery] = useState<{
    label: string;
    photos: Array<{ id: string; url: string; caption: string | null; capturedAtIso: string }>;
  } | null>(null);

  const totalVisits = visits.length;
  const lastVisit = visits[0];
  const sentItemGroups = groupSentItemsByArticle(sentItems);

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
        {canEdit && (
          <Button asChild>
            <Link href={`/backoffice/stores/${store.id}/edit`}>
              <Pencil className="h-4 w-4" />
              {tDetail("editButton")}
            </Link>
          </Button>
        )}
      </div>

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
          <CardTitle className="flex items-center gap-2 text-base">
            <Store className="h-4 w-4" />
            {tDetail("infoTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {tForm("sections.contact")}
            </h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              <DetailField label={tForm("phone")}>
                {store.phone ? (
                  <a href={`tel:${store.phone}`} className="inline-flex items-center gap-1.5 hover:underline">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    {store.phone}
                  </a>
                ) : (
                  "—"
                )}
              </DetailField>
              <DetailField label={tForm("contactName")}>
                {store.contactName ? (
                  <span className="inline-flex items-center gap-1.5">
                    <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    {store.contactName}
                  </span>
                ) : (
                  "—"
                )}
              </DetailField>
            </dl>
          </section>

          <Separator />

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {tForm("sections.location")}
            </h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              <DetailField label={tForm("address")}>
                <span className="whitespace-pre-wrap">{store.address}</span>
              </DetailField>
              <DetailField label={tDetail("locationLabel")}>
                {store.lat !== null && store.lng !== null ? (
                  <div className="space-y-2">
                    <p className="font-mono text-xs text-muted-foreground">
                      {store.lat}, {store.lng}
                    </p>
                    <a
                      href={`https://www.google.com/maps?q=${store.lat},${store.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openStoreInMaps(store.lat!, store.lng!);
                      }}
                    >
                      <MapPin className="h-3 w-3" />
                      {tDetail("openInMaps")}
                      <ExternalLink className="ml-1 h-3 w-3" />
                    </a>
                  </div>
                ) : (
                  tDetail("noLocation")
                )}
              </DetailField>
              <DetailField label={tForm("checkinRadius")}>
                {store.checkinRadiusMeters !== null
                  ? tDetail("checkinRadiusValue", { meters: store.checkinRadiusMeters })
                  : tDetail("checkinRadiusDefault")}
              </DetailField>
            </dl>
          </section>

          <Separator />

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {tForm("sections.terms")}
            </h3>
            <dl className="grid gap-4 sm:grid-cols-3">
              <DetailField label={tForm("termsType")}>
                {store.termsType === "PUTUS" ? tForm("termsPutus") : tForm("termsKonsi")}
              </DetailField>
              <DetailField label={tForm("paymentTempo")}>{store.paymentTempo}</DetailField>
              <DetailField label={tForm("marginPercent")}>
                {store.marginPercent !== null ? `${store.marginPercent}%` : "—"}
              </DetailField>
            </dl>
          </section>

          <Separator />

          <dl className="grid gap-4 sm:grid-cols-3">
            <DetailField label={tDetail("stats.totalVisits")}>
              <span className="font-semibold tabular-nums">{totalVisits}</span>
            </DetailField>
            <DetailField label={tDetail("stats.lastVisit")}>
              {lastVisit ? formatDateTime(lastVisit.checkinAtIso) : tDetail("noVisits")}
            </DetailField>
            <DetailField label={tDetail("stats.terms")}>
              <span className="tabular-nums">
                {store.paymentTempo}d · {store.marginPercent ?? "—"}%
              </span>
            </DetailField>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" />
            {tDetail("historyTitle")}
            <span className="text-sm font-normal text-muted-foreground ml-2">({totalVisits})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {visits.length === 0 ? (
            <div className="text-center py-8">
              <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">{tDetail("noVisits")}</p>
            </div>
          ) : (
            <div className="overflow-auto max-h-96 rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
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
                  {visits.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="whitespace-nowrap">{formatDateTime(v.checkinAtIso)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {v.checkoutAtIso ? (
                          formatDateTime(v.checkoutAtIso)
                        ) : (
                          <Badge variant="secondary">{tDetail("stillOpen")}</Badge>
                        )}
                        {v.autoClosed && (
                          <Badge variant="outline" className="ml-2">
                            {tDetail("autoClosed")}
                          </Badge>
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
                            {tDetail("visitTable.outOfRadius")}
                            {v.checkinDistanceMeters !== null ? ` · ${v.checkinDistanceMeters} m` : ""}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {v.photos.length > 0 ? (
                          <Button
                            variant="outline"
                            className="gap-1.5"
                            onClick={() =>
                              setGallery({ label: formatDateTime(v.checkinAtIso), photos: v.photos })
                            }
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
                  {orders.map((o) => (
                    <TableRow
                      key={o.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() =>
                        startTransition(() => router.push(`/backoffice/field-sales-orders/${o.id}`))
                      }
                    >
                      <TableCell className="font-mono text-xs">{o.orderNo}</TableCell>
                      <TableCell>
                        <Badge variant={o.orderType === "PUTUS" ? "outline" : "secondary"}>
                          {o.orderType === "KONSI" ? tFso("typeKonsi") : tFso("typePutus")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{tFso(ORDER_STATUS_LABEL[o.status])}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(o.createdAtIso)}
                      </TableCell>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" />
            {tSentItems("cardTitle")}
            <span className="text-sm font-normal text-muted-foreground ml-2">({sentItems.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sentItems.length === 0 ? (
            <div className="text-center py-8">
              <Package className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">{tSentItems("empty")}</p>
            </div>
          ) : (
            <div className="overflow-auto max-h-96 rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead>{tSentItems("colArticle")}</TableHead>
                    <TableHead>{tSentItems("colSize")}</TableHead>
                    <TableHead className="text-right">{tSentItems("colQtySent")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sentItemGroups.map((group) =>
                    group.variants.map((v, i) => (
                      <TableRow key={`${group.articleSku}-${v.variantSku}`}>
                        <TableCell className="text-xs">
                          {i === 0 ? (
                            <>
                              <span className="font-mono">{group.articleSku}</span>
                              <span className="text-muted-foreground"> — {group.articleName}</span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">↳</span>
                          )}
                        </TableCell>
                        <TableCell>{v.variantSku}</TableCell>
                        <TableCell className="text-right tabular-nums">{v.totalQty}</TableCell>
                      </TableRow>
                    )),
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {store.termsType === "KONSI" && stockCard && (
        <StoreStockCard
          rows={stockCard.rows}
          negativeCount={stockCard.negativeCount}
          movements={stockCard.movements}
        />
      )}

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
              <img
                src={lightbox.url}
                alt={lightbox.caption ?? ""}
                className="max-h-[70vh] w-full rounded-md object-contain"
              />
              {lightbox.caption && <p className="text-sm text-muted-foreground">{lightbox.caption}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
