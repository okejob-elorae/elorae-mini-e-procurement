"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";

/**
 * "Di rak: N" — saldo buku stok toko SPG (pcs, boleh minus; opname yang
 * meluruskan). `jumlah` tidak ada = toko tanpa buku / barang belum pernah
 * tercatat di toko itu → tidak menampilkan apa-apa. Juga di toko konsinyasi:
 * hanya potong, tanpa harga.
 */
export function LencanaRak({ jumlah }: { jumlah?: number }) {
  const t = useTranslations("pwa.catalog");
  if (jumlah === undefined) return null;
  return (
    <Badge variant="outline" className="tabular-nums">
      {t("diRak", { jumlah })}
    </Badge>
  );
}
