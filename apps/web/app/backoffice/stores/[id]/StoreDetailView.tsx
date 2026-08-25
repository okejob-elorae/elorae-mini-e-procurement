"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowLeft,
  ClipboardList,
  Clock,
  ExternalLink,
  Images,
  MapPin,
  Package,
  Pencil,
  Phone,
  ShoppingBag,
  Store,
  Undo2,
  User as UserIcon,
} from "lucide-react";
import type { StoreListItem } from "@/lib/stores/queries";
import type { StoreSentItemRow } from "@/lib/field-sales/queries";
import type { StoreStocktakeStatusValue } from "@/lib/stores/stocktake/queries";
import { createAction as createStocktakeAction } from "@/app/actions/store-stocktakes";
import { raiseAdminReturnAction, type RaiseAdminReturnActionResult } from "@/app/actions/field-returns";
import { FIELD_RETURN_REASONS, type FieldReturnLineInput, type FieldReturnReasonInput } from "@/lib/field-sales/retur/types";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StoreChangeReviewCard } from "./StoreChangeReviewCard";
import { StoreStockCard, type SerializedStockMovement } from "./StoreStockCard";
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

type StockCardProps = {
  rows: StoreStockCardData["rows"];
  negativeCount: number;
  inTransitAdminReturn: { raisedQty: number; receivedQty: number };
  movements: SerializedStockMovement[];
};

/** One row of the admin return picker's draft state, keyed by `${itemId}::${variantSku}`. */
type RaiseLineDraft = {
  itemId: string;
  variantSku: string;
  itemName: string;
  qtyRaw: string;
  reason: FieldReturnReasonInput;
  reasonNote: string;
};

type StocktakeHistoryRow = {
  id: string;
  docNo: string;
  status: StoreStocktakeStatusValue;
  countedAtIso: string;
  lineCount: number;
  countedLineCount: number;
};

type StocktakesCardProps = {
  rows: StocktakeHistoryRow[];
  total: number;
  /** The store's currently open (DRAFT / PENDING_VERIFICATION) document, if any. */
  openId: string | null;
};

type Props = {
  store: StoreListItem;
  canEdit: boolean;
  canManageFieldReturns: boolean;
  visits: Visit[];
  orders: OrderRow[];
  sentItems: StoreSentItemRow[];
  /** Only ever populated for a KONSI store — a PUTUS store never has a stock ledger to show. */
  stockCard: StockCardProps | null;
  /** Only ever populated for a KONSI store — same gate as `stockCard`. */
  stocktakes: StocktakesCardProps | null;
  pendingChange: {
    requestId: string;
    requestedByLabel: string;
    proposed: PendingChangeFields;
    old: PendingChangeFields;
  } | null;
};

const STOCKTAKE_STATUS_BADGE_VARIANT: Record<StoreStocktakeStatusValue, "secondary" | "destructive" | "default" | "outline"> = {
  DRAFT: "secondary",
  PENDING_VERIFICATION: "outline",
  APPROVED: "default",
  CANCELLED: "destructive",
};

