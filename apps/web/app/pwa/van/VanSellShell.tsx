"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Minus, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { recordVanSaleAction } from "@/app/actions/van-sale";

type VanStockRow = { itemId: string; sku: string; productName: string; variantSku: string | null; qtyOnVan: number; price: number | null };
type StoreOption = { id: string; name: string };
type ShortLine = { itemId: string; variantSku: string | null; requested: number; available: number };

type CartEntry = { itemId: string; variantSku: string | null; sku: string; productName: string; unitPrice: number; qty: number; qtyOnVan: number };

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

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

export function VanSellShell({ stock, stores }: { stock: VanStockRow[]; stores: StoreOption[] }) {
  const t = useTranslations("vanSale");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
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
  const total = useMemo(() => cartLines.reduce((s, l) => s + l.qty * l.unitPrice, 0), [cartLines]);
  const paid = Number(amountPaid) || 0;
  const change = paid - total;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return stock;
    return stock.filter((r) => r.sku.toLowerCase().includes(needle) || r.productName.toLowerCase().includes(needle));
  }, [stock, q]);

  const canSubmit = cartLines.length > 0 && total > 0 && paid >= total && !pending;

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
            disabled={pending}
          >
            {t("buyerStore")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={buyerMode === "adhoc" ? "default" : "outline"}
            className="flex-1"
            onClick={() => setBuyerMode("adhoc")}
            disabled={pending}
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
              disabled={pending}
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
      </Card>

      <Input placeholder={t("searchItemPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} />

      {stock.length === 0 && <p className="text-sm text-muted-foreground">{t("emptyStock")}</p>}
      {stock.length > 0 && filtered.length === 0 && <p className="text-sm text-muted-foreground">{t("noResults")}</p>}

      <div className="flex flex-col gap-2">
        {filtered.map((row) => {
          const key = lineKey(row.itemId, row.variantSku);
          const qty = cart.get(key)?.qty ?? 0;
          const canSell = row.price !== null && row.qtyOnVan > 0;
          return (
            <Card key={key} className="flex flex-row items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.productName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.sku}
                  {row.variantSku ? ` · ${row.variantSku}` : ""}
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
                      disabled={qty <= 0 || pending}
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
                      disabled={qty >= row.qtyOnVan || pending}
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
        })}
      </div>

      {cartLines.length > 0 && <div aria-hidden style={{ height: 232 }} />}

      {cartLines.length > 0 && (
        <div className="sticky bottom-0 -mx-4 -mb-4 space-y-2 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("totalLabel")}</span>
            <span className="font-semibold tabular-nums">{rupiah(total)}</span>
          </div>
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
    </div>
  );
}
