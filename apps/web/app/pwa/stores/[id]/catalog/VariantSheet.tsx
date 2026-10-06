"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Package } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CartLine } from "@/lib/field-sales/cart";
import type { PackRatioRow } from "@elorae/db/pack-ratio";
import { grupPack, tambahSatuPack, type KurangPack, type PetaUkuranPack } from "@/lib/field-sales/keranjang-katalog";
import { QtyStepper } from "./QtyStepper";
import { LencanaRak } from "./LencanaRak";

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
  diRak?: number;
  variants: Array<{ variantSku: string; variantLabel: string; available: number; diRak?: number }>;
};

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export function VariantSheet({
  item,
  isKonsi,
  inden = false,
  hasActiveVisit,
  cart,
  setQty,
  rasioPack = [],
  petaUkuran = {},
  onJepit,
  open,
  onOpenChange,
}: {
  item: CatalogItem | null;
  isKonsi: boolean;
  /** Pre-order: varian belum ada di gudang — "akan datang", tanpa batas stok. */
  inden?: boolean;
  hasActiveVisit: boolean;
  cart: Map<string, CartLine>;
  setQty: (item: CatalogItem, variantSku: string, variantLabel: string | null, qty: number) => void;
  /** Rasio pack global (Pengaturan → Rasio Pack); kosong = tombol pack tidak tampil. */
  rasioPack?: PackRatioRow[];
  /** variantSku → [ukuran, warna], hanya ukuran yang ada di rasio. */
  petaUkuran?: PetaUkuranPack;
  /** Jumlah yang diketik melewati batas dan dijepit ke `max`. */
  onJepit?: (max: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pwa.catalog");
  const tKredit = useTranslations("pwa.kredit");
  const tInden = useTranslations("pwa.inden");
  const [q, setQ] = useState("");
  /** Hasil "+1 pack" terakhir yang tidak penuh — satu baris peringatan, hilang di aksi berikutnya. */
  const [kurangPack, setKurangPack] = useState<KurangPack[] | null>(null);
  // Minimum pesan dihitung per barang: semua varian di keranjang dijumlah.
  let dipilih = 0;
  if (item) for (const l of cart.values()) if (l.itemId === item.itemId) dipilih += l.qty;
  const tampilkanMinimum = !!item && !isKonsi && item.minOrderQty > 1;

  const filtered = useMemo(() => {
    if (!item) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return item.variants;
    return item.variants.filter(
      (v) => v.variantLabel.toLowerCase().includes(needle) || v.variantSku.toLowerCase().includes(needle),
    );
  }, [item, q]);

  // Grup warna yang bisa diisi per pack; kosong = barang ini tidak bertanda ukuran dari rasio.
  const grup = useMemo(
    () => (item && rasioPack.length > 0 ? grupPack(item.variants, petaUkuran) : []),
    [item, rasioPack, petaUkuran],
  );
  const isiPack = rasioPack.map((r) => `${r.size} ${r.qty}`).join(" · ");

  function tambahPack(g: string) {
    if (!item) return;
    const jumlah: Record<string, number> = {};
    for (const l of cart.values()) if (l.itemId === item.itemId) jumlah[l.variantSku] = l.qty;
    const hasil = tambahSatuPack({ rasio: rasioPack, varian: item.variants, peta: petaUkuran, grup: g, jumlah });
    for (const b of hasil.baris) {
      const v = item.variants.find((x) => x.variantSku === b.variantSku);
      setQty(item, b.variantSku, v?.variantLabel ?? null, b.qty);
    }
    setKurangPack(hasil.kurang.length > 0 ? hasil.kurang : null);
  }

  // Ditutup lewat latar, geser, atau tombol Selesai: pencarian dan peringatan pack ikut bersih.
  function ubahBuka(next: boolean) {
    if (!next) {
      setQ("");
      setKurangPack(null);
    }
    onOpenChange(next);
  }

  const teksKurang = (k: KurangPack) =>
    k.tidakAda ? t("packTidakAda", { ukuran: k.ukuran }) : t("packKurangUkuran", { ukuran: k.ukuran, dapat: k.dapat, butuh: k.butuh });

  return (
    <Sheet open={open} onOpenChange={ubahBuka}>
      <SheetContent side="bottom" className="flex max-h-[85vh] flex-col gap-0 p-0">
        {item && (
          <>
            <SheetHeader className="border-b pb-3">
              <SheetTitle>{t("variantSheetTitle")}</SheetTitle>
              <SheetDescription>{item.nameId}</SheetDescription>
              {tampilkanMinimum && (
                <p
                  className={
                    dipilih > 0 && dipilih < item.minOrderQty ? "text-xs text-destructive" : "text-xs text-muted-foreground"
                  }
                >
                  {tKredit("minPesanLembar", { min: item.minOrderQty, jumlah: dipilih })}
                </p>
              )}
            </SheetHeader>

            <div className="px-4 pt-3">
              <Input
                placeholder={t("variantSearchPlaceholder")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            {hasActiveVisit && grup.length > 0 && (
              <div className="flex flex-col gap-1.5 px-4 pt-3">
                <div className="flex flex-wrap gap-2">
                  {grup.map((g) => (
                    <Button key={g || "-"} type="button" variant="outline" size="sm" onClick={() => tambahPack(g)}>
                      <Package className="h-4 w-4" aria-hidden />
                      {g ? t("packTambahGrup", { grup: g }) : t("packTambah")}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t("packIsi", { rasio: isiPack })}</p>
                {kurangPack && (
                  <p role="status" className="text-xs text-amber-800 dark:text-amber-300">
                    {t("packKurang", { daftar: kurangPack.map(teksKurang).join(", ") })}
                  </p>
                )}
              </div>
            )}

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
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {inden ? (
                              <Badge variant="outline" className="border-amber-500/40 text-amber-800 dark:text-amber-300">
                                {tInden("varianAkanDatang")}
                              </Badge>
                            ) : (
                              <Badge variant={v.available > 0 ? "secondary" : "destructive"}>
                                {v.available > 0 ? t("variantAvailable", { available: v.available }) : t("variantOutOfStock")}
                              </Badge>
                            )}
                            <LencanaRak jumlah={v.diRak} />
                            {!isKonsi && item.price != null && (
                              <span className="text-xs text-muted-foreground tabular-nums">{rupiah(item.price)}</span>
                            )}
                          </div>
                        </div>
                        <QtyStepper
                          value={qty}
                          max={v.available}
                          disabled={!hasActiveVisit}
                          onChange={(n) => {
                            setKurangPack(null);
                            setQty(item, v.variantSku, v.variantLabel, n);
                          }}
                          onJepit={onJepit}
                          labelKurang={t("variantDecrease", { label: v.variantLabel })}
                          labelTambah={t("variantIncrease", { label: v.variantLabel })}
                          labelJumlah={t("jumlahLabel", { label: v.variantLabel })}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <SheetFooter className="border-t pt-3">
              <Button type="button" className="w-full" onClick={() => ubahBuka(false)}>
                {t("sheetDone")}
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
