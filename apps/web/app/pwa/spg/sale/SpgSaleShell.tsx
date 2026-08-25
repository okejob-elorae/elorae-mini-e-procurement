"use client";

import { useMemo, useState, useTransition } from "react";
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
import { recordSpgSaleAction } from "@/app/actions/spg-sale";
import { SpgVariantSheet, type SpgGroup } from "./SpgVariantSheet";
import type { SpgCatalogRow } from "@/lib/spg/sale-queries";

type CartEntry = { itemId: string; variantSku: string | null; sku: string; productName: string; unitPrice: number; qty: number };

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

function lineKey(itemId: string, variantSku: string | null) {
  return `${itemId}::${variantSku ?? ""}`;
}

const ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN: "Anda tidak memiliki akses untuk mencatat penjualan.",
  NO_ASSIGNED_STORE: "Anda belum ditugaskan ke toko manapun. Hubungi admin.",
  NO_ACTIVE_VISIT: "Anda belum check-in di toko. Check-in dulu sebelum mencatat penjualan.",
  EMPTY: "Keranjang masih kosong.",
  STORE_NOT_FOUND: "Toko tidak ditemukan.",
  NO_PRICE: "Ada produk yang belum punya harga.",
  INSUFFICIENT_PAYMENT: "Uang tunai kurang dari total belanja.",
  VALIDATION: "Data tidak valid, coba lagi.",
};

/**
 * Best-effort GPS: never blocks the sale on denial/timeout/unavailability,
 * mirroring the van-sale screen (check-in is the only GPS-mandatory flow).
 */
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

/**
 * SPG record-sale screen — mirrors VanSellShell's shape (apps/web/app/pwa/van/VanSellShell.tsx)
 * but drops the buyer picker (buyer is always the SPG's fixed assigned store,
 * derived server-side) and the van-stock cap (SpgSale is record-only, no ledger
 * backs it, so every priced item/variant is sellable, unbounded).
 */
