"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { KeteranganKirim } from "../KeteranganKirim";
import { toast } from "sonner";
import { ChevronRight, Loader2, Minus, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { recordVanSaleAction } from "@/app/actions/van-sale";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { VanVariantSheet, type VanStockRow, type VanGroup } from "./VanVariantSheet";
import {
  bacaSimpananKeranjangVan,
  kirimPenjualanVan,
  kunciBaris,
  kunciSesudahUbah,
  pulihkanKeranjangVan,
  susunSimpananKeranjangVan,
  tulisSimpananKeranjangVan,
  type BarisKeranjangVan,
  type Penyimpanan,
} from "./keranjang";

import { TautanKembali } from "@/app/pwa/TautanKembali";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";
type StoreOption = { id: string; name: string };
type ShortLine = { itemId: string; variantSku: string | null; requested: number; available: number };

type CartEntry = BarisKeranjangVan;

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

const lineKey = kunciBaris;

/** sessionStorage bisa dilarang (mode privat): aksesnya sendiri pun bisa melempar. */
function sesi(): Penyimpanan | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
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

export function VanSellShell({ userId, stock, stores }: { userId: string; stock: VanStockRow[]; stores: StoreOption[] }) {
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
  // Satu kunci per keranjang, disimpan bersama isinya di sessionStorage
  // (`keranjang.ts`): kirim ulang setelah sinyal putus atau muat ulang memakai
  // kunci yang sama, jadi server mengembalikan penjualan yang sudah tercatat.
  // Diganti hanya setelah penjualan tercatat atau keranjang dikosongkan.
  const [idempotencyKey, setIdempotencyKey] = useState(() => newLocalId());
  // Simpanan baru dibaca setelah mount (server merender keranjang kosong);
  // sebelum itu tidak ada yang ditulis, supaya simpanan tidak tertimpa kosong.
  const [dipulihkan, setDipulihkan] = useState(false);
  const [sheetGroup, setSheetGroup] = useState<VanGroup | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  function openSheet(g: VanGroup) {
    setSheetGroup(g);
    setSheetOpen(true);
  }

  useEffect(() => {
    const p = pulihkanKeranjangVan(bacaSimpananKeranjangVan(sesi(), userId), stock, stores);
    if (p) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- simpanan ada di sessionStorage, hanya terbaca di klien sesudah mount
      setCart(p.baris);
      setIdempotencyKey(p.idempotencyKey);
      setBuyerMode(p.mode);
      setStoreId(p.storeId);
      setAmountPaid(p.uangDiterima);
      toast.info(t("keranjangDipulihkan"), { id: "van-keranjang-dipulihkan" });
    }
    setDipulihkan(true);
    // Sekali saat layar dibuka; stok baru tidak memulihkan ulang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (!dipulihkan) return;
    tulisSimpananKeranjangVan(
      sesi(),
      userId,
      susunSimpananKeranjangVan({ idempotencyKey, baris: cart.values(), mode: buyerMode, storeId, uangDiterima: amountPaid }),
    );
  }, [dipulihkan, userId, idempotencyKey, cart, buyerMode, storeId, amountPaid]);

  function setQty(row: VanStockRow, qty: number) {
    if (pending) return;
    const key = lineKey(row.itemId, row.variantSku);
    const next = new Map(cart);
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
    setCart(next);
    // Keranjang dikosongkan = penjualan ditinggalkan: keranjang berikutnya kunci baru.
    const kunci = kunciSesudahUbah(cart.size, next.size, idempotencyKey, newLocalId);
    if (kunci !== idempotencyKey) setIdempotencyKey(kunci);
  }

  const cartLines = useMemo(() => Array.from(cart.values()), [cart]);
  const total = useMemo(() => cartLines.reduce((s, l) => s + l.qty * l.unitPrice, 0), [cartLines]);
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

  const canSubmit = cartLines.length > 0 && total > 0 && paid >= total && !pending;
  const kurang = pending
    ? null
    : cartLines.length === 0
      ? t("kurangBarang")
      : paid === 0
        ? t("kurangUang")
        : null;

  function onSubmit() {
    if (!canSubmit) return;
    const simpanan = susunSimpananKeranjangVan({ idempotencyKey, baris: cartLines, mode: buyerMode, storeId, uangDiterima: amountPaid });
    if (!simpanan) return;
    const muatan = {
      storeId: buyerMode === "store" ? storeId || null : null,
      buyerName: buyerMode === "adhoc" ? buyerName.trim() || null : null,
      buyerPhone: buyerMode === "adhoc" ? buyerPhone.trim() || null : null,
      amountPaid: paid,
      lines: cartLines.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku, qty: l.qty })),
    };
    setShortLines([]);
    startTransition(async () => {
      const position = await getPositionBestEffort();
      const hasil = await kirimPenjualanVan({
        penyimpanan: sesi(),
        userId,
        simpanan,
        kirim: (kunci) => recordVanSaleAction({ ...muatan, saleLat: position?.lat ?? null, saleLng: position?.lng ?? null, idempotencyKey: kunci }),
      });
      if (hasil.jenis === "tercatat") {
        // Keranjang selesai: simpanannya sudah dihapus; layar kosong dengan kunci baru.
        setCart(new Map());
        setIdempotencyKey(newLocalId());
        setAmountPaid("");
        toast.success(t("successToast", { docNo: hasil.docNo }));
        // replace: Kembali dari nota tidak membuka keranjang yang sudah tercatat.
        router.replace(`/pwa/van/${hasil.saleId}/nota`);
        return;
      }
      if (hasil.jenis === "terputus") {
        // Penjualan mungkin sudah tercatat: keranjang dan kuncinya tetap, kirim lagi aman.
        toast.error(t("errTerputus"));
        return;
      }
      const res = hasil.hasil;
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
    <div className="flex min-h-dvh flex-col gap-3 p-4">
      <header className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <TautanKembali cadangan="/pwa" />
        </Button>
      </header>

      <div>
        <div className="flex items-center gap-1">
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <TombolBantuanHp judul={t("title")} />
        </div>
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

      <Card className="gap-3 p-3">
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
          <div className="grid grid-cols-1 gap-2">
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
          }

          // Multiple variants → tap to open the variant sheet.
          const selected = selectedQtyForGroup(g);
          return (
            <Card
              key={g.itemId}
              role="button"
              tabIndex={0}
              onClick={() => openSheet(g)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openSheet(g);
                }
              }}
              className="flex cursor-pointer flex-row items-center gap-3 p-3"
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
        <div className="sticky bottom-0 -mx-4 -mb-4 mt-auto space-y-2 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
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
          <KeteranganKirim teks={kurang} />
        </div>
      )}

      <VanVariantSheet group={sheetGroup} cart={cart} setQty={setQty} open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  );
}
