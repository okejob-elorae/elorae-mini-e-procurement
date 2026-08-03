"use client";

import { useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SpgCatalogRow } from "@/lib/spg/sale-queries";

export type SpgGroup = {
  itemId: string;
  sku: string;
  productName: string;
  price: number | null;
  variants: SpgCatalogRow[];
};

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

function lineKey(itemId: string, variantSku: string | null) {
  return `${itemId}::${variantSku ?? ""}`;
}

/**
 * Variant picker for the SPG sale screen — mirrors VanVariantSheet
 * (apps/web/app/pwa/van/VanVariantSheet.tsx) but drops the qtyOnVan stock cap:
 * SpgSale is record-only (no stock ledger backs it), so every variant with a
 * price is sellable, unbounded.
 */
export function SpgVariantSheet({
  group,
  cart,
  setQty,
  open,
  onOpenChange,
}: {
  group: SpgGroup | null;
  cart: Map<string, { qty: number }>;
  setQty: (row: SpgCatalogRow, qty: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    if (!group) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return group.variants;
    return group.variants.filter(
      (v) => (v.variantLabel ?? "").toLowerCase().includes(needle) || (v.variantSku ?? "").toLowerCase().includes(needle),
    );
  }, [group, q]);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setQ("");
        onOpenChange(next);
      }}
    >
      <SheetContent side="bottom" className="flex max-h-[85vh] flex-col gap-0 p-0">
        {group && (
          <>
            <SheetHeader className="border-b pb-3">
              <SheetTitle>Pilih Varian</SheetTitle>
              <SheetDescription>{group.productName}</SheetDescription>
            </SheetHeader>

            <div className="px-4 pt-3">
              <Input placeholder="Cari varian..." value={q} onChange={(e) => setQ(e.target.value)} />
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {filtered.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Varian tidak ditemukan.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {filtered.map((v) => {
                    const key = lineKey(v.itemId, v.variantSku);
                    const qty = cart.get(key)?.qty ?? 0;
                    const canSell = v.price !== null;
                    const label = v.variantLabel ?? v.variantSku ?? v.productName;
                    return (
                      <div key={key} className="flex items-center gap-3 rounded-lg border p-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{label}</p>
                          <div className="mt-1">
                            {v.price !== null ? (
                              <span className="text-xs text-muted-foreground tabular-nums">{rupiah(v.price)}</span>
                            ) : (
                              <Badge variant="outline" className="text-xs italic text-muted-foreground">
                                Harga belum diset
                              </Badge>
                            )}
                          </div>
                        </div>
                        {canSell && (
                          <div className="flex shrink-0 items-center gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-lg"
                              disabled={qty <= 0}
                              onClick={() => setQty(v, qty - 1)}
                              aria-label={`Kurangi ${label}`}
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <span className="w-5 text-center text-sm font-semibold tabular-nums">{qty}</span>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-lg"
                              onClick={() => setQty(v, qty + 1)}
                              aria-label={`Tambah ${label}`}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <SheetFooter className="border-t pt-3">
              <Button type="button" className="w-full" onClick={() => onOpenChange(false)}>
                Selesai
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
