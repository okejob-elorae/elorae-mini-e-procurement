"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Minus, Plus } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CartLine } from "@/lib/field-sales/cart";

// Mirrors the CatalogItem shape from CatalogShell.tsx (kept local rather than imported —
// same convention CatalogShell itself uses instead of importing @/lib/catalog/queries).
type CatalogItem = {
  itemId: string;
  sku: string;
  nameId: string;
  categoryId: string | null;
  categoryName: string | null;
  primaryImageUrl: string | null;
  available: number;
  price: number | null;
  priceLabel: string | null;
  neverSent: boolean;
  minOrderQty: number;
  variants: Array<{ variantSku: string; variantLabel: string; available: number }>;
};

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export function VariantSheet({
  item,
  isKonsi,
  hasActiveVisit,
  cart,
  setQty,
  open,
  onOpenChange,
}: {
  item: CatalogItem | null;
  isKonsi: boolean;
  hasActiveVisit: boolean;
  cart: Map<string, CartLine>;
  setQty: (item: CatalogItem, variantSku: string, variantLabel: string | null, qty: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pwa.catalog");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    if (!item) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return item.variants;
    return item.variants.filter(
      (v) => v.variantLabel.toLowerCase().includes(needle) || v.variantSku.toLowerCase().includes(needle),
    );
  }, [item, q]);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setQ("");
        onOpenChange(next);
      }}
    >
      <SheetContent side="bottom" className="flex max-h-[85vh] flex-col gap-0 p-0">
        {item && (
          <>
            <SheetHeader className="border-b pb-3">
              <SheetTitle>{t("variantSheetTitle")}</SheetTitle>
              <SheetDescription>{item.nameId}</SheetDescription>
            </SheetHeader>

            <div className="px-4 pt-3">
              <Input
                placeholder={t("variantSearchPlaceholder")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {filtered.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("variantEmpty")}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {filtered.map((v) => {
                    const key = `${item.itemId}::${v.variantSku}`;
                    const qty = cart.get(key)?.qty ?? 0;
                    return (
                      <div key={v.variantSku} className="flex items-center gap-3 rounded-lg border p-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{v.variantLabel}</p>
                          <div className="mt-1 flex items-center gap-1.5">
                            <Badge variant={v.available > 0 ? "secondary" : "destructive"}>
                              {v.available > 0 ? t("variantAvailable", { available: v.available }) : t("variantOutOfStock")}
                            </Badge>
                            {!isKonsi && item.price != null && (
                              <span className="text-xs text-muted-foreground tabular-nums">{rupiah(item.price)}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-lg"
                            disabled={!hasActiveVisit || qty <= 0}
                            onClick={() => setQty(item, v.variantSku, v.variantLabel, qty - 1)}
                            aria-label={`Kurangi ${v.variantLabel}`}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                          <span className="w-5 text-center text-sm font-semibold tabular-nums">{qty}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-lg"
                            disabled={!hasActiveVisit || qty >= v.available}
                            onClick={() => setQty(item, v.variantSku, v.variantLabel, qty + 1)}
                            aria-label={`Tambah ${v.variantLabel}`}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <SheetFooter className="border-t pt-3">
              <Button type="button" className="w-full" onClick={() => onOpenChange(false)}>
                {t("sheetDone")}
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
