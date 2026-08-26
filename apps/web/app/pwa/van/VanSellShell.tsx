"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, ChevronRight, Loader2, Minus, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { recordVanSaleAction, getVanStockForStoreAction } from "@/app/actions/van-sale";
import { roundToWholeRupiah, roundCents } from "@elorae/db/pricing";
import { VanVariantSheet, type VanStockRow, type VanGroup } from "./VanVariantSheet";

type StoreOption = { id: string; name: string };
type ShortLine = { itemId: string; variantSku: string | null; requested: number; available: number };

type CartEntry = { itemId: string; variantSku: string | null; sku: string; productName: string; unitPrice: number; qty: number; qtyOnVan: number };

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
// Exact 2dp display — for the Subtotal row ONLY. `rupiah()` rounds for display, which would make
// Subtotal look identical to the already-rounded Total whenever they differ by under Rp 1 — the
// entire point of showing Subtotal is the fraction `rupiah()` would hide.
const rupiahExact = (n: number) => `Rp ${n.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Signed sub-rupiah delta display (Total - Subtotal) — the rounding itself is never sub-rupiah,
// but the ADJUSTMENT it represents is, by construction (see roundToWholeRupiah in @elorae/db/pricing).
const formatAdjustment = (n: number) =>
  `${n >= 0 ? "+" : "-"}Rp ${Math.abs(n).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function lineKey(itemId: string, variantSku: string | null) {
  return `${itemId}::${variantSku ?? ""}`;
}

// Best-effort GPS: never blocks the sale on denial/timeout/unavailability (unlike
// store check-in, which requires GPS). Resolves null instead of rejecting.
function getPositionBestEffort(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 60_000 },
    );
  });
}

