"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { GrnTanpaPoMenunggu } from "@/app/actions/stock-opname";

/**
 * Penerimaan tanpa PO yang masih menunggu konfirmasi admin (P51a), di layar hitung dan layar
 * rincian opname: barangnya sudah di rak tetapi belum masuk stok, jadi kalau ikut dihitung lalu
 * GRN-nya dikonfirmasi stoknya dobel. Daftar kosong = tidak tampil.
 */
export function KartuGrnTanpaPoMenunggu({ grn }: { grn: GrnTanpaPoMenunggu[] }) {
  const t = useTranslations("stockOpname.grnTanpaPoMenunggu");
  if (grn.length === 0) return null;

  return (
    <Card className="border-amber-300 bg-amber-50 py-0 dark:border-amber-900 dark:bg-amber-950/30">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">{t("judul")}</p>
            <p className="text-sm text-amber-900/90 dark:text-amber-200/90">{t("isi")}</p>
          </div>
        </div>
        <ul className="divide-y rounded-md border bg-background text-sm">
          {grn.map((g) => (
            <li key={g.id} className="space-y-1 px-3 py-2">
              <p className="font-medium">
                {g.docNumber} · {g.pemasok}
              </p>
              <ul className="space-y-0.5 text-muted-foreground">
                {g.barang.map((b, i) => {
                  const kode = b.variantSku || b.sku;
                  return (
                    <li key={`${b.itemId}-${b.variantSku ?? ""}-${i}`}>
                      {b.nama}
                      {kode ? ` (${kode})` : ""} × {b.qty.toLocaleString("id-ID")}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
