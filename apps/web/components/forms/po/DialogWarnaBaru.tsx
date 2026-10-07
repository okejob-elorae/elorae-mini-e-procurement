"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listPantoneColorsForTheme, type PantoneThemeSwatch } from "@/app/actions/settings/theme";
import { tambahVarianWarnaBahanAction } from "@/app/actions/po-varian-warna";
import type { ItemVariantRow } from "@/lib/items/variants";
import { MAKS_PANJANG_WARNA, labelPantone, normalisasiWarna, skuVarianWarna } from "@/lib/purchase-orders/varian-warna";

export type VarianWarnaBaru = { sku: string; warna: string; pantone: string | null; hex: string | null };

/**
 * "+ Warna baru": menambah varian warna ke bahan (bukan barang jadi) langsung
 * dari formulir PO, dengan kode Pantone TCX opsional dari katalog Pantone.
 * Warna yang ternyata sudah ada langsung dipilih.
 */
export function DialogWarnaBaru({
  bahan,
  open,
  onOpenChange,
  onDibuat,
  onSudahAda,
}: {
  bahan: { id: string; sku: string; nama: string } | null;
  open: boolean;
  onOpenChange: (buka: boolean) => void;
  onDibuat: (varian: VarianWarnaBaru, variants: ItemVariantRow[]) => void;
  onSudahAda: (sku: string, variants: ItemVariantRow[] | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {/* Isi dilepas saat dialog tertutup, jadi setiap pembukaan mulai kosong. */}
        {bahan ? <IsiWarnaBaru bahan={bahan} onTutup={() => onOpenChange(false)} onDibuat={onDibuat} onSudahAda={onSudahAda} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function IsiWarnaBaru({
  bahan,
  onTutup,
  onDibuat,
  onSudahAda,
}: {
  bahan: { id: string; sku: string; nama: string };
  onTutup: () => void;
  onDibuat: (varian: VarianWarnaBaru, variants: ItemVariantRow[]) => void;
  onSudahAda: (sku: string, variants: ItemVariantRow[] | null) => void;
}) {
  const t = useTranslations("purchaseOrders.warnaBaru");
  const [warna, setWarna] = useState("");
  const [cari, setCari] = useState("");
  const [hasilCari, setHasilCari] = useState<{ q: string; warna: PantoneThemeSwatch[] } | null>(null);
  const [pantone, setPantone] = useState<PantoneThemeSwatch | null>(null);
  const [menyimpan, mulai] = useTransition();
  const q = cari.trim();

  useEffect(() => {
    if (q.length < 2) return;
    let batal = false;
    const h = setTimeout(() => {
      listPantoneColorsForTheme(q, 1)
        .then((r) => {
          if (!batal) setHasilCari({ q, warna: r.colors.slice(0, 24) });
        })
        .catch(() => {
          if (!batal) setHasilCari({ q, warna: [] });
        });
    }, 300);
    return () => {
      batal = true;
      clearTimeout(h);
    };
  }, [q]);

  const mencari = q.length >= 2 && hasilCari?.q !== q;
  const daftarPantone = q.length >= 2 && hasilCari?.q === q ? hasilCari.warna : [];

  const warnaRapi = normalisasiWarna(warna);
  const skuAkan = /[A-Z0-9]/.test(warnaRapi) ? skuVarianWarna(bahan.sku, warnaRapi) : null;

  const simpan = () => {
    if (!skuAkan || menyimpan) return;
    mulai(async () => {
      try {
        const hasil = await tambahVarianWarnaBahanAction(bahan.id, {
          warna: warnaRapi,
          pantone: pantone ? labelPantone(pantone.tcx) : null,
        });
        if (hasil.ok) {
          onDibuat(hasil.varian, hasil.variants);
          toast.success(t("berhasil", { warna: hasil.varian.warna, bahan: bahan.nama }));
          onTutup();
          return;
        }
        if (hasil.kode === "VARIAN_SUDAH_ADA" && "sku" in hasil && hasil.sku) {
          onSudahAda(hasil.sku, "variants" in hasil && hasil.variants ? hasil.variants : null);
          toast.info(t("sudahAda"));
          onTutup();
          return;
        }
        toast.error(t(`err.${hasil.kode}`));
      } catch {
        toast.error(t("err.GAGAL"));
      }
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("judul", { bahan: bahan.nama })}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="warna-baru">{t("warna")}</Label>
          <Input
            id="warna-baru"
            value={warna}
            maxLength={MAKS_PANJANG_WARNA}
            onChange={(e) => setWarna(e.target.value)}
            placeholder={t("warnaContoh")}
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                simpan();
              }
            }}
          />
          {skuAkan ? <p className="text-xs text-muted-foreground">{t("skuAkan", { sku: skuAkan })}</p> : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="pantone-cari">{t("pantone")}</Label>
          {pantone ? (
            <div className="flex items-center gap-2 rounded-md border p-2">
              <span className="h-6 w-6 shrink-0 rounded border" style={{ backgroundColor: pantone.hex }} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="font-mono">{labelPantone(pantone.tcx)}</span> · {pantone.name}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setPantone(null)}
                aria-label={t("hapusPantone")}
                title={t("hapusPantone")}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search aria-hidden className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="pantone-cari"
                  value={cari}
                  onChange={(e) => setCari(e.target.value)}
                  placeholder={t("cariPantone")}
                  className="pl-9"
                  autoComplete="off"
                />
              </div>
              {mencari ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("pantoneMemuat")}
                </p>
              ) : q.length >= 2 && daftarPantone.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("pantoneKosong")}</p>
              ) : daftarPantone.length > 0 ? (
                <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                  {daftarPantone.map((c) => (
                    <Button
                      key={c.tcx}
                      type="button"
                      variant="outline"
                      onClick={() => setPantone(c)}
                      className="h-auto min-w-0 justify-start gap-2 px-2 py-1.5 text-left font-normal"
                    >
                      <span className="h-5 w-5 shrink-0 rounded border" style={{ backgroundColor: c.hex }} aria-hidden />
                      <span className="min-w-0 truncate">
                        <span className="font-mono">{c.tcx}</span> {c.name}
                      </span>
                    </Button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onTutup} disabled={menyimpan}>
          {t("batal")}
        </Button>
        <Button type="button" onClick={simpan} disabled={menyimpan || !skuAkan}>
          {menyimpan ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("menyimpan")}
            </>
          ) : (
            t("simpan")
          )}
        </Button>
      </DialogFooter>
    </>
  );
}