export function VanSellShell({ stock: initialStock, stores }: { stock: VanStockRow[]; stores: StoreOption[] }) {
  const t = useTranslations("vanSale");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [repricing, startReprice] = useTransition();
  const [stock, setStock] = useState<VanStockRow[]>(initialStock);
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<Map<string, CartEntry>>(new Map());
  const [buyerMode, setBuyerMode] = useState<"store" | "adhoc">("adhoc");
  const [storeId, setStoreId] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [shortLines, setShortLines] = useState<ShortLine[]>([]);
  // Stable across retries so a re-submit after an ambiguous failure dedups server-side;
  // rotated only after a confirmed success.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [sheetGroup, setSheetGroup] = useState<VanGroup | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  /**
   * The store picker's selection is the pricing input — a walk-in (`buyerMode: "adhoc"`)
   * prices at list (matches `initialStock`, which was fetched with no storeId), a chosen
   * store re-prices with that store's `priceDiscountPercent`, mirroring what `recordVanSale`
   * will actually charge. Skips the very first run: `initialStock` is already correct for
   * the default "adhoc" mode, so mounting shouldn't fire a redundant refetch.
   */
  const skipFirstReprice = useRef(true);
  // Guards against an in-flight fetch for a since-superseded selection resolving late and
  // clobbering a newer one — React gives no ordering guarantee across overlapping transitions.
  const repriceReqRef = useRef(0);
  // The buyer key (storeId, or "" for walk-in) that `stock` was actually priced for. Compared
  // against the CURRENT buyer key to gate submit — a selection change makes this stale until a
  // reprice for the new key lands, independent of whether `repricing` has already flipped back
  // to false (e.g. after a failed fetch).
  const [pricedForKey, setPricedForKey] = useState("");
  const [repriceError, setRepriceError] = useState<"UNAUTHORIZED" | "GENERIC" | null>(null);
  const [repriceNonce, setRepriceNonce] = useState(0);
  useEffect(() => {
    if (skipFirstReprice.current) {
      skipFirstReprice.current = false;
      return;
    }
    const effectiveStoreId = buyerMode === "store" ? storeId || null : null;
    const reqId = ++repriceReqRef.current;
    startReprice(async () => {
      try {
        const res = await getVanStockForStoreAction(effectiveStoreId);
        if (repriceReqRef.current !== reqId) return;
        if (!res.ok) {
          setRepriceError(res.reason);
          return;
        }
        setStock(res.rows);
        setPricedForKey(effectiveStoreId ?? "");
        setRepriceError(null);
      } catch {
        if (repriceReqRef.current === reqId) setRepriceError("GENERIC");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buyerMode, storeId, repriceNonce]);

  function retryReprice() {
    setRepriceNonce((n) => n + 1);
  }

  /**
   * A cart entry snapshots `unitPrice` at add-time (see setQty). If the store selection
   * changes AFTER items are already in the cart, that snapshot goes stale — this resyncs
   * every cart line to the freshly re-priced `stock` the moment it lands, so `total`/`change`
   * never settle on a price recordVanSale won't actually charge.
   */
  useEffect(() => {
    setCart((prev) => {
      if (prev.size === 0) return prev;
      const priceByKey = new Map(stock.map((r) => [lineKey(r.itemId, r.variantSku), r.price]));
      let changed = false;
      const next = new Map(prev);
      for (const [key, entry] of next) {
        const freshPrice = priceByKey.get(key);
        if (freshPrice !== undefined && freshPrice !== null && freshPrice !== entry.unitPrice) {
          next.set(key, { ...entry, unitPrice: freshPrice });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [stock]);

  function openSheet(g: VanGroup) {
    setSheetGroup(g);
    setSheetOpen(true);
  }

  function setQty(row: VanStockRow, qty: number) {
    const key = lineKey(row.itemId, row.variantSku);
    setCart((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(key);
      else
        next.set(key, {
          itemId: row.itemId,
          variantSku: row.variantSku,
          sku: row.sku,
          productName: row.productName,
          unitPrice: row.price ?? 0,
          qty,
          qtyOnVan: row.qtyOnVan,
        });
      return next;
    });
  }

  const cartLines = useMemo(() => Array.from(cart.values()), [cart]);
  // subtotal = exact 2dp sum of lines; total = the whole-rupiah CHARGED figure recordVanSale
  // actually persists and compares payment against — derived from the SAME shared helper the
  // writer uses (@elorae/db/pricing), so this preview can never drift from what gets charged.
  const subtotal = useMemo(() => cartLines.reduce((s, l) => s + l.qty * l.unitPrice, 0), [cartLines]);
  const total = roundToWholeRupiah(subtotal);
  const roundingAdjustment = roundCents(total - subtotal);
  const paid = Number(amountPaid) || 0;
  const change = paid - total;

  const groups = useMemo(() => {
    const m = new Map<string, VanGroup>();
    for (const r of stock) {
      let g = m.get(r.itemId);
      if (!g) {
        g = { itemId: r.itemId, sku: r.sku, productName: r.productName, price: r.price, variants: [], totalVan: 0 };
        m.set(r.itemId, g);
      }
      g.variants.push(r);
      g.totalVan += r.qtyOnVan;
    }
    return Array.from(m.values());
  }, [stock]);

  /**
   * A variant sheet holds a snapshot of its `group` at open-time (see openSheet). If a reprice
   * lands while the sheet is open, refresh that snapshot from the freshly re-priced `groups` so
   * a subsequent tap in the sheet writes the current price into the cart, not the one the sheet
   * opened with.
   */
  useEffect(() => {
    if (!sheetOpen) return;
    setSheetGroup((prev) => {
      if (!prev) return prev;
      return groups.find((g) => g.itemId === prev.itemId) ?? prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stock]);

  const filteredGroups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return groups;
    return groups.filter(
      (g) =>
        g.sku.toLowerCase().includes(needle) ||
        g.productName.toLowerCase().includes(needle) ||
        g.variants.some((v) => (v.variantLabel ?? "").toLowerCase().includes(needle) || (v.variantSku ?? "").toLowerCase().includes(needle)),
    );
  }, [groups, q]);

  function selectedQtyForGroup(g: VanGroup): number {
    return g.variants.reduce((s, v) => s + (cart.get(lineKey(v.itemId, v.variantSku))?.qty ?? 0), 0);
  }

  const effectiveStoreId = buyerMode === "store" ? storeId || null : null;
  const pricingStale = pricedForKey !== (effectiveStoreId ?? "");
  const canSubmit =
    cartLines.length > 0 && total > 0 && paid >= total && !pending && !repricing && !pricingStale && !repriceError;

  function onSubmit() {
    setShortLines([]);
    startTransition(async () => {
      const position = await getPositionBestEffort();
      const res = await recordVanSaleAction({
        storeId: buyerMode === "store" ? storeId || null : null,
        buyerName: buyerMode === "adhoc" ? buyerName.trim() || null : null,
        buyerPhone: buyerMode === "adhoc" ? buyerPhone.trim() || null : null,
        saleLat: position?.lat ?? null,
        saleLng: position?.lng ?? null,
        amountPaid: paid,
        idempotencyKey,
        lines: cartLines.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku, qty: l.qty })),
      });
      if (res.ok) {
        setIdempotencyKey(crypto.randomUUID()); // rotate for the next sale
        toast.success(t("successToast", { docNo: res.docNo }));
        router.push(`/pwa/van/${res.saleId}/nota`);
        return;
      }
      if (res.reason === "INSUFFICIENT_VAN_STOCK") {
        setShortLines(res.shortLines ?? []);
        toast.error(t("errInsufficientStock"));
        return;
      }
      const msg =
        res.reason === "NO_PRICE"
          ? t("errNoPrice")
          : res.reason === "INSUFFICIENT_PAYMENT"
            ? t("errInsufficientPayment")
            : res.reason === "UNAUTHORIZED"
              ? t("errUnauthorized")
              : res.reason === "VALIDATION"
                ? t("errValidation")
                : t("errEmpty");
      toast.error(msg);
    });
  }

  function itemLabel(itemId: string) {
    const row = stock.find((r) => r.itemId === itemId);
    return row ? `${row.sku} - ${row.productName}` : itemId;
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/pwa">
            <ArrowLeft className="h-4 w-4" />
            {t("back")}
          </Link>
        </Button>
      </header>

      <div>
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {shortLines.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <p className="mb-1 font-medium">{t("errInsufficientStock")}</p>
            <ul className="space-y-1 text-sm">
              {shortLines.map((sl, idx) => (
                <li key={idx}>
                  {itemLabel(sl.itemId)}
                  {sl.variantSku ? ` (${sl.variantSku})` : ""} — {t("shortLineDetail", { requested: sl.requested, available: sl.available })}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card className="space-y-3 p-3">
        <p className="text-sm font-medium">{t("buyerSectionTitle")}</p>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={buyerMode === "store" ? "default" : "outline"}
            className="flex-1"
            onClick={() => setBuyerMode("store")}
            disabled={pending || repricing}
          >
            {t("buyerStore")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={buyerMode === "adhoc" ? "default" : "outline"}
            className="flex-1"
            onClick={() => setBuyerMode("adhoc")}
            disabled={pending || repricing}
          >
            {t("buyerAdhoc")}
          </Button>
        </div>

        {buyerMode === "store" ? (
          <div className="space-y-1.5">
            <Label className="text-xs">{t("selectStore")}</Label>
            <SearchableCombobox
              options={stores.map((s) => ({ value: s.id, label: s.name }))}
              value={storeId}
              onValueChange={setStoreId}
              placeholder={t("selectStore")}
              searchPlaceholder={t("searchStorePlaceholder")}
              emptyMessage={t("noStoreFound")}
              disabled={pending || repricing}
              triggerClassName="w-full"
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="van-buyer-name" className="text-xs">
                {t("buyerNameLabel")}
              </Label>
              <Input
                id="van-buyer-name"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                placeholder={t("buyerNamePlaceholder")}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="van-buyer-phone" className="text-xs">
                {t("buyerPhoneLabel")}
              </Label>
              <Input
                id="van-buyer-phone"
                value={buyerPhone}
                onChange={(e) => setBuyerPhone(e.target.value)}
                placeholder={t("buyerPhonePlaceholder")}
                disabled={pending}
              />
            </div>
          </div>
        )}

        {repricing && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("updatingPrices")}
          </p>
        )}
        {repriceError && (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-2">
              <span>{repriceError === "UNAUTHORIZED" ? t("errUnauthorized") : t("repriceFailed")}</span>
              <Button type="button" size="sm" variant="outline" onClick={retryReprice} disabled={repricing}>
                {t("retry")}
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </Card>

      <Input placeholder={t("searchItemPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} />

      {stock.length === 0 && <p className="text-sm text-muted-foreground">{t("emptyStock")}</p>}
      {stock.length > 0 && filteredGroups.length === 0 && <p className="text-sm text-muted-foreground">{t("noResults")}</p>}

      <div className="flex flex-col gap-2">
        {filteredGroups.map((g) => {
          // Single loaded row → inline stepper (no sheet needed for one choice).
          if (g.variants.length === 1) {
            const row = g.variants[0];
            const key = lineKey(row.itemId, row.variantSku);
            const qty = cart.get(key)?.qty ?? 0;
            const canSell = row.price !== null && row.qtyOnVan > 0;
            return (
              <Card key={g.itemId} className="flex flex-row items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.productName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.sku}
                    {row.variantLabel ? ` · ${row.variantLabel}` : row.variantSku ? ` · ${row.variantSku}` : ""}
                  </p>
                  <Badge variant={row.qtyOnVan > 0 ? "secondary" : "destructive"} className="mt-1">
                    {t("qtyOnVan", { qty: row.qtyOnVan })}
                  </Badge>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {row.price !== null ? (
                    <span className="text-sm font-semibold tabular-nums">{rupiah(row.price)}</span>
                  ) : (
                    <span className="text-xs italic text-muted-foreground">{t("priceUnset")}</span>
                  )}
                  {canSell && (
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-lg"
                        disabled={qty <= 0 || pending || repricing}
                        onClick={() => setQty(row, qty - 1)}
                        aria-label={t("decrease", { name: row.productName })}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <span className="w-5 text-center text-sm font-semibold tabular-nums">{qty}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-lg"
                        disabled={qty >= row.qtyOnVan || pending || repricing}
                        onClick={() => setQty(row, qty + 1)}
                        aria-label={t("increase", { name: row.productName })}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          }

          // Multiple variants → tap to open the variant sheet.
          const selected = selectedQtyForGroup(g);
          return (
            <Card
              key={g.itemId}
              role="button"
              tabIndex={0}
              aria-disabled={repricing}
              onClick={() => {
                if (!repricing) openSheet(g);
              }}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !repricing) {
                  e.preventDefault();
                  openSheet(g);
                }
              }}
              className={`flex flex-row items-center gap-3 p-3 ${repricing ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{g.productName}</p>
                <p className="truncate text-xs text-muted-foreground">{g.sku}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">{t("qtyOnVan", { qty: g.totalVan })}</Badge>
                  <Badge variant="outline">{t("variantsChip", { count: g.variants.length })}</Badge>
                  {selected > 0 && <Badge>{t("selectedChip", { count: selected })}</Badge>}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {g.price !== null ? (
                  <span className="text-sm font-semibold tabular-nums">{rupiah(g.price)}</span>
                ) : (
                  <span className="text-xs italic text-muted-foreground">{t("priceUnset")}</span>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </Card>
          );
        })}
      </div>

      {cartLines.length > 0 && <div aria-hidden style={{ height: 232 }} />}

      {cartLines.length > 0 && (
        <div className="sticky bottom-0 -mx-4 -mb-4 space-y-2 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {roundingAdjustment !== 0 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("subtotalLabel")}</span>
              <span className="tabular-nums">{rupiahExact(subtotal)}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("totalLabel")}</span>
            <span className="font-semibold tabular-nums">{rupiah(total)}</span>
          </div>
          {roundingAdjustment !== 0 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("roundingAdjustmentLabel")}</span>
              <span className="tabular-nums">{formatAdjustment(roundingAdjustment)}</span>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="van-cash-tendered" className="text-xs">
              {t("cashTenderedLabel")}
            </Label>
            <Input
              id="van-cash-tendered"
              type="number"
              inputMode="numeric"
              min="0"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
              placeholder={t("cashTenderedPlaceholder")}
              disabled={pending}
            />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("changeLabel")}</span>
            <span className={`font-semibold tabular-nums ${change < 0 ? "text-destructive" : ""}`}>{rupiah(change)}</span>
          </div>
          {paid > 0 && change < 0 && <p className="text-xs text-destructive">{t("changeInsufficient")}</p>}
          <Button type="button" className="w-full" size="lg" onClick={onSubmit} disabled={!canSubmit}>
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("submitting")}
              </>
            ) : (
              t("submit")
            )}
          </Button>
        </div>
      )}

      <VanVariantSheet group={sheetGroup} cart={cart} setQty={setQty} open={sheetOpen} onOpenChange={setSheetOpen} disabled={repricing} />
    </div>
  );
}