const STOCKTAKE_STATUS_BADGE_CLASS: Record<StoreStocktakeStatusValue, string> = {
  DRAFT: "",
  PENDING_VERIFICATION: "border-amber-500/40 text-amber-700",
  APPROVED: "",
  CANCELLED: "",
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

function raiseLineKey(itemId: string, variantSku: string): string {
  return `${itemId}::${variantSku}`;
}

/**
 * A non-negative integer only — `FieldReturnLine.qty` is an `Int` column. `null` means invalid,
 * never silently rounded or clamped, so a garbled entry blocks submit instead of being dropped.
 */
function parseRaiseQty(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  return Number.isSafeInteger(n) ? n : null;
}

type RaiseAdminReturnErrorCode = Exclude<RaiseAdminReturnActionResult, { ok: true }>["code"];

/**
 * Exhaustive over `RaiseAdminReturnActionResult`'s own declared error codes, derived from the
 * action's type rather than hand-copied — the same technique `field-returns.ts` uses for its own
 * `ERROR_CODE_MAP`/`RAISE_ADMIN_RETURN_ERROR_CODE_MAP`. If that action's declared error union
 * ever widens, this `Record` stops being exhaustive and fails to compile here, rather than
 * `result.code` reaching `stores.adminReturn.err.*` as a raw untranslated key on screen.
 */
const RAISE_ADMIN_RETURN_ERR_KEY: Record<RaiseAdminReturnErrorCode, string> = {
  FORBIDDEN: "err.FORBIDDEN",
  INVALID_REQUEST: "err.INVALID_REQUEST",
  NOT_FOUND: "err.NOT_FOUND",
  ERROR: "err.ERROR",
};

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function StoreDetailView({
  store,
  canEdit,
  canManageFieldReturns,
  visits,
  orders,
  sentItems,
  stockCard,
  stocktakes,
  pendingChange,
}: Props) {
  const t = useTranslations("stores");
  const tBadge = useTranslations("stores.badge");
  const tDetail = useTranslations("stores.detail");
  const tForm = useTranslations("stores.form");
  const tTable = useTranslations("stores.list.table");
  const tOrders = useTranslations("stores.orders");
  const tSentItems = useTranslations("stores.sentItems");
  const tStocktake = useTranslations("stores.stocktake");
  const tAdminReturn = useTranslations("stores.adminReturn");
  const tReturReason = useTranslations("fieldReturns.reason");
  const tCommon = useTranslations("common");
  const tST = useTranslations("storeStocktakes");
  const tFso = useTranslations("fieldSalesOrders");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creatingStocktake, startCreateStocktakeTransition] = useTransition();
  const [lightbox, setLightbox] = useState<{ url: string; caption: string | null } | null>(null);
  const [gallery, setGallery] = useState<{
    label: string;
    photos: Array<{ id: string; url: string; caption: string | null; capturedAtIso: string }>;
  } | null>(null);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raiseLines, setRaiseLines] = useState<Map<string, RaiseLineDraft>>(new Map());
  const [raiseNote, setRaiseNote] = useState("");
  const [raising, startRaiseTransition] = useTransition();

  const totalVisits = visits.length;
  const lastVisit = visits[0];
  const sentItemGroups = groupSentItemsByArticle(sentItems);

  function handleStartStocktake(): void {
    startCreateStocktakeTransition(async () => {
      try {
        const result = await createStocktakeAction({ storeId: store.id, countedAt: new Date().toISOString() });
        if (result.ok && result.id) {
          router.push(`/backoffice/store-stocktakes/${result.id}`);
          return;
        }
        if (!result.ok) toast.error(tST(`err.${result.code}`));
      } catch {
        toast.error(tST("err.ERROR"));
      }
    });
  }

  function resetRaiseForm(): void {
    setRaiseLines(new Map());
    setRaiseNote("");
  }

  function openRaiseDialog(): void {
    resetRaiseForm();
    setRaiseOpen(true);
  }

  function closeRaiseDialog(open: boolean): void {
    if (raising) return;
    setRaiseOpen(open);
    if (!open) resetRaiseForm();
  }

  function setRaiseLineQty(row: StockCardProps["rows"][number], qtyRaw: string): void {
    const key = raiseLineKey(row.itemId, row.variantSku);
    setRaiseLines((prev) => {
      const next = new Map(prev);
      if (qtyRaw.trim() === "") {
        next.delete(key);
        return next;
      }
      const existing = prev.get(key);
      next.set(key, {
        itemId: row.itemId,
        variantSku: row.variantSku,
        itemName: row.itemName,
        qtyRaw,
        /*
         * UNSOLD, not DAMAGED (the PWA's default) — an admin at the office has inspected
         * nothing physically, so defaulting to a claim about condition would be unverified.
         */
        reason: existing?.reason ?? "UNSOLD",
        reasonNote: existing?.reasonNote ?? "",
      });
      return next;
    });
  }

  function setRaiseLineReason(key: string, reason: FieldReturnReasonInput): void {
    setRaiseLines((prev) => {
      const existing = prev.get(key);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(key, { ...existing, reason, reasonNote: reason === "OTHER" ? existing.reasonNote : "" });
      return next;
    });
  }

  function setRaiseLineReasonNote(key: string, reasonNote: string): void {
    setRaiseLines((prev) => {
      const existing = prev.get(key);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(key, { ...existing, reasonNote });
      return next;
    });
  }

  const raiseLineArr = Array.from(raiseLines.values());
  /**
   * A garbled qty (anything parseRaiseQty refuses) blocks submit rather than being silently
   * dropped — the operator must fix or clear it, never have it vanish unnoticed.
   */
  const hasInvalidRaiseQty = raiseLineArr.some((l) => parseRaiseQty(l.qtyRaw) === null);
  const includedRaiseLines = raiseLineArr.filter((l) => (parseRaiseQty(l.qtyRaw) ?? 0) > 0);
  const hasRaiseOtherWithoutNote = includedRaiseLines.some(
    (l) => l.reason === "OTHER" && l.reasonNote.trim() === "",
  );
  const canSubmitRaise =
    includedRaiseLines.length > 0 && !hasInvalidRaiseQty && !hasRaiseOtherWithoutNote && !raising;

  function submitRaise(): void {
    if (!canSubmitRaise) return;
    startRaiseTransition(async () => {
      try {
        const lines: FieldReturnLineInput[] = includedRaiseLines.map((l) => ({
          itemId: l.itemId,
          variantSku: l.variantSku,
          qty: parseRaiseQty(l.qtyRaw) as number,
          reason: l.reason,
          ...(l.reason === "OTHER" ? { reasonNote: l.reasonNote.trim() } : {}),
        }));
        const result = await raiseAdminReturnAction({
          storeId: store.id,
          lines,
          note: raiseNote.trim() || undefined,
        });
        if (result.ok) {
          toast.success(tAdminReturn("success", { docNo: result.docNo }));
          setRaiseOpen(false);
          resetRaiseForm();
          router.push(`/backoffice/field-returns/${result.returnId}`);
          return;
        }
        toast.error(tAdminReturn(RAISE_ADMIN_RETURN_ERR_KEY[result.code]));
      } catch {
        toast.error(tAdminReturn(RAISE_ADMIN_RETURN_ERR_KEY.ERROR));
      }
    });
  }

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
          inTransitAdminReturn={stockCard.inTransitAdminReturn}
          movements={stockCard.movements}
        />
      )}

      {store.termsType === "KONSI" && stockCard && canManageFieldReturns && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Undo2 className="h-4 w-4" />
              {tAdminReturn("cardTitle")}
            </CardTitle>
            <Button size="sm" disabled={stockCard.rows.length === 0} onClick={openRaiseDialog}>
              {tAdminReturn("raiseButton")}
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {stockCard.rows.length === 0 ? tAdminReturn("emptyStock") : tAdminReturn("description")}
            </p>
          </CardContent>
        </Card>
      )}

      {store.termsType === "KONSI" && stocktakes && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4" />
              {tStocktake("cardTitle")}
              <span className="text-sm font-normal text-muted-foreground ml-2">({stocktakes.total})</span>
            </CardTitle>
            {canEdit &&
              (stocktakes.openId ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/backoffice/store-stocktakes/${stocktakes.openId}`}>
                    {tStocktake("continueButton")}
                  </Link>
                </Button>
              ) : (
                <Button size="sm" disabled={creatingStocktake} onClick={handleStartStocktake}>
                  {creatingStocktake ? tStocktake("creating") : tStocktake("startButton")}
                </Button>
              ))}
          </CardHeader>
          <CardContent>
            {canEdit && stocktakes.openId && (
              <p className="mb-3 text-sm text-muted-foreground">{tStocktake("openBanner")}</p>
            )}
            {stocktakes.rows.length === 0 ? (
              <div className="text-center py-8">
                <ClipboardList className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">{tStocktake("empty")}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tStocktake("colDocNo")}</TableHead>
                      <TableHead>{tStocktake("colCountedAt")}</TableHead>
                      <TableHead>{tStocktake("colStatus")}</TableHead>
                      <TableHead className="text-right">{tStocktake("colLines")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stocktakes.rows.map((s) => (
                      <TableRow
                        key={s.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => startTransition(() => router.push(`/backoffice/store-stocktakes/${s.id}`))}
                      >
                        <TableCell className="font-mono text-sm">{s.docNo}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDateOnlyJakarta(new Date(s.countedAtIso))}</TableCell>
                        <TableCell>
                          <Badge variant={STOCKTAKE_STATUS_BADGE_VARIANT[s.status]} className={STOCKTAKE_STATUS_BADGE_CLASS[s.status]}>
                            {tST(`status.${s.status}`)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.countedLineCount} / {s.lineCount}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
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

      <Dialog open={raiseOpen} onOpenChange={closeRaiseDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{tAdminReturn("dialogTitle")}</DialogTitle>
            <DialogDescription>{tAdminReturn("dialogDescription")}</DialogDescription>
          </DialogHeader>

          {(stockCard?.rows ?? []).length === 0 ? (
            <div className="text-center py-8">
              <Undo2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">{tAdminReturn("emptyStock")}</p>
            </div>
          ) : (
            <div className="overflow-auto max-h-96 rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead>{tAdminReturn("colProduct")}</TableHead>
                    <TableHead>{tAdminReturn("colVariant")}</TableHead>
                    <TableHead className="text-right">{tAdminReturn("colCurrentQty")}</TableHead>
                    <TableHead className="w-28">{tAdminReturn("colReturnQty")}</TableHead>
                    <TableHead className="min-w-[200px]">{tAdminReturn("colReason")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(stockCard?.rows ?? []).map((row) => {
                    const key = raiseLineKey(row.itemId, row.variantSku);
                    const draft = raiseLines.get(key);
                    const invalidQty = draft !== undefined && parseRaiseQty(draft.qtyRaw) === null;
                    const rowLabel = row.variantSku ? `${row.itemName} ${row.variantSku}` : row.itemName;
                    return (
                      <TableRow key={key}>
                        <TableCell className="text-sm">{row.itemName}</TableCell>
                        <TableCell className="font-mono text-xs">{row.variantSku || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{row.qty}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            step={1}
                            disabled={raising}
                            aria-label={`${tAdminReturn("colReturnQty")} — ${rowLabel}`}
                            className="w-20 text-right tabular-nums"
                            value={draft?.qtyRaw ?? ""}
                            onChange={(e) => setRaiseLineQty(row, e.target.value)}
                          />
                          {invalidQty && <p className="mt-1 text-xs text-destructive">{tAdminReturn("qtyInvalid")}</p>}
                        </TableCell>
                        <TableCell>
                          {draft && (
                            <div className="space-y-1.5">
                              <Select
                                value={draft.reason}
                                disabled={raising}
                                onValueChange={(v) => setRaiseLineReason(key, v as FieldReturnReasonInput)}
                              >
                                <SelectTrigger className="w-full" aria-label={`${tAdminReturn("colReason")} — ${rowLabel}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {FIELD_RETURN_REASONS.map((reason) => (
                                    <SelectItem key={reason} value={reason}>
                                      {tReturReason(reason)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {draft.reason === "OTHER" && (
                                <Input
                                  placeholder={tAdminReturn("reasonNotePlaceholder")}
                                  disabled={raising}
                                  aria-label={`${tAdminReturn("reasonNotePlaceholder")} — ${rowLabel}`}
                                  value={draft.reasonNote}
                                  onChange={(e) => setRaiseLineReasonNote(key, e.target.value)}
                                />
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="admin-return-note" className="text-sm font-medium">
              {tAdminReturn("noteLabel")}
            </label>
            <Textarea
              id="admin-return-note"
              rows={2}
              disabled={raising}
              placeholder={tAdminReturn("notePlaceholder")}
              value={raiseNote}
              onChange={(e) => setRaiseNote(e.target.value)}
            />
          </div>

          {/*
            All rows entered but every one is zero (or the map has entries with no positive
            qty) — Submit is disabled with no other visible explanation, since qtyInvalid only
            fires on unparseable input, not on a valid all-zero set.
          */}
          {raiseLineArr.length > 0 && !hasInvalidRaiseQty && includedRaiseLines.length === 0 && (
            <p className="text-xs text-destructive">{tAdminReturn("noQtyEntered")}</p>
          )}

          <DialogFooter>
            <Button variant="outline" disabled={raising} onClick={() => closeRaiseDialog(false)}>
              {tCommon("cancel")}
            </Button>
            <Button disabled={!canSubmitRaise} onClick={submitRaise}>
              {raising ? tAdminReturn("submitting") : tAdminReturn("submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