export function SpgSaleShell({ catalog }: { catalog: SpgCatalogRow[] }) {
  const router = useRouter();
  const t = useTranslations("spgSale");
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<Map<string, CartEntry>>(new Map());
  const [amountPaid, setAmountPaid] = useState("");
  /* Stable across retries so a re-submit after an ambiguous failure dedups server-side; rotated only after a confirmed success. */
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [sheetGroup, setSheetGroup] = useState<SpgGroup | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  function openSheet(g: SpgGroup) {
    setSheetGroup(g);
    setSheetOpen(true);
  }

  function setQty(row: SpgCatalogRow, qty: number) {
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
        });
      return next;
    });
  }

  const cartLines = useMemo(() => Array.from(cart.values()), [cart]);
  const total = useMemo(() => cartLines.reduce((s, l) => s + l.qty * l.unitPrice, 0), [cartLines]);
  const paid = Number(amountPaid) || 0;
  const change = paid - total;

  const groups = useMemo(() => {
    const m = new Map<string, SpgGroup>();
    for (const r of catalog) {
      let g = m.get(r.itemId);
      if (!g) {
        g = { itemId: r.itemId, sku: r.sku, productName: r.productName, price: r.price, variants: [] };
        m.set(r.itemId, g);
      }
      g.variants.push(r);
    }
    return Array.from(m.values());
  }, [catalog]);

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

  function selectedQtyForGroup(g: SpgGroup): number {
    return g.variants.reduce((s, v) => s + (cart.get(lineKey(v.itemId, v.variantSku))?.qty ?? 0), 0);
  }

  const canSubmit = cartLines.length > 0 && total > 0 && paid >= total && !pending;

  function onSubmit() {
    startTransition(async () => {
      const position = await getPositionBestEffort();
      const res = await recordSpgSaleAction({
        cashReceived: paid,
        saleLat: position?.lat ?? null,
        saleLng: position?.lng ?? null,
        idempotencyKey,
        lines: cartLines.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku, qty: l.qty })),
      });
      if (res.ok) {
        setIdempotencyKey(crypto.randomUUID()); /* rotate for the next sale */
        toast.success(`Penjualan ${res.docNo} berhasil dicatat.`);
        router.push(`/pwa/spg/${res.spgSaleId}/nota`);
        return;
      }
      toast.error(ERROR_MESSAGES[res.code] ?? "Gagal mencatat penjualan.");
    });
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/pwa">
            <ArrowLeft className="h-4 w-4" />
            Kembali
          </Link>
        </Button>
      </header>

      <div>
        <h1 className="text-lg font-semibold">Catat Penjualan</h1>
        <p className="text-sm text-muted-foreground">Pilih produk yang terjual di toko ini.</p>
      </div>

      <Input placeholder="Cari produk..." value={q} onChange={(e) => setQ(e.target.value)} />

      {catalog.length === 0 && <p className="text-sm text-muted-foreground">Belum ada produk aktif.</p>}
      {catalog.length > 0 && filteredGroups.length === 0 && <p className="text-sm text-muted-foreground">Produk tidak ditemukan.</p>}

      <div className="flex flex-col gap-2">
        {filteredGroups.map((g) => {
          /* Single variant (or no variants) → inline stepper. */
          if (g.variants.length === 1) {
            const row = g.variants[0];
            const key = lineKey(row.itemId, row.variantSku);
            const qty = cart.get(key)?.qty ?? 0;
            const canSell = row.price !== null;
            return (
              <Card key={g.itemId} className="flex flex-row items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.productName}</p>
                  <p className="truncate text-xs text-muted-foreground">{row.sku}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {row.price !== null ? (
                    <span className="text-sm font-semibold tabular-nums">{rupiah(row.price)}</span>
                  ) : (
                    <span className="text-xs italic text-muted-foreground">Harga belum diset</span>
                  )}
                  <Badge variant={row.onCounterQty < 0 ? "destructive" : "outline"} className="text-xs">
                    {t("onCounterQty", { qty: row.onCounterQty })}
                  </Badge>
                  {canSell && (
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-lg"
                        disabled={qty <= 0 || pending}
                        onClick={() => setQty(row, qty - 1)}
                        aria-label={`Kurangi ${row.productName}`}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <span className="w-5 text-center text-sm font-semibold tabular-nums">{qty}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-lg"
                        disabled={pending}
                        onClick={() => setQty(row, qty + 1)}
                        aria-label={`Tambah ${row.productName}`}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          }

          /* Multiple variants → tap to open the variant sheet. */
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
                  <Badge variant="outline">{g.variants.length} varian</Badge>
                  {selected > 0 && <Badge>{selected} dipilih</Badge>}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {g.price !== null ? (
                  <span className="text-sm font-semibold tabular-nums">{rupiah(g.price)}</span>
                ) : (
                  <span className="text-xs italic text-muted-foreground">Harga belum diset</span>
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
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold tabular-nums">{rupiah(total)}</span>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="spg-cash-tendered" className="text-xs">
              Uang Tunai Diterima
            </Label>
            <Input
              id="spg-cash-tendered"
              type="number"
              inputMode="numeric"
              min="0"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
              placeholder="0"
              disabled={pending}
            />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Kembalian</span>
            <span className={`font-semibold tabular-nums ${change < 0 ? "text-destructive" : ""}`}>{rupiah(change)}</span>
          </div>
          {paid > 0 && change < 0 && <p className="text-xs text-destructive">Uang tunai belum cukup.</p>}
          <Button type="button" className="w-full" size="lg" onClick={onSubmit} disabled={!canSubmit}>
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Menyimpan...
              </>
            ) : (
              "Simpan Penjualan"
            )}
          </Button>
        </div>
      )}

      <SpgVariantSheet group={sheetGroup} cart={cart} setQty={setQty} open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  );
}
