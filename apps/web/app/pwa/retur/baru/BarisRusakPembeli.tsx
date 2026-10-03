"use client";

import { useTranslations } from "next-intl";
import { Minus, PackageX, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dinamis } from "@/lib/i18n/dinamis";
import type { KondisiRusak } from "@/lib/spg/gudang-rusak";

/**
 * Barang rusak yang dikembalikan pembeli di konter dan dikirim balik ke gudang
 * barang rusak: kondisinya terkunci (RUSAK/EXPIRED dari retur pembelinya),
 * jumlahnya paling banyak `sisa`, dan barisnya menunjuk baris retur pembeli —
 * tidak mengurangi buku stok toko, karena barang itu tidak pernah kembali ke rak.
 */
export type BarisRusakPembeliAwal = {
  spgSaleReturnLineId: string;
  itemId: string;
  variantSku: string;
  nama: string;
  /** Nomor nota SPG asal barangnya. */
  docNo: string;
  kondisi: KondisiRusak;
  sisa: number;
  qty: number;
};

export function BarisRusakPembeli({
  baris,
  pending,
  onUbahQty,
  onHapus,
}: {
  baris: BarisRusakPembeliAwal[];
  pending: boolean;
  onUbahQty: (id: string, qty: number) => void;
  onHapus: (id: string) => void;
}) {
  const t = useTranslations("gudangRusak");
  const td = dinamis(t);
  const tr = useTranslations("spgRetur");
  if (baris.length === 0) return null;
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{t("retur.judul")}</p>
      {baris.map((b) => (
        <div key={b.spgSaleReturnLineId} className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2">
              <PackageX className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <div className="min-w-0">
                <p className="font-medium">{b.nama}</p>
                {b.variantSku ? <p className="text-xs text-muted-foreground">{b.variantSku}</p> : null}
                <p className="text-xs text-muted-foreground">{t("retur.dari", { doc: b.docNo, n: b.sisa })}</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" aria-label={tr("hapus")} onClick={() => onHapus(b.spgSaleReturnLineId)} disabled={pending}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label={tr("kurangi")}
              onClick={() => onUbahQty(b.spgSaleReturnLineId, b.qty - 1)}
              disabled={pending || b.qty <= 1}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={b.sisa}
              className="w-16 text-center tabular-nums"
              aria-label={tr("qty")}
              value={b.qty}
              onChange={(e) => onUbahQty(b.spgSaleReturnLineId, Number(e.target.value))}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label={tr("tambahSatu")}
              onClick={() => onUbahQty(b.spgSaleReturnLineId, b.qty + 1)}
              disabled={pending || b.qty >= b.sisa}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <span className="min-w-0 flex-1 text-sm text-muted-foreground">{td(`kondisi.${b.kondisi}`)}</span>
          </div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">{t("retur.penjelasan")}</p>
    </div>
  );
}
