"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Minus, Plus } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatIDR } from "@/lib/sales-orders/format";
import { kunciBaris } from "@/lib/spg/stok";
import type { SpgCatalogRow } from "@/lib/spg/sale-queries";
import { cn } from "@/lib/utils";

export type SpgGroup = {
  itemId: string;
  sku: string;
  productName: string;
  price: number | null;
  /** Jumlah saldo toko semua varian; null kalau katalog dimuat tanpa toko. */
  stok: number | null;
  variants: SpgCatalogRow[];
};

/** Label satu varian di layar: label varian, SKU varian, atau nama barang. */
export function labelVarian(v: SpgCatalogRow): string {
  return v.variantLabel ?? v.variantSku ?? v.productName;
}

/**
 * Teks stok toko satu baris. Stok nol atau minus tampil sebagai PERINGATAN
 * halus, tidak pernah menutup tombol tambah: barang yang laku di toko memang
 * laku, dan selisih buku dibereskan opname — bukan dengan menolak penjualan.
 */
export function TeksStok({ qty, lengkap = false }: { qty: number; lengkap?: boolean }) {
  const t = useTranslations("pwa.spgJual");
  const habis = qty <= 0;
  return (
    <span className={cn("text-xs tabular-nums", habis ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
      {habis && lengkap ? t("stockSellAnyway", { qty }) : t("stock", { qty })}
    </span>
  );
}

/**
 * Pemilih varian untuk layar jual SPG. Dibuka dari hasil cari (barang
 * bervarian) atau dari pindaian SKU induk — pindaian itu tahu barangnya, tidak
 * tahu ukurannya.
 */
export function SpgVariantSheet({
  group,
  qtyOf,
  setQty,
  open,
  onOpenChange,
  stokDilacak,
}: {
  group: SpgGroup | null;
  qtyOf: (row: SpgCatalogRow) => number;
  setQty: (row: SpgCatalogRow, qty: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stokDilacak: boolean;
}) {
  const t = useTranslations("pwa.spgJual");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    if (!group) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return group.variants;
    return group.variants.filter(
      (v) =>
        (v.variantLabel ?? "").toLowerCase().includes(needle) ||
        (v.variantSku ?? "").toLowerCase().includes(needle) ||
        (v.barcode ?? "").toLowerCase().includes(needle),
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
      <SheetContent side="bottom" className="mx-auto flex max-h-[85dvh] w-full max-w-xl flex-col gap-0 p-0">
        {group && (
          <>
            <SheetHeader className="border-b pb-3">
              <SheetTitle>{t("variantSheet.title")}</SheetTitle>
              <SheetDescription>
                {group.productName} · {group.sku}
              </SheetDescription>
            </SheetHeader>

            {/* Kolom cari hanya berguna kalau variannya banyak; untuk tiga
                ukuran ia cuma mendorong daftar ke bawah. */}
            {group.variants.length > 6 && (
              <div className="px-4 pt-3">
                <Input
                  placeholder={t("variantSheet.search")}
                  aria-label={t("variantSheet.search")}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4">
              {filtered.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("variantSheet.empty")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {filtered.map((v) => {
                    const qty = qtyOf(v);
                    const label = labelVarian(v);
                    return (
                      <li
                        key={kunciBaris(v.itemId, v.variantSku)}
                        className={cn("flex items-center gap-3 rounded-lg border p-3", qty > 0 && "border-primary/50 bg-primary/5")}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{label}</p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            {v.price !== null ? (
                              <span className="text-xs tabular-nums text-muted-foreground">{formatIDR(v.price)}</span>
                            ) : (
                              <span className="text-xs italic text-muted-foreground">{t("noPrice")}</span>
                            )}
                            {stokDilacak && v.stok !== null ? <TeksStok qty={v.stok} lengkap /> : null}
                          </div>
                        </div>
                        {v.price !== null && (
                          <div className="flex shrink-0 items-center gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-lg"
                              disabled={qty <= 0}
                              onClick={() => setQty(v, qty - 1)}
                              aria-label={t("decrease", { name: label })}
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <span className="w-6 text-center text-sm font-semibold tabular-nums">{qty}</span>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-lg"
                              onClick={() => setQty(v, qty + 1)}
                              aria-label={t("add", { name: label })}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <SheetFooter className="border-t pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <Button type="button" className="w-full" size="lg" onClick={() => onOpenChange(false)}>
                {t("variantSheet.done")}
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
